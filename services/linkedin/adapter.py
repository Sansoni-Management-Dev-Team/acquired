"""Voyager adapter. Message wire format verified against a successful browser HAR."""
import re
import secrets
import uuid
from urllib.parse import urlparse
import diagnostics as diag
from playwright.async_api import Error as BrowserError, TimeoutError as BrowserTimeoutError

def read_failure_code(error):
    """Classify transport failures only; malformed/ambiguous reads need review."""
    if isinstance(error,(TimeoutError,BrowserTimeoutError)): return 'timeout'
    if isinstance(error,(ConnectionError,OSError)): return 'unavailable'
    if isinstance(error,BrowserError):
        if re.search(r'TimeoutError|AbortError|signal timed out',str(error),re.I): return 'timeout'
        if re.search(r'Failed to fetch|NetworkError|net::ERR_(?:CONNECTION|TIMED_OUT|NAME_NOT_RESOLVED|NETWORK)',str(error),re.I): return 'unavailable'
    return None


PATHS = {
    'invite': '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2',
    'message': '/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',
}

def message_target(raw, mailbox, recipient, allow_new=False):
    """Resolve a verified thread or an explicit single-recipient campaign target."""
    from replies import observed_collection, profile
    own, target = profile(mailbox), profile(recipient)
    if own == target:
        raise ValueError('Choose another recipient')
    threads, _ = observed_collection(raw, 'messengerConversationsBySyncToken')
    matches = set()
    for thread in threads:
        try:
            participants = [profile(item) for item in thread.get('conversationParticipants', [])]
        except ValueError:
            continue
        urn = thread.get('entityUrn', '')
        if (thread.get('groupChat') is False and len(participants) == 2
                and set(participants) == {own, target}
                and isinstance(urn, str) and re.fullmatch(r'urn:li:msg_conversation:[A-Za-z0-9_(),:=%-]+', urn)):
            matches.add(urn)
    if not matches and allow_new:
        return {'mailboxUrn': own, 'hostRecipientUrns': [target]}
    if len(matches) != 1:
        raise ValueError('Refresh LinkedIn Messaging: exactly one verified one-to-one conversation is required')
    return {'mailboxUrn': own, 'conversationUrn': matches.pop()}


def payload(kind, recipient, text, token, target=None):
    if kind == 'invite':
        if text.strip():
            raise ValueError('Invitation notes require a verified browser capture; send without a note')
        return {'invitee': {'inviteeUnion': {'memberProfile': recipient}}}
    if not target:
        raise ValueError('A verified message target is required')
    # Campaign journal IDs are SHA-256; Voyager expects a stable UUID token.
    origin = str(uuid.UUID(token[:32] if re.fullmatch(r'[a-f0-9]{64}', token) else token))
    message = {'body': {'attributes': [], 'text': text}, 'renderContentUnions': [], 'originToken': origin}
    body = {'message': message, 'mailboxUrn': target['mailboxUrn'],
            'trackingId': secrets.token_urlsafe(12), 'dedupeByClientGeneratedToken': False}
    if 'conversationUrn' in target:
        message['conversationUrn'] = target['conversationUrn']
    else:
        from replies import profile
        own, other = profile(target['mailboxUrn']), profile(recipient)
        if own == other or target.get('hostRecipientUrns') != [other]:
            raise ValueError('A verified single recipient is required')
        body['hostRecipientUrns'] = [other]
    return body


def message_receipt(data, body):
    value = data.get('value') if isinstance(data, dict) else None
    message = body['message']
    conversation = value.get('conversationUrn') if isinstance(value, dict) else None
    target_matches = (conversation == message['conversationUrn'] if 'conversationUrn' in message else
                      isinstance(conversation, str) and re.fullmatch(r'urn:li:msg_conversation:[A-Za-z0-9_(),:=%-]+', conversation)
                      and value.get('hostRecipientUrns', body['hostRecipientUrns']) == body['hostRecipientUrns'])
    if (isinstance(value, dict) and isinstance(value.get('entityUrn'), str)
            and value['entityUrn'].startswith('urn:li:msg_message:')
            and value.get('originToken') == message['originToken']
            and target_matches
            and value.get('body') == message['body']):
        return value['entityUrn']
    return None


def invitation_receipt(data):
    """Require the normalized invitation receipt observed in the successful HAR."""
    value = data.get('data', {}).get('value') if isinstance(data, dict) and isinstance(data.get('data'), dict) else None
    if not isinstance(value, dict):
        return None
    urn = value.get('invitationUrn')
    included = data.get('included', [])
    if (isinstance(urn, str) and re.fullmatch(r'urn:li:fsd_invitation:[A-Za-z0-9_-]+', urn)
            and value.get('*invitation') == urn and isinstance(included, list)
            and any(isinstance(item, dict) and item.get('entityUrn') == urn for item in included)):
        return urn
    return None

