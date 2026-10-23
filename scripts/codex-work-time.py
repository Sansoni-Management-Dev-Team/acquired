#!/usr/bin/env python3
"""Estimate work time across Codex threads. Standard library only; read-only inputs."""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Turn:
    thread_id: str
    turn_id: str
    users: tuple[int, ...]
    end: int | None
    final: bool = True


def readonly(path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only = ON")
    db.execute("BEGIN")
    return db


def milliseconds(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"Timestamp has no timezone: {value}")
    return round(dt.timestamp() * 1000)


def bound(value, zone):
    if value is None:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zone)
    return round(dt.timestamp() * 1000)


def iso(ms, zone):
    return datetime.fromtimestamp(ms / 1000, zone).isoformat(timespec="milliseconds")


def human_thread(row):
    source = row.get("source", "")
    return (
        row.get("thread_source") in (None, "user")
        and row.get("agent_path") in (None, "/root")
        and source in ("cli", "vscode", "app", "desktop", "exec")
    )


def selected(row, projects, excludes, thread_ids):
    cwd = Path(row["cwd"]).expanduser().resolve()
    within = lambda root: cwd == root or root in cwd.parents
    return (
        human_thread(row)
        and (not thread_ids or row["id"] in thread_ids)
        and (not projects or any(within(root) for root in projects))
        and not any(within(root) for root in excludes)
    )


def projected_turns(db, thread_id):
    # Query only message timestamps and turn boundaries, never tool output/text.
    users = defaultdict(list)
    for row in db.execute(
        "SELECT turn_id, created_at_ms FROM thread_items "
        "WHERE thread_id = ? AND item_type = 'userMessage' "
        "ORDER BY rollout_ordinal", (thread_id,)
    ):
        users[row["turn_id"]].append(row["created_at_ms"])
    turns = []
    for row in db.execute(
        "SELECT t.turn_id, t.status, t.completed_at, t.final_agent_item_id, "
        "a.created_at_ms AS final_created, a.completed_at_ms AS final_completed "
        "FROM thread_turns t LEFT JOIN thread_items a "
        "ON a.thread_id = t.thread_id AND a.turn_id = t.turn_id "
        "AND a.item_id = t.final_agent_item_id WHERE t.thread_id = ? "
        "ORDER BY t.rollout_ordinal", (thread_id,)
    ):
        stamps = users.pop(row["turn_id"], [])
        if not stamps:
            continue  # Automated continuation without a user message.
        closed = row["completed_at"] is not None or row["status"] == "completed"
        final = closed and row["final_created"] is not None
        end = (row["final_completed"] or row["final_created"]) if closed else None
        if end is None and row["completed_at"] is not None:
            end = row["completed_at"] * 1000
        turns.append(Turn(thread_id, row["turn_id"], tuple(sorted(set(stamps))), end, final))
    for turn_id, stamps in sorted(users.items()):
        turns.append(Turn(thread_id, turn_id, tuple(sorted(set(stamps))), None, False))
    return turns


def rollout_turns(path, thread_id):
    """Legacy fallback. Prefer event messages over their response-item duplicates."""
    malformed, has_user_events = 0, False
    # Two streaming passes avoid retaining large tool outputs in memory.
    with path.open() as stream:
        for line in stream:
            try:
                record = json.loads(line)
                if record.get("type") == "event_msg" and record.get("payload", {}).get("type") == "user_message":
                    has_user_events = True
                if record.get("timestamp"):
                    milliseconds(record["timestamp"])
            except (json.JSONDecodeError, ValueError):
                malformed += 1
    turns, users, final_end = [], [], None
    turn_id = "legacy-0"

    def finish(end, final):
        nonlocal users, final_end
        if users:
            turns.append(Turn(thread_id, turn_id, tuple(sorted(set(users))), end, final))
        users, final_end = [], None

    def records():
        with path.open() as stream:
            for index, line in enumerate(stream):
                try:
                    record = json.loads(line)
                    if record.get("timestamp"):
                        milliseconds(record["timestamp"])
                        yield index, record
                except (json.JSONDecodeError, ValueError):
                    continue

    for index, record in records():
        p = record.get("payload", {})
        typ = p.get("type")
        stamp = milliseconds(record["timestamp"])
        if record.get("type") == "event_msg":
            if typ == "task_started":
                if users:
                    finish(final_end, final_end is not None)
                turn_id = p.get("turn_id", f"legacy-{index}")
            elif typ == "user_message":
                if final_end is not None:
                    finish(final_end, True)
                    turn_id = f"legacy-{index}"
                users.append(stamp)
            elif typ in ("task_complete", "task_aborted"):
                finish(stamp, typ == "task_complete")
        elif record.get("type") == "response_item" and typ == "message":
            if p.get("role") == "user" and not has_user_events:
                text = "\n".join(c.get("text", "") for c in p.get("content", []))
                if text.lstrip().startswith(("# AGENTS.md", "<environment_context>", "<permissions")):
                    continue
                if users:
                    finish(final_end, final_end is not None)
                turn_id = f"legacy-{index}"
                users.append(stamp)
            elif p.get("role") == "assistant" and p.get("phase") == "final_answer":
                final_end = stamp
    finish(final_end, final_end is not None)
    return turns, malformed


