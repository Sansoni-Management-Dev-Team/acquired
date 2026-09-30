"""Test-only adapter around /app/server.py and its actual Chromium reader.

Synthetic public websites are remapped before navigation. Browser subrequests
are allowed only to the fixture server. Production URL policies are untouched.
"""
import asyncio
import importlib.util
import os
import re
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit, quote

fixture_origin = os.environ.get("E2E_FIXTURE_ORIGIN", "http://host.docker.internal:18124").rstrip("/")
fixture = urlsplit(fixture_origin)
if (fixture.scheme != "http" or fixture.hostname != "host.docker.internal" or fixture.username or fixture.password
        or fixture.path not in ("", "/") or fixture.query or fixture.fragment or not fixture.port):
    raise ValueError("E2E reader requires a host.docker.internal fixture origin with an explicit port")

spec = importlib.util.spec_from_file_location("e2e_real_reader", os.environ.get("E2E_REAL_READER_PATH", "/app/server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def fixture_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "http" and parsed.netloc == fixture.netloc and not parsed.username and not parsed.password
                and not parsed.fragment and (parsed.path.startswith("/fixtures/") or parsed.path == "/robots.txt"))
    except (ValueError, TypeError):
        return False


def mapped_url(url):
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Unsupported E2E source")
    if fixture_url(url):
        return url
    if parsed.scheme != "https" or parsed.port not in (None, 443):
        raise ValueError("Unsupported E2E source")
    match = re.fullmatch(r"(alpha|beta|gamma)\.instruments\.example\.com", parsed.hostname or "")
    if match:
        path = quote(parsed.path or "/", safe="/-._~")
        return f"{fixture_origin}/fixtures/{match[1]}{path}"
    if parsed.hostname == "html.duckduckgo.com" and parsed.path == "/html/":
        return f"{fixture_origin}/fixtures/search?{parsed.query}"
    raise ValueError("Unsupported E2E source")


def test_public_url(url):
    try:
        mapped_url(url)
        return True
    except (ValueError, TypeError):
        return False


real_create_crawler = server.create_crawler
real_read_page = server.read_page


async def fixture_crawler():
    crawler = await real_create_crawler()

    async def guard(page, context, **_kwargs):
        async def route_request(route):
            if fixture_url(route.request.url):
                await route.continue_()
            else:
                await route.abort()
        await context.route("**/*", route_request)
        return page
    crawler.crawler_strategy.set_hook("on_page_context_created", guard)
    return crawler


async def mapped_read_page(url):
    mapped = mapped_url(url)
    result = await real_read_page(mapped)
    if not fixture_url(result["url"]):
        raise server.ReadError("unsupported_redirect")
    return {**result, "url": url}


server.public_url = test_public_url
server.create_crawler = fixture_crawler
server.read_page = mapped_read_page

if __name__ == "__main__":
    threading.Thread(target=server.reader_loop.run_forever, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("E2E_READER_CONTAINER_PORT", "8080"))), server.Handler).serve_forever()
