"""Bounded public reader with warm browsers and optional bearer authentication."""
import asyncio
import hmac
import hashlib
import re
import math
import time
import uuid
import ipaddress
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

CONCURRENCY = max(1, min(5, int(os.environ.get("CRAWL4AI_CONCURRENCY", "1"))))
busy = threading.BoundedSemaphore(CONCURRENCY)
capacity_lock = threading.Lock()
active_reads = 0
service_secret = os.environ.get("SERVICE_SECRET", "")
pool = None
domain_lock = threading.Lock()
domains = {}
active_domains = set()
DOMAIN_DELAY = max(1, int(os.environ.get("CRAWL4AI_DOMAIN_DELAY", "3")))
# This is a polling hint, not the active read's lease or post-read cooldown.
# Returning the stale lease (45 seconds) can unnecessarily pause a caller long
# after a normal 2–5 second read and its real cooldown have finished.
ACTIVE_DOMAIN_RETRY_SECONDS = 3


TRANSPORT_FAILURES = frozenset({"connection_refused", "dns_resolution_failed", "timeout", "connection_reset", "connection_closed", "tls_verification_failed", "network_unavailable", "navigation_failed"})


def classify_transport_failure(error):
    """Diagnostic classification only; never expose raw messages/URLs or retry.

    Crawl4AI returns failed navigation as a result rather than an exception, so
    status/category alone cannot distinguish network refusal from an empty page.
    """
    if isinstance(error, ConnectionRefusedError):
        return "connection_refused"
    if isinstance(error, socket.gaierror):
        return "dns_resolution_failed"
    if isinstance(error, TimeoutError):
        return "timeout"
    try:
        text = (error if isinstance(error, str) else str(error) if isinstance(error, Exception) else "")[:16000].lower()
        for tokens, category in [
            (("net::err_connection_refused", "econnrefused"), "connection_refused"),
            (("net::err_name_not_resolved", "eai_again"), "dns_resolution_failed"),
            (("net::err_timed_out", "net::err_connection_timed_out", "timeouterror"), "timeout"),
            (("net::err_connection_reset",), "connection_reset"),
            (("net::err_connection_closed",), "connection_closed"),
            (("net::err_cert_",), "tls_verification_failed"),
            (("net::err_internet_disconnected", "net::err_network_changed"), "network_unavailable"),
            (("net::err_failed",), "navigation_failed"),
        ]:
            if any(token in text for token in tokens):
                return category
    except Exception:
        pass  # Diagnostics cannot change a failed read's original outcome.
    return None


class ReadError(Exception):
    def __init__(self, category, status=502, origin_status=None, transport_failure=None):
        self.category, self.status = category, status
        self.origin_status = origin_status
        self.transport_failure = transport_failure if transport_failure in TRANSPORT_FAILURES else None


def acquire_slot():
    global active_reads
    with capacity_lock:
        if not busy.acquire(blocking=False):
            return False
        active_reads += 1
        return True


def release_slot():
    global active_reads
    with capacity_lock:
        active_reads -= 1
        busy.release()


def reader_diagnostics(started, domain=None, retry_after=None):
    with capacity_lock:
        data = {"activeReads": active_reads, "maxReads": CONCURRENCY, "availableReads": max(0, CONCURRENCY - active_reads)}
    data["elapsedMs"] = round((time.monotonic() - started) * 1000)
    if retry_after is not None:
        data["retryAfterMs"] = retry_after * 1000
    if domain:
        data["domainKey"] = hashlib.sha256(domain.encode()).hexdigest()[:12]
        with domain_lock:
            data["domainActive"] = domain in active_domains
    return data


def claim_domain(host):
    with domain_lock:
        now = time.monotonic()
        for key in list(domains):
            if domains[key] <= now:
                del domains[key]
                active_domains.discard(key)
        if host in domains:
            remaining = max(1, math.ceil(domains[host] - now))
            return min(ACTIVE_DOMAIN_RETRY_SECONDS, remaining) if host in active_domains else remaining
        domains[host] = now + 45
        active_domains.add(host)
        return 0


