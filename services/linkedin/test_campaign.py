import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from adapter import parse_relationship, profile_identity
from test_service import setup, call
import server
import campaign
from playwright.async_api import Error as BrowserError


def test_relationship_requires_target_evidence():
    target = {'entityUrn': 'urn:li:fsd_profile:alice', 'publicIdentifier': 'alice', 'connectionDegree': 'FIRST'}
    assert parse_relationship({'included': [target]}, 'alice')['connected'] is True
    assert parse_relationship({'included': [target]}, 'bob')['connected'] is None
    assert parse_relationship({'included': [{**target, 'connectionDegree': 'SECOND'}]}, 'alice')['connected'] is False
    assert parse_relationship({'included': [{**target, 'connectionDegree': None}]}, 'alice')['connected'] is None
    assert profile_identity('https://au.linkedin.com/in/alice/') == 'alice'
    with pytest.raises(ValueError): profile_identity('https://linkedin.com.evil.test/in/alice')


def prepare(setup, monkeypatch, connected=False):
    client, vault = setup
    owner = vault.owner('test-org', 'alice')
    server.workers[owner] = SimpleNamespace(fixture=True, status=AsyncMock(return_value='connected'), touched=time.time())
    lookup = AsyncMock(return_value=({'status': 200}, {'connected': connected, 'recipient': 'urn:li:fsd_profile:alex'}))
    monkeypatch.setattr(campaign, 'relationship', lookup)
    urn = 'urn:li:fsd_invitation:fictional'
    provider = AsyncMock(return_value={'status': 200, 'data': {'data': {'value': {'invitationUrn': urn, '*invitation': urn}}, 'included': [{'entityUrn': urn}]}})
    monkeypatch.setattr(server, 'provider_request', provider)
    return client, vault, owner, lookup, provider


def request(operation='connect', **extra):
    return {'operation': operation, 'profile': 'https://www.linkedin.com/in/alex', 'key': 'campaign:enrolment:step', 'text': '' if operation == 'connect' else 'Hi', **extra}


def test_skip_existing_connection_and_replay(setup, monkeypatch):
    client, _, _, lookup, provider = prepare(setup, monkeypatch, True)
    for _ in range(2):
        result = call(client, 'post', '/campaign', json=request()).json()
        assert result['action']['status'] == 'skipped'
    assert lookup.call_count == 1
    assert provider.call_count == 0


