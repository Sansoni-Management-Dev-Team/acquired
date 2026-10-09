import asyncio
import contextlib
import copy
import hashlib
import hmac
import json
import os
import re
import random
import secrets
import shutil
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from playwright.async_api import async_playwright
from storage import Vault
from adapter import request as provider_request, conversations, payload, PATHS, message_target, message_receipt, invitation_receipt, read_failure_code
import policy
import replies
import diagnostics as diag

SECRET = os.environ['LINKEDIN_SERVICE_SECRET']
if len(SECRET) < 32:
    raise RuntimeError('Service secret too short')
VAULT = Vault(os.getenv('LINKEDIN_STATE_DIR', '/data'), os.environ['LINKEDIN_ENCRYPTION_KEY'])
PUBLIC = os.getenv('LINKEDIN_PUBLIC_URL', 'http://127.0.0.1:18096')
MAX_WORKERS = int(os.getenv('LINKEDIN_MAX_WORKERS', '2'))
workers = {}
viewers = {}
locks = {}
allocation = asyncio.Lock()
playwright = None

class Worker:
    def __init__(self, owner, slot, fixture=False):
        self.owner, self.slot, self.fixture = owner, slot, fixture
        self.origin = 'http://127.0.0.1:8080' if fixture else 'https://www.linkedin.com'
        self.directory = tempfile.mkdtemp(prefix='linkedin-profile-')
        self.processes = []
        self.reply_queries = {}
        self.sync_token = self.mailbox = self.query_id = self.conversation_variables = self.conversation_request = self.message_request = None
        self.touched = time.time()
        self.agent_busy = False
        self.viewer_count = 0
        self.page_crashed = False

    async def start(self):
        with diag.span('browser.start', owner=self.owner, slot=self.slot, fixture=self.fixture):
            result = await self._start()
            diag.emit('browser.start.result', status=result if isinstance(result, str) else 'complete')
            return result

    async def _start(self):
        display = f':{80 + self.slot}'
        env = {**os.environ, 'DISPLAY': display}
        commands = [
            ['Xvfb', display, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'],
            ['x11vnc', '-display', display, '-rfbport', str(5900 + self.slot), '-localhost', '-nopw', '-forever', '-shared', '-quiet'],
            ['chromium', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
             '--disable-sync', '--password-store=basic', '--remote-debugging-address=127.0.0.1',
             f'--remote-debugging-port={9200 + self.slot}', f'--user-data-dir={self.directory}', 'about:blank'],
        ]
        for command in commands:
            with diag.span('browser.process_launch', process=command[0]):
                process = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.processes.append(process)
                await asyncio.sleep(0.3)
                diag.emit('browser.process_state', process=command[0], exit_code=process.poll())
        for _ in range(60):
            try:
                with diag.span('browser.cdp_connect', timeout_ms=1000):
                    self.browser = await playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{9200+self.slot}', timeout=1000)
                break
            except Exception:
                await asyncio.sleep(0.3)
        else:
            raise RuntimeError('Browser did not start')
        data = VAULT.load(self.owner)
        diag.emit('browser.restore_state', saved_session=bool(data.get('browserState')))
        self.reply_queries = data.get('replyReadQueries', {})
        state = data.get('browserState') if data.get('fixture') == self.fixture else None
        initial_pages = [page for context in self.browser.contexts for page in context.pages]
        with diag.span('browser.restore_context', saved_session=bool(state)):
            self.context = await self.browser.new_context(storage_state=state, viewport={'width': 1280, 'height': 800})
        with diag.span('browser.configure_page'):
            self.context.set_default_timeout(10000)
            self.page = await self.context.new_page()
            self.page.on('crash', self.mark_page_crashed)
            session = await self.context.new_cdp_session(self.page)
            window = await session.send('Browser.getWindowForTarget')
            await session.send('Browser.setWindowBounds', {'windowId': window['windowId'], 'bounds': {'left': 0, 'top': 0, 'width': 1280, 'height': 900, 'windowState': 'normal'}})
            await session.detach()
            for page in initial_pages:
                await page.close()
        self.context.on('request', self.capture)
        with diag.span('browser.navigate', stage='login', timeout_ms=45000):
            await self.page.goto(self.origin + ('/fixture' if self.fixture else '/login'), wait_until='domcontentloaded', timeout=45000)
        if await self.authenticated():
            with diag.span('browser.navigate', stage='messaging', timeout_ms=45000):
                await self.page.goto(self.origin + ('/fixture/inbox' if self.fixture else '/messaging/'), wait_until='domcontentloaded', timeout=45000)

    def capture(self, request):
        parsed = urlparse(request.url)
        if parsed.netloc != urlparse(self.origin).netloc or 'voyagerMessagingGraphQL' not in parsed.path:
            return
        query = parse_qs(parsed.query)
        query_id = query.get('queryId', [''])[0]
        variables = unquote(query.get('variables', [''])[0])
        token = re.search(r'syncToken:([^,)]+)', variables)
        mailbox = re.search(r'mailboxUrn:(urn:li:[^,)]+)', variables)
        if request.method == 'GET' and query_id.startswith('messengerConversations.') and mailbox:
            self.sync_token, self.mailbox, self.query_id = token[1] if token else None, mailbox[1], query_id
            self.conversation_variables = query.get('variables', [''])[0]
            self.conversation_request = parsed.path + '?' + parsed.query
        if request.method == 'GET' and query_id.startswith('messengerMessages.') and 'conversationUrn:' in variables:
            self.message_request = parsed.path + '?' + parsed.query
        if request.method == 'GET' and self.mailbox and query_id.startswith(('messengerConversations.','messengerMessages.')):
            try:
                if replies.capture_queries(self.reply_queries,parsed.path+'?'+parsed.query,self.mailbox):
                    data=VAULT.load(self.owner);data['replyReadQueries']=self.reply_queries;VAULT.save(self.owner,data)
            except ValueError:
                pass

    async def authenticated(self):
        with diag.span('browser.cookies', owner=self.owner, timeout_ms=5000):
            cookies = await asyncio.wait_for(self.context.cookies(self.origin), 5)
        return any(c['name'] == 'li_at' and c['value'] for c in cookies)

    def mark_page_crashed(self, *_):
        self.page_crashed = True

    async def recover_page(self):
        with diag.span('browser.recover', owner=self.owner, slot=self.slot):
            await self._recover_page()

    async def _recover_page(self):
        # Playwright rejects reload on a crashed target. A fresh tab in the
        # same context preserves the current cookies without restoring a vault.
        previous = self.page
        target = previous.url
        if urlparse(target).netloc != urlparse(self.origin).netloc:
            target = self.origin + ('/fixture' if self.fixture else '/login')
        page = await self.context.new_page()
        try:
            with diag.span('browser.navigate', stage='recovery', timeout_ms=40000):
                await page.goto(target, wait_until='domcontentloaded', timeout=40000)
        except Exception:
            await page.close()
            raise
        self.page = page
        self.page_crashed = False
        page.on('crash', self.mark_page_crashed)
        with contextlib.suppress(Exception):
            await previous.close()

    async def status(self):
        with diag.span('browser.status', owner=self.owner, slot=self.slot, fixture=self.fixture):
            result = await self._status()
            diag.emit('browser.status.result', status=result if isinstance(result, str) else 'complete')
            return result

    async def _status(self):
        if not self.browser.is_connected() or self.page.is_closed():
            return 'browser_closed'
        if self.page_crashed:
            return 'browser_crashed'
        try:
            # A crashed renderer retains its URL and cookies. Check the page
            # responds before treating those as a live session.
            with diag.span('browser.renderer_probe', timeout_ms=5000):
                await asyncio.wait_for(self.page.evaluate('() => document.readyState'), 5)
        except Exception:
            return 'browser_crashed' if self.page_crashed else 'browser_unresponsive'
        if urlparse(self.page.url).netloc != urlparse(self.origin).netloc:
            return 'login_required'
        path = urlparse(self.page.url).path
        if any(s in path for s in ('checkpoint', 'challenge', 'login', 'authwall')):
            return 'login_required'
        try:
            return 'connected' if await self.authenticated() else 'login_required'
        except Exception:
            return 'browser_unresponsive'

    async def snapshot(self):
        if await self.status() == 'connected':
            data = VAULT.load(self.owner)
            # storage_state visits every embedded origin in a visible temporary
            # tab. Capture only this channel's cookies and existing page storage.
            cookies = await asyncio.wait_for(self.context.cookies(self.origin), 5)
            origins = [entry for entry in data.get('browserState', {}).get('origins', [])
                       if entry.get('origin') == self.origin]
            parsed = urlparse(self.page.url)
            if f'{parsed.scheme}://{parsed.netloc}' == self.origin:
                try:
                    local = await asyncio.wait_for(self.page.evaluate('''() =>
                        Object.keys(localStorage).map(name => ({name, value: localStorage.getItem(name)}))'''), 5)
                    origins = [{'origin': self.origin, 'localStorage': local}]
                except Exception:
                    # Keep the last saved storage when the page is navigating.
                    pass
            data.update(browserState={'cookies': cookies, 'origins': origins}, fixture=self.fixture, replyReadQueries=self.reply_queries)
            VAULT.save(self.owner, data)

    async def close(self, save=True):
        with diag.span('browser.close', owner=self.owner, slot=self.slot):
            await self._close(save)

    async def _close(self, save=True):
        if save:
            with contextlib.suppress(Exception):
                await self.snapshot()
        if hasattr(self, 'browser'):
            with contextlib.suppress(Exception):
                await self.browser.close()
        for process in reversed(self.processes):
            process.terminate()
        for process in reversed(self.processes):
            try:
                await asyncio.to_thread(process.wait, timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(self.directory, ignore_errors=True)

def mode_for(owner):
    worker = workers.get(owner)
    return worker.fixture if worker else bool(VAULT.load(owner).get('fixture', False))


def dashboard(owner):
    data, fixture = VAULT.load(owner), mode_for(owner)
    state = policy.control(data, fixture)
    actions = [a for a in data.get('actions', {}).values() if a.get('fixture', False) == fixture]
    protection = policy.status_summary(data, fixture)
    protection['liveSendsEnabled'] = os.getenv('LINKEDIN_ALLOW_LIVE_SENDS') == 'true'
    protection['campaignsEnabled'] = os.getenv('LINKEDIN_ALLOW_CAMPAIGNS') == 'true'
    return {'settings': policy.settings(data, fixture), 'usage': policy.usage(data, fixture),
            'protection': protection, 'queue': sorted(actions, key=lambda a:a.get('createdAt',0), reverse=True)[:100],
            'activity': list(reversed(state.get('activity', []))),
            'keepAlive': {'enabled': policy.settings(data, fixture)['keepAliveEnabled'],
                          'lastRunAt': state.get('lastKeepAliveAt'), 'nextRunAt': state.get('nextKeepAliveAt'),
                          'status': state.get('keepAliveStatus', 'Not scheduled')},
            'cache': {'fetchedAt': state.get('inbox', {}).get('fetchedAt')},
            'replyReader': {'requested':reply_reader_requested(state),
                            'stage':state.get('replyJournal',{}).get('scan',{}).get('stage'),
                            'folder':state.get('replyJournal',{}).get('scan',{}).get('folder'),
                            'pages':state.get('replyJournal',{}).get('scan',{}).get('pages'),
                            'boundedFolders':state.get('replyJournal',{}).get('scan',{}).get('boundedFolders'),
                            'lastAttemptAt':state.get('lastReplyReadAttemptAt'),
                            'lastCompleteAt':state.get('replyJournal',{}).get('coverageAt'),
                            'error':state.get('replyReadError')},
            'fixture': fixture}


async def dispatch_action(owner, worker, record):
    with diag.context(trace_id=diag.CONTEXT.get().get('trace_id') or diag.trace_id(),
                      owner=owner, action_id=record['id'], fixture=worker.fixture):
        with diag.span('action.dispatch', kind=record['kind']):
            diag.emit('action.initial_state', status=record['status'])
            result = await _dispatch_action(owner, worker, record)
            diag.emit('action.result', status=result['status'], provider_status=result.get('providerStatus'),
                      next_eligible_at=result.get('nextEligibleAt'), has_receipt=bool(result.get('providerId')))
            return result


async def _dispatch_action(owner, worker, record):
    """Caller holds the owner lock; reserve and persist before any network await."""
    data = VAULT.load(owner)
    if record['status'] != 'queued':
        return record
    now = time.time()
    if record.get('approvedUntil', 0) < now:
        record.update(status='expired', reason='Approval expired; create a fresh draft')
    elif worker.fixture != record.get('fixture', False):
        record['reason'] = 'Resume the account used for this draft'
    elif not worker.fixture and os.getenv('LINKEDIN_ALLOW_LIVE_SENDS') != 'true':
        record['reason'] = 'Live sends are disabled on the test service'
    elif getattr(worker, 'viewer_count', 0):
        record['reason'] = 'Waiting while the live browser is open'
    elif record['kind'] == 'invite' and record['text'].strip():
        record.update(status='blocked', reason='Invitation notes require a verified browser capture; send without a note')
    elif await worker.status() != 'connected':
        policy.control(data, worker.fixture).update(requiresVerification=True, reason='Complete login in the live browser')
        record['reason'] = 'Complete login in the live browser'
    else:
        target = None
        if record['kind'] == 'invite':
            diag.emit('invitation.preflight', recipient_id=diag.identifier(record['recipient']))
        if record['kind'] == 'message':
            cached = policy.control(data, worker.fixture).get('inbox', {})
            # Keep the read valid through the configured request spacing, otherwise
            # a long spacing window would cause endless refreshes before sending.
            freshness = max(300, policy.settings(data, worker.fixture)['maxSpacingSeconds'] + 60)
            if now - cached.get('fetchedAt', 0) > freshness:
                due, reason = policy.reserve(data, 'read', worker.fixture, now)
                record.update(nextEligibleAt=due, reason=reason)
                if due is not None and due <= now:
                    VAULT.save(owner, data)
                    try:
                        inbox = await conversations(worker)
                    except Exception:
                        inbox = {'status': 'provider_error', 'response': {'status': 0}}
                    data = VAULT.load(owner)
                    policy.provider_result(data, inbox.get('response', {}), worker.fixture)
                    if inbox.get('status') == 'ok':
                        policy.control(data, worker.fixture)['inbox'] = {'fetchedAt': now, 'result': inbox}
                        record['reason'] = 'Inbox refreshed; waiting between requests before sending'
                        record['nextEligibleAt'] = policy.control(data, worker.fixture).get('nextRequestAt')
                    else:
                        record['reason'] = 'Refresh LinkedIn Messaging before sending'
                data['actions'][record['id']] = record
                VAULT.save(owner, data)
                return record
            try:
                with diag.span('action.resolve_conversation'):
                    target = message_target(cached['result']['response']['data'], worker.mailbox, record['recipient'])
                diag.emit('action.target_verified', conversation_id=diag.identifier(target['conversationUrn']), mailbox_id=diag.identifier(target['mailboxUrn']), recipient_id=diag.identifier(record['recipient']))
            except (ValueError, KeyError, AttributeError):
                record.update(status='blocked', reason='Refresh LinkedIn Messaging: a verified one-to-one conversation is required')
                data['actions'][record['id']] = record
                VAULT.save(owner, data)
                return record
        with diag.span('action.reserve_write'):
            due, reason = policy.reserve(data, record['kind'], worker.fixture, now)
        record.update(nextEligibleAt=due, reason=reason)
        if due is not None and due <= now:
            with diag.span('action.build_payload'):
                body = payload(record['kind'], record['recipient'], record['text'], record['id'], target)
            if target:
                record.update(conversationUrn=target['conversationUrn'], mailboxUrn=target['mailboxUrn'], originToken=body['message']['originToken'])
            record.update(status='uncertain', attemptedAt=now, traceId=diag.CONTEXT.get().get('trace_id'))
            data['actions'][record['id']] = record
            with diag.span('action.persist_attempt'):
                VAULT.save(owner, data)
            diag.emit('action.attempt_reserved', status='uncertain')
            try:
                result = await provider_request(worker, PATHS[record['kind']], 'POST', body)
            except Exception as error:
                diag.emit('action.provider_error', error_type=type(error).__name__)
                result = {'status': 0}
            data = VAULT.load(owner)
            policy.provider_result(data, result, worker.fixture)
            record['providerStatus'] = result['status']
            record['providerEndpoint'] = PATHS[record['kind']]
            record['providerRedirect'] = bool(result.get('redirect'))
            error = result.get('data')
            if isinstance(error, dict):
                # Numeric error codes aid diagnosis without retaining response bodies or credentials.
                record['providerErrorCodes'] = {key: error[key] for key in ('status', 'serviceErrorCode') if type(error.get(key)) is int}
            if 200 <= result['status'] < 300 and not result.get('redirect'):
                response = result.get('data') or {}
                receipt = message_receipt(response, body) if record['kind'] == 'message' else invitation_receipt(response)
                record['providerId'] = receipt
                if receipt:
                    record['status'] = 'submitted'
                else:
                    record['reason'] = 'Response did not confirm this action; verify in LinkedIn before creating another action'
            elif result['status'] in (401,403,422,429,999) or result.get('redirect'):
                record['status'] = 'blocked'
                record['reason'] = policy.control(data, worker.fixture).get('reason', 'LinkedIn rejected this action')
            else:
                record['reason'] = 'Outcome unknown; verify in LinkedIn before creating another action'
            policy.activity(data, record['kind'], record['status'], record.get('reason') or 'Request accepted by LinkedIn; delivery not yet verified', worker.fixture)
    data['actions'][record['id']] = record
    VAULT.save(owner, data)
    return record


async def keep_alive(owner, worker):
    data, now = VAULT.load(owner), time.time()
    config, state = policy.settings(data, worker.fixture), policy.control(data, worker.fixture)
    if not config['keepAliveEnabled']:
        return
    if state.get('nextKeepAliveAt', 0) > now:
        return
    if getattr(worker, 'viewer_count', 0) or worker.agent_busy:
        state.update(keepAliveStatus='Waiting while the live browser is in use', nextKeepAliveAt=now+60)
    elif any(a['status']=='queued' and a.get('fixture',False)==worker.fixture for a in data.get('actions',{}).values()):
        state.update(keepAliveStatus='Waiting for queued actions', nextKeepAliveAt=now+60)
    elif await worker.status() != 'connected':
        state.update(requiresVerification=True, reason='Complete login in the live browser', keepAliveStatus='Needs verification')
    else:
        due, reason = policy.reserve(data, 'keepalive', worker.fixture, now)
        if due is None or due > now:
            if due and reason in ('Outside active hours', 'Waiting for active hours'):
                due = policy.schedule_next(config, due + random.uniform(60, 900), 'keepalive')
            state.update(keepAliveStatus=reason, nextKeepAliveAt=due or now+300)
        else:
            # Save intent first: a crash must not cause an immediate repeated visit.
            state.update(nextKeepAliveAt=now+random.uniform(config['keepAliveMinMinutes'],config['keepAliveMaxMinutes'])*60,
                         keepAliveStatus='Running read-only feed activity')
            VAULT.save(owner,data)
            worker.agent_busy = True
            try:
                feed = worker.origin + ('/fixture/feed' if worker.fixture else '/feed/')
                if worker.page.url.split('?')[0].rstrip('/') != feed.rstrip('/'):
                    response = await worker.page.goto(feed,wait_until='domcontentloaded',timeout=20000)
                    if response and response.status >= 400:
                        policy.provider_result(data, {'status':response.status}, worker.fixture)
                        raise RuntimeError('Feed unavailable')
                if await worker.status() != 'connected':
                    state.update(requiresVerification=True, reason='Complete verification in the live browser')
                    raise RuntimeError('Verification required')
                for _ in range(random.randint(1,3)):
                    await worker.page.mouse.wheel(0,random.randint(220,650))
                    await asyncio.sleep(random.uniform(0.5,1.5))
                state.update(lastKeepAliveAt=now, keepAliveStatus='Read-only feed activity completed')
                policy.activity(data,'keepalive','complete','Visited the feed and scrolled; no likes, messages or invitations',worker.fixture)
                worker.touched = now
            except Exception:
                if not state.get('requiresVerification'):
                    policy.provider_result(data, {'status':0}, worker.fixture)
                state['keepAliveStatus'] = 'Feed activity stopped; check account status'
                policy.activity(data,'keepalive','stopped','Feed activity stopped; session preserved',worker.fixture)
            finally:
                worker.agent_busy = False
    VAULT.save(owner,data)


async def background_once():
    # Resume opted-in sessions after service restart; explicit browser pauses win.
    for path in VAULT.directory.glob('*.enc'):
        owner = path.stem
        if owner in workers or locks.setdefault(owner,asyncio.Lock()).locked():
            continue
        async with locks[owner]:
            data = VAULT.load(owner)
            fixture = bool(data.get('fixture',False))
            state = policy.control(data,fixture)
            wants_browser = reply_reader_requested(state) or policy.settings(data,fixture)['keepAliveEnabled'] or any(a['status']=='queued' and a.get('fixture',False)==fixture for a in data.get('actions',{}).values())
            if not data.get('browserState') or data.get('browserPaused') or not wants_browser or state.get('requiresVerification') or state.get('resumeAfter',0)>time.time():
                continue
            async with allocation:
                slot = next((i for i in range(MAX_WORKERS) if i not in {w.slot for w in workers.values()}),None)
                if slot is None:
                    continue
                worker = Worker(owner,slot,fixture)
                workers[owner] = worker
                try:
                    await worker.start()
                except Exception:
                    with contextlib.suppress(Exception): await worker.close(save=False)
                    workers.pop(owner,None)
                    state['resumeAfter'] = time.time()+300
                    VAULT.save(owner,data)
    for owner, worker in list(workers.items()):
        if locks[owner].locked() or worker.agent_busy:
            continue
        try:
            await background_worker(owner, worker)
        except Exception:
            # One failed browser must not stop work for unrelated accounts.
            with contextlib.suppress(Exception):
                data = VAULT.load(owner)
                policy.control(data, worker.fixture).update(
                    requiresVerification=True, reason='Browser unavailable; reopen the live browser',
                    keepAliveStatus='Browser unavailable')
                VAULT.save(owner, data)


async def background_worker(owner, worker):
    async with locks[owner]:
        data = VAULT.load(owner)
        if await worker.status() != 'connected':
            state = policy.control(data,worker.fixture)
            state.update(requiresVerification=True,reason='Complete login or verification in the live browser')
            VAULT.save(owner,data)
            return
        for record in sorted(data.get('actions',{}).values(),key=lambda a:a.get('approvedAt',0)):
            if record['status']=='queued' and not record.get('campaignKey') and record.get('fixture',False)==worker.fixture:
                await dispatch_action(owner,worker,record)
                break
        await background_reply_read(owner,worker)
        await keep_alive(owner,worker)
        with contextlib.suppress(Exception):
            await worker.snapshot()
        data = VAULT.load(owner)
        keep_open = reply_reader_requested(policy.control(data,worker.fixture)) or policy.settings(data,worker.fixture)['keepAliveEnabled'] or any(a['status']=='queued' for a in data.get('actions',{}).values())
        if not keep_open and not getattr(worker,'viewer_count',0) and time.time()-worker.touched>1800:
            await worker.close()
            workers.pop(owner,None)
            revoke(owner)

async def maintenance():
    while True:
        await asyncio.sleep(10)
        try:
            await background_once()
        except Exception:
            # Avoid session/provider content in logs; preserve other account work.
            pass

@asynccontextmanager
async def lifespan(app):
    global playwright
    for directory in Path('/tmp').glob('linkedin-profile-*'):
        shutil.rmtree(directory, ignore_errors=True)
    playwright = await async_playwright().start()
    task = asyncio.create_task(maintenance())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.gather(*(w.close() for w in workers.values()), return_exceptions=True)
    await playwright.stop()

app = FastAPI(lifespan=lifespan)
app.mount('/novnc', StaticFiles(directory='/usr/share/novnc'), name='novnc')

@app.middleware('http')
async def private_headers(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@asynccontextmanager
async def traced_lock(lock, stage, owner):
    with diag.span('account.lock_wait', stage=stage, owner=owner):
        await lock.acquire()
    started = time.monotonic()
    try:
        yield
    finally:
        lock.release()
        diag.emit('account.lock_released', stage=stage, owner=owner, duration_ms=round((time.monotonic()-started)*1000, 1))


def owner_for(request):
    if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + SECRET):
        raise HTTPException(401, 'Unauthorised')
    org, user = request.query_params.get('organizationId'), request.query_params.get('userId')
    if not org or not user or len(org) > 200 or len(user) > 200:
        raise HTTPException(400, 'Invalid owner')
    return VAULT.owner(org, user)

def revoke(owner):
    for token, grant in list(viewers.items()):
        if grant[0] == owner:
            viewers.pop(token, None)

def view_worker(token):
    grant = viewers.get(token)
    if not grant or grant[1] < time.time() or grant[0] not in workers:
        raise HTTPException(401, 'Viewer expired; reopen the live browser')
    worker = workers[grant[0]]
    if worker.agent_busy:
        raise HTTPException(409, 'Browser is busy with a read-only task; try again shortly')
    worker.touched = time.time()
    return worker

@app.middleware('http')
async def trace_request(request: Request, call_next):
    if request.url.path not in ('/connection', '/actions', '/inbox', '/settings', '/campaign', '/agent', '/replies'):
        return await call_next(request)
    supplied_trace = request.headers.get('x-linkedin-trace-id', '')
    trace = supplied_trace if re.fullmatch(r'[a-f0-9]{32}', supplied_trace) else diag.trace_id()
    with diag.context(trace_id=trace):
        with diag.span('http.request', method=request.method, endpoint=request.url.path):
            response = await call_next(request)
            diag.emit('http.response', http_status=response.status_code)
            response.headers['X-LinkedIn-Trace-Id'] = diag.CONTEXT.get()['trace_id']
            return response


@app.get('/health')
async def health():
    return {'ok': True}

@app.api_route('/connection', methods=['GET', 'POST', 'DELETE'])
async def connection(request: Request):
    owner = owner_for(request)
    lock = locks.setdefault(owner, asyncio.Lock())
    async with traced_lock(lock, 'connection', owner):
        worker = workers.get(owner)
        if request.method == 'DELETE':
            if worker:
                await worker.close(save=False)
                workers.pop(owner, None)
            revoke(owner)
            VAULT.delete(owner)
            return {'status': 'disconnected'}
        if request.method == 'POST':
            body = await request.json()
            if not isinstance(body, dict):
                raise HTTPException(400, 'Expected an object')
            if worker and 'fixture' in body and bool(body['fixture']) != worker.fixture:
                raise HTTPException(409, 'Save and pause the current browser before switching accounts')
            if body.get('action') == 'pause':
                data = VAULT.load(owner)
                data['browserPaused'] = True
                VAULT.save(owner,data)
                if worker:
                    await worker.close()
                    workers.pop(owner, None)
                revoke(owner)
                return {'status': 'paused', 'saved': bool(VAULT.load(owner).get('browserState'))}
            if worker:
                status = await worker.status()
                if status in ('browser_crashed', 'browser_unresponsive'):
                    # Preserve cookies from an unsaved login in the same context.
                    try:
                        await worker.recover_page()
                    except Exception:
                        # If the browser transport has failed too, a new tab
                        # cannot help. Restart using the last encrypted session.
                        await worker.close(save=False)
                        workers.pop(owner, None)
                        revoke(owner)
                        worker = None
                elif status == 'browser_closed':
                    await worker.close(save=False)
                    workers.pop(owner, None)
                    revoke(owner)
                    worker = None
            if not worker:
                async with allocation:
                    used = {w.slot for w in workers.values()}
                    slot = next((i for i in range(MAX_WORKERS) if i not in used), None)
                    if slot is None:
                        raise HTTPException(503, 'All browser workers are occupied')
                    fixture = bool(body.get('fixture', VAULT.load(owner).get('fixture', False)))
                    if fixture and os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true':
                        raise HTTPException(403, 'Fixtures disabled')
                    worker = Worker(owner, slot, fixture)
                    workers[owner] = worker
                    try:
                        await worker.start()
                    except Exception:
                        await worker.close(save=False)
                        workers.pop(owner, None)
                        raise HTTPException(503, 'Browser failed to start')
            revoke(owner)
            token = secrets.token_urlsafe(32)
            viewers[token] = (owner, time.time()+900)
            worker.touched = time.time()
            data = VAULT.load(owner)
            data['browserPaused'] = False
            VAULT.save(owner,data)
            return {'status': await worker.status(), 'viewerUrl': PUBLIC+'/view/'+token, 'fixture': worker.fixture}
        if worker:
            return {'status': await worker.status(), 'fixture': worker.fixture, 'inboxCaptured': bool(worker.conversation_request), 'saved': bool(VAULT.load(owner).get('browserState')), 'agentConfigured': bool(os.getenv('OPENAI_API_KEY') or os.getenv('OPENROUTER_API_KEY'))}
        saved = VAULT.load(owner)
        return {'status': 'paused' if saved.get('browserState') else 'disconnected', 'saved': bool(saved.get('browserState')), 'fixture': saved.get('fixture', False)}

@app.get('/view/{token}', response_class=HTMLResponse)
async def viewer(token):
    view_worker(token)
    return HTMLResponse('''<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>LinkedIn live browser</title>
    <style>html,body{height:100%;overflow:hidden}body{margin:0;background:#101418;color:white;font:14px system-ui}#screen{height:calc(100vh - 36px)}header{padding:8px}button{margin-left:12px}</style></head>
    <body><header><span id="status">Connecting live browser…</span><button id="disconnect">Close viewer</button></header><div id="screen"></div>
    <script type="module">import RFB from '/novnc/core/rfb.js';
    const rfb=new RFB(document.getElementById('screen'), `${location.protocol==='https:'?'wss':'ws'}://${location.host}/stream/''' + token + '''`);
    rfb.scaleViewport=true; rfb.resizeSession=false;
    rfb.addEventListener('connect',()=>document.getElementById('status').textContent='Live browser — enter credentials and complete verification here');
    rfb.addEventListener('disconnect',()=>document.getElementById('status').textContent='Viewer closed or expired. Reopen from Settings.');
    document.getElementById('disconnect').onclick=()=>rfb.disconnect();</script></body></html>''')

@app.websocket('/stream/{token}')
async def stream(websocket: WebSocket, token: str):
    try:
        worker = view_worker(token)
        if websocket.headers.get('origin') != PUBLIC:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        reader, writer = await asyncio.open_connection('127.0.0.1', 5900+worker.slot)
        worker.viewer_count += 1
        async def incoming():
            while True:
                frame = await websocket.receive_bytes()
                view_worker(token)
                writer.write(frame)
                await writer.drain()
        async def outgoing():
            while True:
                view_worker(token)
                try:
                    chunk = await asyncio.wait_for(reader.read(65536), timeout=30)
                except asyncio.TimeoutError:
                    continue
                if not chunk:
                    break
                await websocket.send_bytes(chunk)
        tasks = [asyncio.create_task(incoming()), asyncio.create_task(outgoing())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks: task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            worker.viewer_count = max(0,worker.viewer_count-1)
            writer.close()
            with contextlib.suppress(Exception): await writer.wait_closed()
    except Exception:
        with contextlib.suppress(Exception):
            await websocket.close(code=1008)

@app.api_route('/settings', methods=['GET','POST'])
async def account_settings(request: Request):
    owner = owner_for(request)
    async with locks.setdefault(owner,asyncio.Lock()):
        fixture = mode_for(owner)
        if request.method == 'POST':
            body = await request.json()
            if not isinstance(body,dict): raise HTTPException(400,'Expected an object')
            data = VAULT.load(owner)
            state = policy.control(data,fixture)
            if body.get('operation') == 'recover':
                worker = workers.get(owner)
                if not worker or await worker.status() != 'connected':
                    raise HTTPException(409,'Complete login or verification in the live browser first')
                state.update(requiresVerification=False,failures=0)
                invalidate_reply_coverage(state)
                policy.activity(data,'recovery','complete','User confirmed verification; existing cooldowns and usage retained',fixture)
            else:
                try: state['settings'] = policy.validate_settings(policy.settings(data,fixture),body)
                except ValueError as error: raise HTTPException(400,str(error))
                if any(key in body for key in ('keepAliveEnabled', 'keepAliveMinMinutes', 'keepAliveMaxMinutes', 'keepAliveDays', 'timezone', 'startHour', 'endHour')):
                    config = state['settings']
                    state['nextKeepAliveAt'] = time.time()+random.uniform(config['keepAliveMinMinutes'],config['keepAliveMaxMinutes'])*60
                    state['keepAliveStatus'] = 'Scheduled' if config['keepAliveEnabled'] else 'Disabled'
                policy.activity(data,'settings','saved','Account activity settings updated',fixture)
            VAULT.save(owner,data)
        return dashboard(owner)


@app.get('/queue')
async def queue(request: Request):
    owner=owner_for(request)
    async with locks.setdefault(owner,asyncio.Lock()):
        return dashboard(owner)


@app.get('/replies')
async def reply_inbox(request: Request):
    owner = owner_for(request)
    if os.getenv('LINKEDIN_REPLY_MONITOR_ENABLED') != 'true':
        raise HTTPException(503,'LinkedIn reply monitoring has not been enabled')
    async with locks.setdefault(owner,asyncio.Lock()):
        worker = workers.get(owner)
        if not worker or await worker.status() != 'connected': raise HTTPException(409,'LinkedIn reply monitor needs reconnection')
        modern = replies.modern_queries_ready(getattr(worker,'reply_queries',{}))
        if not worker.mailbox or (not modern and (not worker.conversation_request or not getattr(worker,'message_request',None))):
            raise HTTPException(409,'Open LinkedIn Messaging and a conversation to capture the account read queries')
        raw_since = request.query_params.get('since')
        try:
            parsed_since = datetime.fromisoformat(raw_since.replace('Z','+00:00')) if raw_since else None
            if parsed_since and parsed_since.tzinfo is None: raise ValueError()
            since = parsed_since.timestamp() if parsed_since else 0
            if since<0 or since>time.time()+5: raise ValueError()
        except (ValueError,TypeError): raise HTTPException(400,'Invalid reply scan start')
        cursor = request.query_params.get('cursor')
        if cursor and len(cursor)>4000: raise HTTPException(400,'Invalid reply checkpoint')
        data = VAULT.load(owner)
        state = policy.control(data,worker.fixture)
        if state.get('requiresVerification'):
            raise HTTPException(409, {'code': 'reconnect'})
        if request.query_params.get('background')=='true':
            if not modern: raise HTTPException(409,'Capture all LinkedIn inbox folders and history queries')
            now=time.time()
            account=('fixture:' if worker.fixture else '')+replies.profile(worker.mailbox)
            journal=state.setdefault('replyJournal',{'accountIdentity':account,'events':[],'revision':0,'nextId':1,'checkedAt':0,'scan':{'complete':False}})
            if journal['accountIdentity']!=account: raise HTTPException(409,'Reply account changed; review the connection')
            # Validate before changing either the request or its durable scope.
            try: result=replies.journal_page(state,cursor)
            except (ValueError,KeyError,TypeError,json.JSONDecodeError): raise HTTPException(409,'Reply account or checkpoint changed; review the connection')
            # Acquire sends the earliest date of the owner's entire current
            # subscription scope. Retired broader scopes must not be renewed.
            requested_since=since
            scan=journal.get('scan',{})
            prior_scope=state.get('replyRequest',{}).get('since',scan.get('requestedSince',requested_since))
            if requested_since!=prior_scope:
                invalidate_reply_coverage(state)
            # Each request asks for one sweep. Maintenance polls do not renew
            # continuous provider work; imminent sends may ask for an earlier one.
            if state.get('replyReadIssue',{}).get('category')=='review' and data.get('replyReadQueries')!=worker.reply_queries:
                invalidate_reply_coverage(state)
            interval=120 if request.query_params.get('refresh','true')=='true' else 900
            covered_at=journal.get('coverageAt')
            previous=state.get('replyRequest',{})
            target=previous.get('targetAt',0)
            if covered_at is None or now-covered_at>=interval:
                if not target or covered_at is not None and target<=covered_at: target=now
            state['replyRequest']={'since':requested_since,'until':now+1800,'targetAt':target}
            data['replyReadQueries']=worker.reply_queries
            VAULT.save(owner,data)
            result=replies.journal_page(state,cursor)
            issue=state.get('replyReadIssue',{})
            if issue.get('category')=='review': raise HTTPException(503,{'code':issue['code']})
            if state.get('replyReadError') and not issue: raise HTTPException(503,{'code':'reply_unverified'})
            result['coverageInvalidated']=journal.get('coverageAt') is None
            if not result['complete'] or journal.get('coverageAt',0)<target or issue.get('category')=='retry':
                due,reason=policy.eligible(data,'reply',worker.fixture,now)
                result['nextReadAt']=replies.iso(max(now+10,due or now+300,issue.get('retryAt',0)))
                result['waitReason']=issue.get('code','rate_limited' if reason and 'limit' in reason.lower() else 'incomplete')
            return result
        # Validate an existing checkpoint before spending the provider read budget.
        if cursor and state.get('replyJournal'):
            try: replies.journal_page(state,cursor)
            except (ValueError,KeyError,TypeError): raise HTTPException(409,'Reply account or checkpoint changed; review the connection')
        now = time.time()
        due,reason = policy.reserve(data,'read',worker.fixture,now)
        VAULT.save(owner,data)
        if due is None or due>now:
            raise HTTPException(429,reason,headers={'Retry-After':str(max(1,int((due or now+300)-now)))})
        async def read(worker,path):
            result = await provider_request(worker,path)
            policy.provider_result(data,result,worker.fixture)
            return result
        previous = copy.deepcopy(state.get('replyJournal'))
        try:
            if modern: await replies.advance_modern_scan(worker,state,read,now,since)
            else: await replies.advance_scan(worker,state,read,now)
            result = replies.journal_page(state,cursor)
            data['replyReadQueries']=getattr(worker,'reply_queries',{})
            VAULT.save(owner,data)
            worker.touched = now
            return result
        except Exception as error:
            # A shape/pagination/identity mismatch cannot authorize outreach.
            # Save policy counters, but never return a successful empty inbox.
            if previous is None: state.pop('replyJournal',None)
            else: state['replyJournal'] = previous
            data['replyReadQueries']=getattr(worker,'reply_queries',{})
            VAULT.save(owner,data)
            reason = str(error) if isinstance(error,ValueError) and str(error).startswith(('LinkedIn','Unverified','Required','Invalid','Unknown','Capture')) else 'Inbox query or response requires review'
            raise HTTPException(503,'LinkedIn reply history could not be verified: '+reason)


def invalidate_reply_coverage(state):
    journal=state.get('replyJournal')
    if journal:
        journal['scan']={'complete':False};journal['checkedAt']=0;journal['revision']+=1
        journal.pop('coverageAt',None);journal.pop('coverageSince',None)
    state.pop('replyReadIssue',None);state.pop('replyReadError',None)


def reply_reader_requested(state,now=None):
    return os.getenv('LINKEDIN_REPLY_MONITOR_ENABLED')=='true' and state.get('replyRequest',{}).get('until',0)>(time.time() if now is None else now)


async def background_reply_read(owner,worker):
    """Caller holds the owner lock. Poll at most one page per reserved read."""
    data=VAULT.load(owner);state=policy.control(data,worker.fixture);now=time.time()
    if not reply_reader_requested(state,now): return
    if state.get('replyReadIssue',{}).get('category')=='review': return
    # Reject missing/broken templates before consuming a provider reservation.
    if not replies.modern_queries_ready(getattr(worker,'reply_queries',{})): return
    try:
        for name in ('categoryInitial','categoryCursor','messageInitial','messageBefore'):
            replies.change_path(worker.reply_queries[name],{})
    except ValueError:
        state['replyReadError']='LinkedIn read templates require recapture';state['replyReadIssue']={'category':'review','code':'reply_unverified'};VAULT.save(owner,data);return
    scan=state.get('replyJournal',{}).get('scan',{})
    journal=state.get('replyJournal',{})
    target=state['replyRequest'].get('targetAt',0)
    if scan.get('complete') and journal.get('coverageAt',scan.get('startedAt',0))>=target: return
    if state.get('replyReadIssue',{}).get('retryAt',0)>now: return
    due,_=policy.eligible(data,'reply',worker.fixture,now)
    if due is None or due>now: return
    due,_=policy.reserve(data,'reply',worker.fixture,now)
    if due is None or due>now: return
    previous=copy.deepcopy(state.get('replyJournal'))
    state['lastReplyReadAttemptAt']=now
    VAULT.save(owner,data)
    async def read(worker,path):
        result=await provider_request(worker,path)
        policy.provider_result(data,result,worker.fixture)
        status=result.get('status',0)
        if status!=200:
            raise HTTPException(status if status else 503)
        return result
    try:
        await replies.advance_modern_scan(worker,state,read,now,state['replyRequest']['since'])
        state.pop('replyReadError',None);state.pop('replyReadIssue',None)
        worker.touched=now
    except Exception as error:
        if previous is None: state.pop('replyJournal',None)
        else: state['replyJournal']=previous
        status=getattr(error,'status_code',None)
        retry=read_failure_code(error) is not None or status==429 or status is not None and status>=500
        code='rate_limited' if status==429 else read_failure_code(error) or 'unavailable' if retry else 'reconnect' if status in (401,403) else 'reply_unverified'
        state['replyReadIssue']={'category':'retry' if retry else 'review','code':code}
        if retry:
            due,_=policy.eligible(data,'reply',worker.fixture,now)
            state['replyReadIssue']['retryAt']=max(now+60,due or now+300)
        state['replyReadError']='LinkedIn reply reader is waiting' if retry else 'LinkedIn reply history could not be verified; review reader status'
    data['replyReadQueries']=worker.reply_queries
    VAULT.save(owner,data)


@app.api_route('/inbox', methods=['GET','POST'])
async def inbox(request: Request):
    owner = owner_for(request)
    async with locks.setdefault(owner, asyncio.Lock()):
        fixture = mode_for(owner)
        data = VAULT.load(owner)
        state = policy.control(data,fixture)
        cached = state.get('inbox')
        worker = workers.get(owner)
        connected = worker and await worker.status() == 'connected'
        if cached and (request.method=='GET' or not connected):
            return {**cached['result'],'cache':{'fetchedAt':cached['fetchedAt'],'cached':True,'stale':time.time()-cached['fetchedAt']>300 or not connected}}
        if not connected:
            raise HTTPException(409, 'Open and sign in to the browser first')
        if getattr(worker,'viewer_count',0) and urlparse(worker.page.url).netloc != urlparse(worker.origin).netloc:
            raise HTTPException(409,'Open LinkedIn in the live browser first')
        if not worker.conversation_request:
            return {'status':'capture_required','error':'Open LinkedIn Messaging in the live browser first'}
        now=time.time()
        due, reason=policy.reserve(data,'read',fixture,now)
        if due is None or due>now:
            if cached:
                return {**cached['result'],'cache':{'fetchedAt':cached['fetchedAt'],'cached':True,'stale':True},'error':reason}
            raise HTTPException(429,reason,headers={'Retry-After':str(max(1,int((due or now+300)-now)))})
        VAULT.save(owner,data)
        try: result=await conversations(worker)
        except Exception: result={'status':'provider_error','response':{'status':0}}
        data=VAULT.load(owner)
        state=policy.control(data,fixture)
        if result.get('status') != 'capture_required':
            policy.provider_result(data,result.get('response',{}),fixture)
        if result['status']=='ok':
            state['inbox']={'fetchedAt':now,'result':result}
        policy.activity(data,'inbox',result['status'],'Inbox refreshed' if result['status']=='ok' else 'Inbox refresh failed; check account status',fixture)
        VAULT.save(owner,data)
        worker.touched=now
        return {**result,'cache':{'fetchedAt':state.get('inbox',{}).get('fetchedAt'),'cached':False,'stale':result['status']!='ok'}}


@app.post('/actions')
async def actions(request: Request):
    owner = owner_for(request)
    async with traced_lock(locks.setdefault(owner, asyncio.Lock()), 'actions', owner):
        body = await request.json()
        if not isinstance(body, dict): raise HTTPException(400, 'Expected an object')
        data=VAULT.load(owner)
        if body.get('operation') in ('execute','cancel'):
            record=data.get('actions',{}).get(body.get('id'))
            if not record: raise HTTPException(400,'Review and approve a saved draft')
            if body['operation']=='cancel':
                if record['status'] not in ('draft','queued'): raise HTTPException(409,'This action has already been attempted')
                record.update(status='cancelled',reason='Cancelled by user')
                VAULT.save(owner,data)
                return {'action':record}
            if body.get('approved') is not True: raise HTTPException(400,'Review and approve a saved draft')
            if record['status']!='draft': return {'action':record}
            worker=workers.get(owner)
            if not worker or await worker.status()!='connected': raise HTTPException(409,'Browser is not connected')
            if record.get('fixture',False)!=worker.fixture: raise HTTPException(409,'Draft belongs to a different account mode; create a new draft')
            if not worker.fixture and os.getenv('LINKEDIN_ALLOW_LIVE_SENDS')!='true': raise HTTPException(403,'Live sends are disabled on the test service')
            if time.time()-record.get('createdAt',0)>7*86400: raise HTTPException(409,'Draft expired; create a new draft')
            now=time.time()
            record.update(status='queued',approvedAt=now,approvedUntil=now+86400)
            record['nextEligibleAt'],record['reason']=policy.eligible(data,record['kind'],worker.fixture,now)
            VAULT.save(owner,data)
            return {'action':await dispatch_action(owner,worker,record)}
        kind,recipient,text=body.get('kind'),body.get('recipient'),body.get('text','')
        if kind not in PATHS or not isinstance(recipient,str) or not re.fullmatch(r'urn:li:(?:fsd_profile|fs_miniProfile|member):[A-Za-z0-9_-]+',recipient) or not isinstance(text,str) or len(text)>(200 if kind=='invite' else 4000) or (kind=='message' and not text.strip()): raise HTTPException(400,'Invalid draft; invitation notes are limited to 200 characters')
        if kind == 'invite' and text.strip():
            raise HTTPException(400, 'Invitation notes require a verified browser capture; send without a note')
        fixture=mode_for(owner)
        fingerprint=hashlib.sha256(json.dumps([fixture,kind,recipient,text]).encode()).hexdigest()
        existing=next((a for a in data['actions'].values() if a.get('fingerprint')==fingerprint and a['status'] not in ('cancelled','expired','blocked')),None)
        if existing: return {'action':existing}
        if sum(a['status'] in ('draft','queued') for a in data['actions'].values())>=100 or len(data['actions'])>=2000: raise HTTPException(409,'Action journal is full')
        record={'id':secrets.token_hex(16),'kind':kind,'recipient':recipient,'text':text,'status':'draft','fingerprint':fingerprint,'fixture':fixture,'createdAt':time.time()}
        data['actions'][record['id']]=record
        VAULT.save(owner,data)
        return {'action':record}

@app.post('/campaign')
async def campaign(request: Request):
    import sys
    from campaign import operate
    owner = owner_for(request)
    async with traced_lock(locks.setdefault(owner, asyncio.Lock()), 'campaign', owner):
        return await operate(sys.modules[__name__], owner, await request.json())

@app.post('/agent')
async def agent(request: Request):
    owner = owner_for(request)
    async with locks.setdefault(owner, asyncio.Lock()):
        worker = workers.get(owner)
        if not worker or await worker.status() != 'connected':
            raise HTTPException(409, 'Sign in first')
        if not (os.getenv('OPENAI_API_KEY') or os.getenv('OPENROUTER_API_KEY')):
            raise HTTPException(503, 'No agent model key configured')
        data = VAULT.load(owner)
        now = time.time()
        due, reason = policy.reserve(data,'read',worker.fixture,now)
        if due is None or due > now: raise HTTPException(429,reason)
        VAULT.save(owner,data)
        worker.agent_busy = True
        revoke(owner)  # Human viewer and agent must not control the same session concurrently.
        try:
            from agent_adapter import inspect_browser
            result = await asyncio.wait_for(inspect_browser(worker), timeout=90)
            return {'status': 'complete', 'result': result}
        except Exception:
            raise HTTPException(503, 'Agent inspection failed; browser session preserved')
        finally:
            worker.agent_busy = False
            worker.touched = time.time()

# Fictional provider UI and endpoints exercise the exact browser request path.
@app.get('/fixture', response_class=HTMLResponse)
async def fixture():
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true':
        raise HTTPException(404)
    return '''<h1>LinkedIn fixture — fictional account</h1><p>No real LinkedIn requests are made.</p><button onclick="document.cookie='li_at=fixture; path=/'; document.cookie='JSESSIONID=fixture-csrf; path=/'; location.href='/fixture/inbox'">Sign in as Test User</button>'''

@app.get('/fixture/inbox', response_class=HTMLResponse)
async def fixture_inbox():
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true':
        raise HTTPException(404)
    paths = []
    for folder in replies.FOLDERS:
        paths.append('/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.fixture&variables=(query:'+replies.category_query(folder)+',count:20,mailboxUrn:urn:li:fsd_profile:fixture)')
    paths.extend([
        '/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.fixture&variables=(query:'+replies.category_query('PRIMARY_INBOX')+',count:20,mailboxUrn:urn:li:fsd_profile:fixture,nextCursor:fixture-cursor)',
        '/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.fixture&variables=(conversationUrn:urn:li:msg_conversation:fixture-alex)',
        '/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.fixture&variables=(conversationUrn:urn:li:msg_conversation:fixture-alex,deliveredAt:1,countBefore:20,countAfter:0)',
        # Finish on the visible inbox after capturing hidden scan queries, so
        # manual message validation reads its verified one-to-one conversation.
        '/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.fixture&variables=(mailboxUrn:urn:li:fsd_profile:fixture,syncToken:fixture-token-123456)',
    ])
    return '<h1>Test User inbox</h1><p>Alex Example: Hello from the fictional test account.</p><script>'+''.join("fetch('"+path+"');" for path in paths)+'</script>'

@app.get('/voyager/api/identity/dash/profiles')
async def fixture_profile(request: Request):
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true' or request.query_params.get('memberIdentity') != 'fictional-alex':
        raise HTTPException(404)
    return {'included': [{'entityUrn': 'urn:li:fsd_profile:fictional-alex', 'publicIdentifier': 'fictional-alex', 'connectionDegree': 'SECOND'}]}

@app.api_route('/voyagerMessagingGraphQL/graphql', methods=['GET'])
async def fixture_reads(request: Request):
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true':
        raise HTTPException(404)
    kind = request.query_params.get('queryId', '')
    variables = request.query_params.get('variables', '')
    conversations = [{'id': 'fixture-conversation', 'name': 'Alex Example', 'text': 'Hello from the fictional test account.'}]
    if kind.startswith('messengerConversations.') and 'query:' in variables:
        return {'conversations': conversations, 'data': {'messengerConversationsByCategoryQuery': {'elements': [], 'metadata': {'nextCursor': None}}}}
    if kind.startswith('messengerMessages.'):
        if 'deliveredAt:' in variables:
            return {'data': {'messengerMessagesByAnchorTimestamp': {'elements': [], 'metadata': {'prevCursor': None}}}}
        return {'data': {'messengerMessagesBySyncToken': {'elements': [], 'metadata': {'newSyncToken': 'fixture-token', 'shouldClearCache': False}}}}
    return {'conversations': conversations, 'data': {'messengerConversationsBySyncToken': {'elements': [{'entityUrn': 'urn:li:msg_conversation:fixture-alex', 'groupChat': False, 'conversationParticipants': [{'hostIdentityUrn': 'urn:li:fsd_profile:fixture'}, {'hostIdentityUrn': 'urn:li:fsd_profile:fictional-alex'}]}]}}}

@app.post('/voyager/api/{path:path}')
async def fixture_writes(path: str, request: Request):
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true':
        raise HTTPException(404)
    body = await request.json()
    if not request.cookies.get('li_at') or request.headers.get('csrf-token') != 'fixture-csrf':
        raise HTTPException(401)
    if path == 'voyagerMessagingDashMessengerMessages' and request.query_params.get('action') == 'createMessage':
        message = body.get('message', {})
        if (body.get('mailboxUrn') != 'urn:li:fsd_profile:fixture'
                or message.get('conversationUrn') != 'urn:li:msg_conversation:fixture-alex'
                or body.get('dedupeByClientGeneratedToken') is not False
                or len(body.get('trackingId', '')) != 16
                or request.headers.get('content-type') != 'text/plain;charset=UTF-8'
                or request.headers.get('accept') != 'application/json'
                or request.headers.get('x-restli-protocol-version') != '2.0.0'):
            raise HTTPException(400, 'Invalid modern message request')
        return {'value': {**message, 'entityUrn': 'urn:li:msg_message:fixture-result'}}
    if path == 'voyagerRelationshipsDashMemberRelationships':
        if (request.query_params.get('action') != 'verifyQuotaAndCreateV2'
                or request.query_params.get('decorationId') != 'com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2'
                or body != {'invitee': {'inviteeUnion': {'memberProfile': 'urn:li:fsd_profile:fictional-alex'}}}
                or request.headers.get('content-type') != 'application/json; charset=UTF-8'
                or request.headers.get('accept') != 'application/vnd.linkedin.normalized+json+2.1'
                or request.headers.get('x-restli-protocol-version') != '2.0.0'):
            raise HTTPException(400, 'Invalid modern invitation request')
        urn = 'urn:li:fsd_invitation:fixture-result'
        return {'data': {'value': {'invitationUrn': urn, '*invitation': urn}}, 'included': [{'entityUrn': urn}]}
    return {'id': 'fixture-'+hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]}

@app.get('/fixture/feed', response_class=HTMLResponse)
async def fixture_feed():
    if os.getenv('LINKEDIN_ENABLE_FIXTURES') != 'true': raise HTTPException(404)
    return '<h1>Fictional feed</h1>' + ''.join(f'<article style="height:400px">Fictional post {i}</article>' for i in range(10))
