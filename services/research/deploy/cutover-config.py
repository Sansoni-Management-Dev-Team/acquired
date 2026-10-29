"""Change only Acquire's research endpoint and credential; keep rollback local."""
import argparse
import json
import os
from pathlib import Path
import re

KEYS = ("RESEARCH_WORKER_URL", "RESEARCH_SERVICE_SECRET")


def settings(text):
    result = {}
    for key in KEYS:
        matches = re.findall(r"^" + key + r"=([^\r\n]*)$", text, re.MULTILINE)
        if len(matches) != 1 or not matches[0]:
            raise ValueError("Expected exactly one nonempty research setting")
        result[key] = matches[0]
    return result


def replace_settings(text, expected, replacement):
    current = settings(text)
    if current == replacement:
        return text
    if current != expected or set(replacement) != set(KEYS):
        raise ValueError("Research configuration changed; refusing to overwrite it")
    for key, value in replacement.items():
        if not isinstance(value, str) or not value or "\n" in value or "\r" in value:
            raise ValueError("Invalid research setting")
        text = re.sub(r"^" + key + r"=[^\r\n]*$", lambda _: key + "=" + value, text, flags=re.MULTILINE)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "rollback"))
    parser.add_argument("environment", type=Path)
    parser.add_argument("state", type=Path)
    args = parser.parse_args()
    state = json.loads(args.state.read_text())
    expected, replacement = state["before"], state["after"]
    if args.action == "rollback":
        expected, replacement = replacement, expected
    original = args.environment.read_text()
    changed = replace_settings(original, expected, replacement)
    temporary = args.environment.with_name(args.environment.name + ".research-cutover")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            output.write(changed)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(args.environment)
    finally:
        temporary.unlink(missing_ok=True)
    print("Research configuration " + args.action + " complete")


if __name__ == "__main__":
    main()
