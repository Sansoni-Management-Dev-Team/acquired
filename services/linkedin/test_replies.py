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

# Reduced, anonymized structures captured from the connected browser, Oct 2026.
def observed_fixture(name):
    import json
    from pathlib import Path
    return json.loads((Path(__file__).parent/'fixtures/replies-observed.json').read_text())[name]

def test_observed_short_conversation_page_still_has_more_and_empty_cursor_is_terminal():
    from replies import cursor_collection
    items,cursor = cursor_collection(observed_fixture('messengerConversationsByCategoryQuery'),'messengerConversationsByCategoryQuery','nextCursor')
    assert len(items) == 18 and cursor == 'synthetic-cursor'
    assert cursor_collection(observed_fixture('messengerConversationsByCategoryQuery-empty'),'messengerConversationsByCategoryQuery','nextCursor') == ([],None)
    raw = observed_fixture('messengerConversationsByCategoryQuery-empty')
    raw['data']['messengerConversationsByCategoryQuery']['metadata'].pop('nextCursor')
    with pytest.raises(ValueError): cursor_collection(raw,'messengerConversationsByCategoryQuery','nextCursor')

def test_observed_history_endpoint_explicitly_marks_the_end():
    from replies import cursor_collection
    assert cursor_collection(observed_fixture('messengerMessagesByAnchorTimestamp-empty'),'messengerMessagesByAnchorTimestamp','prevCursor') == ([],None)

def test_captures_all_inbox_folders_and_only_unfiltered_message_initial_queries():
    from replies import capture_queries, modern_queries_ready
    q = {}
    for folder in ('PRIMARY_INBOX','SECONDARY_INBOX','ARCHIVE','SPAM'):
        capture_queries(q,f'/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:{folder})))),count:20,mailboxUrn:{ME})',ME)
    capture_queries(q,f'/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:{ME},nextCursor:old)',ME)
    capture_queries(q,f'/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(conversationUrn:{THREAD},syncToken:old)',ME)
    capture_queries(q,f'/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(deliveredAt:1700000000000,conversationUrn:{THREAD},countBefore:20,countAfter:0)',ME)
    assert not modern_queries_ready(q)
    capture_queries(q,f'/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(conversationUrn:{THREAD})',ME)
    assert modern_queries_ready(q)
    q['folders'].remove('SPAM')
    assert not modern_queries_ready(q)

def modern_worker():
    return SimpleNamespace(mailbox=ME,fixture=False,reply_queries={
        'folders':['PRIMARY_INBOX','SECONDARY_INBOX','ARCHIVE','SPAM'],
        'categoryInitial':f'/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:SECONDARY_INBOX)))),count:20,mailboxUrn:{ME})',
        'categoryCursor':f'/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:{ME},nextCursor:old)',
        'messageInitial':f'/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(conversationUrn:{THREAD})',
        'messageBefore':f'/voyagerMessagingGraphQL?queryId=messengerMessages.test&variables=(deliveredAt:1,conversationUrn:{THREAD},countBefore:20,countAfter:0)'})

def category_page(items,cursor=None):
    return {'status':200,'data':{'data':{'messengerConversationsByCategoryQuery':{'elements':items,'metadata':{'nextCursor':cursor}}}}}

def test_modern_scan_covers_every_folder_and_history_before_certifying_completion():
    from replies import advance_modern_scan
    worker=modern_worker(); data={}
    thread={'entityUrn':THREAD,'conversationParticipants':[{'hostIdentityUrn':ME},{'hostIdentityUrn':OTHER}],'lastActivityAt':1700000001000}
    provider=AsyncMock(side_effect=[category_page([thread],'next'),category_page([]),category_page([]),category_page([]),category_page([]),
        {'status':200,'data':{'data':{'messengerMessagesBySyncToken':{'elements':[message(conversation={'entityUrn':THREAD})],'metadata':{'newSyncToken':'new','shouldClearCache':False}}}}},
        {'status':200,'data':{'data':{'messengerMessagesByAnchorTimestamp':{'elements':[],'metadata':{'prevCursor':None,'nextCursor':None}}}}}])
    for step in range(6):
        asyncio.run(advance_modern_scan(worker,data,provider,1700000100+step,0))
        assert journal_page(data,None)['complete'] is False
    asyncio.run(advance_modern_scan(worker,data,provider,1700000106,0))
    assert journal_page(data,None)['complete'] is True
    assert len(journal_page(data,None)['events']) == 1
    paths=[call.args[1] for call in provider.call_args_list]
    assert all(any(folder in path for path in paths) for folder in ('PRIMARY_INBOX','SECONDARY_INBOX','ARCHIVE','SPAM'))
    assert 'nextCursor=next' not in paths[1] and 'nextCursor%3Anext' in paths[1]

def test_modern_scan_rejects_repeated_cursors_wrong_thread_and_unverified_scope():
    from replies import advance_modern_scan
    worker=modern_worker(); data={}
    thread={'entityUrn':THREAD,'conversationParticipants':[ME,OTHER],'lastActivityAt':1700000001000}
    provider=AsyncMock(return_value=category_page([thread],'same'))
    asyncio.run(advance_modern_scan(worker,data,provider,1700000100,0))
    with pytest.raises(ValueError): asyncio.run(advance_modern_scan(worker,data,provider,1700000101,0))
    data={}; worker.reply_queries['folders'].remove('SPAM')
    with pytest.raises(ValueError): asyncio.run(advance_modern_scan(worker,data,provider,1700000100,0))

