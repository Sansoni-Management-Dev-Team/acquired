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


class ReadError(Exception):
    def __init__(self, category, status=502, origin_status=None):
        self.category, self.status = category, status
        self.origin_status = origin_status


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


def public_url(url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username or parsed.password:
            return False
        if not parsed.hostname or "." not in parsed.hostname or parsed.hostname.endswith((".localhost", ".local", ".internal")):
            return False
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (ValueError, OSError):
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


async def read_page(url):
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
        ))
        healthy = True
        status = getattr(result, "status_code", None)
        if status == 429:
            raise ReadError("origin_rate_limit", 429)
        if status and status >= 400:
            raise ReadError("origin_http_error", origin_status=status)
        if not result.success or not result.markdown:
            raise ReadError("page_unavailable")
        final_url = getattr(result, "redirected_url", None) or result.url
        if not await asyncio.to_thread(public_url, final_url):
            raise ReadError("unsupported_redirect")
        return {"url": final_url, "markdown": result.markdown.raw_markdown[:30000]}
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

    def send_json(self, status, data, retry_after=None):
        if hasattr(self, "crawl_started"):
            diagnostics = reader_diagnostics(self.crawl_started, getattr(self, "crawl_domain", None), retry_after)
            data = {**data, "reader": diagnostics}
            correlation = {}
            for header, key in [("x-request-id", "requestId"), ("x-research-job-id", "jobId")]:
                value = self.headers.get(header, "")
                if re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", value):
                    correlation[key] = value
            print("research-reader " + json.dumps({"event": "response", "httpStatus": status, "category": data.get("category", "succeeded" if status == 200 else "invalid_request"), **({"originHttpStatus": data["originHttpStatus"]} if data.get("originHttpStatus") else {}), **correlation, **diagnostics}), flush=True)
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
            if not isinstance(url, str) or not public_url(url):
                return self.send_json(400, {"error": "Unsupported public URL"})
            domain = urlsplit(url).hostname.lower().removeprefix("www.")
            self.crawl_domain = domain
            delay = claim_domain(domain)
            if delay:
                return self.send_json(429, {"error": "Domain cooling down", "category": "domain_backoff"}, delay)
            host = domain
            async def bounded():
                return await asyncio.wait_for(read_page(url), timeout=35)
            # Crawl4AI shares async cache resources. All reads must use one loop,
            # including concurrent requests, rather than a new loop per thread.
            future = asyncio.run_coroutine_threadsafe(bounded(), reader_loop)
            self.send_json(200, future.result(timeout=40))
        except ReadError as error:
            cooldown = 30 if error.status == 429 else DOMAIN_DELAY
            self.send_json(error.status, {"error": "Page read failed", "category": error.category, **({"originHttpStatus": error.origin_status} if error.origin_status else {})}, cooldown if error.status == 429 else None)
        except Exception as error:
            if future is not None:
                future.cancel()
            category = "reader_timeout" if isinstance(error, TimeoutError) else "reader_failure"
            self.send_json(502, {"error": "Page read failed", "category": category})
        finally:
            if host:
                release_domain(host, cooldown)
            release_slot()


if __name__ == "__main__":
    threading.Thread(target=reader_loop.run_forever, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