def load(home, projects, excludes, thread_ids):
    warnings, turns, threads = [], [], []
    state_path = home / "state_5.sqlite"
    if not state_path.exists():
        raise ValueError(f"Missing thread index: {state_path}")
    state = readonly(state_path)
    history_path = home / "thread_history_1.sqlite"
    history = readonly(history_path) if history_path.exists() else None
    try:
        rows = [dict(r) for r in state.execute("SELECT * FROM threads ORDER BY id")]
        for row in rows:
            if not selected(row, projects, excludes, thread_ids):
                continue
            entries = projected_turns(history, row["id"]) if history else []
            source = "thread_history_1.sqlite"
            if not entries:
                path = Path(row["rollout_path"])
                if not path.exists():
                    warnings.append(f"No message history for {row['id']}")
                    continue
                entries, malformed = rollout_turns(path, row["id"])
                if malformed:
                    warnings.append(f"Skipped {malformed} malformed log lines in {row['id']}")
                source = "rollout"
            turns.extend(entries)
            threads.append({"id": row["id"], "title": row.get("name") or row["title"],
                            "project": row["cwd"], "source": source})
    finally:
        state.close()
        if history:
            history.close()
    return turns, threads, warnings


def union(intervals):
    merged = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def duration(intervals):
    return sum(end - start for start, end in union(intervals))


def calculate(turns, idle_ms=900000, start=None, end=None):
    """Pure deterministic calculation; no wall clock or pending-turn extrapolation."""
    processing, bridges, excluded, messages, warnings = [], [], [], [], []
    for turn in sorted(turns, key=lambda t: (t.thread_id, t.turn_id)):
        stamps = sorted(set(turn.users))
        if not stamps:
            continue
        valid_end = turn.end
        if valid_end is not None and valid_end < stamps[0]:
            if (start is None or stamps[-1] >= start) and (end is None or stamps[0] < end):
                warnings.append(f"End precedes user message: {turn.thread_id}/{turn.turn_id}")
            valid_end = None
        if valid_end is not None:
            processing.append((stamps[0], valid_end))
        for stamp in stamps:
            messages.append({"time_ms": stamp, "thread_id": turn.thread_id,
                             "turn_id": turn.turn_id, "final_ms": valid_end if turn.final else None,
                             "processing_end_ms": valid_end})
    messages.sort(key=lambda m: (m["time_ms"], m["thread_id"], m["turn_id"]))
    # Group simultaneous messages so ordering of equal timestamps cannot change time.
    groups = []
    for message in messages:
        if not groups or groups[-1][0]["time_ms"] != message["time_ms"]:
            groups.append([])
        groups[-1].append(message)
    for previous, following in zip(groups, groups[1:]):
        a, b = previous[0]["time_ms"], following[0]["time_ms"]
        finals = [m["final_ms"] for m in previous
                  if m["final_ms"] is not None and a <= m["final_ms"] <= b]
        if b - a <= idle_ms:
            bridges.append((a, b))
        elif finals and b - max(finals) <= idle_ms:
            bridges.append((max(finals), b))
        else:
            # A final in an older thread never renews the latest user anchor.
            excluded.append((max(finals) if finals else a, b))

    def clip(intervals):
        return union((max(a, start) if start is not None else a,
                      min(b, end) if end is not None else b) for a, b in intervals)

    processing, bridges, excluded = map(clip, (processing, bridges, excluded))
    total = union(processing + bridges)
    return {"processing": processing, "bridges": bridges, "total": total,
            "excluded": excluded, "messages": messages, "warnings": warnings}