def test_queued_invitation_skips_if_recipient_connects_before_retry(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    assert queued['status'] == 'queued'
    data = vault.load(owner)
    state = server.policy.control(data, True)
    state['relationships'].clear()
    state['nextRequestAt'] = 0
    vault.save(owner, data)
    lookup.return_value = ({'status': 200}, {'connected': True, 'recipient': 'urn:li:fsd_profile:alex'})
    result = call(client, 'post', '/campaign', json=request()).json()['action']
    assert result['id'] == queued['id']
    assert result['status'] == 'skipped'
    assert result['reason'] == 'Already connected'
    assert lookup.call_count == 2
    assert provider.call_count == 0
    assert vault.load(owner)['actions'][queued['id']]['status'] == 'skipped'
    assert call(client, 'post', '/campaign', json=request()).json()['action']['status'] == 'skipped'
    assert provider.call_count == 0


def test_unknown_connection_status_never_sends_invitation(setup, monkeypatch):
    client, _, _, lookup, provider = prepare(setup, monkeypatch, None)
    assert call(client, 'post', '/campaign', json=request()).status_code == 409
    assert lookup.call_count == 1
    assert provider.call_count == 0


def test_verification_hold_needs_reconnection_even_with_connected_cookies(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    data = vault.load(owner)
    server.policy.control(data, True)['requiresVerification'] = True
    vault.save(owner, data)
    response = call(client, 'post', '/campaign', json=request('status'))
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'reconnect'
    assert lookup.call_count == provider.call_count == 0


def test_nonconnection_and_unknown_status_never_send_message(setup, monkeypatch):
    client, _, _, _, provider = prepare(setup, monkeypatch, False)
    assert call(client, 'post', '/campaign', json=request('message')).status_code == 409
    assert provider.call_count == 0


def test_personalised_note_limit(setup, monkeypatch):
    client, _, _, lookup, provider = prepare(setup, monkeypatch)
    assert call(client, 'post', '/campaign', json=request(text='x' * 201)).status_code == 400
    assert lookup.call_count == provider.call_count == 0


def test_campaign_queue_is_not_dispatched_by_background_worker(setup, monkeypatch):
    import asyncio
    client, vault, owner, _, provider = prepare(setup, monkeypatch)
    result = call(client, 'post', '/campaign', json=request()).json()
    assert result['action']['status'] == 'queued'
    monkeypatch.setattr(server, 'keep_alive', AsyncMock())
    asyncio.run(server.background_worker(owner, server.workers[owner]))
    assert provider.call_count == 0


def test_replay_of_uncertain_action_never_dispatches(setup, monkeypatch):
    client, vault, owner, _, provider = prepare(setup, monkeypatch)
    record = call(client, 'post', '/campaign', json=request()).json()['action']
    data = vault.load(owner)
    data['actions'][record['id']]['status'] = 'uncertain'
    vault.save(owner, data)
    assert call(client, 'post', '/campaign', json=request()).json()['action']['status'] == 'uncertain'
    assert call(client, 'post', '/campaign', json=request(text='changed')).status_code == 409
    assert provider.call_count == 0


def test_submitted_action_is_idempotent_and_content_bound(setup, monkeypatch):
    client, vault, owner, _, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    assert queued['status'] == 'queued'
    data = vault.load(owner)
    server.policy.control(data, True)['nextRequestAt'] = 0
    vault.save(owner, data)
    for _ in range(2):
        assert call(client, 'post', '/campaign', json=request()).json()['action']['status'] == 'submitted'
    assert provider.call_count == 1
    assert call(client, 'post', '/campaign', json=request(text='different')).status_code == 409


def test_queued_action_refreshes_expired_relationship_without_restarting_completed_wait(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    clock = [10000.0]
    monkeypatch.setattr(campaign.time, 'time', lambda: clock[0])
    monkeypatch.setattr(server.policy.random, 'uniform', lambda minimum, maximum: maximum)
    data = vault.load(owner)
    server.policy.control(data, True)['settings'] = {
        'timezone': 'UTC', 'activeDays': list(range(7)), 'startHour': 0, 'endHour': 24,
        'minSpacingSeconds': 120, 'maxSpacingSeconds': 600}
    vault.save(owner, data)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    assert queued['status'] == 'queued'
    assert queued['nextEligibleAt'] == 10600
    clock[0] = 10600.0
    submitted = call(client, 'post', '/campaign', json=request()).json()['action']
    assert submitted['id'] == queued['id']
    assert submitted['status'] == 'submitted'
    assert lookup.call_count == 2  # Relationship stays fresh at dispatch.
    provider.assert_awaited_once()
    assert server.policy.usage(vault.load(owner), True, clock[0])['requestsHourly']['used'] == 3


def test_queued_action_does_not_spend_profile_budget_before_its_outreach_window(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    clock = [10000.0]
    monkeypatch.setattr(campaign.time, 'time', lambda: clock[0])
    monkeypatch.setattr(server.policy.random, 'uniform', lambda minimum, maximum: maximum)
    data = vault.load(owner)
    server.policy.control(data, True)['settings'] = {
        'timezone': 'UTC', 'activeDays': list(range(7)), 'startHour': 0, 'endHour': 24,
        'minSpacingSeconds': 120, 'maxSpacingSeconds': 600}
    vault.save(owner, data)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    clock[0] = 10500.0  # Cache expired, but the original spacing wait remains.
    for _ in range(2):
        action = call(client, 'post', '/campaign', json=request()).json()['action']
        assert action['id'] == queued['id']
        assert action['status'] == 'queued'
        assert action['nextEligibleAt'] == 10600
    lookup.assert_awaited_once()
    provider.assert_not_awaited()


@pytest.mark.parametrize('failure', [429, 503, 'timeout', 'changed_recipient'])
def test_queued_revalidation_never_writes_after_failed_or_changed_identity(setup, monkeypatch, failure):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    data = vault.load(owner)
    state = server.policy.control(data, True)
    state['relationships'].clear()
    state['nextRequestAt'] = 0
    vault.save(owner, data)
    if failure == 'timeout':
        lookup.side_effect = TimeoutError('private details')
    elif failure == 'changed_recipient':
        lookup.return_value = ({'status': 200}, {'connected': False, 'recipient': 'urn:li:fsd_profile:changed'})
    else:
        lookup.return_value = ({'status': failure}, {'connected': None, 'recipient': None})
    response = call(client, 'post', '/campaign', json=request())
    if failure == 'changed_recipient':
        assert response.status_code == 409
    else:
        assert response.json()['status'] == 'retry'
        assert server.policy.control(vault.load(owner), True)['nextRequestAt'] > time.time()
    assert vault.load(owner)['actions'][queued['id']]['status'] == 'queued'
    provider.assert_not_awaited()


def test_queued_revalidation_that_uses_last_request_slot_still_blocks_the_write(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    data = vault.load(owner)
    state = server.policy.control(data, True)
    state['relationships'].clear()
    state['nextRequestAt'] = 0
    state['settings'] = {'requestsHourly': 2}
    vault.save(owner, data)
    action = call(client, 'post', '/campaign', json=request()).json()['action']
    assert action['id'] == queued['id'] and action['status'] == 'queued'
    assert action['nextEligibleAt'] > time.time()
    assert server.policy.usage(vault.load(owner), True)['requestsHourly']['used'] == 2
    lookup.assert_awaited()
    provider.assert_not_awaited()


def test_live_campaigns_have_a_separate_gate(setup, monkeypatch):
    client, _, owner, lookup, provider = prepare(setup, monkeypatch)
    server.workers[owner].fixture = False
    monkeypatch.delenv('LINKEDIN_ALLOW_CAMPAIGNS', raising=False)
    assert call(client, 'post', '/campaign', json=request()).status_code == 403
    assert provider.call_count == lookup.call_count == 0


def test_live_relationship_check_does_not_enable_campaign_writes(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch, True)
    server.workers[owner].fixture = False
    monkeypatch.delenv('LINKEDIN_ALLOW_CAMPAIGNS', raising=False)
    monkeypatch.delenv('LINKEDIN_ALLOW_LIVE_SENDS', raising=False)
    result = call(client, 'post', '/campaign', json={'operation':'status','profile':'https://www.linkedin.com/in/alex'})
    assert result.status_code == 200
    assert result.json()['connected'] is True
    assert call(client, 'post', '/campaign', json=request('message')).status_code == 403
    assert vault.load(owner).get('actions', {}) == {}
    lookup.assert_awaited_once()
    provider.assert_not_called()


@pytest.mark.parametrize('operation',['status','connect','message'])
@pytest.mark.parametrize('failure',[TimeoutError('private transport details'),BrowserError('Page.evaluate: TimeoutError: signal timed out')])
def test_temporary_relationship_timeout_is_retryable_before_any_submission(setup,monkeypatch,operation,failure):
    client,vault,owner,lookup,provider=prepare(setup,monkeypatch)
    lookup.side_effect=failure
    response=call(client,'post','/campaign',json=request(operation))
    assert response.status_code==200
    result=response.json()
    assert result['status']=='retry' and result['nextEligibleAt']>time.time()
    assert 'private' not in response.text
    assert not vault.load(owner).get('actions')
    provider.assert_not_awaited()


@pytest.mark.parametrize('status',[429,502,503,504])
def test_temporary_relationship_provider_failure_does_not_become_unknown_identity(setup,monkeypatch,status):
    client,_,_,lookup,provider=prepare(setup,monkeypatch)
    lookup.return_value=({'status':status},{'connected':None,'recipient':None})
    assert call(client,'post','/campaign',json=request('status')).json()['status']=='retry'
    provider.assert_not_awaited()


def test_receipt_lookup_is_read_only_and_owner_scoped(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch, True)
    submitted = call(client, 'post', '/campaign', json=request()).json()['action']
    server.workers.clear()  # Receipts survive browser restarts.
    data = vault.load(owner)
    data['fixture'] = True
    vault.save(owner, data)
    def receipt(user='alice'):
        return client.get('/campaign?key=campaign:enrolment:step&organizationId=test-org&userId='+user, headers={'authorization':'Bearer '+server.SECRET})
    for _ in range(2):
        response = receipt()
        assert response.status_code == 200
        assert response.json()['action']['id'] == submitted['id']
        assert 'text' not in response.json()['action']
    assert receipt('bob').json() == {'status': 'missing'}
    assert lookup.call_count == 1
    assert provider.call_count == 0