def test_modern_scan_since_cutoff_is_conservative_and_new_earlier_contact_restarts_scan():
    from replies import advance_modern_scan
    worker=modern_worker();data={}
    old={'entityUrn':THREAD,'conversationParticipants':[ME,OTHER],'lastActivityAt':1699999999000}
    provider=AsyncMock(return_value=category_page([old]))
    for step in range(4): asyncio.run(advance_modern_scan(worker,data,provider,1700000100+step,1700000000))
    assert journal_page(data,None)['complete'] is True and not journal_page(data,None)['events']
    asyncio.run(advance_modern_scan(worker,data,provider,1700000110,0))
    assert journal_page(data,None)['complete'] is False

def test_observed_inline_sender_is_normalized_without_retaining_message_content():
    from replies import observed_collection
    messages,_=observed_collection(observed_fixture('messengerMessagesBySyncToken'),'messengerMessagesBySyncToken')
    incoming=messages[0]
    sender=incoming['sender']['hostIdentityUrn']
    events=message_events([incoming],'urn:li:fsd_profile:syntheticOwner',[sender,'urn:li:fsd_profile:syntheticOwner'])
    assert events[0]['fromIdentity']==sender
    assert set(events[0])=={'id','fromIdentity','receivedAt'}

def test_modern_message_page_cannot_supply_another_threads_reply():
    from replies import advance_modern_scan
    worker=modern_worker();data={}
    thread={'entityUrn':THREAD,'conversationParticipants':[ME,OTHER],'lastActivityAt':1700000001000}
    provider=AsyncMock(side_effect=[category_page([thread]),category_page([]),category_page([]),category_page([]),
        {'status':200,'data':{'data':{'messengerMessagesBySyncToken':{'elements':[message(conversation={'entityUrn':'urn:li:msg_conversation:someoneElse'})],'metadata':{'newSyncToken':'new','shouldClearCache':False}}}}}])
    for step in range(4): asyncio.run(advance_modern_scan(worker,data,provider,1700000100+step,0))
    with pytest.raises(ValueError): asyncio.run(advance_modern_scan(worker,data,provider,1700000105,0))
    assert not journal_page(data,None)['complete'] and not journal_page(data,None)['events']

def test_query_captures_are_persisted_only_for_the_current_owner(setup):
    client,vault=setup
    owner=vault.owner('test-org','alice')
    worker=SimpleNamespace(origin='https://www.linkedin.com',owner=owner,reply_queries={},mailbox=ME,query_id=None,conversation_request=None,message_request=None,sync_token=None)
    request=SimpleNamespace(method='GET',url=f'https://www.linkedin.com/voyagerMessagingGraphQL?queryId=messengerConversations.test&variables=(query:(predicateUnions:List((conversationCategoryPredicate:(category:SPAM)))),count:20,mailboxUrn:{ME})')
    server.Worker.capture(worker,request)
    assert vault.load(owner)['replyReadQueries']['folders']==['SPAM']
    assert not vault.load(vault.owner('test-org','bob')).get('replyReadQueries')

def test_modern_endpoint_rejects_invalid_or_unscoped_since_dates(setup,monkeypatch):
    client,vault=setup;monkeypatch.setenv('LINKEDIN_REPLY_MONITOR_ENABLED','true')
    worker=modern_worker();worker.status=AsyncMock(return_value='connected')
    server.workers[vault.owner('test-org','alice')]=worker
    for value in ('garbage','2026-10-05','2999-01-01T00:00:00Z'):
        assert call(client,'get','/replies',params={'organizationId':'test-org','userId':'alice','since':value}).status_code==400


def test_old_activity_does_not_hide_later_replies_behind_a_conversation_cursor():
    from replies import advance_modern_scan
    worker=modern_worker();data={}
    old={'entityUrn':THREAD,'conversationParticipants':[ME,OTHER],'lastActivityAt':1699999999000}
    provider=AsyncMock(return_value=category_page([old],'older'))
    asyncio.run(advance_modern_scan(worker,data,provider,1700000100,1700000000))
    assert data['replyJournal']['scan']['folder']==0
    assert data['replyJournal']['scan']['cursor']=='older'
    assert not journal_page(data,None)['complete']

def test_cursor_cannot_inject_extra_restli_query_fields():
    from replies import cursor_collection
    with pytest.raises(ValueError):cursor_collection(category_page([], 'x,mailboxUrn:other')['data'],'messengerConversationsByCategoryQuery','nextCursor')

def test_modern_authenticated_endpoint_advances_all_four_folders_atomically(setup,monkeypatch):
    client,vault=setup;monkeypatch.setenv('LINKEDIN_REPLY_MONITOR_ENABLED','true')
    worker=modern_worker();worker.status=AsyncMock(return_value='connected')
    owner=vault.owner('test-org','alice');server.workers[owner]=worker
    monkeypatch.setattr(server.policy,'reserve',lambda data,kind,fixture,now:(now,None))
    provider=AsyncMock(return_value=category_page([]))
    monkeypatch.setattr(server,'provider_request',provider)
    cursor=None
    for index in range(4):
        response=call(client,'get','/replies',params={'organizationId':'test-org','userId':'alice','since':'1970-01-01T00:00:00Z',**({'cursor':cursor} if cursor else {})})
        assert response.status_code==200
        result=response.json();cursor=result['nextCursor']
        assert result['complete']==(index==3)
    assert provider.await_count==4
    assert set(vault.load(owner)['replyReadQueries']['folders'])=={'PRIMARY_INBOX','SECONDARY_INBOX','ARCHIVE','SPAM'}
