"""Run with: python3 -m unittest discover -s scripts -p 'test_codex_work_time.py'."""

import argparse
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location("codex_work_time", Path(__file__).with_name("codex-work-time.py"))
work = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = work
spec.loader.exec_module(work)
MINUTE = 60000


def turn(thread, start, end, final=True):
    return work.Turn(thread, str(start), (start * MINUTE,),
                     end * MINUTE if end is not None else None, final)


class WorkTimeTests(unittest.TestCase):
    def test_switching_threads_counts_gap_once(self):
        result = work.calculate([turn("a", 0, 3), turn("b", 11, 13)])
        self.assertEqual(work.duration(result["total"]), 13 * MINUTE)
        self.assertEqual(work.duration(result["processing"]), 5 * MINUTE)

    def test_timeout_removes_entire_gap(self):
        result = work.calculate([turn("a", 0, 3), turn("b", 40, 42)])
        self.assertEqual(result["total"], [(0, 3 * MINUTE), (40 * MINUTE, 42 * MINUTE)])

    def test_cutoff_inclusive_and_one_millisecond_over_excluded(self):
        first = turn("a", 0, 3)
        at = work.Turn("b", "b", (18 * MINUTE,), None)
        after = work.Turn("b", "b", (18 * MINUTE + 1,), None)
        self.assertEqual(work.duration(work.calculate([first, at])["total"]), 18 * MINUTE)
        self.assertEqual(work.duration(work.calculate([first, after])["total"]), 3 * MINUTE)

    def test_no_idle_tail(self):
        result = work.calculate([turn("a", 0, 3)])
        self.assertEqual(result["total"], [(0, 3 * MINUTE)])

    def test_long_processing_is_separate_and_final_starts_review_window(self):
        result = work.calculate([turn("a", 0, 20), turn("b", 25, 26)])
        self.assertEqual(work.duration(result["total"]), 26 * MINUTE)
        self.assertEqual(work.duration(result["processing"]), 21 * MINUTE)

    def test_background_final_cannot_reset_latest_user_anchor(self):
        result = work.calculate([turn("a", 0, 60), turn("b", 20, 25), turn("c", 65, 66)])
        self.assertEqual(result["total"], [(0, 60 * MINUTE), (65 * MINUTE, 66 * MINUTE)])
        self.assertEqual(result["bridges"], [])

    def test_overlapping_processing_not_double_counted(self):
        result = work.calculate([turn("a", 0, 10), turn("b", 2, 12)])
        self.assertEqual(work.duration(result["processing"]), 12 * MINUTE)
        self.assertEqual(work.duration(result["total"]), 12 * MINUTE)

    def test_pending_turn_not_extended_to_wall_clock(self):
        result = work.calculate([turn("a", 0, None), turn("b", 10, None)])
        self.assertEqual(result["processing"], [])
        self.assertEqual(result["total"], [(0, 10 * MINUTE)])

    def test_abort_does_not_start_final_reply_grace_period(self):
        result = work.calculate([turn("a", 0, 20, False), turn("b", 25, 26)])
        self.assertEqual(work.duration(result["total"]), 21 * MINUTE)

    def test_simultaneous_messages_and_input_order_are_deterministic(self):
        turns = [turn("a", 0, 20), turn("b", 0, 3), turn("c", 25, 26)]
        self.assertEqual(work.calculate(turns), work.calculate(list(reversed(turns))))
        self.assertEqual(work.duration(work.calculate(turns)["total"]), 26 * MINUTE)

    def test_range_clipping_keeps_outside_evidence(self):
        result = work.calculate([turn("a", 0, 3), turn("b", 11, 13)], start=4 * MINUTE, end=10 * MINUTE)
        self.assertEqual(result["total"], [(4 * MINUTE, 10 * MINUTE)])
        self.assertEqual(result["processing"], [])

    def test_project_and_subagent_filters(self):
        root = Path("/work")
        base = {"id": "x", "cwd": "/work/sub", "source": "vscode", "thread_source": "user"}
        self.assertTrue(work.selected(base, [root], [], set()))
        self.assertFalse(work.selected({**base, "cwd": "/work-other"}, [root], [], set()))
        self.assertFalse(work.selected({**base, "thread_source": "subagent"}, [], [], set()))
        self.assertFalse(work.selected({**base, "source": "automation"}, [], [], set()))
        self.assertFalse(work.selected(base, [], [root], set()))

    def test_legacy_rollout_deduplicates_user_event_and_response_item(self):
        def record(timestamp, typ, payload):
            return {"timestamp": timestamp, "type": typ, "payload": payload}
        rows = [
            record("2026-10-09T10:00:00Z", "event_msg", {"type": "task_started", "turn_id": "t"}),
            record("2026-10-09T10:00:01Z", "event_msg", {"type": "user_message", "message": "hello"}),
            record("2026-10-09T10:00:02Z", "response_item", {"type": "message", "role": "user"}),
            record("2026-10-09T10:03:00Z", "response_item", {"type": "message", "role": "assistant", "phase": "final_answer"}),
            record("2026-10-09T10:03:01Z", "event_msg", {"type": "task_complete"}),
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "log.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in rows) + "\n{partial")
            turns, malformed = work.rollout_turns(path, "x")
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].users, (work.milliseconds("2026-10-09T10:00:01Z"),))
        self.assertEqual(turns[0].end, work.milliseconds("2026-10-09T10:03:01Z"))
        self.assertEqual(malformed, 1)

    def test_sqlite_loader_reads_native_millisecond_boundaries_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            with closing(sqlite3.connect(home / "state_5.sqlite")) as db, db:
                db.execute("CREATE TABLE threads(id, cwd, source, thread_source, title, rollout_path)")
                db.executemany("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)", [
                    ("a", "/work", "vscode", "user", "Work", "missing"),
                    ("child", "/work", "cli", "subagent", "Child", "missing"),
                ])
            with closing(sqlite3.connect(home / "thread_history_1.sqlite")) as db, db:
                db.execute("CREATE TABLE thread_items(thread_id, turn_id, item_id, rollout_ordinal, created_at_ms, completed_at_ms, item_type)")
                db.execute("CREATE TABLE thread_turns(thread_id, turn_id, rollout_ordinal, status, completed_at, final_agent_item_id)")
                db.executemany("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)", [
                    ("a", "t", "user", 1, 1001, 1001, "userMessage"),
                    ("a", "t", "final", 2, 5000, 6007, "agentMessage"),
                ])
                db.execute("INSERT INTO thread_turns VALUES ('a', 't', 1, 'completed', 6, 'final')")
                db.execute("INSERT INTO thread_items VALUES ('a', 'pending', 'pending-user', 3, 7000, 7000, 'userMessage')")
                db.execute("INSERT INTO thread_items VALUES ('a', 'pending', 'streaming-final', 4, 8000, NULL, 'agentMessage')")
                db.execute("INSERT INTO thread_turns VALUES ('a', 'pending', 2, 'inProgress', NULL, 'streaming-final')")
            turns, threads, warnings = work.load(home, [], [], set())
            self.assertEqual(turns, [work.Turn("a", "t", (1001,), 6007),
                                     work.Turn("a", "pending", (7000,), None, False)])
            self.assertEqual(len(threads), 1)
            self.assertEqual(warnings, [])
            db = work.readonly(home / "state_5.sqlite")
            with self.assertRaises(sqlite3.OperationalError):
                db.execute("DELETE FROM threads")
            db.close()

    def test_daily_split_across_dst_and_stable_json(self):
        zone = ZoneInfo("Australia/Melbourne")
        start = work.bound("2026-10-04", zone)
        end = work.bound("2026-10-05", zone)
        self.assertEqual(end - start, 23 * 3600000)
        result = work.calculate([work.Turn("a", "t", (start,), end)])
        args = argparse.Namespace(since="2026-10-04", until="2026-10-05", idle_minutes=15,
                                  project=[], exclude_project=[], thread=[])
        report = work.report(result, [], [], zone, args)
        self.assertEqual(report["daily"][0]["processing_ms"], 23 * 3600000)
        self.assertEqual(json.dumps(report, sort_keys=True), json.dumps(work.report(result, [], [], zone, args), sort_keys=True))


if __name__ == "__main__":
    unittest.main()
