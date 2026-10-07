import asyncio
import tempfile
from unittest.mock import AsyncMock
import pytest
from cryptography.fernet import Fernet, InvalidToken
from fastapi.testclient import TestClient
import server
from storage import Vault

@pytest.fixture()
def setup(monkeypatch):
    with tempfile.TemporaryDirectory() as directory:
        vault = Vault(directory, Fernet.generate_key().decode())
        monkeypatch.setattr(server, 'VAULT', vault)
        monkeypatch.setattr(server, 'workers', {})
        monkeypatch.setattr(server, 'locks', {})
        monkeypatch.setattr(server, 'viewers', {})
        monkeypatch.setattr(server.policy, 'DEFAULTS', {**server.policy.DEFAULTS, 'timezone':'UTC','activeDays':list(range(7)), 'startHour':0,'endHour':24,'minSpacingSeconds':1,'maxSpacingSeconds':1})
        client = TestClient(server.app)  # No real browser startup in unit tests.
        yield client, vault

def call(client, method, path, user='alice', **kwargs):
    return getattr(client, method)(path+'?organizationId=test-org&userId='+user,
        headers={'authorization': 'Bearer '+server.SECRET}, **kwargs)

def test_vault_isolated_encrypted_and_tamper_rejected(setup):
    _, vault = setup
    a,b = vault.owner('org','alice'),vault.owner('org','bob')
    vault.save(a, {'actions':{}, 'browserState':{'cookies':[{'value':'private-cookie'}]}})
    assert not vault.load(b).get('browserState')
    files = list(vault.directory.glob('*.enc'))
    assert len(files)==1 and b'private-cookie' not in files[0].read_bytes()
    files[0].write_bytes(b'tampered')
    with pytest.raises(InvalidToken): vault.load(a)

def test_service_authentication_and_owner_isolation(setup):
    client,_ = setup
    assert client.get('/connection?organizationId=org&userId=alice').status_code==401
    draft = call(client,'post','/actions',json={'kind':'message','recipient':'urn:li:fsd_profile:example','text':'Fixture hello'}).json()['action']
    assert call(client,'post','/actions',user='bob',json={'operation':'execute','id':draft['id'],'approved':True}).status_code==400
    assert call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':False}).status_code==400

def test_uncertain_dispatch_is_never_retried(setup,monkeypatch):
    client,vault = setup
    owner = vault.owner('test-org','alice')
    class Worker:
        fixture=True
        status=AsyncMock(return_value='connected')
    server.workers[owner]=Worker()
    dispatch=AsyncMock(side_effect=TimeoutError())
    monkeypatch.setattr(server,'provider_request',dispatch)
    draft=call(client,'post','/actions',json={'kind':'message','recipient':'urn:li:fsd_profile:example','text':'Fixture hello'}).json()['action']
    for _ in range(2):
        assert call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':True}).json()['action']['status']=='uncertain'
    assert dispatch.call_count==1

def test_live_sends_disabled(setup,monkeypatch):
    client,vault=setup
    owner=vault.owner('test-org','alice')
    class Worker:
        fixture=False
        status=AsyncMock(return_value='connected')
    server.workers[owner]=Worker()
    monkeypatch.setenv('LINKEDIN_ALLOW_LIVE_SENDS','false')
    draft=call(client,'post','/actions',json={'kind':'invite','recipient':'urn:li:fsd_profile:example','text':''}).json()['action']
    assert call(client,'post','/actions',json={'operation':'execute','id':draft['id'],'approved':True}).status_code==403

def test_viewer_expired_and_other_owner_grants_retain_isolation(setup):
    client,vault=setup
    owner=vault.owner('test-org','alice')
    server.viewers['expired']=(owner,0)
    assert client.get('/view/expired').status_code==401
    assert client.get('/view/missing').status_code==401

def test_agent_only_read_tools():
    from browser_use import Tools
    tools=Tools()
    @tools.action('Read page text')
    async def read_current_page() -> str: return 'Fixture text'
    allowed={name: action for name,action in tools.registry.registry.actions.items() if name in {'done','read_current_page'}}
    assert set(allowed)=={'done','read_current_page'}