async def request(worker, path, method='GET', body=None):
    with diag.context(trace_id=diag.CONTEXT.get().get('trace_id') or diag.trace_id()):
        with diag.span('provider.request', owner=getattr(worker, 'owner', None),
                       fixture=getattr(worker, 'fixture', None), method=method,
                       endpoint=diag.endpoint(path), timeout_ms=20000):
            result = await _request(worker, path, method, body)
            data = result.get('data')
            value = data.get('value') if isinstance(data, dict) else None
            if value is None and isinstance(data, dict) and isinstance(data.get('data'), dict):
                value = data['data'].get('value')
            diag.emit('provider.response', http_status=result.get('status'),
                      redirect=bool(result.get('redirect')), retry_after=result.get('retryAfter'),
                      has_data=data is not None, has_receipt=isinstance(value, dict) and bool(value.get('entityUrn') or value.get('invitationUrn')),
                      service_error_code=data.get('serviceErrorCode') if isinstance(data, dict) and type(data.get('serviceErrorCode')) is int else None)
            return result


async def _request(worker, path, method='GET', body=None):
    if not path.startswith(('/voyager/api/', '/voyagerMessagingGraphQL/')):
        raise ValueError('Endpoint not allowed')
    if urlparse(worker.page.url).netloc != urlparse(worker.origin).netloc:
        raise ValueError('Return to LinkedIn before making a provider request')
    with diag.span('provider.cookies'):
        cookies = await worker.context.cookies(worker.origin)
    csrf = next((c['value'].strip('"') for c in cookies if c['name'] == 'JSESSIONID'), None)
    if not csrf:
        diag.emit('provider.preflight_rejected', reason_code='missing_csrf')
        return {'status': 401, 'error': 'Sign in to LinkedIn first'}
    # Execute in the authenticated page: Chrome supplies its own cookies.
    with diag.span('provider.fetch', timeout_ms=20000):
        return await worker.page.evaluate("""async ({path, method, body, csrf, messageWrite, invitationWrite}) => {
          const response = await fetch(path, {method, credentials: 'include', redirect: 'manual',
            headers: {'csrf-token': csrf, 'accept': messageWrite ? 'application/json' : 'application/vnd.linkedin.normalized+json+2.1',
                      ...(messageWrite ? {'content-type':'text/plain;charset=UTF-8', 'x-restli-protocol-version':'2.0.0', 'x-li-lang':'en_US'} : invitationWrite ? {'content-type':'application/json; charset=UTF-8', 'x-restli-protocol-version':'2.0.0', 'x-li-lang':'en_US'} : body ? {'content-type':'application/json'} : {})},
            ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)});
          let data = null; try { data = await response.json(); } catch {}
          const retry = Number(response.headers.get('retry-after'));
          return {status:response.status, data, redirect:response.type === 'opaqueredirect',
                  retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null};
        }""", {'path': path, 'method': method, 'body': body, 'csrf': csrf, 'messageWrite': method == 'POST' and path == PATHS['message'], 'invitationWrite': method == 'POST' and path == PATHS['invite']})

async def conversations(worker):
    if not worker.conversation_request:
        return {'status': 'capture_required', 'error': 'Open LinkedIn Messaging in the live browser to capture the inbox request.'}
    # Replay the exact read query observed from this account's browser. Current
    # LinkedIn versions can omit syncToken and use a different Voyager path.
    result = await request(worker, worker.conversation_request)
    return {'status': 'ok' if result['status'] == 200 else 'provider_error', 'response': result}


def profile_identity(value):
    """Accept a public profile URL or a member identifier, never an arbitrary URL."""
    import re
    if not isinstance(value, str):
        raise ValueError('A LinkedIn profile is required')
    if value.startswith('https://'):
        parsed = urlparse(value)
        if not (parsed.hostname == 'linkedin.com' or (parsed.hostname or '').endswith('.linkedin.com')):
            raise ValueError('Invalid LinkedIn profile')
        match = re.fullmatch(r'/in/([^/]+)/?', parsed.path)
        value = match.group(1) if match else ''
    elif value.startswith('urn:li:fsd_profile:'):
        value = value.rsplit(':', 1)[-1]
    if not re.fullmatch(r'[A-Za-z0-9_%\-]{1,200}', value):
        raise ValueError('Invalid LinkedIn profile')
    return value


