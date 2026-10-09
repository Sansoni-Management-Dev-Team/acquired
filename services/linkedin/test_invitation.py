"""Connection-request tracing and reference-client contract, no live outreach."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import server
from adapter import PATHS, payload, invitation_receipt, parse_relationship, request as provider_request, relationship
from test_service import setup, call
from test_campaign import prepare, request
from test_diagnostics import events, records


def receipt():
    urn = 'urn:li:fsd_invitation:fictional'
    return {'data': {'value': {'invitationUrn': urn, '*invitation': urn}}, 'included': [{'entityUrn': urn}]}


def test_invitation_matches_successful_browser_capture_and_receipt():
    body = payload('invite', 'urn:li:fsd_profile:fictional', '', 'a'*32)
    assert body == {'invitee': {'inviteeUnion': {'memberProfile': 'urn:li:fsd_profile:fictional'}}}
    assert 'action=verifyQuotaAndCreateV2' in PATHS['invite']
    assert invitation_receipt(receipt()) == 'urn:li:fsd_invitation:fictional'
    bad = receipt(); bad['included'] = [{'entityUrn': 'urn:li:fsd_invitation:other'}]
    assert invitation_receipt(bad) is None
    bad = receipt(); bad['data']['value']['*invitation'] = 'urn:li:fsd_invitation:other'
    assert invitation_receipt(bad) is None
    assert invitation_receipt({'id': 'legacy'}) is None
    with pytest.raises(ValueError): payload('invite', 'urn:li:fsd_profile:fictional', 'Unverified note', 'a'*32)


def test_invitation_trace_spans_persistence_and_request_without_private_values(setup, monkeypatch, events):
    client, vault, owner, lookup, _ = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    assert queued['status'] == 'queued'
    data = vault.load(owner)
    server.policy.control(data, True)['nextRequestAt'] = 0
    vault.save(owner, data)
    events.clear()

    async def accepted(script, args):
        attempted = vault.load(owner)['actions'][queued['id']]
        assert attempted['status'] == 'uncertain' and attempted['attemptedAt']
        assert args['path'] == PATHS['invite'] and args['method'] == 'POST'
        assert args['body'] == {'invitee': {'inviteeUnion': {'memberProfile': 'urn:li:fsd_profile:alex'}}}
        assert args['messageWrite'] is False and args['invitationWrite'] is True
        assert 'application/json; charset=UTF-8' in script and 'x-restli-protocol-version' in script
        assert any(r['event'] == 'provider.request.start' for r in records(events))
        return {'status': 200, 'data': {**receipt(), 'privateResponse': 'private-note'}}

    worker = server.workers[owner]
    worker.owner, worker.origin = owner, 'https://www.linkedin.com'
    worker.page = SimpleNamespace(url=worker.origin+'/messaging/', evaluate=AsyncMock(side_effect=accepted))
    worker.context = SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'JSESSIONID','value':'private-csrf'}]))
    monkeypatch.setattr(server, 'provider_request', provider_request)
    response = call(client, 'post', '/campaign', json=request())
    assert response.json()['action']['status'] == 'submitted'
    rows = records(events)
    assert {r['trace_id'] for r in rows} == {response.headers['x-linkedin-trace-id']}
    names = [r['event'] for r in rows]
    assert names.index('action.persist_attempt.end') < names.index('provider.request.start')
    assert names.index('provider.request.end') < names.index('action.result')
    assert 'invitation.preflight' in names and 'campaign.operation.end' in names
    assert any(r['event'] == 'relationship.cache' and r['stage'] == 'hit' for r in rows)
    for private in ('private-note', 'private-csrf', 'urn:li:fsd_profile:alex'):
        assert private not in str(rows)
    assert call(client, 'post', '/campaign', json=request()).json()['action']['status'] == 'submitted'
    assert worker.page.evaluate.call_count == lookup.call_count == 1


@pytest.mark.parametrize('response', [{'status': 200, 'data': {}}, {'status': 400, 'data': {'message': 'private-error'}}])
def test_unconfirmed_invitation_never_retries(setup, monkeypatch, response):
    client, vault, owner, _, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    data = vault.load(owner); server.policy.control(data, True)['nextRequestAt'] = 0; vault.save(owner, data)
    provider.return_value = response
    for _ in range(2):
        action = call(client, 'post', '/campaign', json=request()).json()['action']
        assert action['status'] == 'uncertain' and action['id'] == queued['id']
        assert 'private-error' not in str(action)
    assert provider.call_count == 1


def test_unverified_invitation_notes_are_rejected_before_any_provider_request(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    assert call(client, 'post', '/campaign', json=request(text='Unverified note')).status_code == 400
    assert call(client, 'post', '/actions', json={'kind':'invite','recipient':'urn:li:fsd_profile:alex','text':'Unverified note'}).status_code == 400
    assert vault.load(owner).get('actions', {}) == {}
    lookup.assert_not_called(); provider.assert_not_called()


@pytest.mark.parametrize('connected', [True, None])
def test_connection_preflight_logs_skip_or_rejection_without_sending(setup, monkeypatch, events, connected):
    client, _, _, _, provider = prepare(setup, monkeypatch, connected)
    response = call(client, 'post', '/campaign', json=request())
    names = [r['event'] for r in records(events)]
    assert 'campaign.relationship_read.start' in names
    assert 'campaign.relationship_read.end' in names
    assert ('invitation.skipped' if connected else 'campaign.preflight_rejected') in names
    assert response.status_code == (200 if connected else 409)
    provider.assert_not_called()


def test_relationship_timeout_logs_read_phase_and_does_not_send(setup, monkeypatch, events):
    client, _, _, lookup, provider = prepare(setup, monkeypatch)
    lookup.side_effect = TimeoutError('private-session-details')
    response = call(client, 'post', '/campaign', json=request())
    assert response.status_code == 200 and response.json()['status']=='retry'
    rows = records(events)
    assert any(r['event'] == 'campaign.relationship_read.error' and r['error_type'] == 'TimeoutError' for r in rows)
    assert 'private-session-details' not in str(rows)
    provider.assert_not_called()


def test_relationship_check_logs_parsed_status_in_same_trace(events):
    import asyncio
    data = {'included':[{'entityUrn':'urn:li:fsd_profile:fictional', 'publicIdentifier':'fictional', 'distance':{'value':'DISTANCE_1'}}]}
    worker = SimpleNamespace(owner='hashed-owner', fixture=True, origin='https://www.linkedin.com',
        page=SimpleNamespace(url='https://www.linkedin.com/messaging/', evaluate=AsyncMock(return_value={'status':200,'data':data})),
        context=SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'JSESSIONID','value':'private-csrf'}])))
    _, observed = asyncio.run(relationship(worker, 'fictional'))
    assert observed['connected'] is True
    rows = records(events)
    assert len({r['trace_id'] for r in rows}) == 1
    assert rows[0]['event'] == 'relationship.check.start' and rows[-1]['event'] == 'relationship.check.end'
    assert any(r['event'] == 'relationship.result' and r['status'] == 'connected' for r in rows)
    assert 'private-csrf' not in str(rows)


def normalized_relationship():
    target = 'urn:li:fsd_profile:fictional'
    relation = 'urn:li:fsd_memberRelationship:fictional'
    connection = 'urn:li:fsd_connection:fictional'
    return {'included': [
        {'entityUrn': target, 'publicIdentifier': 'fictional', 'profileStatefulProfileActions': {
            'overflowActions': [{'connection': {'memberRelationshipUrn': relation, '*memberRelationship': relation}}]}},
        {'entityUrn': relation, 'memberRelationshipUnion': {'*connection': connection}, 'memberRelationshipData': {'*connection': connection}},
        {'entityUrn': connection, 'connectedMember': target, '*connectedMemberResolutionResult': target},
    ]}


def test_connected_status_follows_current_target_bound_relationship_graph():
    assert parse_relationship(normalized_relationship(), 'fictional') == {'connected': True, 'recipient': 'urn:li:fsd_profile:fictional'}


@pytest.mark.parametrize('failure', ['unrelated_target', 'wrong_member', 'missing_connection', 'duplicate_relation', 'conflicting_degree', 'conflicting_references'])
def test_current_relationship_graph_rejects_unverified_evidence(failure):
    data = normalized_relationship(); profile, relation, connection = data['included']
    if failure == 'unrelated_target': profile['profileStatefulProfileActions'] = {}
    elif failure == 'wrong_member': connection['connectedMember'] = 'urn:li:fsd_profile:other'
    elif failure == 'missing_connection': data['included'].pop()
    elif failure == 'duplicate_relation': data['included'].append(dict(relation))
    elif failure == 'conflicting_degree': profile['connectionDegree'] = 'SECOND'
    else: relation['memberRelationshipData']['*connection'] = 'urn:li:fsd_connection:other'
    assert parse_relationship(data, 'fictional')['connected'] is None
