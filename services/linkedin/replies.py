"""Conservative, resumable reads using queries observed in the owner's browser.

Unknown response shapes never certify an empty inbox. No message bodies are
persisted in the reply journal. The encrypted owner vault is the durable queue.
"""
import base64
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, urlencode

PROFILE = re.compile(r'urn:li:fsd_profile:[A-Za-z0-9_-]{1,200}\Z')

def iso(seconds):
    return datetime.fromtimestamp(seconds,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def collection(raw, kind):
    included = {item.get('entityUrn'):item for item in raw.get('included',[]) if isinstance(item,dict)} if isinstance(raw,dict) else {}
    found = []
    def walk(value):
        if not isinstance(value,dict): return
        for key,child in value.items():
            if key.startswith(kind) and isinstance(child,dict) and ('elements' in child or '*elements' in child): found.append(child)
            else: walk(child)
    walk(raw)
    if len(found) != 1: raise ValueError('LinkedIn message collection shape requires review')
    root = found[0]
    elements = root.get('elements',root.get('*elements'))
    paging = root.get('paging')
    if not isinstance(elements,list) or not isinstance(paging,dict) or any(type(paging.get(key)) is not int or paging[key]<0 for key in ('start','count','total')):
        raise ValueError('LinkedIn message pagination is unverified')
    elements = [included.get(item) if isinstance(item,str) else item for item in elements]
    if any(not isinstance(item,dict) for item in elements) or len(elements)>paging['count'] or (not elements and paging['start']<paging['total']):
        raise ValueError('LinkedIn message page is incomplete')
    # Resolve explicitly referenced sender/participant records, never names.
    def resolve(value):
        if isinstance(value,list): return [resolve(item) for item in value]
        if not isinstance(value,dict): return included.get(value,value) if isinstance(value,str) else value
        return {key.lstrip('*'): resolve(child) if key.startswith('*') else child for key,child in value.items()}
    return [resolve(item) for item in elements], paging

def profile(value):
    if isinstance(value,str) and PROFILE.fullmatch(value): return value
    if isinstance(value,dict):
        for key in ('hostIdentityUrn','profileUrn','entityUrn'):
            if PROFILE.fullmatch(str(value.get(key,''))): return value[key]
    raise ValueError('LinkedIn reply participant identity is unverified')

def message_events(messages, own, participants):
    own = profile(own)
    members = list(dict.fromkeys(profile(item) for item in participants))
    if own not in members: raise ValueError('LinkedIn conversation does not belong to this account')
    if len(members) != 2: return []
    events = []
    for message in messages:
        kind = message.get('eventType')
        if kind in ('CONNECTION_ACCEPTED','CONNECTION_INVITATION','REACTION','READ_RECEIPT','SYSTEM'): continue
        if kind not in (None,'MESSAGE'): raise ValueError('Unknown LinkedIn message event type')
        sender = profile(message.get('senderUrn') or message.get('sender'))
        if sender not in members: raise ValueError('LinkedIn sender is outside the verified conversation')
        if sender == own: continue
        body = message.get('body') or message.get('attributedBody')
        if not body and not message.get('attachments'): raise ValueError('LinkedIn message content type is unverified')
        identifier = message.get('entityUrn') or message.get('backendUrn')
        timestamp = message.get('deliveredAt') or message.get('createdAt')
        if not isinstance(identifier,str) or not identifier.startswith(('urn:li:msg_message:','urn:li:fsd_message:')) or type(timestamp) not in (int,float) or timestamp<=0:
            raise ValueError('LinkedIn reply id or timestamp is unverified')
        events.append({'id':identifier,'fromIdentity':sender,'receivedAt':iso(timestamp/1000)})
    return events

def replace_variable(raw, key, value):
    if not raw.startswith('(') or not raw.endswith(')'): raise ValueError('Unverified LinkedIn query variables')
    parts = []; start = 1; depth = 0
    for index,char in enumerate(raw[1:-1],1):
        if char == '(': depth += 1
        elif char == ')': depth -= 1
        elif char == ',' and depth == 0: parts.append(raw[start:index]); start = index+1
    parts.append(raw[start:-1])
    matches = [index for index,item in enumerate(parts) if item.startswith(key+':')]
    if len(matches) != 1: raise ValueError('Required LinkedIn pagination variable was not observed')
    parts[matches[0]] = key+':'+value
    return '('+','.join(parts)+')'

def read_path(template, offset, conversation=None):
    parsed = urlparse(template); query = parse_qs(parsed.query)
    variables = query.get('variables',[None])[0]
    variables = replace_variable(variables,'start',str(offset))
    if conversation: variables = replace_variable(variables,'conversationUrn',conversation)
    query['variables'] = [variables]
    return parsed.path+'?'+urlencode(query,doseq=True)

async def advance_scan(worker, data, provider, now):
    account = ('fixture:' if getattr(worker,'fixture',False) else '')+profile(worker.mailbox)
    journal = data.setdefault('replyJournal',{'accountIdentity':account,'events':[],'revision':0,'nextId':1})
    if journal['accountIdentity'] != account: raise ValueError('LinkedIn reply monitor account changed')
    scan = journal.get('scan')
    if not scan or scan['complete']:
        scan = {'stage':'conversations','offset':0,'threads':[],'index':0,'startedAt':now,'complete':False}
        journal['scan'] = scan
    if scan['stage'] == 'conversations':
        path = read_path(worker.conversation_request,scan['offset'])
        result = await provider(worker,path)
        if result.get('status') != 200: raise ValueError('LinkedIn reply provider read failed')
        elements,paging = collection(result.get('data'),'messengerConversations')
        if paging['start'] != scan['offset']: raise ValueError('LinkedIn conversation checkpoint changed')
        for item in elements:
            urn = item.get('entityUrn') or item.get('backendUrn')
            participants = item.get('participants')
            if not isinstance(urn,str) or not urn.startswith(('urn:li:msg_conversation:','urn:li:fsd_conversation:')) or not isinstance(participants,list): raise ValueError('LinkedIn conversation identities require review')
            members = list(dict.fromkeys(profile(member) for member in participants))
            if profile(worker.mailbox) not in members: raise ValueError('LinkedIn conversation account is unverified')
            if len(members)==2: scan['threads'].append({'urn':urn,'participants':members})
        if len(scan['threads'])>200: raise ValueError('LinkedIn reply scan exceeds conversation limit')
        scan['offset'] += len(elements)
        if scan['offset'] >= paging['total']:
            scan.update(stage='messages',offset=0)
            if not scan['threads']: scan['complete'] = True
    else:
        thread = scan['threads'][scan['index']]
        path = read_path(worker.message_request,scan['offset'],thread['urn'])
        result = await provider(worker,path)
        if result.get('status') != 200: raise ValueError('LinkedIn reply provider read failed')
        elements,paging = collection(result.get('data'),'messengerMessages')
        if paging['start'] != scan['offset']: raise ValueError('LinkedIn message checkpoint changed')
        events = message_events(elements,worker.mailbox,thread['participants'])
        known = {item['event']['id'] for item in journal['events']}
        for event in events:
            if event['id'] in known: continue
            if len(journal['events'])>=10000: raise ValueError('LinkedIn reply journal requires archival review')
            journal['events'].append({'sequence':journal['nextId'],'event':event}); journal['nextId'] += 1; known.add(event['id'])
        scan['offset'] += len(elements)
        if scan['offset'] >= paging['total']:
            scan['index'] += 1; scan['offset'] = 0
            if scan['index'] >= len(scan['threads']): scan['complete'] = True
    journal['revision'] += 1
    journal['checkedAt'] = scan['startedAt'] if scan['complete'] else now

def journal_page(data, cursor):
    journal = data['replyJournal']; after = 0
    if cursor:
        checkpoint = json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
        if checkpoint.get('account') != journal['accountIdentity']: raise ValueError('LinkedIn reply monitor account changed')
        after = checkpoint.get('after')
        if type(after) is not int or after<0 or after>=journal['nextId']: raise ValueError('Invalid LinkedIn reply checkpoint')
    pending = [item for item in journal['events'] if item['sequence']>after]
    page = pending[:500]
    checkpoint = {'account':journal['accountIdentity'],'after':page[-1]['sequence'] if page else after,'revision':journal['revision']}
    return {'accountIdentity':journal['accountIdentity'],'events':[item['event'] for item in page],
            'nextCursor':base64.urlsafe_b64encode(json.dumps(checkpoint).encode()).decode().rstrip('='),
            'complete':journal['scan']['complete'] and len(pending)<=500,'checkedAt':iso(journal['checkedAt'])}

FOLDERS = ('PRIMARY_INBOX','SECONDARY_INBOX','ARCHIVE','SPAM')

def query_parts(path):
    parsed = urlparse(path); query = parse_qs(parsed.query)
    raw = query.get('variables',[''])[0]
    if not raw.startswith('(') or not raw.endswith(')'): raise ValueError('Unverified LinkedIn variables')
    parts = []; start = 1; depth = 0
    for index,char in enumerate(raw[1:-1],1):
        if char == '(': depth += 1
        elif char == ')': depth -= 1
        elif char == ',' and depth == 0: parts.append(raw[start:index]); start=index+1
        if depth<0: raise ValueError('Invalid LinkedIn variables')
    if depth: raise ValueError('Invalid LinkedIn variables')
    parts.append(raw[start:-1]); values = {}
    for part in parts:
        key,separator,value = part.partition(':')
        if not separator or key in values: raise ValueError('Ambiguous LinkedIn variables')
        values[key] = value
    return parsed,query,values

def change_path(template, changes):
    parsed,query,_ = query_parts(template)
    raw = query['variables'][0]
    for key,value in changes.items(): raw = replace_variable(raw,key,str(value))
    query['variables'] = [raw]
    return parsed.path+'?'+urlencode(query,doseq=True)

def category_query(folder):
    if folder not in FOLDERS: raise ValueError('Unknown LinkedIn inbox folder')
    return '(predicateUnions:List((conversationCategoryPredicate:(category:'+folder+'))))'

def capture_queries(queries,path,mailbox):
    parsed,query,values = query_parts(path)
    if not parsed.path.startswith(('/voyager/api/','/voyagerMessagingGraphQL')): return False
    kind = query.get('queryId',[''])[0]
    before = json.dumps(queries,sort_keys=True)
    if kind.startswith('messengerConversations.') and values.get('mailboxUrn') == mailbox:
        folder = next((item for item in FOLDERS if values.get('query') == category_query(item)),None)
        if folder and values.get('count') == '20':
            folders = queries.setdefault('folders',[])
            if folder not in folders: folders.append(folder)
            if set(values) == {'query','count','mailboxUrn'}: queries['categoryInitial'] = path
            if set(values) == {'query','count','mailboxUrn','nextCursor'}: queries['categoryCursor'] = path
    elif kind.startswith('messengerMessages.'):
        if set(values) == {'conversationUrn'}: queries['messageInitial'] = path
        if set(values) == {'conversationUrn','deliveredAt','countBefore','countAfter'} and values['countBefore']=='20' and values['countAfter']=='0': queries['messageBefore'] = path
    return before != json.dumps(queries,sort_keys=True)

def modern_queries_ready(queries):
    return set(queries.get('folders',[])) == set(FOLDERS) and all(queries.get(key) for key in ('categoryInitial','categoryCursor','messageInitial','messageBefore'))

def observed_collection(raw,kind):
    included = {item.get('entityUrn'):item for item in raw.get('included',[]) if isinstance(item,dict)} if isinstance(raw,dict) else {}
    found=[]
    def walk(value):
        if not isinstance(value,dict): return
        for key,child in value.items():
            if key==kind and isinstance(child,dict): found.append(child)
            else: walk(child)
    walk(raw)
    if len(found)!=1: raise ValueError('LinkedIn collection requires review')
    root=found[0]; values=root.get('elements',root.get('*elements'))
    if not isinstance(values,list) or len(values)>500: raise ValueError('LinkedIn page elements are unverified')
    def resolve(value,seen=()):
        if isinstance(value,list): return [resolve(item,seen) for item in value]
        if isinstance(value,str) and value in included:
            if value in seen: raise ValueError('Cyclic LinkedIn entity reference')
            return resolve(included[value],(*seen,value))
        if not isinstance(value,dict): return value
        return {key.lstrip('*'):resolve(child,seen) if key.startswith('*') else child for key,child in value.items()}
    values=resolve(values)
    if any(not isinstance(item,dict) or item.get('incompleteRetriableData') is True for item in values): raise ValueError('Incomplete LinkedIn entities')
    return values,root

def cursor_collection(raw,kind,direction):
    values,root=observed_collection(raw,kind)
    metadata=root.get('metadata')
    if not isinstance(metadata,dict) or direction not in metadata: raise ValueError('LinkedIn page completion is unverified')
    cursor=metadata[direction]
    if cursor is not None and (not isinstance(cursor,str) or not cursor or len(cursor)>4000): raise ValueError('Invalid LinkedIn history cursor')
    if not values and cursor is not None: raise ValueError('Empty LinkedIn page has a continuation')
    return values,cursor

def append_events(journal,events,since):
    known={item['event']['id'] for item in journal['events']}
    for event in events:
        if event['id'] in known or datetime.fromisoformat(event['receivedAt'].replace('Z','+00:00')).timestamp()<since: continue
        if len(journal['events'])>=10000: raise ValueError('LinkedIn reply journal requires archival review')
        journal['events'].append({'sequence':journal['nextId'],'event':event});journal['nextId']+=1;known.add(event['id'])

async def advance_modern_scan(worker,data,provider,now,since):
    queries=worker.reply_queries
    if not modern_queries_ready(queries): raise ValueError('Capture all LinkedIn inbox folders and history queries')
    # Query templates are owner-bound, and a resumed scan may not silently change accounts.
    for name in ('categoryInitial','categoryCursor'):
        if query_parts(queries[name])[2].get('mailboxUrn') != profile(worker.mailbox): raise ValueError('LinkedIn read query account changed')
    account=('fixture:' if getattr(worker,'fixture',False) else '')+profile(worker.mailbox)
    journal=data.setdefault('replyJournal',{'accountIdentity':account,'events':[],'revision':0,'nextId':1})
    if journal['accountIdentity']!=account: raise ValueError('LinkedIn reply monitor account changed')
    scan=journal.get('scan')
    if not scan or scan.get('protocol')!='cursor-v1' or scan['complete'] or since<scan['since']:
        scan={'protocol':'cursor-v1','stage':'conversations','folder':0,'cursor':None,'seenCursors':[], 'threads':[],'index':0,'before':None,'startedAt':now,'since':since,'complete':False}
        journal['scan']=scan
    since=scan['since']
    if scan['stage']=='conversations':
        folder=FOLDERS[scan['folder']]
        changes={'query':category_query(folder)}
        template=queries['categoryInitial']
        if scan['cursor'] is not None: template=queries['categoryCursor'];changes['nextCursor']=scan['cursor']
        result=await provider(worker,change_path(template,changes))
        if result.get('status')!=200: raise ValueError('LinkedIn reply provider read failed')
        elements,cursor=cursor_collection(result.get('data'),'messengerConversationsByCategoryQuery','nextCursor')
        dates=[item.get('lastActivityAt') for item in elements]
        if any(type(date) not in (int,float) or date<=0 or date>(now+5)*1000 for date in dates) or dates!=sorted(dates,reverse=True): raise ValueError('LinkedIn conversation ordering is unverified')
        if dates and scan.get('lastActivityAt') is not None and dates[0]>scan['lastActivityAt']: raise ValueError('LinkedIn conversation page moved backwards')
        known={item['urn'] for item in scan['threads']}
        for item in elements:
            if item['lastActivityAt']<since*1000: continue
            urn=item.get('entityUrn'); participants=item.get('conversationParticipants')
            if not isinstance(urn,str) or not urn.startswith(('urn:li:msg_conversation:','urn:li:fsd_conversation:')) or not isinstance(participants,list): raise ValueError('LinkedIn conversation identities require review')
            members=list(dict.fromkeys(profile(member) for member in participants))
            if profile(worker.mailbox) not in members: raise ValueError('LinkedIn conversation account is unverified')
            if len(members)==2 and urn not in known: scan['threads'].append({'urn':urn,'participants':members});known.add(urn)
        if len(scan['threads'])>200: raise ValueError('LinkedIn reply scan exceeds conversation limit')
        if cursor is not None:
            if cursor in scan['seenCursors']: raise ValueError('LinkedIn conversation cursor did not advance')
            scan['seenCursors'].append(cursor)
        # Sorted activity older than the oldest monitored enrolment cannot hide a
        # later reply: any such reply moves the conversation's lastActivityAt.
        if cursor is None or (dates and dates[-1]<since*1000):
            scan['folder']+=1;scan['cursor']=None;scan['seenCursors']=[];scan.pop('lastActivityAt',None)
            if scan['folder']==len(FOLDERS):
                scan['stage']='messages'
                if not scan['threads']: scan['complete']=True
        else:
            scan['cursor']=cursor
            if dates: scan['lastActivityAt']=dates[-1]
    else:
        thread=scan['threads'][scan['index']]
        changes={'conversationUrn':thread['urn']}
        initial=scan['before'] is None
        template=queries['messageInitial'] if initial else queries['messageBefore']
        if not initial: changes['deliveredAt']=scan['before']
        result=await provider(worker,change_path(template,changes))
        if result.get('status')!=200: raise ValueError('LinkedIn reply provider read failed')
        if initial:
            elements,root=observed_collection(result.get('data'),'messengerMessagesBySyncToken')
            metadata=root.get('metadata')
            if not isinstance(metadata,dict) or not isinstance(metadata.get('newSyncToken'),str) or type(metadata.get('shouldClearCache')) is not bool: raise ValueError('LinkedIn message snapshot is unverified')
            terminal=False
        else:
            elements,cursor=cursor_collection(result.get('data'),'messengerMessagesByAnchorTimestamp','prevCursor')
            terminal=cursor is None
        for message in elements:
            if message.get('conversation',{}).get('entityUrn')!=thread['urn']: raise ValueError('LinkedIn message belongs to another conversation')
        events=message_events(elements,worker.mailbox,thread['participants'])
        append_events(journal,events,since)
        dates=[message.get('deliveredAt') for message in elements]
        if any(type(date) not in (int,float) or date<=0 or date>(now+5)*1000 for date in dates): raise ValueError('LinkedIn message history timestamp is unverified')
        oldest=min(dates) if dates else int(now*1000)
        if not initial and dates and oldest>=scan['before']: raise ValueError('LinkedIn message history did not advance')
        if terminal or (dates and oldest<since*1000):
            scan['index']+=1;scan['before']=None
            if scan['index']==len(scan['threads']): scan['complete']=True
        else: scan['before']=oldest
    journal['revision']+=1
    journal['checkedAt']=scan['startedAt'] if scan['complete'] else now
