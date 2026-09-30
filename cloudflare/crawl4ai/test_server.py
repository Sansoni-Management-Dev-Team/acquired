import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock
import importlib.util
import pathlib
import unittest
import io
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("reader", pathlib.Path(__file__).with_name("server.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ReaderPolicyTests(unittest.TestCase):
    def test_http_diagnostics_are_correlated_without_logging_urls_or_credentials(self):
        handler = reader.Handler.__new__(reader.Handler)
        handler.headers = {"x-request-id": "request-1234", "x-research-job-id": "job-12345678", "Authorization": "private-secret"}
        handler.crawl_started = reader.time.monotonic()
        handler.crawl_domain = "example.com"
        handler.wfile = io.BytesIO()
        handler.send_response = lambda _: None
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None
        with patch("builtins.print") as log:
            handler.send_json(429, {"error": "private content", "category": "domain_backoff"}, 3)
        body = reader.json.loads(handler.wfile.getvalue())
        self.assertEqual(body["reader"]["retryAfterMs"], 3000)
        event = reader.json.loads(log.call_args.args[0].split(" ", 1)[1])
        self.assertEqual(event["requestId"], "request-1234")
        self.assertEqual(event["jobId"], "job-12345678")
        self.assertNotIn("example.com", str(event))
        self.assertNotIn("private", str(event))

    def test_capacity_diagnostics_and_release(self):
        with patch.object(reader, "busy", reader.threading.BoundedSemaphore(2)), patch.object(reader, "CONCURRENCY", 2), patch.object(reader, "active_reads", 0):
            self.assertTrue(reader.acquire_slot())
            self.assertTrue(reader.acquire_slot())
            self.assertFalse(reader.acquire_slot())
            self.assertEqual(reader.reader_diagnostics(reader.time.monotonic())["availableReads"], 0)
            reader.release_slot()
            self.assertEqual(reader.reader_diagnostics(reader.time.monotonic())["activeReads"], 1)
            reader.release_slot()

    def test_domain_diagnostics_distinguish_active_read_from_cooldown(self):
        reader.domains.clear()
        reader.active_domains.clear()
        started = reader.time.monotonic()
        reader.claim_domain("example.com")
        diagnostics = reader.reader_diagnostics(started, "example.com", 3)
        self.assertTrue(diagnostics["domainActive"])
        self.assertEqual(diagnostics["retryAfterMs"], 3000)
        self.assertNotIn("example.com", str(diagnostics))
        reader.release_domain("example.com")
        self.assertFalse(reader.reader_diagnostics(started, "example.com")["domainActive"])

    def test_rejects_private_destinations_and_mixed_dns(self):
        for addresses in [["127.0.0.1"], ["169.254.169.254"], ["::1"], ["8.8.8.8", "10.0.0.1"]]:
            with patch.object(reader.socket, "getaddrinfo", return_value=[(None, None, None, None, (ip, 443)) for ip in addresses]):
                self.assertFalse(reader.public_url("https://example.com"))
        for url in ["http://example.com", "https://user:pass@example.com", "https://example.com:8080", "https://host.local"]:
            self.assertFalse(reader.public_url(url))

    def test_allows_public_https(self):
        with patch.object(reader.socket, "getaddrinfo", return_value=[(None, None, None, None, ("8.8.8.8", 443))]):
            self.assertTrue(reader.public_url("https://example.com"))

    def test_domain_admission_and_cooldown(self):
        reader.domains.clear()
        with patch.object(reader.time, "monotonic", return_value=100):
            self.assertEqual(reader.claim_domain("example.com"), 0)
            self.assertEqual(reader.claim_domain("example.com"), 45)
            reader.release_domain("example.com", 30)
        with patch.object(reader.time, "monotonic", return_value=120):
            self.assertEqual(reader.claim_domain("example.com"), 10)
            self.assertEqual(reader.claim_domain("another.com"), 0)
        with patch.object(reader.time, "monotonic", return_value=131):
            self.assertEqual(reader.claim_domain("example.com"), 0)


class ReaderPoolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reader.pool = None
        self.crawler = SimpleNamespace(
            arun=AsyncMock(return_value=SimpleNamespace(success=True, status_code=200, url="https://example.com/", markdown=SimpleNamespace(raw_markdown="Company manufactures precision instruments."))),
            close=AsyncMock(), crawler_strategy=SimpleNamespace(kill_session=AsyncMock()))
        self.fake_module = SimpleNamespace(CrawlerRunConfig=lambda **kw: SimpleNamespace(**kw), CacheMode=SimpleNamespace(BYPASS="bypass"))

    async def test_reuses_browsers_and_cleans_unique_sessions(self):
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "CONCURRENCY", 1), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)) as create, patch.object(reader, "public_url", return_value=True):
            await reader.read_page("https://example.com/")
            await reader.read_page("https://example.com/about")
            create.assert_awaited_once()
            sessions = [call.args[0] for call in self.crawler.crawler_strategy.kill_session.await_args_list]
            self.assertEqual(len(set(sessions)), 2)
            self.crawler.close.assert_not_awaited()

    async def test_discards_browser_after_cancellation(self):
        self.crawler.arun.side_effect = asyncio.CancelledError()
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "CONCURRENCY", 1), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)):
            with self.assertRaises(asyncio.CancelledError):
                await reader.read_page("https://example.com/")
            self.crawler.close.assert_awaited_once()
            self.assertIsNone(reader.pool.get_nowait())


if __name__ == "__main__":
    unittest.main()
