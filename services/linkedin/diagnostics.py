"""Structured diagnostics: correlation and timings, never payloads or credentials."""
import contextvars
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from urllib.parse import urlparse, parse_qs

class PrivateRotatingFileHandler(RotatingFileHandler):
    """Keep every current/rotated log owner-readable only, including after rollover."""
    def _open(self):
        descriptor = os.open(self.baseFilename, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, self.mode, encoding=self.encoding, errors=self.errors)


def file_handler(path, max_bytes=2 * 1024 * 1024):
    handler = PrivateRotatingFileHandler(path, maxBytes=max_bytes, backupCount=2, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(message)s'))
    return handler


LOGGER = logging.getLogger('linkedin.diagnostics')
if not LOGGER.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(message)s'))
    LOGGER.addHandler(handler)
    if os.getenv('LINKEDIN_DIAGNOSTICS_PATH'):
        LOGGER.addHandler(file_handler(os.environ['LINKEDIN_DIAGNOSTICS_PATH']))
LOGGER.setLevel(logging.INFO)
LOGGER.propagate = False
CONTEXT = contextvars.ContextVar('linkedin_trace', default={})
# An allowlist makes accidental logging of headers, bodies and exception text fail closed.
FIELDS = {'trace_id', 'owner', 'action_id', 'fixture', 'slot', 'method', 'endpoint',
          'stage', 'status', 'http_status', 'duration_ms', 'timeout_ms', 'error_type',
          'redirect', 'retry_after', 'has_data', 'has_receipt', 'service_error_code',
          'provider_status', 'kind', 'next_eligible_at', 'reason_code', 'process',
          'exit_code', 'saved_session', 'conversation_id', 'recipient_id', 'mailbox_id'}


def identifier(value):
    return hashlib.sha256(str(value).encode()).hexdigest()[:16] if value else None


def endpoint(path):
    parsed = urlparse(path)
    # Endpoint names only: discard variables, cursor/sync tokens and member IDs.
    known = ('/voyager/api/voyagerMessagingDashMessengerMessages',
             '/voyager/api/voyagerRelationshipsDashMemberRelationships',
             '/voyager/api/identity/dash/profiles')
    name = parsed.path if parsed.path in known else '/voyagerMessagingGraphQL/graphql' if parsed.path.startswith('/voyagerMessagingGraphQL/') else 'other'
    action = parse_qs(parsed.query).get('action', [''])[0]
    if action in ('createMessage', 'verifyQuotaAndCreate', 'verifyQuotaAndCreateV2'):
        name += '?action=' + action
    return name


@contextmanager
def context(**fields):
    token = CONTEXT.set({**CONTEXT.get(), **{k: v for k, v in fields.items() if k in FIELDS}})
    try:
        yield
    finally:
        CONTEXT.reset(token)


def emit(event, **fields):
    values = {**CONTEXT.get(), **fields}
    record = {'at': datetime.now(timezone.utc).isoformat(), 'event': event,
              **{k: v for k, v in values.items() if k in FIELDS and v is not None}}
    LOGGER.info(json.dumps(record, separators=(',', ':'), default=str))


@contextmanager
def span(event, **fields):
    started = time.monotonic()
    fields = {'trace_id': CONTEXT.get().get('trace_id') or trace_id(), **fields}
    with context(**fields):
        emit(event + '.start')
        try:
            yield
        except BaseException as error:
            emit(event + '.error', duration_ms=round((time.monotonic()-started)*1000, 1),
                 error_type=type(error).__name__)
            raise
        else:
            emit(event + '.end', duration_ms=round((time.monotonic()-started)*1000, 1))


def trace_id():
    return uuid.uuid4().hex
