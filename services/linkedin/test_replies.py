import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from replies import message_events, collection, replace_variable, advance_scan, journal_page
from test_service import setup, call
import server

ME = 'urn:li:fsd_profile:me'
OTHER = 'urn:li:fsd_profile:alex'
THREAD = 'urn:li:msg_conversation:thread'
def message(id='m1', **extra):
    return {'entityUrn': 'urn:li:msg_message:'+id, 'senderUrn': OTHER, 'deliveredAt': 1700000000000, 'body': {'text':'private body'}, **extra}

def test_normalizes_incoming_messages_and_media_but_not_sent_acceptance_or_groups():
    assert message_events([message()], ME, [ME,OTHER])[0]['fromIdentity'] == OTHER
    assert 'private body' not in str(message_events([message()], ME, [ME,OTHER]))
    assert message_events([message(senderUrn=ME)], ME, [ME,OTHER]) == []
    assert message_events([message(eventType='CONNECTION_ACCEPTED')], ME, [ME,OTHER]) == []
    assert message_events([message()], ME, [ME,OTHER,'urn:li:fsd_profile:third']) == []
    assert message_events([message(body=None,attachments=[{'type':'VOICE'}])], ME, [ME,OTHER])

def test_missing_sender_or_pagination_is_unknown_not_a_successful_empty_inbox():
    with pytest.raises(ValueError): message_events([message(senderUrn=None)], ME, [ME,OTHER])
    with pytest.raises(ValueError): collection({'data':{'elements':[]}}, 'messengerMessages')
    with pytest.raises(ValueError): collection({'data':{'messengerMessages':{'elements':[], 'paging':{'start':0,'count':20,'total':1}}}}, 'messengerMessages')
    items, paging = collection({'data':{'messengerMessages':{'elements':[], 'paging':{'start':0,'count':20,'total':0}}}}, 'messengerMessages')
    assert items == [] and paging['total'] == 0

def test_changes_only_observed_variables_and_preserves_nested_urns():
    raw = '(conversationUrn:urn:li:msg_conversation:(me,thread),start:0,count:20)'
    assert replace_variable(raw,'start','20').endswith('start:20,count:20)')
    assert 'conversationUrn:urn:li:msg_conversation:(me,other)' in replace_variable(raw,'conversationUrn','urn:li:msg_conversation:(me,other)')
    with pytest.raises(ValueError): replace_variable(raw,'cursor','invented')

def test_durable_scan_requires_every_conversation_and_message_page_before_complete():
    worker = SimpleNamespace(mailbox=ME, conversation_request='/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(start:0,count:20)', message_request='/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(conversationUrn:urn:li:msg_conversation:old,start:0,count:20)')
    data = {}
    provider = AsyncMock(side_effect=[
        {'status':200,'data':{'data':{'messengerConversations':{'elements':[{'entityUrn':THREAD,'participants':[ME,OTHER]}], 'paging':{'start':0,'count':20,'total':1}}}}},
        {'status':200,'data':{'data':{'messengerMessages':{'elements':[message()], 'paging':{'start':0,'count':1,'total':2}}}}},
        {'status':200,'data':{'data':{'messengerMessages':{'elements':[message('m2')], 'paging':{'start':1,'count':1,'total':2}}}}},
    ])
    asyncio.run(advance_scan(worker,data,provider,1700000100))
    assert journal_page(data,None)['complete'] is False
    asyncio.run(advance_scan(worker,data,provider,1700000101))
    first = journal_page(data,None)
    assert first['complete'] is False and len(first['events']) == 1
    asyncio.run(advance_scan(worker,data,provider,1700000102))
    final = journal_page(data,first['nextCursor'])
    assert final['complete'] is True and len(final['events']) == 1
    with pytest.raises(ValueError): journal_page({**data,'replyJournal':{**data['replyJournal'],'accountIdentity':'other'}},first['nextCursor'])

def test_reply_endpoint_requires_enabled_authenticated_connected_account(setup,monkeypatch):
    client,_ = setup
    monkeypatch.setenv('LINKEDIN_REPLY_MONITOR_ENABLED','false')
    assert call(client,'get','/replies').status_code == 503
    assert client.get('/replies').status_code == 401
    monkeypatch.setenv('LINKEDIN_REPLY_MONITOR_ENABLED','true')
    assert call(client,'get','/replies').status_code == 409

def test_failed_page_does_not_persist_a_partial_conversation_checkpoint(setup,monkeypatch):
    client,vault = setup
    owner = vault.owner('test-org','alice')
    monkeypatch.setenv('LINKEDIN_REPLY_MONITOR_ENABLED','true')
    worker = SimpleNamespace(fixture=True,status=AsyncMock(return_value='connected'),mailbox=ME,
        conversation_request='/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(start:0,count:20)',
        message_request='/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(conversationUrn:urn:li:msg_conversation:old,start:0,count:20)')
    server.workers[owner] = worker
    monkeypatch.setattr(server.policy,'reserve',lambda data,kind,fixture,now:(now,None))
    provider = AsyncMock(return_value={'status':200,'data':{'data':{'messengerConversations':{
        'elements':[{'entityUrn':THREAD,'participants':[ME,OTHER]},{'entityUrn':'unknown','participants':[ME,OTHER]}],
        'paging':{'start':0,'count':20,'total':2}}}}})
    monkeypatch.setattr(server,'provider_request',provider)
    assert call(client,'get','/replies').status_code == 503
    state = server.policy.control(vault.load(owner),True)
    assert not state.get('replyJournal')