def report(result, threads, warnings, zone, args):
    total_ms = duration(result["total"])
    processing_ms = duration(result["processing"])
    daily = defaultdict(lambda: {"total_ms": 0, "processing_ms": 0})
    for kind in ("total", "processing"):
        for start, end in result[kind]:
            while start < end:
                local = datetime.fromtimestamp(start / 1000, zone)
                midnight = datetime.combine(local.date() + timedelta(days=1), time(), zone)
                stop = min(end, round(midnight.timestamp() * 1000))
                daily[str(local.date())][kind + "_ms"] += stop - start
                start = stop
    for values in daily.values():
        values["review_ms"] = values["total_ms"] - values["processing_ms"]
    intervals = lambda key: [
        {"start": iso(a, zone), "end": iso(b, zone), "duration_ms": b - a}
        for a, b in result[key]
    ]
    evidence = []
    start, end = bound(args.since, zone), bound(args.until, zone)
    relevant_ids = set()
    for message in result["messages"]:
        stamp = message["time_ms"]
        last = message["processing_end_ms"] or stamp
        if start is not None and last < start - args.idle_minutes * 60000:
            continue
        if end is not None and stamp > end + args.idle_minutes * 60000:
            continue
        relevant_ids.add(message["thread_id"])
        evidence.append({"thread_id": message["thread_id"], "turn_id": message["turn_id"],
                         "user_at": iso(stamp, zone),
                         "final_at": iso(message["final_ms"], zone) if message["final_ms"] is not None else None,
                         "processing_end_at": iso(last, zone) if message["processing_end_ms"] is not None else None})
    return {
        "algorithm": "codex-work-time-v1", "timezone": str(zone),
        "idle_minutes": args.idle_minutes,
        "range": {"from_inclusive": args.since, "to_exclusive": args.until},
        "selection": {"projects": sorted(args.project), "excluded_projects": sorted(args.exclude_project),
                      "thread_ids": sorted(args.thread), "scope": "user-initiated threads"},
        "totals": {"total_ms": total_ms, "processing_ms": processing_ms,
                   "review_ms": total_ms - processing_ms},
        "daily": [{"date": day, **values} for day, values in sorted(daily.items())],
        "sessions": intervals("total"), "processing_intervals": intervals("processing"),
        "engagement_bridges": intervals("bridges"), "rejected_gaps": intervals("excluded"),
        "messages": evidence, "threads": [t for t in threads if t["id"] in relevant_ids],
        "warnings": sorted(warnings + result["warnings"]),
    }


def format_duration(ms):
    seconds = ms // 1000
    return f"{seconds // 3600}h {(seconds % 3600) // 60:02d}m {seconds % 60:02d}s"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", type=Path, default=Path(os.getenv("CODEX_HOME", "~/.codex")).expanduser())
    parser.add_argument("--from", dest="since", help="Inclusive local date or ISO timestamp")
    parser.add_argument("--to", dest="until", help="Exclusive local date or ISO timestamp")
    parser.add_argument("--timezone", default="Asia/Makassar")
    parser.add_argument("--idle-minutes", type=int, default=15)
    parser.add_argument("--project", action="append", default=[], help="Include this working directory and descendants; repeatable")
    parser.add_argument("--exclude-project", action="append", default=[])
    parser.add_argument("--thread", action="append", default=[])
    parser.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args()
    try:
        zone = ZoneInfo(args.timezone)
        start, end = bound(args.since, zone), bound(args.until, zone)
        if args.idle_minutes <= 0:
            raise ValueError("--idle-minutes must be positive")
        if start is not None and end is not None and end <= start:
            raise ValueError("--to must be later than --from")
        projects = [Path(p).expanduser().resolve() for p in args.project]
        excludes = [Path(p).expanduser().resolve() for p in args.exclude_project]
        turns, threads, warnings = load(args.codex_home.expanduser(), projects, excludes, set(args.thread))
        result = calculate(turns, args.idle_minutes * 60000, start, end)
        output = report(result, threads, warnings, zone, args)
    except (ValueError, OSError, sqlite3.Error, KeyError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    if args.format == "json":
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        print(f"Codex work estimate · {zone} · {args.idle_minutes}-minute cutoff")
        print(f"Scope: {len(output['threads'])} user-initiated threads across selected projects")
        print("Date          Total           Processing      Review / between messages")
        for day in output["daily"]:
            print(f"{day['date']}    {format_duration(day['total_ms']):<16}"
                  f"{format_duration(day['processing_ms']):<16}{format_duration(day['review_ms'])}")
        values = output["totals"]
        print(f"Total         {format_duration(values['total_ms']):<16}"
              f"{format_duration(values['processing_ms']):<16}{format_duration(values['review_ms'])}")
        print("Processing includes waiting for Codex. Review time is inferred. No idle tail is added.")
        for warning in output["warnings"]:
            print(f"Warning: {warning}", file=sys.stderr)


if __name__ == "__main__":
    main()
