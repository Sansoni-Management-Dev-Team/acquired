"""Policy and delegation tests; Chromium execution is checked by the E2E launcher."""
import importlib.util
import os
import pathlib
import unittest
from unittest.mock import AsyncMock

root = pathlib.Path(__file__).resolve().parents[2]
os.environ["E2E_REAL_READER_PATH"] = str(root / "cloudflare/crawl4ai/server.py")
os.environ["E2E_FIXTURE_ORIGIN"] = "http://host.docker.internal:18124"
spec = importlib.util.spec_from_file_location("e2e_reader", pathlib.Path(__file__).with_name("reader.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ReaderPolicyTest(unittest.IsolatedAsyncioTestCase):
    def test_no_unmatched_or_credentialed_external_navigation(self):
        for url in ["https://outside.example/", "http://127.0.0.1:3010/", "https://user:secret@alpha.instruments.example.com/", "http://host.docker.internal:18124/__control", "https://alpha.instruments.example.com.evil.test/"]:
            self.assertFalse(reader.test_public_url(url), url)
        self.assertEqual(reader.mapped_url("https://alpha.instruments.example.com/team"), "http://host.docker.internal:18124/fixtures/alpha/team")
        self.assertFalse(reader.fixture_url("https://alpha.instruments.example.com/"))
        self.assertTrue(reader.fixture_url("http://host.docker.internal:18124/fixtures/alpha/"))

    async def test_delegates_actual_reader_and_preserves_public_source_identity(self):
        original = reader.real_read_page
        try:
            reader.real_read_page = AsyncMock(return_value={"url": "http://host.docker.internal:18124/fixtures/beta/", "markdown": "Grounded page"})
            result = await reader.mapped_read_page("https://beta.instruments.example.com/")
            reader.real_read_page.assert_awaited_once_with("http://host.docker.internal:18124/fixtures/beta/")
            self.assertEqual(result["url"], "https://beta.instruments.example.com/")
        finally:
            reader.real_read_page = original

    async def test_subrequest_guard_aborts_any_external_destination(self):
        class Strategy:
            def set_hook(self, _name, callback): self.guard = callback
        class Crawler:
            crawler_strategy = Strategy()
        original = reader.real_create_crawler
        try:
            reader.real_create_crawler = AsyncMock(return_value=Crawler())
            crawler = await reader.fixture_crawler()
            class Context:
                async def route(self, _pattern, callback): self.callback = callback
            context = Context()
            await crawler.crawler_strategy.guard(None, context)
            class Route:
                request = type("Request", (), {"url": "https://outside.example/private"})()
                continue_ = AsyncMock()
                abort = AsyncMock()
            route = Route()
            await context.callback(route)
            route.abort.assert_awaited_once()
            route.continue_.assert_not_awaited()
        finally:
            reader.real_create_crawler = original


if __name__ == "__main__": unittest.main()
