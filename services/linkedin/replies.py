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
