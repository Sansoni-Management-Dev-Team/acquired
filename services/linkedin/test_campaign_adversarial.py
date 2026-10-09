"""No browser or live provider: all relationship reads and writes are mocked."""
import time
from unittest.mock import AsyncMock
import pytest
import campaign
import server
from adapter import parse_relationship, profile_identity
from test_service import setup, call
from test_campaign import prepare, request

@pytest.mark.parametrize('value', ['http://linkedin.com/in/alex', 'https://linkedin.com.evil.test/in/alex', 'https://evil.test/in/alex', 'https://linkedin.com/company/alex', 'https://linkedin.com/in/alex/extra', 'urn:li:fsd_profile:'])
def test_profile_input_cannot_choose_arbitrary_provider_url(value):
    with pytest.raises(ValueError):
        profile_identity(value)

@pytest.mark.parametrize('evidence', ['missing', 'conflicting', 'duplicate', 'unrelated'])
def test_relationship_requires_unambiguous_target_evidence(evidence):
    profile = {'entityUrn': 'urn:li:fsd_profile:alex', 'publicIdentifier': 'alex', 'connectionDegree': 'FIRST'}
    if evidence == 'missing': data = {'included': [{**profile, 'connectionDegree': None}]}
    elif evidence == 'conflicting': data = {'included': [{**profile, '*network': 'urn:li:network:alex'}, {'entityUrn': 'urn:li:network:alex', 'distance': {'value': 'DISTANCE_2'}}]}
    elif evidence == 'duplicate': data = {'included': [profile, profile]}
    else: data = {'included': [{**profile, 'publicIdentifier': 'other', 'entityUrn': 'urn:li:fsd_profile:other'}]}
    assert parse_relationship(data, 'alex')['connected'] is None

@pytest.mark.parametrize('state', [None, False])
def test_message_never_dispatches_without_confirmed_connection(setup, monkeypatch, state):
    client, _, _, _, provider = prepare(setup, monkeypatch, state)
    assert call(client, 'post', '/campaign', json=request('message')).status_code == 409
    assert provider.call_count == 0

@pytest.mark.parametrize('status', [401, 403, 429, 500, 999])
def test_failed_relationship_read_never_sends_an_invitation(setup, monkeypatch, status):
    client, _, _, lookup, provider = prepare(setup, monkeypatch)
    lookup.return_value = ({'status': status}, {'connected': False, 'recipient': 'urn:li:fsd_profile:alex'})
    response=call(client,'post','/campaign',json=request())
    assert response.status_code==(200 if status in (429,500) else 409)
    if status in (429,500): assert response.json()['status']=='retry'
    assert provider.call_count == 0

@pytest.mark.parametrize('changed', ['recipient', 'operation', 'text'])
def test_same_key_cannot_be_rebound_to_other_content_or_recipient(setup, monkeypatch, changed):
    client, _, _, _, provider = prepare(setup, monkeypatch, True)
    assert call(client, 'post', '/campaign', json=request()).json()['action']['status'] == 'skipped'
    payload = request()
    if changed == 'recipient': payload['profile'] = 'https://linkedin.com/in/victim'
    elif changed == 'operation': payload.update(operation='message', text='Hi')
    else: payload['text'] = 'Different note'
    assert call(client, 'post', '/campaign', json=payload).status_code == 409
    assert provider.call_count == 0

@pytest.mark.parametrize('failure', ['timeout', 'server-error', 'redirect'])
def test_ambiguous_write_cannot_be_automatically_repeated(setup, monkeypatch, failure):
    # Keep the first write queued even when a busy local VM spends more than
    # one second persisting the profile read and action journal.
    now = time.time()
    monkeypatch.setattr(server.time, 'time', lambda: now)
    client, vault, owner, _, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    data = vault.load(owner); server.policy.control(data, True)['nextRequestAt'] = 0; vault.save(owner, data)
    if failure == 'timeout': provider.side_effect = TimeoutError('response lost')
    else: provider.return_value = {'status': 500 if failure == 'server-error' else 200, 'redirect': failure == 'redirect', 'data': {}}
    first = call(client, 'post', '/campaign', json=request()).json()['action']
    assert first['status'] in ('uncertain', 'blocked')
    second = call(client, 'post', '/campaign', json=request()).json()['action']
    assert second['status'] == first['status']
    assert second['id'] == queued['id']
    assert provider.call_count == 1
