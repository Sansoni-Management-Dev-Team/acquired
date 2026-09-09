"""Bounded, public-only Crawl4AI reader. Authentication terminates at the Worker."""
import asyncio
import ipaddress
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

busy = threading.BoundedSemaphore(1)


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


async def read_page(url):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
        async def guard(page, context, **kwargs):
            async def route_request(route):
                if await asyncio.to_thread(public_url, route.request.url):
                    await route.continue_()
                else:
                    await route.abort()
            await context.route("**/*", route_request)
            return page
        crawler.crawler_strategy.set_hook("on_page_context_created", guard)
        result = await crawler.arun(url=url, config=CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS, wait_until="domcontentloaded",
            page_timeout=25000, check_robots_txt=True, verbose=False,
        ))
        if not result.success or not result.markdown:
            raise ValueError("Page unavailable")
        final_url = getattr(result, "redirected_url", None) or result.url
        if not await asyncio.to_thread(public_url, final_url):
            raise ValueError("Unsupported redirect")
        return {"url": final_url, "markdown": result.markdown.raw_markdown[:30000]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log URLs, page contents or credentials.

    def send_json(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.send_json(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        if self.path != "/crawl":
            return self.send_json(404, {"error": "Not found"})
        if not busy.acquire(blocking=False):
            return self.send_json(429, {"error": "Reader busy"})
        try:
            self.connection.settimeout(10)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                return self.send_json(400, {"error": "Invalid request"})
            data = json.loads(self.rfile.read(length))
            url = data.get("url") if isinstance(data, dict) else None
            if not isinstance(url, str) or not public_url(url):
                return self.send_json(400, {"error": "Unsupported public URL"})
            async def bounded():
                return await asyncio.wait_for(read_page(url), timeout=35)
            self.send_json(200, asyncio.run(bounded()))
        except Exception:
            self.send_json(502, {"error": "Page read failed"})
        finally:
            busy.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
