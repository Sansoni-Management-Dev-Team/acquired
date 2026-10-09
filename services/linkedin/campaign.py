"""Owner-locked campaign operations. No autonomous queue dispatch or blind retries."""
import hashlib
import json
import os
import re
import time
from fastapi import HTTPException
from adapter import profile_identity, relationship, read_failure_code
import policy
import diagnostics as diag

async def operate(service, owner, body):
    operation = body.get('operation') if isinstance(body, dict) else None
    stage = operation if operation in ('status', 'connect', 'message') else 'invalid'
    with diag.span('campaign.operation', owner=owner, stage=stage):
        result = await _operate(service, owner, body)
        action = result.get('action')
        diag.emit('campaign.result', action_id=action.get('id') if action else None,
                  status=action['status'] if action else result.get('status') or
                  ('unknown' if result.get('connected') is None else 'connected' if result['connected'] else 'not_connected'),
                  next_eligible_at=result.get('nextEligibleAt'))
        return result

async def _operate(service, owner, body):
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
        if operation == 'connect' and text.strip():
            raise HTTPException(400, 'Invitation notes require a verified browser capture; send without a note')
    # Short cache prevents a budgeted profile read from starving the following
    # send on every retry. Mode and target are part of the cache key.
    state = policy.control(data, worker.fixture)
    if state.get('requiresVerification'):
        raise HTTPException(409, {'code': 'reconnect'})
    cached = state.get('relationships', {}).get(identity)
    if cached and now - cached['checkedAt'] < 300:
        diag.emit('relationship.cache', stage='hit', recipient_id=diag.identifier(identity))
        observed = cached
    else:
        diag.emit('relationship.cache', stage='miss', recipient_id=diag.identifier(identity))
        completed_wait = False
        previous_request_at = state.get('nextRequestAt')
        if record:
            due, reason = policy.eligible(data, record['kind'], worker.fixture, now)
            if due is None or due > now:
                record.update(nextEligibleAt=due or now + 300, reason=reason)
                data['actions'][action_id] = record
                service.VAULT.save(owner, data)
                return {'action': record}
            completed_wait = True
        with diag.span('relationship.reserve_read'):
            due, reason = policy.reserve(data, 'profile', worker.fixture, now)
        service.VAULT.save(owner, data)
        if due is None or due > now:
            diag.emit('relationship.deferred', reason_code='read_budget', next_eligible_at=due)
            return {'status': 'retry', 'nextEligibleAt': due or now + 300, 'reason': reason}
        transport_failed=False
        try:
            with diag.span('campaign.relationship_read'):
                result, observed = await relationship(worker, identity)
        except Exception as error:
            diag.emit('campaign.relationship_error', error_type=type(error).__name__)
            transport_failed=read_failure_code(error) is not None
            result, observed = {'status': 0}, {'connected': None, 'recipient': None}
        data = service.VAULT.load(owner)
        policy.provider_result(data, result, worker.fixture)
        if result.get('status') != 200: observed = {'connected': None, 'recipient': None}
        observed['checkedAt'] = now
        if observed['connected'] is not None:
            refreshed_state = policy.control(data, worker.fixture)
            refreshed_state.setdefault('relationships', {})[identity] = observed
            # Fresh validation belongs to this already eligible queued action.
            # Both requests still consume budget; dispatch rechecks all caps,
            # cooldowns and operating hours before reserving the write.
            if completed_wait and observed.get('recipient'):
                if previous_request_at is None:
                    refreshed_state.pop('nextRequestAt', None)
                else:
                    refreshed_state['nextRequestAt'] = previous_request_at
        service.VAULT.save(owner, data)
        # This is still a read-only preflight: no action exists or submission has
        # occurred. Preserve temporary failures as waits instead of unknown IDs.
        if transport_failed or result.get('status') in (429,500,502,503,504):
            due,reason=policy.eligible(data,'profile',worker.fixture,now)
            return {'status':'retry','nextEligibleAt':max(now+60,due or now+300),'reason':reason or 'Profile read is temporarily unavailable'}
    if operation == 'status': return observed
    if observed['connected'] is None or not observed['recipient']:
        diag.emit('campaign.preflight_rejected', reason_code='unknown_relationship')
        raise HTTPException(409, 'LinkedIn connection status is unknown; review the profile')
    if record and record['recipient'] != observed['recipient']:
        raise HTTPException(409, 'LinkedIn recipient identity changed; review before continuing')
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
    if operation == 'connect' and (observed['connected'] or observed.get('invitationPending')):
        pending = observed.get('invitationPending', False)
        diag.emit('invitation.skipped', action_id=action_id, reason_code='invitation_pending' if pending else 'already_connected')
        record.update(status='skipped', reason='Invitation already pending' if pending else 'Already connected', attemptedAt=now)
        data['actions'][action_id] = record
        service.VAULT.save(owner, data)
    if record['status'] == 'queued':
        # Only a fresh call from the eligible enrolment may execute this action.
        # Background maintenance deliberately excludes campaign records.
        record['approvedUntil'] = now + 86400
        record = await service.dispatch_action(owner, worker, record)
    worker.touched = now
    return {'action': record}
