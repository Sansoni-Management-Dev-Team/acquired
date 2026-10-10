"""First DM wire contract observed on 10 October 2026; see README capture incident."""
import copy
import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from adapter import payload, message_target, message_receipt
from test_service import setup, call
import server
import campaign

OWN='urn:li:fsd_profile:sender'
RECIPIENT='urn:li:fsd_profile:recipient'
THREAD='urn:li:msg_conversation:(sender,new-thread)'
KEY='campaign:enrolment:first-dm'

def empty_inbox():
    return {'data': {'messengerConversationsBySyncToken': {'elements': []}}}

def test_first_dm_contract_and_campaign_token():
    target=message_target(empty_inbox(),OWN,RECIPIENT,allow_new=True)
    assert target=={'mailboxUrn':OWN,'hostRecipientUrns':[RECIPIENT]}
    action_id='a'*64
    body=payload('message',RECIPIENT,'Hello',action_id,target)
    assert body['hostRecipientUrns']==[RECIPIENT]
    assert 'conversationUrn' not in body['message']
    assert body['mailboxUrn']==OWN
    assert str(uuid.UUID(body['message']['originToken']))==body['message']['originToken']
    assert body==payload('message',RECIPIENT,'Hello',action_id,target)|{'trackingId':body['trackingId']}
    result={'value':{**body['message'],'conversationUrn':THREAD,'entityUrn':'urn:li:msg_message:first'}}
    assert message_receipt(result,body)=='urn:li:msg_message:first'
    for key,value in [('originToken','other'),('conversationUrn','invalid'),('body',{'text':'other'})]:
        wrong=copy.deepcopy(result);wrong['value'][key]=value
        assert message_receipt(wrong,body) is None
    wrong=copy.deepcopy(result);wrong['value']['hostRecipientUrns']=['urn:li:fsd_profile:other']
    assert message_receipt(wrong,body) is None

@pytest.mark.parametrize('raw',[{}, {'data':{'messengerConversationsBySyncToken':{'elements':[{'incompleteRetriableData':True}]}}}])
def test_first_dm_does_not_bypass_unverified_inbox(raw):
    with pytest.raises(ValueError): message_target(raw,OWN,RECIPIENT,allow_new=True)

def test_noncampaign_action_still_requires_existing_thread():
    with pytest.raises(ValueError): message_target(empty_inbox(),OWN,RECIPIENT)

@pytest.mark.parametrize('target',[{'mailboxUrn':OWN,'hostRecipientUrns':[OWN]}, {'mailboxUrn':OWN,'hostRecipientUrns':['urn:li:fsd_profile:other']}, {'mailboxUrn':OWN,'hostRecipientUrns':[RECIPIENT,OWN]}])
def test_payload_rejects_changed_or_multiple_new_recipients(target):
    with pytest.raises(ValueError): payload('message',RECIPIENT,'Hello','a'*64,target)

def test_campaign_first_dm_submits_once_and_replays(setup,monkeypatch):
    client,vault=setup;owner=vault.owner('test-org','alice')
    server.workers[owner]=SimpleNamespace(fixture=True,mailbox=OWN,status=AsyncMock(return_value='connected'),touched=time.time())
    monkeypatch.setattr(campaign,'relationship',AsyncMock(return_value=({'status':200},{'connected':True,'recipient':RECIPIENT})))
    async def accepted(worker,path,method,body):
        assert body['hostRecipientUrns']==[RECIPIENT]
        return {'status':200,'data':{'value':{**body['message'],'conversationUrn':THREAD,'entityUrn':'urn:li:msg_message:first'}}}
    provider=AsyncMock(side_effect=accepted);monkeypatch.setattr(server,'provider_request',provider)
    body={'operation':'message','profile':'https://www.linkedin.com/in/recipient','key':KEY,'text':'Hello'}
    first=call(client,'post','/campaign',json=body).json()['action'];assert first['status']=='queued'
    data=vault.load(owner);state=server.policy.control(data,True);state['nextRequestAt']=0
    state['inbox']={'fetchedAt':time.time(),'result':{'status':'ok','response':{'status':200,'data':empty_inbox()}}};vault.save(owner,data)
    sent=call(client,'post','/campaign',json=body).json()['action']
    assert sent['status']=='submitted';assert sent['conversationUrn']==THREAD
    assert call(client,'post','/campaign',json=body).json()['action']['id']==sent['id']
    assert provider.await_count==1
    assert call(client,'post','/campaign',json={**body,'text':'Changed'}).status_code==409