def release_domain(host, cooldown=DOMAIN_DELAY):
    with domain_lock:
        domains[host] = time.monotonic() + cooldown
        active_domains.discard(host)


reader_loop = asyncio.new_event_loop()


def public_url(url, diagnostics=None):
    validation = diagnostics if diagnostics is not None else {}
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username or parsed.password:
            validation["urlValidationReason"] = "scheme_or_credentials"
            return False
        if not parsed.hostname or "." not in parsed.hostname or parsed.hostname.endswith((".localhost", ".local", ".internal")):
            validation["urlValidationReason"] = "hostname"
            return False
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        allowed = bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
        validation["urlValidationReason"] = "allowed" if allowed else "non_public_address"
        return allowed
    except OSError as error:
        validation["urlValidationReason"] = "dns_resolution_failed"
        if isinstance(error.errno, int):
            validation["dnsErrorCode"] = error.errno
        return False
    except ValueError:
        validation["urlValidationReason"] = "malformed_url"
        return False


async def create_crawler():
    from crawl4ai import AsyncWebCrawler, BrowserConfig
    crawler = AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False))
    await crawler.start()

    async def guard(page, context, **kwargs):
        async def route_request(route):
            if await asyncio.to_thread(public_url, route.request.url):
                await route.continue_()
            else:
                await route.abort()
        await context.route("**/*", route_request)
        return page
    crawler.crawler_strategy.set_hook("on_page_context_created", guard)
    return crawler