def test_snapshot_does_not_open_storage_export_tabs(setup):
    from types import SimpleNamespace
    _, vault = setup
    owner = vault.owner('test-org', 'alice')
    worker = server.Worker(owner, 0, fixture=True)
    worker.status = AsyncMock(return_value='connected')
    worker.context = SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'li_at', 'value':'fixture'}]),
                                    storage_state=AsyncMock(side_effect=AssertionError('Must not export all origins')))
    worker.page = SimpleNamespace(url=worker.origin+'/fixture/inbox',
                                  evaluate=AsyncMock(return_value=[{'name':'fixture', 'value':'retained'}]))
    try:
        asyncio.run(worker.snapshot())
        saved = vault.load(owner)['browserState']
        assert saved['origins'] == [{'origin':worker.origin, 'localStorage':[{'name':'fixture','value':'retained'}]}]
        worker.context.storage_state.assert_not_called()
        worker.page.evaluate.side_effect = TimeoutError()
        asyncio.run(worker.snapshot())
        assert vault.load(owner)['browserState'] == saved
    finally:
        import shutil
        shutil.rmtree(worker.directory, ignore_errors=True)


def test_capture_current_messaging_query_without_sync_token():
    from types import SimpleNamespace
    from urllib.parse import urlencode
    import shutil
    worker = server.Worker('capture-test', 0)
    try:
        query = urlencode({'queryId':'messengerConversations.current', 'variables':'(mailboxUrn:urn:li:fsd_profile:synthetic-profile)'})
        path = '/voyager/api/voyagerMessagingGraphQL/graphql?' + query
        worker.capture(SimpleNamespace(url='https://www.linkedin.com'+path, method='GET'))
        assert worker.conversation_request == path
        assert worker.mailbox == 'urn:li:fsd_profile:synthetic-profile'
        assert worker.sync_token is None
        worker.capture(SimpleNamespace(url='https://another.example'+path, method='GET'))
        assert worker.conversation_request == path
    finally:
        shutil.rmtree(worker.directory)


def test_settings_and_queue_are_owned_and_validated(setup):
    client,vault=setup
    assert call(client,'post','/settings',json={'proxy':{}}).status_code==400
    assert call(client,'post','/settings',json={'messagesDaily':5}).json()['settings']['messagesDaily']==5
    assert call(client,'get','/settings',user='bob').json()['settings']['messagesDaily']==20
    draft=call(client,'post','/actions',json={'kind':'message','recipient':'urn:li:fsd_profile:example','text':'Owned draft'}).json()['action']
    assert call(client,'post','/actions',user='bob',json={'operation':'cancel','id':draft['id']}).status_code==400
    assert call(client,'post','/actions',json={'operation':'cancel','id':draft['id']}).json()['action']['status']=='cancelled'
    assert call(client,'get','/queue',user='bob').json()['queue']==[]


def test_cached_inbox_survives_paused_browser_without_provider_call(setup,monkeypatch):
    client,vault=setup
    owner=vault.owner('test-org','alice')
    data=vault.load(owner)
    server.policy.control(data)['inbox']={'fetchedAt':1,'result':{'status':'ok','response':{'status':200,'data':{'conversations':[]}}}}
    vault.save(owner,data)
    provider=AsyncMock(side_effect=AssertionError('Cached reads must not reach LinkedIn'))
    monkeypatch.setattr(server,'conversations',provider)
    result=call(client,'get','/inbox').json()
    assert result['cache']['cached'] and result['cache']['stale']
    provider.assert_not_called()


def test_concurrent_approvals_reserve_before_dispatch(setup,monkeypatch):
    import httpx
    from types import SimpleNamespace
    client,vault=setup
    owner=vault.owner('test-org','alice')
    server.workers[owner]=SimpleNamespace(fixture=True,status=AsyncMock(return_value='connected'),viewer_count=0)
    dispatch=AsyncMock(return_value={'status':200,'data':{'id':'fixture-result'}})
    monkeypatch.setattr(server,'provider_request',dispatch)
    drafts=[call(client,'post','/actions',json={'kind':'message','recipient':'urn:li:fsd_profile:example','text':str(i)}).json()['action'] for i in range(2)]
    async def approve():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),base_url='http://test') as api:
            return await asyncio.gather(*(api.post('/actions?organizationId=test-org&userId=alice',headers={'authorization':'Bearer '+server.SECRET},json={'operation':'execute','id':a['id'],'approved':True}) for a in drafts))
    responses=asyncio.run(approve())
    assert sorted(r.json()['action']['status'] for r in responses)==['queued','submitted']
    assert dispatch.call_count==1
    assert server.policy.usage(vault.load(owner),True)['messagesDaily']['used']==1