@pytest.mark.parametrize('response',[{'status':200,'data':{}}, {'status':500,'data':{}}])
def test_first_campaign_dm_uncertain_receipt_never_repeats(setup,monkeypatch,response):
    client,vault=setup;owner=vault.owner('test-org','alice')
    server.workers[owner]=SimpleNamespace(fixture=True,mailbox=OWN,status=AsyncMock(return_value='connected'),touched=time.time())
    monkeypatch.setattr(campaign,'relationship',AsyncMock(return_value=({'status':200},{'connected':True,'recipient':RECIPIENT})))
    provider=AsyncMock(return_value=response);monkeypatch.setattr(server,'provider_request',provider)
    data=vault.load(owner);state=server.policy.control(data,True)
    state['relationships']={'recipient':{'connected':True,'recipient':RECIPIENT,'checkedAt':time.time()}}
    state['inbox']={'fetchedAt':time.time(),'result':{'status':'ok','response':{'status':200,'data':empty_inbox()}}};vault.save(owner,data)
    body={'operation':'message','profile':'https://www.linkedin.com/in/recipient','key':KEY,'text':'Hello'}
    for _ in range(2):
        result=call(client,'post','/campaign',json=body).json()['action']
        assert result['status']=='uncertain'
    assert provider.await_count==1

def test_first_dm_http_fixture_checks_the_captured_wire_contract(setup,monkeypatch):
    client,_=setup;monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES','true')
    path='/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=fictional-dm-alex'
    result=client.get(path)
    assert result.status_code==200
    from adapter import parse_relationship
    assert parse_relationship(result.json(),'fictional-dm-alex')['connected'] is True
    recipient='urn:li:fsd_profile:fictional-dm-alex'
    body=payload('message',recipient,'Hello','a'*64,{'mailboxUrn':'urn:li:fsd_profile:fixture','hostRecipientUrns':[recipient]})
    headers={'cookie':'li_at=fixture','csrf-token':'fixture-csrf','content-type':'text/plain;charset=UTF-8','accept':'application/json','x-restli-protocol-version':'2.0.0'}
    r=client.post('/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',json=body,headers=headers)
    assert r.status_code==200
    assert message_receipt(r.json(),body)
    wrong=copy.deepcopy(body);wrong['hostRecipientUrns']=['urn:li:fsd_profile:other']
    assert client.post('/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',json=wrong,headers=headers).status_code==400

def test_reply_scans_preserve_the_visible_dm_inbox_query(setup):
    import shutil
    worker=server.Worker('fixture-query-separation',0,fixture=True)
    try:
        visible='/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.fixture&variables=(mailboxUrn:urn:li:fsd_profile:fixture,syncToken:visible-inbox-token)'
        worker.capture(SimpleNamespace(url=worker.origin+visible,method='GET'))
        assert worker.conversation_request==visible
        import replies
        for folder in replies.FOLDERS:
            scan='/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.fixture&variables=(query:'+replies.category_query(folder)+',count:20,mailboxUrn:urn:li:fsd_profile:fixture)'
            worker.capture(SimpleNamespace(url=worker.origin+scan,method='GET'))
            assert worker.conversation_request==visible
            assert worker.sync_token=='visible-inbox-token'
        assert set(worker.reply_queries['folders'])==set(replies.FOLDERS)
    finally:
        shutil.rmtree(worker.directory)
