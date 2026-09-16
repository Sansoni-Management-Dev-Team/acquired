import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("reader", pathlib.Path(__file__).with_name("server.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ReaderPolicyTests(unittest.TestCase):
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