def test_keep_alive_defers_for_viewer_and_never_clicks(setup,monkeypatch):
    from types import SimpleNamespace
    client,vault=setup
    owner=vault.owner('test-org','alice')
    data=vault.load(owner)
    server.policy.control(data,True)['settings']={**server.policy.settings(data,True),'keepAliveEnabled':True}
    vault.save(owner,data)
    worker=SimpleNamespace(fixture=True,viewer_count=1,agent_busy=False,status=AsyncMock(return_value='connected'),
        origin='http://127.0.0.1:8080',page=SimpleNamespace(url='http://127.0.0.1:8080/fixture/feed',mouse=SimpleNamespace(wheel=AsyncMock(),click=AsyncMock())))
    asyncio.run(server.keep_alive(owner,worker))
    worker.page.mouse.wheel.assert_not_called()
    data=vault.load(owner)
    server.policy.control(data,True)['nextKeepAliveAt']=0
    vault.save(owner,data)
    worker.viewer_count=0
    monkeypatch.setattr(server.asyncio,'sleep',AsyncMock())
    asyncio.run(server.keep_alive(owner,worker))
    assert 1<=worker.page.mouse.wheel.call_count<=3
    worker.page.mouse.click.assert_not_called()
    assert server.policy.control(vault.load(owner),True)['lastKeepAliveAt']>0


def test_background_restart_resumes_only_opted_in_sessions(setup,monkeypatch):
    from types import SimpleNamespace
    client,vault=setup
    owner=vault.owner('test-org','alice')
    data=vault.load(owner)
    data.update(browserState={'cookies':[],'origins':[]},fixture=True,browserPaused=True)
    server.policy.control(data,True)['settings']={**server.policy.settings(data,True),'keepAliveEnabled':True}
    vault.save(owner,data)
    fake=SimpleNamespace(fixture=True,slot=0,status=AsyncMock(return_value='connected'),agent_busy=False,viewer_count=0,
        touched=server.time.time(),start=AsyncMock(),snapshot=AsyncMock())
    monkeypatch.setattr(server,'Worker',lambda *args:fake)
    monkeypatch.setattr(server,'keep_alive',AsyncMock())
    asyncio.run(server.background_once())
    fake.start.assert_not_called()
    data['browserPaused']=False
    vault.save(owner,data)
    asyncio.run(server.background_once())
    fake.start.assert_awaited_once()
    fake.snapshot.assert_awaited_once()


def test_recovery_does_not_reset_cooldowns_or_usage(setup):
    from types import SimpleNamespace
    client,vault=setup
    owner=vault.owner('test-org','alice')
    server.workers[owner]=SimpleNamespace(fixture=False,status=AsyncMock(return_value='connected'))
    data=vault.load(owner)
    server.policy.reserve(data,'read')
    server.policy.provider_result(data,{'status':429})
    server.policy.provider_result(data,{'status':401})
    vault.save(owner,data)
    before=server.policy.control(data).copy()
    recovered=call(client,'post','/settings',json={'operation':'recover'}).json()
    state=server.policy.control(vault.load(owner))
    assert state['cooldownUntil']==before['cooldownUntil']
    assert state['events']==before['events']
    assert not state['requiresVerification']
    assert recovered['protection']['status']=='cooling_down'


def test_keep_alive_respects_budget_and_verification(setup):
    from types import SimpleNamespace
    client,vault=setup
    owner=vault.owner('test-org','alice')
    worker=SimpleNamespace(fixture=True,viewer_count=0,agent_busy=False,status=AsyncMock(return_value='connected'),
        origin='http://127.0.0.1:8080',page=SimpleNamespace(url='http://127.0.0.1:8080/fixture/feed',mouse=SimpleNamespace(wheel=AsyncMock())))
    data=vault.load(owner)
    state=server.policy.control(data,True)
    state['settings']={**server.policy.settings(data,True),'keepAliveEnabled':True,'requestsHourly':1}
    server.policy.reserve(data,'read',True)
    vault.save(owner,data)
    asyncio.run(server.keep_alive(owner,worker))
    worker.page.mouse.wheel.assert_not_called()
    state=server.policy.control(vault.load(owner),True)
    assert state['nextKeepAliveAt']>server.time.time()
    data=vault.load(owner)
    server.policy.control(data,True).update(events=[],nextRequestAt=0,nextKeepAliveAt=0,requiresVerification=True)
    vault.save(owner,data)
    asyncio.run(server.keep_alive(owner,worker))
    worker.page.mouse.wheel.assert_not_called()