async def read_page(url, only_main_content=True):
    from crawl4ai import CrawlerRunConfig, CacheMode
    global pool
    if pool is None:
        pool = asyncio.Queue()
        for _ in range(CONCURRENCY):
            pool.put_nowait(None)
    crawler = await pool.get()
    session = str(uuid.uuid4())
    healthy = False
    try:
        if crawler is None:
            crawler = await create_crawler()
        result = await crawler.arun(url=url, config=CrawlerRunConfig(
            session_id=session, cache_mode=CacheMode.BYPASS,
            wait_until="domcontentloaded", delay_before_return_html=1,
            page_timeout=25000, check_robots_txt=True, verbose=False,
            **({"word_count_threshold": 0, "excluded_tags": [], "excluded_selector": None}
               if not only_main_content else {}),
        ))
        healthy = True
        status = getattr(result, "status_code", None)
        if status == 429:
            raise ReadError("origin_rate_limit", 429)
        if status and status >= 400:
            raise ReadError("origin_http_error", origin_status=status)
        if not result.success or not result.markdown:
            raise ReadError("page_unavailable", transport_failure=classify_transport_failure(getattr(result, "error_message", None)))
        final_url = getattr(result, "redirected_url", None) or result.url
        if not await asyncio.to_thread(public_url, final_url):
            raise ReadError("unsupported_redirect")
        markdown = result.markdown.raw_markdown
        if only_main_content:
            return {"url": final_url, "markdown": markdown[:30000]}
        # Raw HTML retains short footer/contact blocks removed by a content
        # extractor. Keep the full-page contract explicit and bounded.
        html = getattr(result, "html", "") or ""
        return {"url": final_url, "markdown": markdown[:100000], "html": html[:250000],
                "only_main_content": False,
                "truncated": len(markdown) > 100000 or len(html) > 250000}
    finally:
        if crawler is not None:
            try:
                # Unique session per read: keep the browser process warm, but close
                # its page AND isolated context so cookies/storage cannot cross jobs.
                await crawler.crawler_strategy.kill_session(session)
            except Exception:
                healthy = False
            if not healthy:
                try:
                    await crawler.close()
                except Exception:
                    pass
                crawler = None
        pool.put_nowait(crawler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log URLs, page contents or credentials.

    def correlation(self):
        result = {}
        for header, key in [("x-request-id", "requestId"), ("x-research-job-id", "jobId")]:
            value = self.headers.get(header, "")
            if re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", value):
                result[key] = value
        return result

    def send_json(self, status, data, retry_after=None):
        if hasattr(self, "crawl_started"):
            diagnostics = reader_diagnostics(self.crawl_started, getattr(self, "crawl_domain", None), retry_after)
            diagnostics.update(getattr(self, "url_validation", {}))
            data = {**data, "reader": diagnostics}
            transport = getattr(self, "transport_failure", None)
            print("research-reader " + json.dumps({"module": "public-reader", "event": "response", "httpStatus": status, "category": data.get("category", "succeeded" if status == 200 else "invalid_request"), **({"originHttpStatus": data["originHttpStatus"]} if data.get("originHttpStatus") else {}), **({"transportFailure": transport} if transport in TRANSPORT_FAILURES else {}), **self.correlation(), **diagnostics}), flush=True)
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if retry_after is not None:
            self.send_header("Retry-After", str(retry_after))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.send_json(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        if self.path != "/crawl":
            return self.send_json(404, {"error": "Not found"})
        if service_secret and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {service_secret}"):
            return self.send_json(401, {"error": "Unauthorized"})
        self.crawl_started = time.monotonic()
        self.url_validation = {}
        print("research-reader " + json.dumps({"module": "public-reader", "event": "request_started", **self.correlation()}), flush=True)
        if not acquire_slot():
            return self.send_json(429, {"error": "Reader busy", "category": "reader_busy"}, 3)
        future = None
        host = None
        cooldown = DOMAIN_DELAY
        try:
            self.connection.settimeout(10)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                return self.send_json(400, {"error": "Invalid request"})
            data = json.loads(self.rfile.read(length))
            url = data.get("url") if isinstance(data, dict) else None
            if not isinstance(url, str) or not public_url(url, self.url_validation):
                dns_failed = self.url_validation.get("urlValidationReason") == "dns_resolution_failed"
                self.transport_failure = "dns_resolution_failed" if dns_failed else None
                return self.send_json(503 if dns_failed else 400, {"error": "Public URL resolution unavailable" if dns_failed else "Unsupported public URL", "category": "dns_resolution_failed" if dns_failed else "unsupported_public_url"})
            only_main_content = data.get("only_main_content", True)
            if not isinstance(only_main_content, bool):
                return self.send_json(400, {"error": "Invalid content mode"})
            domain = urlsplit(url).hostname.lower().removeprefix("www.")
            self.crawl_domain = domain
            print("research-reader " + json.dumps({"module": "public-reader", "event": "url_validation_completed", **self.correlation(), **self.url_validation, **reader_diagnostics(self.crawl_started, domain)}), flush=True)
            delay = claim_domain(domain)
            if delay:
                return self.send_json(429, {"error": "Domain cooling down", "category": "domain_backoff"}, delay)
            host = domain
            async def bounded():
                return await asyncio.wait_for(read_page(url, only_main_content), timeout=35)
            # Crawl4AI shares async cache resources. All reads must use one loop,
            # including concurrent requests, rather than a new loop per thread.
            future = asyncio.run_coroutine_threadsafe(bounded(), reader_loop)
            self.send_json(200, future.result(timeout=40))
        except ReadError as error:
            self.transport_failure = error.transport_failure
            cooldown = 30 if error.status == 429 else DOMAIN_DELAY
            self.send_json(error.status, {"error": "Page read failed", "category": error.category, **({"originHttpStatus": error.origin_status} if error.origin_status else {})}, cooldown if error.status == 429 else None)
        except Exception as error:
            if future is not None:
                future.cancel()
            category = "reader_timeout" if isinstance(error, TimeoutError) else "reader_failure"
            self.transport_failure = classify_transport_failure(error)
            self.send_json(502, {"error": "Page read failed", "category": category})
        finally:
            if host:
                release_domain(host, cooldown)
            release_slot()


if __name__ == "__main__":
    threading.Thread(target=reader_loop.run_forever, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("CRAWL4AI_PORT", "8080"))), Handler).serve_forever()
