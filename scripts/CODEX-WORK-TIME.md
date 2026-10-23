# Codex work time

`codex-work-time.py` estimates time from the local Codex history across all
selected user-initiated threads. It uses Python 3.10+ with no extra dependencies.
It opens existing SQLite databases read-only; it does not modify Codex history
or run migrations. Message text and tool output are not included in reports.

```sh
# Last week across all user-initiated threads, in your current timezone.
python3 scripts/codex-work-time.py --from 2026-10-05 --to 2026-10-12

# Select work projects explicitly. Repeat --project for additional projects.
python3 scripts/codex-work-time.py --from 2026-10-05 --to 2026-10-12 \
  --project /Users/callum/Documents/Development/project-acquire \
  --project /Users/callum/Documents/Development/Shopfront

# Audit report with exact timestamps, intervals, rejected bridges and thread IDs.
python3 scripts/codex-work-time.py --from 2026-10-05 --to 2026-10-12 \
  --format json > /tmp/codex-work-time.json

# Compare a different cutoff or timezone.
python3 scripts/codex-work-time.py --from 2026-10-05 --to 2026-10-12 \
  --idle-minutes 30 --timezone Australia/Melbourne

python3 -m unittest discover -s scripts -p 'test_codex_work_time.py'
```

Dates use `Asia/Makassar` by default; `--from` is inclusive and `--to` is
exclusive. Both accept ISO timestamps as well as dates. Without date bounds,
the script uses all available history. `--codex-home` defaults to `$CODEX_HOME`
or `~/.codex`. `--thread` and `--exclude-project` are repeatable filters.
Project paths include descendant working directories. Without project filters,
all user-initiated threads are assumed to be work, including personal chats.
Archived threads are included; sub-agents and non-user sources are excluded.

## Deterministic rule: version 1

1. Collect user-message timestamps and their turn's final completion time across
   selected threads. Sort by timestamp, grouping simultaneous user messages.
2. Count a finished user-initiated turn from its first user message to completion
   as **assistant processing**. Aborted/failed turns with a recorded end count
   processing, but do not start a final-reply review window. Pending turns are
   never extended to the current time.
3. For each consecutive pair of user messages across threads:
   - If the messages are at most 15 minutes apart, connect them.
   - Otherwise, if the earlier message's own final reply completed before the
     next user message and at most 15 minutes before it, connect that final reply
     to the next user message.
   - Otherwise, reject the entire gap. A completion from an older thread cannot
     reset the latest user-message anchor. Commentary cannot reset it either.
4. Union processing and connected intervals across threads. Overlaps count once.
   **Total** is that union. **Processing** is the union of processing intervals.
   **Review / between messages** is total minus processing, so these columns add
   up exactly. No time is added after the last final reply or last user message.
5. Resolve connections using surrounding history, then clip to the requested
   range and split at local midnight. This handles threads crossing date bounds
   and daylight-saving changes. Exactly 15 minutes qualifies; 15 minutes plus
   one millisecond does not. Durations are integer milliseconds; the text report
   truncates to whole seconds for display. JSON retains exact durations.

The combined total includes waiting for Codex, even for long turns. It is a
project-time estimate, not proof of human attention during processing. The
review column also remains an inference: unrelated activity between nearby
messages may be included, and long testing/thinking gaps may be omitted. Work
done without Codex messages cannot be measured by this script.

The input is the native `state_5.sqlite` index and `thread_history_1.sqlite`
message projection. Threads without projected user messages fall back to their
rollout JSONL logs, where event/response duplicates are avoided. Partial log
lines and missing history produce warnings. Legacy logs without turn boundaries
or explicit final phases may undercount processing rather than guess a finish.
If a later Codex version changes its storage schema, the script fails visibly.

For the same input snapshot, arguments and timezone database, JSON output is
stable: no current-time extrapolation, report-generation timestamp, or rounding
of the underlying intervals. A live Codex history can change between runs; keep
the JSON audit report as the evidence for a particular calculation. Rejected
gaps mean rejected engagement bridges; processing in another thread may still
cover part of those gaps in the combined total.
