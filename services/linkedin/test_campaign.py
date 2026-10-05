import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from adapter import parse_relationship, profile_identity
from test_service import setup, call
import server
import campaign


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
    provider = AsyncMock(return_value={'status': 200, 'data': {}})
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


def test_live_campaigns_have_a_separate_gate(setup, monkeypatch):
    client, _, owner, lookup, provider = prepare(setup, monkeypatch)
    server.workers[owner].fixture = False
    monkeypatch.delenv('LINKEDIN_ALLOW_CAMPAIGNS', raising=False)
    assert call(client, 'post', '/campaign', json=request()).status_code == 403
    assert provider.call_count == lookup.call_count == 0
