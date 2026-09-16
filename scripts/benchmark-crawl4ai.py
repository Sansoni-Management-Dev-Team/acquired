"""Opt-in read-only URL benchmark. No searches, AI calls, or database writes."""
import argparse
import concurrent.futures
import json
import os
import pathlib
import re
import statistics
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--urls", required=True, help="JSON array of public HTTPS URLs")
parser.add_argument("--endpoint", default="http://127.0.0.1:18083")
parser.add_argument("--output", required=True)
parser.add_argument("--concurrency", type=int, choices=[1, 2, 3], default=2)
args = parser.parse_args()
endpoint = urlsplit(args.endpoint)
if endpoint.scheme != "https" and not (endpoint.scheme == "http" and endpoint.hostname in ["localhost", "127.0.0.1"]):
    parser.error("Use HTTPS for hosted readers")
urls = json.loads(pathlib.Path(args.urls).read_text())
if not isinstance(urls, list) or not 1 <= len(urls) <= 30 or any(not isinstance(u, str) or urlsplit(u).scheme != "https" for u in urls):
    parser.error("Supply 1–30 public HTTPS URLs")
secret = os.environ.get("READER_BENCHMARK_SECRET")
try:
    health = urllib.request.Request(args.endpoint.rstrip("/") + "/health", headers={"User-Agent": "AcquireReaderBenchmark/1.0", **({"Authorization": f"Bearer {secret}"} if secret else {})})
    with urllib.request.urlopen(health, timeout=45) as response:
        if not json.load(response).get("ok"):
            parser.error("Reader is not ready")
except Exception:
    parser.error("Reader health check failed; start the service before benchmarking")
challenge = re.compile(r"title:\s*[\"']?(?:access (?:to this page )?(?:has been )?denied|just a moment|attention required|security verification)|px-captcha|cf-chl-|verify (?:that )?you are (?:a )?human|checking your browser|enable javascript and cookies to continue", re.I)


def read(url):
    started = time.monotonic()
    row = {"url": url}
    try:
        headers = {"Content-Type": "application/json", "User-Agent": "AcquireReaderBenchmark/1.0"}
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        request = urllib.request.Request(args.endpoint.rstrip("/") + "/crawl", data=json.dumps({"url": url}).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
            markdown = result.get("markdown", "").strip()
            usable = len(markdown) >= 32 and not challenge.search(markdown[:1500])
            row.update(status="usable" if usable else "unusable", characters=len(markdown), finalUrl=result.get("url"), headings=[s for s in markdown.splitlines() if s.startswith("#")][:5])
    except urllib.error.HTTPError as error:
        row.update(status="failed", httpStatus=error.code)
        try:
            row["category"] = json.loads(error.read()).get("category", "reader_error")
        except Exception:
            row["category"] = "reader_error"
    except Exception as error:
        row.update(status="failed", category=type(error).__name__)
    row["elapsedMs"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(row), flush=True)
    return row


started = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
    rows = list(executor.map(read, urls))
report = {"observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "endpoint": args.endpoint, "concurrency": args.concurrency,
          "summary": {"requests": len(rows), "usable": sum(r["status"] == "usable" for r in rows), "medianMs": statistics.median(r["elapsedMs"] for r in rows), "totalSeconds": round(time.monotonic()-started, 1)},
          "actualCost": None, "costNote": "Measure host billing separately; local latency does not predict hosted access or cost.",
          "qualityNote": "Usable means nonempty content without known challenge markers, not validated acquisition evidence.", "rows": rows}
out = pathlib.Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report["summary"]))
