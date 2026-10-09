"""Current target-bound pending invitation contract, with fictional identities."""
import copy
import pytest
from adapter import parse_relationship
from test_campaign import prepare, request
from test_service import setup, call
import server


def profile_response(invitation=True):
    relationship = 'urn:li:fsd_memberRelationship:alex'
    invite = 'urn:li:fsd_invitation:fictional'
    no_connection = {'memberDistance': 'DISTANCE_2'}
    if invitation:
        no_connection['invitationUnion'] = {'*invitation': invite}
    return {'included': [
        {'entityUrn': 'urn:li:fsd_profile:alex', 'publicIdentifier': 'alex',
         'profileStatefulProfileActions': {'secondaryAction': {'statefulAction': {
             'actionDataModelUnion': {'relationshipActionData': {
                 'relationshipData': {'*connectionOrInvitation': relationship},
                 'relationshipDataUnion': {'connectionOrInvitation': relationship}}}}}}},
        {'entityUrn': relationship, 'memberRelationshipUnion': {'noConnection': no_connection},
         'memberRelationshipData': {'*invitation': invite} if invitation else {}},
        *([{'entityUrn': invite, 'inviteeMember': 'urn:li:fsd_profile:alex',
            'invitationState': 'PENDING', 'invitationType': 'SENT'}] if invitation else []),
    ]}


def test_current_secondary_action_reference_resolves_nonconnection():
    assert parse_relationship(profile_response(False), 'alex') == {
        'connected': False, 'recipient': 'urn:li:fsd_profile:alex'}


def test_current_outgoing_pending_invitation_is_verified_for_this_target():
    assert parse_relationship(profile_response(), 'alex') == {
        'connected': False, 'recipient': 'urn:li:fsd_profile:alex', 'invitationPending': True}


@pytest.mark.parametrize('change', ['other_target', 'received', 'withdrawn', 'missing', 'duplicate', 'conflicting_degree'])
def test_unverified_or_conflicting_invitation_cannot_authorise_connection(change):
    data = profile_response()
    if change == 'other_target': data['included'][-1]['inviteeMember'] = 'urn:li:fsd_profile:bob'
    if change == 'received': data['included'][-1]['invitationType'] = 'RECEIVED'
    if change == 'withdrawn': data['included'][-1]['invitationState'] = 'WITHDRAWN'
    if change == 'missing': data['included'].pop()
    if change == 'duplicate': data['included'].append(copy.deepcopy(data['included'][-1]))
    if change == 'conflicting_degree': data['included'][0]['connectionDegree'] = 'FIRST'
    observed = parse_relationship(data, 'alex')
    assert observed['connected'] is None
    assert not observed.get('invitationPending')


def test_unrelated_pending_invitation_does_not_skip_this_target():
    data = profile_response(False)
    data['included'] += profile_response()['included'][1:]
    # Duplicate relationships are ambiguous, never a successful empty lookup.
    assert parse_relationship(data, 'alex')['connected'] is None


def test_known_pending_invitation_skips_without_write_and_replays(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    lookup.return_value = ({'status': 200}, parse_relationship(profile_response(), 'alex'))
    for _ in range(2):
        response = call(client, 'post', '/campaign', json=request())
        assert response.status_code == 200
        action = response.json()['action']
        assert action['status'] == 'skipped'
        assert action['reason'] == 'Invitation already pending'
    assert lookup.call_count == 1
    provider.assert_not_awaited()
    assert not any(event['kind'] == 'invite' for event in server.policy.control(vault.load(owner), True)['events'])


def test_queued_invitation_skips_when_outgoing_pending_request_is_observed(setup, monkeypatch):
    client, vault, owner, lookup, provider = prepare(setup, monkeypatch)
    queued = call(client, 'post', '/campaign', json=request()).json()['action']
    assert queued['status'] == 'queued'
    data = vault.load(owner)
    state = server.policy.control(data, True)
    state['relationships'].clear()
    state['nextRequestAt'] = 0
    vault.save(owner, data)
    lookup.return_value = ({'status': 200}, parse_relationship(profile_response(), 'alex'))
    action = call(client, 'post', '/campaign', json=request()).json()['action']
    assert action['id'] == queued['id']
    assert action['status'] == 'skipped'
    assert action['reason'] == 'Invitation already pending'
    provider.assert_not_awaited()


def test_pending_invitation_does_not_authorise_a_message(setup, monkeypatch):
    client, _, _, lookup, provider = prepare(setup, monkeypatch)
    lookup.return_value = ({'status': 200}, parse_relationship(profile_response(), 'alex'))
    assert call(client, 'post', '/campaign', json=request('message')).status_code == 409
    provider.assert_not_awaited()
