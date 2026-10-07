"""Owner-locked campaign operations. No autonomous queue dispatch or blind retries."""
import hashlib
import json
import os
import re
import time
from fastapi import HTTPException
from adapter import profile_identity, relationship
import policy

async def operate(service, owner, body):
    if not isinstance(body, dict) or body.get('operation') not in ('status', 'connect', 'message'):
        raise HTTPException(400, 'Invalid campaign operation')
    operation = body['operation']
    try: identity = profile_identity(body.get('profile'))
    except ValueError as error: raise HTTPException(400, str(error))
    worker = service.workers.get(owner)
    if not worker or await worker.status() != 'connected':
        raise HTTPException(409, 'Resume and sign in to LinkedIn before running this sequence')
    if operation != 'status' and not worker.fixture and os.getenv('LINKEDIN_ALLOW_CAMPAIGNS') != 'true':
        raise HTTPException(403, 'LinkedIn campaign delivery has not been enabled on this service')
    data = service.VAULT.load(owner)
    now = time.time()
    key = body.get('key')
    record = None
    if operation != 'status':
        text = body.get('text', '')
        if not isinstance(key, str) or not re.fullmatch(r'campaign:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+', key):
            raise HTTPException(400, 'A campaign step idempotency key is required')
        if not isinstance(text, str) or len(text) > (200 if operation == 'connect' else 4000) or (operation == 'message' and not text.strip()):
            raise HTTPException(400, 'Invalid personalised LinkedIn text')
        action_id = hashlib.sha256(json.dumps([worker.fixture, key]).encode()).hexdigest()
        fingerprint = hashlib.sha256(json.dumps([identity, operation, text]).encode()).hexdigest()
        record = data.get('actions', {}).get(action_id)
        if record:
            if record.get('fingerprint') != fingerprint:
                raise HTTPException(409, 'Campaign recipient or content changed; review before continuing')
            if record['status'] != 'queued': return {'action': record}
    # Short cache prevents a budgeted profile read from starving the following
    # send on every retry. Mode and target are part of the cache key.
    state = policy.control(data, worker.fixture)
    cached = state.get('relationships', {}).get(identity)
    if cached and now - cached['checkedAt'] < 300:
        observed = cached
    else:
        due, reason = policy.reserve(data, 'profile', worker.fixture, now)
        service.VAULT.save(owner, data)
        if due is None or due > now:
            return {'status': 'retry', 'nextEligibleAt': due or now + 300, 'reason': reason}
        try: result, observed = await relationship(worker, identity)
        except Exception: result, observed = {'status': 0}, {'connected': None, 'recipient': None}
        data = service.VAULT.load(owner)
        policy.provider_result(data, result, worker.fixture)
        if result.get('status') != 200: observed = {'connected': None, 'recipient': None}
        observed['checkedAt'] = now
        if observed['connected'] is not None:
            policy.control(data, worker.fixture).setdefault('relationships', {})[identity] = observed
        service.VAULT.save(owner, data)
    if operation == 'status': return observed
    if observed['connected'] is None or not observed['recipient']:
        raise HTTPException(409, 'LinkedIn connection status is unknown; review the profile')
    if operation == 'message' and not observed['connected']:
        raise HTTPException(409, 'Recipient has not accepted the LinkedIn connection request')
    if not record:
        if len(data.get('actions', {})) >= 2000:
            raise HTTPException(409, 'LinkedIn action journal is full')
        record = {'id': action_id, 'kind': 'invite' if operation == 'connect' else 'message',
                  'recipient': observed['recipient'], 'text': text, 'status': 'queued',
                  'fingerprint': fingerprint, 'fixture': worker.fixture, 'createdAt': now,
                  'approvedAt': now, 'approvedUntil': now + 86400, 'campaignKey': key}
        data.setdefault('actions', {})[action_id] = record
        service.VAULT.save(owner, data)
    # Recheck queued retries too: the recipient may have connected while the
    # invitation was waiting for its dispatch budget.
    if operation == 'connect' and observed['connected']:
        record.update(status='skipped', reason='Already connected', attemptedAt=now)
        data['actions'][action_id] = record
        service.VAULT.save(owner, data)
    if record['status'] == 'queued':
        # Only a fresh call from the eligible enrolment may execute this action.
        # Background maintenance deliberately excludes campaign records.
        record['approvedUntil'] = now + 86400
        record = await service.dispatch_action(owner, worker, record)
    worker.touched = now
    return {'action': record}
