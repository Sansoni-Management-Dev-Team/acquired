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