def test_saved_policy_usage_queue_survive_vault_reopen(setup):
    client,vault=setup
    owner=vault.owner('test-org','alice')
    data=vault.load(owner)
    server.policy.control(data)['settings']={**server.policy.settings(data),'messagesDaily':3}
    server.policy.reserve(data,'read')
    data['actions']['pending']={'id':'pending','status':'queued','kind':'message','approvedUntil':server.time.time()+86400}
    vault.save(owner,data)
    import base64
    key=base64.urlsafe_b64encode(vault.cipher._signing_key+vault.cipher._encryption_key)
    reopened=Vault(vault.directory,key).load(owner)
    assert server.policy.settings(reopened)['messagesDaily']==3
    assert server.policy.usage(reopened)['requestsDaily']['used']==1
    assert reopened['actions']['pending']['status']=='queued'


def test_failed_browser_does_not_block_other_accounts(setup,monkeypatch):
    from types import SimpleNamespace
    client,vault=setup
    bad,good=vault.owner('test-org','alice'),vault.owner('test-org','bob')
    server.locks={bad:asyncio.Lock(),good:asyncio.Lock()}
    bad_worker=SimpleNamespace(fixture=True,status=AsyncMock(side_effect=TimeoutError()),agent_busy=False)
    good_worker=SimpleNamespace(fixture=True,status=AsyncMock(return_value='connected'),agent_busy=False,
        snapshot=AsyncMock(),viewer_count=0,touched=server.time.time())
    server.workers={bad:bad_worker,good:good_worker}
    monkeypatch.setattr(server,'keep_alive',AsyncMock())
    asyncio.run(server.background_once())
    good_worker.snapshot.assert_awaited_once()
    assert server.policy.control(vault.load(bad),True)['requiresVerification']
    assert not server.policy.control(vault.load(good),True).get('requiresVerification')

@pytest.mark.parametrize('failure, expected', [
    ('healthy', 'connected'), ('crash', 'browser_crashed'),
    ('unresponsive', 'browser_unresponsive'), ('closed', 'browser_closed'),
    ('disconnected', 'browser_closed'), ('challenge', 'login_required'),
])
def test_worker_status_checks_renderer_even_with_login_cookie(failure, expected):
    from types import SimpleNamespace
    import shutil
    worker = server.Worker('renderer-status-test', 0)
    worker.browser = SimpleNamespace(is_connected=lambda: failure != 'disconnected')
    worker.page = SimpleNamespace(is_closed=lambda: failure == 'closed',
        url=worker.origin + ('/checkpoint/challenge' if failure == 'challenge' else '/feed/'),
        evaluate=AsyncMock(return_value='complete'))
    worker.context = SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'li_at','value':'saved-login'}]))
    if failure == 'crash':
        worker.mark_page_crashed()
    elif failure == 'unresponsive':
        worker.page.evaluate.side_effect = TimeoutError('Renderer did not respond')
    try:
        assert asyncio.run(worker.status()) == expected
        if failure in ('crash', 'unresponsive', 'closed', 'disconnected'):
            worker.context.cookies.assert_not_called()
    finally:
        shutil.rmtree(worker.directory, ignore_errors=True)

@pytest.mark.parametrize('reload_fails', [False, True])
def test_open_browser_recovers_crash_without_replacing_login_cookies(setup, monkeypatch, reload_fails):
    from types import SimpleNamespace
    client, vault = setup
    owner = vault.owner('test-org', 'alice')
    worker = SimpleNamespace(fixture=False, page_crashed=True,
        status=AsyncMock(side_effect=['browser_crashed', 'connected']),
        recover_page=AsyncMock(side_effect=TimeoutError() if reload_fails else None), close=AsyncMock())
    replacement = SimpleNamespace(fixture=False, slot=0, start=AsyncMock(), status=AsyncMock(return_value='login_required'))
    monkeypatch.setattr(server, 'Worker', lambda *args: replacement)
    server.workers[owner] = worker
    server.viewers['old-viewer'] = (owner, server.time.time()+900)
    response = call(client, 'post', '/connection', json={'fixture':False})
    worker.recover_page.assert_awaited_once()
    if reload_fails:
        assert response.status_code == 200
        assert server.workers[owner] is replacement
        worker.close.assert_awaited_once_with(save=False)
        replacement.start.assert_awaited_once()
        assert response.json()['status'] == 'login_required'
    else:
        assert response.status_code == 200
        assert server.workers[owner] is worker
        assert response.json()['status'] == 'connected'
        assert 'old-viewer' not in server.viewers