def parse_relationship(data, identity):
    """Require target-bound evidence; missing fields are unknown, never false."""
    import re
    included = data.get('included', []) if isinstance(data, dict) else []
    profiles = [item for item in included if isinstance(item, dict)
                and re.fullmatch(r'urn:li:fsd_profile:[A-Za-z0-9_-]+', item.get('entityUrn', ''))
                and (item.get('publicIdentifier') == identity or item['entityUrn'].rsplit(':', 1)[-1] == identity)]
    if len(profiles) != 1:
        return {'connected': None, 'recipient': None}
    profile = profiles[0]
    evidence = [profile]
    # Supplementary fields may be normalised behind a referenced entity.
    refs = {value for key, value in profile.items() if key.startswith('*') and isinstance(value, str)}
    evidence += [item for item in included if isinstance(item, dict) and item.get('entityUrn') in refs]
    degrees = set()
    for item in evidence:
        distance = item.get('distance')
        raw = item.get('connectionDegree') or (distance.get('value') if isinstance(distance, dict) else distance)
        if raw in ('DISTANCE_1', 'FIRST'): degrees.add(True)
        elif raw in ('DISTANCE_2', 'SECOND', 'DISTANCE_3', 'THIRD', 'OUT_OF_NETWORK'): degrees.add(False)
    # Current supplementary responses link the target's stateful profile actions
    # to a MemberRelationship, which in turn references the Connection entity.
    # Follow only references embedded in the selected target profile; unrelated
    # included connections must never decide this recipient's relationship.
    relationship_refs = set()
    def collect(value):
        if isinstance(value, dict):
            for key, entry in value.items():
                if key in ('*memberRelationship', 'memberRelationshipUrn', '*connectionOrInvitation', 'connectionOrInvitation') and isinstance(entry, str) and entry.startswith('urn:li:fsd_memberRelationship:'):
                    relationship_refs.add(entry)
                elif isinstance(entry, (dict, list)):
                    collect(entry)
        elif isinstance(value, list):
            for entry in value:
                collect(entry)
    collect(profile.get('profileStatefulProfileActions'))
    pending = False
    ambiguous = len(relationship_refs) > 1
    if len(relationship_refs) == 1:
        relations = [item for item in included if isinstance(item, dict) and item.get('entityUrn') in relationship_refs]
        ambiguous = len(relations) != 1
        if len(relations) == 1:
            relation = relations[0]
            connections = set()
            invitations = set()
            no_connection_degrees = set()
            for field in ('memberRelationshipUnion', 'memberRelationshipData'):
                union = relation.get(field)
                if not isinstance(union, dict):
                    continue
                connection = union.get('*connection') or union.get('connection')
                if isinstance(connection, dict): connection = connection.get('entityUrn')
                if isinstance(connection, str): connections.add(connection)
                no_connection = union.get('noConnection')
                if isinstance(no_connection, dict) and no_connection.get('memberDistance') in ('DISTANCE_2', 'SECOND', 'DISTANCE_3', 'THIRD', 'OUT_OF_NETWORK'):
                    no_connection_degrees.add(False)
                invitation_union = no_connection.get('invitationUnion', {}) if isinstance(no_connection, dict) else {}
                for source in (union, invitation_union):
                    invitation = source.get('*invitation') or source.get('invitation') if isinstance(source, dict) else None
                    if isinstance(invitation, str): invitations.add(invitation)
            if invitations:
                resolved = [item for item in included if isinstance(item, dict) and item.get('entityUrn') in invitations]
                # Only the target's verified outgoing pending invitation may
                # suppress a duplicate. Missing/stale/incoming receipts require review.
                pending = len(invitations) == 1 and len(resolved) == 1 and (
                    resolved[0].get('inviteeMember') == profile['entityUrn']
                    and resolved[0].get('invitationState') == 'PENDING'
                    and resolved[0].get('invitationType') == 'SENT')
                ambiguous = not pending or bool(connections)
            if len(connections) == 1 and not no_connection_degrees:
                resolved = [item for item in included if isinstance(item, dict) and item.get('entityUrn') in connections]
                if len(resolved) == 1 and resolved[0].get('connectedMember') == profile['entityUrn']:
                    degrees.add(True)
                else: ambiguous = True
            elif not connections:
                degrees.update(no_connection_degrees)
            else: ambiguous = True
    observed = {'connected': next(iter(degrees)) if len(degrees) == 1 and not ambiguous else None, 'recipient': profile['entityUrn']}
    if pending and observed['connected'] is False: observed['invitationPending'] = True
    return observed


async def relationship(worker, identity):
    from urllib.parse import quote
    # Same supplementary profile query used by Lattice's fetchProfileNetworkInfo.
    path = '/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + quote(identity, safe='') + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardSupplementary-142'
    with diag.span('relationship.check', recipient_id=diag.identifier(identity)):
        result = await request(worker, path)
        with diag.span('relationship.parse'):
            observed = parse_relationship(result.get('data'), identity)
        diag.emit('relationship.result', http_status=result.get('status'),
                  status='unknown' if observed['connected'] is None else 'connected' if observed['connected'] else 'not_connected',
                  reason_code='unmatched_or_ambiguous_target' if not observed['recipient'] else
                  'missing_or_conflicting_relationship' if observed['connected'] is None else 'target_bound_relationship',
                  recipient_id=diag.identifier(observed['recipient']))
        return result, observed
