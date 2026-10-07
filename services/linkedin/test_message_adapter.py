"""Sanitized contract from the successful manual HAR; no session credentials."""
import asyncio
import copy
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from adapter import PATHS, payload, message_target, message_receipt, request
from test_service import setup, call, seed_inbox
import server

OWN = 'urn:li:fsd_profile:fixture'
RECIPIENT = 'urn:li:fsd_profile:example'
THREAD = 'urn:li:msg_conversation:(example,thread)'

def inbox():
    return {'data': {'messengerConversationsBySyncToken': {'elements': [{
        'entityUrn': THREAD, 'groupChat': False, 'incompleteRetriableData': False,
        'conversationParticipants': [{'hostIdentityUrn': OWN}, {'hostIdentityUrn': RECIPIENT}]
    }]}}}

def test_har_message_contract_and_receipt():
    target = message_target(inbox(), OWN, RECIPIENT)
    token = uuid.uuid4().hex
    body = payload('message', RECIPIENT, 'Fictional test', token, target)
    assert PATHS['message'].endswith('voyagerMessagingDashMessengerMessages?action=createMessage')
    assert body == {'message': {'body': {'attributes': [], 'text': 'Fictional test'},
        'renderContentUnions': [], 'conversationUrn': THREAD, 'originToken': str(uuid.UUID(token))},
        'mailboxUrn': OWN, 'trackingId': body['trackingId'], 'dedupeByClientGeneratedToken': False}
    assert len(body['trackingId']) == 16
    response = {'value': {**body['message'], 'entityUrn': 'urn:li:msg_message:example'}}
    assert message_receipt(response, body) == 'urn:li:msg_message:example'
    for key, value in [('originToken', 'other'), ('conversationUrn', 'other'), ('body', {'text':'other'})]:
        bad = copy.deepcopy(response)
        bad['value'][key] = value
        assert message_receipt(bad, body) is None
    assert message_receipt({'id': 'legacy'}, body) is None

@pytest.mark.parametrize('failure', ['group', 'wrong_owner', 'wrong_recipient', 'incomplete', 'ambiguous', 'missing'])
def test_target_rejects_unverified_threads(failure):
    raw = inbox()
    items = raw['data']['messengerConversationsBySyncToken']['elements']
    if failure == 'group': items[0]['groupChat'] = True
    if failure == 'wrong_owner': items[0]['conversationParticipants'][0]['hostIdentityUrn'] = 'urn:li:fsd_profile:other'
    if failure == 'wrong_recipient': items[0]['conversationParticipants'][1]['hostIdentityUrn'] = 'urn:li:fsd_profile:other'
    if failure == 'incomplete': items[0]['incompleteRetriableData'] = True
    if failure == 'ambiguous': items.append({**items[0], 'entityUrn': 'urn:li:msg_conversation:another'})
    if failure == 'missing': items.clear()
    with pytest.raises(ValueError): message_target(raw, OWN, RECIPIENT)

def test_modern_headers_use_current_browser_csrf():
    worker = SimpleNamespace(origin='https://www.linkedin.com',
        page=SimpleNamespace(url='https://www.linkedin.com/messaging/', evaluate=AsyncMock(return_value={'status':200})),
        context=SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'JSESSIONID', 'value':'"current-session"'}])))
    asyncio.run(request(worker, PATHS['message'], 'POST', {'message':{}}))
    script, args = worker.page.evaluate.call_args.args
    assert args['csrf'] == 'current-session' and args['messageWrite'] is True
    assert 'text/plain;charset=UTF-8' in script and 'x-restli-protocol-version' in script
    asyncio.run(request(worker, PATHS['invite'], 'POST', {}))
    assert worker.page.evaluate.call_args.args[1]['messageWrite'] is False

@pytest.mark.parametrize('result', [{'status':200,'data':{}}, {'status':400,'data':{'message':'private body'}}])
def test_unconfirmed_send_never_retries(setup, monkeypatch, result):
    client, vault = setup
    owner = vault.owner('test-org','alice')
    server.workers[owner] = SimpleNamespace(fixture=True, mailbox=OWN, status=AsyncMock(return_value='connected'))
    seed_inbox(vault, owner)
    provider = AsyncMock(return_value=result)
    monkeypatch.setattr(server, 'provider_request', provider)
    draft = call(client,'post','/actions',json={'kind':'message','recipient':RECIPIENT,'text':'Fictional test'}).json()['action']
    for _ in range(2):
        action = call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':True}).json()['action']
        assert action['status'] == 'uncertain'
    assert provider.call_count == 1
    assert action['originToken'] == str(uuid.UUID(draft['id']))
    assert 'private body' not in str(action)

def test_inbox_refresh_is_a_separate_rate_limited_read(setup, monkeypatch):
    client, vault = setup
    owner = vault.owner('test-org','alice')
    server.workers[owner] = SimpleNamespace(fixture=True, mailbox=OWN, status=AsyncMock(return_value='connected'))
    refresh = AsyncMock(return_value={'status':'ok','response':{'status':200,'data':inbox()}})
    provider = AsyncMock()
    monkeypatch.setattr(server,'conversations',refresh)
    monkeypatch.setattr(server,'provider_request',provider)
    draft = call(client,'post','/actions',json={'kind':'message','recipient':RECIPIENT,'text':'Fictional test'}).json()['action']
    action = call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':True}).json()['action']
    assert action['status'] == 'queued' and action['nextEligibleAt']
    assert refresh.call_count == 1
    provider.assert_not_called()
    usage = server.policy.usage(vault.load(owner),True)
    assert usage['requestsDaily']['used'] == 1 and usage['messagesDaily']['used'] == 0


def test_long_spacing_does_not_cause_endless_refreshes(setup, monkeypatch):
    import time
    client, vault = setup
    owner = vault.owner('test-org','alice')
    server.workers[owner] = SimpleNamespace(fixture=True, mailbox=OWN, status=AsyncMock(return_value='connected'))
    seed_inbox(vault, owner)
    data = vault.load(owner)
    state = server.policy.control(data, True)
    state['settings'] = {'minSpacingSeconds':600, 'maxSpacingSeconds':600}
    state['inbox']['fetchedAt'] = time.time() - 601
    vault.save(owner, data)
    refresh = AsyncMock()
    async def accepted(worker, path, method, body):
        return {'status':200,'data':{'value':{**body['message'],'entityUrn':'urn:li:msg_message:example'}}}
    monkeypatch.setattr(server,'conversations',refresh)
    monkeypatch.setattr(server,'provider_request',AsyncMock(side_effect=accepted))
    draft = call(client,'post','/actions',json={'kind':'message','recipient':RECIPIENT,'text':'Fictional test'}).json()['action']
    action = call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':True}).json()['action']
    assert action['status'] == 'submitted'
    refresh.assert_not_called()
