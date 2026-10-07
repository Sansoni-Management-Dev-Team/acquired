"""Real Chromium fixture smoke; never contacts LinkedIn or sends real outreach."""
import asyncio
import json
import os
import httpx
from playwright.async_api import async_playwright
from websockets.asyncio.client import connect

async def main():
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8080',headers={'Authorization':'Bearer '+os.environ['LINKEDIN_SERVICE_SECRET']},timeout=120) as client:
        async def api(method,path,user='smoke-a',body=None):
            response=await client.request(method,path,params={'organizationId':'fixture-smoke','userId':user},json=body)
            assert response.is_success,(response.status_code,response.text)
            return response.json()
        for user in ('smoke-a','smoke-b','smoke-c'):
            await api('DELETE','/connection',user)
        try:
            first=await api('POST','/connection',body={'fixture':True})
            assert first['status']=='login_required'
            token=first['viewerUrl'].rsplit('/',1)[1]
            async with connect('ws://127.0.0.1:8080/stream/'+token,origin=os.getenv('LINKEDIN_PUBLIC_URL','http://127.0.0.1:18096')) as socket:
                assert (await socket.recv()).startswith(b'RFB ')
            print('PASS live VNC stream',flush=True)
            async with async_playwright() as pw:
                browser=await pw.chromium.connect_over_cdp('http://127.0.0.1:9200')
                page=next(p for c in browser.contexts for p in c.pages if '/fixture' in p.url)
                await page.get_by_role('button',name='Sign in as Test User').click()
                await page.wait_for_url('**/fixture/inbox')
                await page.evaluate("localStorage.setItem('restore-test','encrypted-state')")
                await page.wait_for_timeout(300)
                status=await api('GET','/connection')
                assert status['status']=='connected' and status['inboxCaptured'],status
                await api('POST','/settings',body={'timezone':'UTC','activeDays':list(range(7)),'startHour':0,'endHour':24,'minSpacingSeconds':1,'maxSpacingSeconds':1})
                inbox=await api('GET','/inbox')
                assert inbox['response']['data']['conversations'][0]['name']=='Alex Example'
                print('PASS browser login and frontend API inbox',flush=True)
                cached=await api('GET','/inbox')
                assert cached['cache']['cached']
                for kind in ('invite','message'):
                    await asyncio.sleep(1.1)
                    draft=(await api('POST','/actions',body={'kind':kind,'recipient':'urn:li:fsd_profile:fictional-alex','text':'' if kind=='invite' else 'Fictional test only'}))['action']
                    body={'operation':'execute','id':draft['id'],'approved':True}
                    sent=(await api('POST','/actions',body=body))['action']
                    assert sent['status']=='submitted',sent
                    assert (await api('POST','/actions',body=body))['action']==sent
                print('PASS fictional invitation and DM, duplicate execution protection',flush=True)
                dashboard=await api('GET','/settings')
                assert dashboard['usage']['requestsDaily']['used']==3, dashboard['usage']
                await api('POST','/settings',body={'keepAliveEnabled':True})
                # Make the fixture timer due; this is test-owned encrypted data only.
                from server import VAULT
                import policy
                owner=VAULT.owner('fixture-smoke','smoke-a')
                saved=VAULT.load(owner)
                policy.control(saved,True)['nextKeepAliveAt']=0
                policy.control(saved,True)['nextRequestAt']=0
                VAULT.save(owner,saved)
                for _ in range(80):
                    dashboard=await api('GET','/settings')
                    if dashboard['keepAlive']['lastRunAt']: break
                    await asyncio.sleep(0.25)
                assert dashboard['keepAlive']['lastRunAt'],dashboard['keepAlive']
                assert '/fixture/feed' in page.url
                assert await page.evaluate('window.scrollY')>0
                print('PASS cached inbox, persistent quotas and read-only feed activity',flush=True)
                await api('POST','/settings',body={'keepAliveEnabled':False})
                cancelled=(await api('POST','/actions',body={'kind':'message','recipient':'urn:li:fsd_profile:fictional-alex','text':'Cancel this fictional draft'}))['action']
                await api('POST','/actions',body={'operation':'cancel','id':cancelled['id']})
                await api('POST','/connection',body={'action':'pause'})
                assert (await client.get('/view/'+token)).status_code==401
                resumed=await api('POST','/connection',body={})
                assert resumed['status']=='connected',resumed
                restored=await pw.chromium.connect_over_cdp('http://127.0.0.1:9200')
                restored_page=next(p for c in restored.contexts for p in c.pages if '/fixture/inbox' in p.url)
                assert await restored_page.evaluate("localStorage.getItem('restore-test')")=='encrypted-state'
                assert (await api('GET','/settings'))['usage']['messagesDaily']['used']==1
                assert (await api('GET','/inbox'))['cache']['cached']
                print('PASS encrypted cookie/localStorage restore and viewer revocation',flush=True)
            capacity = int(os.getenv('LINKEDIN_MAX_WORKERS', '2'))
            if capacity == 2:
                second=await api('POST','/connection','smoke-b',{'fixture':True})
                assert second['status']=='login_required'
            elif capacity != 1:
                raise RuntimeError('This smoke test expects one or two browser workers')
            full=await client.post('/connection',params={'organizationId':'fixture-smoke','userId':'smoke-c'},json={'fixture':True})
            assert full.status_code==503
            print(f'PASS isolated browser workers, bounded capacity ({capacity})',flush=True)
            await api('DELETE','/connection','smoke-b')
            if status.get('agentConfigured') and os.getenv('LINKEDIN_SMOKE_SKIP_AGENT') != 'true':
                await asyncio.sleep(1.1)
                result=await api('POST','/agent',body={})
                assert result['result']['readOnly'] and result['result']['agentReportedSuccess'],result
                print('PASS read-only Browser Use agent on fictional inbox',flush=True)
            else: print('SKIP agent inspection (no model key or explicitly skipped)',flush=True)
        finally:
            for user in ('smoke-a','smoke-b','smoke-c'):
                await api('DELETE','/connection',user)

if __name__=='__main__': asyncio.run(main())
