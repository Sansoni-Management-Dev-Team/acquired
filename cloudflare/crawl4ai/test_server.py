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
    def setUp(self):
        reader.domains.clear()
        reader.active_domains.clear()

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

    def test_transport_classification_is_trace_only_and_never_echoes_a_raw_error(self):
        handler = reader.Handler.__new__(reader.Handler)
        handler.headers = {"x-request-id": "request-1234", "x-research-job-id": "job-12345678"}
        handler.crawl_started = reader.time.monotonic()
        handler.transport_failure = "connection_refused"
        handler.wfile = io.BytesIO()
        handler.send_response = lambda _: None
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None
        with patch("builtins.print") as log:
            handler.send_json(502, {"error": "Page read failed", "category": "page_unavailable"})
        event = reader.json.loads(log.call_args.args[0].split(" ", 1)[1])
        self.assertEqual(event.get("transportFailure"), "connection_refused")
        body = reader.json.loads(handler.wfile.getvalue())
        self.assertEqual(body["category"], "page_unavailable")
        self.assertNotIn("transportFailure", body)
        self.assertNotIn("transportFailure", body["reader"])

    def test_classifies_only_bounded_transport_reasons_without_echoing_input(self):
        for error, expected in [
            (ConnectionRefusedError(111, "PRIVATE endpoint"), "connection_refused"),
            (reader.socket.gaierror(-3, "PRIVATE resolver"), "dns_resolution_failed"),
            (TimeoutError("PRIVATE URL"), "timeout"),
            ("Page.goto net::ERR_NAME_NOT_RESOLVED PRIVATE", "dns_resolution_failed"),
            ("Page.goto net::ERR_CONNECTION_TIMED_OUT PRIVATE", "timeout"),
            ("Page.goto net::ERR_CONNECTION_RESET PRIVATE", "connection_reset"),
            ("Page.goto net::ERR_CERT_AUTHORITY_INVALID PRIVATE", "tls_verification_failed"),
            ("PRIVATE unrelated failure", None),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(reader.classify_transport_failure(error), expected)

    def test_post_logs_refusal_without_changing_failed_read_body_status_or_cooldown(self):
        handler = reader.Handler.__new__(reader.Handler)
        payload = reader.json.dumps({"url": "https://example.com/?token=PRIVATE"}).encode()
        handler.path = "/crawl"
        handler.headers = {"Content-Length": str(len(payload)), "x-request-id": "request-1234", "x-research-job-id": "job-12345678"}
        handler.rfile, handler.wfile = io.BytesIO(payload), io.BytesIO()
        handler.connection = SimpleNamespace(settimeout=lambda _: None)
        status = []
        handler.send_response = status.append
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None
        error = reader.ReadError("page_unavailable", transport_failure="connection_refused")
        def submitted(coroutine, _):
            coroutine.close()
            def result(timeout):
                raise error
            return SimpleNamespace(result=result, cancel=lambda: None)
        with patch.object(reader, "service_secret", ""), patch.object(reader, "public_url", return_value=True), patch.object(reader.asyncio, "run_coroutine_threadsafe", side_effect=submitted), patch("builtins.print") as log:
            handler.do_POST()
        self.assertEqual(status, [502])
        body = reader.json.loads(handler.wfile.getvalue())
        self.assertEqual(body["error"], "Page read failed")
        self.assertEqual(body["category"], "page_unavailable")
        self.assertNotIn("transportFailure", body["reader"])
        response = reader.json.loads(log.call_args.args[0].split(" ", 1)[1])
        self.assertEqual(response["transportFailure"], "connection_refused")
        self.assertNotIn("PRIVATE", str(log.call_args_list))
        self.assertNotIn("example.com", str(log.call_args_list))
        self.assertNotIn("example.com", reader.active_domains)

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

    def test_dns_failure_is_distinguishable_without_allowing_the_destination(self):
        diagnostics = {}
        with patch.object(reader.socket, "getaddrinfo", side_effect=reader.socket.gaierror(-3, "private resolver details")):
            self.assertFalse(reader.public_url("https://example.com", diagnostics))
        self.assertEqual(diagnostics, {"urlValidationReason": "dns_resolution_failed", "dnsErrorCode": -3})
        self.assertNotIn("private", str(diagnostics))

    def test_domain_admission_and_cooldown(self):
        reader.domains.clear()
        with patch.object(reader.time, "monotonic", return_value=100):
            self.assertEqual(reader.claim_domain("example.com"), 0)
            self.assertEqual(reader.claim_domain("example.com"), 3)
            reader.release_domain("example.com", 30)
        with patch.object(reader.time, "monotonic", return_value=120):
            self.assertEqual(reader.claim_domain("example.com"), 10)
            self.assertEqual(reader.claim_domain("another.com"), 0)
        with patch.object(reader.time, "monotonic", return_value=131):
            self.assertEqual(reader.claim_domain("example.com"), 0)


    def test_active_domain_advertises_short_retry_without_shortening_stale_lease(self):
        with patch.object(reader.time, "monotonic", return_value=100):
            self.assertEqual(reader.claim_domain("example.com"), 0)
            self.assertEqual(reader.domains["example.com"], 145)
        with patch.object(reader.time, "monotonic", return_value=101):
            self.assertEqual(reader.claim_domain("example.com"), 3)
            self.assertEqual(reader.domains["example.com"], 145)
        with patch.object(reader.time, "monotonic", return_value=144):
            self.assertEqual(reader.claim_domain("example.com"), 1)
        with patch.object(reader.time, "monotonic", return_value=145):
            self.assertEqual(reader.claim_domain("another.com"), 0)
            self.assertNotIn("example.com", reader.active_domains)
            self.assertEqual(reader.claim_domain("example.com"), 0)

    def test_finished_read_keeps_real_cooldown_then_admits_next_read(self):
        with patch.object(reader.time, "monotonic", return_value=100):
            self.assertEqual(reader.claim_domain("example.com"), 0)
        with patch.object(reader.time, "monotonic", return_value=102):
            reader.release_domain("example.com", 3)
            self.assertEqual(reader.claim_domain("example.com"), 3)
            self.assertFalse(reader.reader_diagnostics(100, "example.com")["domainActive"])
        with patch.object(reader.time, "monotonic", return_value=104):
            self.assertEqual(reader.claim_domain("example.com"), 1)
        with patch.object(reader.time, "monotonic", return_value=105):
            self.assertEqual(reader.claim_domain("example.com"), 0)

    def test_simultaneous_claims_keep_one_active_read_per_domain(self):
        from concurrent.futures import ThreadPoolExecutor
        with patch.object(reader.time, "monotonic", return_value=100), ThreadPoolExecutor(max_workers=8) as executor:
            claims = list(executor.map(reader.claim_domain, ["example.com"] * 20))
        self.assertEqual(claims.count(0), 1)
        self.assertEqual(claims.count(3), 19)
        self.assertEqual(reader.domains["example.com"], 145)


class ReaderPoolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reader.pool = None
        self.crawler = SimpleNamespace(
            arun=AsyncMock(return_value=SimpleNamespace(success=True, status_code=200, url="https://example.com/", markdown=SimpleNamespace(raw_markdown="Company manufactures precision instruments."))),
            close=AsyncMock(), crawler_strategy=SimpleNamespace(kill_session=AsyncMock()))
        self.fake_module = SimpleNamespace(CrawlerRunConfig=lambda **kw: SimpleNamespace(**kw), CacheMode=SimpleNamespace(BYPASS="bypass"))

    async def test_retains_only_connection_refused_classification_for_a_failed_crawl(self):
        self.crawler.arun.return_value = SimpleNamespace(success=False, status_code=None, markdown=None,
            error_message="Page.goto: net::ERR_CONNECTION_REFUSED at https://private.example/?token=PRIVATE&email=person@example.invalid")
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)):
            with self.assertRaises(reader.ReadError) as caught:
                await reader.read_page("https://private.example/")
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(caught.exception.category, "page_unavailable")
        self.assertEqual(getattr(caught.exception, "transport_failure", None), "connection_refused")
        self.assertNotIn("PRIVATE", str(caught.exception))
        self.assertNotIn("private.example", str(caught.exception))

    async def test_reuses_browsers_and_cleans_unique_sessions(self):
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "CONCURRENCY", 1), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)) as create, patch.object(reader, "public_url", return_value=True):
            await reader.read_page("https://example.com/")
            await reader.read_page("https://example.com/about")
            create.assert_awaited_once()
            sessions = [call.args[0] for call in self.crawler.crawler_strategy.kill_session.await_args_list]
            self.assertEqual(len(set(sessions)), 2)
            self.crawler.close.assert_not_awaited()

    async def test_full_page_preserves_footer_html_and_explicit_bounded_mode(self):
        result = self.crawler.arun.return_value
        result.html = "<main>" + "x" * 40000 + "</main><footer>office@example.com</footer>"
        result.markdown.raw_markdown = "x" * 40000 + "\nFooter office@example.com"
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "CONCURRENCY", 1), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)), patch.object(reader, "public_url", return_value=True):
            full = await reader.read_page("https://example.com/", False)
            config = self.crawler.arun.await_args.kwargs["config"]
            self.assertEqual(config.word_count_threshold, 0)
            self.assertEqual(config.excluded_tags, [])
            self.assertIn("<footer>office@example.com</footer>", full["html"])
            self.assertIn("office@example.com", full["markdown"])
            self.assertFalse(full["only_main_content"])
            self.assertFalse(full["truncated"])
            legacy = await reader.read_page("https://example.com/")
            self.assertEqual(len(legacy["markdown"]), 30000)
            self.assertNotIn("html", legacy)

    async def test_full_page_truncation_is_explicit(self):
        self.crawler.arun.return_value.html = "x" * 250001
        self.crawler.arun.return_value.markdown.raw_markdown = "x" * 100001
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)), patch.object(reader, "public_url", return_value=True):
            full = await reader.read_page("https://example.com/", False)
            self.assertTrue(full["truncated"])
            self.assertEqual(len(full["html"]), 250000)
            self.assertEqual(len(full["markdown"]), 100000)

    async def test_discards_browser_after_cancellation(self):
        self.crawler.arun.side_effect = asyncio.CancelledError()
        with patch.dict(sys.modules, {"crawl4ai": self.fake_module}), patch.object(reader, "CONCURRENCY", 1), patch.object(reader, "create_crawler", AsyncMock(return_value=self.crawler)):
            with self.assertRaises(asyncio.CancelledError):
                await reader.read_page("https://example.com/")
            self.crawler.close.assert_awaited_once()
            self.assertIsNone(reader.pool.get_nowait())


if __name__ == "__main__":
    unittest.main()
