"""Small, versioned Voyager adapter, adapted from Lattice. Live writes unverified."""
from urllib.parse import urlparse

PATHS = {
    'invite': '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreate',
    'message': '/voyager/api/voyagerMessagingDashMessengerConversations?action=createConversation',
}

def payload(kind, recipient, text, token):
    if kind == 'invite':
        return {'trackingId': token, 'inviteeUrn': recipient, 'message': text}
    return {'keyVersion': 'LEGACY_INBOX', 'conversationCreate': {
        'eventCreate': {'originToken': token, 'trackingId': token,
            'value': {'com.linkedin.voyager.messaging.create.MessageCreate': {
                'attributedBody': {'text': text, 'attributes': []}, 'attachments': []}}},
        'dedupeByClientGeneratedToken': True, 'recipients': [recipient], 'subtype': 'MEMBER_TO_MEMBER'}}

async def request(worker, path, method='GET', body=None):
    if not path.startswith(('/voyager/api/', '/voyagerMessagingGraphQL/')):
        raise ValueError('Endpoint not allowed')
    if urlparse(worker.page.url).netloc != urlparse(worker.origin).netloc:
        raise ValueError('Return to LinkedIn before making a provider request')
    cookies = await worker.context.cookies(worker.origin)
    csrf = next((c['value'].strip('"') for c in cookies if c['name'] == 'JSESSIONID'), None)
    if not csrf:
        return {'status': 401, 'error': 'Sign in to LinkedIn first'}
    # Execute in the authenticated page: Chrome supplies its own cookies.
    return await worker.page.evaluate("""async ({path, method, body, csrf}) => {
      const response = await fetch(path, {method, credentials: 'include', redirect: 'manual',
        headers: {'csrf-token': csrf, 'accept': 'application/vnd.linkedin.normalized+json+2.1',
                  ...(body ? {'content-type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)});
      let data = null; try { data = await response.json(); } catch {}
      const retry = Number(response.headers.get('retry-after'));
      return {status:response.status, data, redirect:response.type === 'opaqueredirect',
              retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null};
    }""", {'path': path, 'method': method, 'body': body, 'csrf': csrf})

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
    return {'connected': next(iter(degrees)) if len(degrees) == 1 else None, 'recipient': profile['entityUrn']}


async def relationship(worker, identity):
    from urllib.parse import quote
    # Same supplementary profile query used by Lattice's fetchProfileNetworkInfo.
    path = '/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + quote(identity, safe='') + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardSupplementary-142'
    result = await request(worker, path)
    return result, parse_relationship(result.get('data'), identity)
