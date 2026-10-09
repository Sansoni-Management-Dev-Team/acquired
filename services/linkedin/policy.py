"""Persistent account policy for the single-process LinkedIn test service."""
import random
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULTS = {
    'outreachPaused': False, 'timezone': 'Australia/Melbourne', 'activeDays': [0, 1, 2, 3, 4],
    'startHour': 9, 'endHour': 17, 'minSpacingSeconds': 120, 'maxSpacingSeconds': 600,
    'invitationsDaily': 10, 'invitationsWeekly': 50, 'messagesDaily': 20,
    'profilesDaily': 100, 'requestsDaily': 200, 'requestsHourly': 20,
    'keepAliveEnabled': False, 'keepAliveMinMinutes': 45, 'keepAliveMaxMinutes': 180,
    'keepAliveDays': [0, 1, 2, 3, 4, 5, 6],
}
BOUNDS = {
    'startHour': (0, 23), 'endHour': (1, 24), 'minSpacingSeconds': (1, 3600),
    'maxSpacingSeconds': (1, 7200), 'invitationsDaily': (0, 30),
    'invitationsWeekly': (0, 100), 'messagesDaily': (0, 100), 'profilesDaily': (0, 100),
    'requestsDaily': (1, 500), 'requestsHourly': (1, 60),
    'keepAliveMinMinutes': (15, 720), 'keepAliveMaxMinutes': (15, 1440),
}


def settings(data, fixture=False):
    return {**DEFAULTS, **data.get('controls', {}).get('fixture' if fixture else 'linkedin', {}).get('settings', {})}


def control(data, fixture=False):
    return data.setdefault('controls', {}).setdefault('fixture' if fixture else 'linkedin', {})


def validate_settings(current, patch):
    if not isinstance(patch, dict) or set(patch) - set(DEFAULTS):
        raise ValueError('Unknown LinkedIn setting')
    result = {**current, **patch}
    for key in ('outreachPaused', 'keepAliveEnabled'):
        if type(result[key]) is not bool:
            raise ValueError(f'{key} must be true or false')
    for key, (minimum, maximum) in BOUNDS.items():
        if type(result[key]) is not int or not minimum <= result[key] <= maximum:
            raise ValueError(f'{key} must be between {minimum} and {maximum}')
    try:
        if not isinstance(result['timezone'], str):
            raise ValueError('Choose a valid timezone')
        ZoneInfo(result['timezone'])
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError('Choose a valid timezone')
    for key in ('activeDays', 'keepAliveDays'):
        days = result[key]
        if not isinstance(days, list) or not days or any(type(d) is not int or not 0 <= d <= 6 for d in days):
            raise ValueError(f'Choose at least one valid day for {key}')
        result[key] = sorted(set(days))
    for minimum, maximum in [('startHour', 'endHour'), ('minSpacingSeconds', 'maxSpacingSeconds'),
                             ('keepAliveMinMinutes', 'keepAliveMaxMinutes')]:
        if result[minimum] > result[maximum] or (minimum == 'startHour' and result[minimum] == result[maximum]):
            raise ValueError(f'{maximum} must be after {minimum}')
    if result['invitationsDaily'] > result['invitationsWeekly']:
        raise ValueError('Weekly invitation limit must cover the daily limit')
    return result


def schedule_next(config, now, kind=None):
    """Return now inside allowed hours, otherwise the next local schedule start.

    Construct each day in the configured timezone so DST changes are respected.
    Overnight schedules are intentionally not accepted by validation.
    """
    if kind == 'keepalive':
        config = {**config, 'activeDays': config['keepAliveDays']}
    local = datetime.fromtimestamp(now, ZoneInfo(config['timezone']))
    if local.weekday() in config['activeDays'] and config['startHour'] <= local.hour < config['endHour']:
        return now
    for offset in range(8):
        day = local.date() + timedelta(days=offset)
        start = datetime(day.year, day.month, day.day, config['startHour'], tzinfo=local.tzinfo)
        if start.weekday() in config['activeDays'] and start.timestamp() > now:
            return start.timestamp()
    raise ValueError('No active schedule')


def events(data, fixture, now):
    return [e for e in control(data, fixture).get('events', []) if e['at'] > now - 7 * 86400]


def usage(data, fixture=False, now=None):
    now = time.time() if now is None else now
    history = events(data, fixture, now)
    config = settings(data, fixture)
    definitions = [('requestsHourly', None, 3600), ('requestsDaily', None, 86400),
                   ('invitationsDaily', 'invite', 86400), ('invitationsWeekly', 'invite', 7 * 86400),
                   ('messagesDaily', 'message', 86400), ('profilesDaily', 'profile', 86400)]
    result = {}
    for key, kind, window in definitions:
        timestamps = sorted(e['at'] for e in history if e['at'] > now - window and (kind is None or e['kind'] == kind))
        result[key] = {'used': len(timestamps), 'limit': config[key],
                       'resetAt': timestamps[0] + window if timestamps else None}
    return result


def eligible(data, kind, fixture=False, now=None):
    now = time.time() if now is None else now
    config, state = settings(data, fixture), control(data, fixture)
    if state.get('requiresVerification'):
        return None, 'Complete verification in the live browser'
    if kind in ('invite', 'message') and config['outreachPaused']:
        return None, 'Outreach is paused'
    due, reason = now, None
    if kind in ('invite', 'message', 'keepalive'):
        scheduled = schedule_next(config, now, kind)
        if scheduled > due:
            due, reason = scheduled, 'Outside active hours'
    spacing_at=state.get('nextReplyReadAt',0) if kind=='reply' and state.get('lastRequestKind')=='reply' else state.get('nextRequestAt',0)
    for timestamp, label in [(state.get('cooldownUntil', 0), state.get('reason', 'Account is cooling down')),
                             (spacing_at, 'Waiting between requests')]:
        if timestamp > due:
            due, reason = timestamp, label
    stats = usage(data, fixture, now)
    keys = ['requestsHourly', 'requestsDaily']
    keys += {'invite': ['invitationsDaily', 'invitationsWeekly'], 'message': ['messagesDaily'], 'profile': ['profilesDaily']}.get(kind, [])
    for key in keys:
        stat = stats[key]
        if stat['limit'] == 0:
            return None, 'This action is disabled by its limit'
        if stat['used'] >= stat['limit']:
            # The (used-limit+1)th expiry frees enough capacity after a limit reduction.
            window = 7 * 86400 if key == 'invitationsWeekly' else 3600 if key == 'requestsHourly' else 86400
            action = 'invite' if key.startswith('invitations') else 'message' if key == 'messagesDaily' else 'profile' if key == 'profilesDaily' else None
            timestamps = sorted(e['at'] for e in events(data, fixture, now) if e['at'] > now-window and (action is None or e['kind'] == action))
            expiry = timestamps[len(timestamps)-stat['limit']] + window
            if expiry > due:
                due, reason = expiry, f'{key} limit reached'
    if kind in ('invite', 'message', 'keepalive'):
        scheduled = schedule_next(config, due, kind)
        if scheduled > due:
            due, reason = scheduled, 'Waiting for active hours'
    return due, reason


def reserve(data, kind, fixture=False, now=None):
    now = time.time() if now is None else now
    due, reason = eligible(data, kind, fixture, now)
    if due is None or due > now:
        return due, reason
    state, config = control(data, fixture), settings(data, fixture)
    state['events'] = events(data, fixture, now) + [{'at': now, 'kind': kind}]
    # A bounded reply sweep has its own page pacing. Advancing the outreach
    # timer on each page can keep a due send perpetually behind that sweep.
    # Preserve spacing after other account activity and keep all reads charged
    # to the shared hourly/daily budgets.
    if kind != 'reply' or 'nextRequestAt' not in state:
        state['nextRequestAt'] = now + random.uniform(config['minSpacingSeconds'], config['maxSpacingSeconds'])
    state['lastRequestKind']=kind
    if kind=='reply': state['nextReplyReadAt']=now+random.uniform(20,40)
    return now, None


def activity(data, kind, status, detail, fixture=False, now=None):
    state = control(data, fixture)
    entry = {'at': time.time() if now is None else now, 'kind': kind, 'status': status, 'detail': detail}
    state['activity'] = (state.get('activity', []) + [entry])[-100:]


def provider_result(data, result, fixture=False, now=None):
    now = time.time() if now is None else now
    state = control(data, fixture)
    code = result.get('status', 0)
    if 200 <= code < 300 and not result.get('redirect'):
        state['failures'] = 0
        state['throttleCount'] = 0
        return
    if code in (401, 403, 999) or result.get('redirect'):
        state.update(requiresVerification=True, reason='LinkedIn requires attention; open the live browser')
    elif code == 429:
        exponent = min(state.get('throttleCount', 0), 5)
        state['throttleCount'] = exponent + 1
        retry = result.get('retryAfter')
        wait = max(900 * 2**exponent, retry if isinstance(retry, (int, float)) else 0)
        state.update(cooldownUntil=now + min(wait, 86400), reason='LinkedIn rate limit reached')
    elif code == 422 and 'cannot_resend_yet' in str(result.get('data', '')):
        state.update(cooldownUntil=now + 7 * 86400, reason='LinkedIn invitation limit reached')
    else:
        state['failures'] = state.get('failures', 0) + 1
        if state['failures'] >= 3:
            state.update(cooldownUntil=now + 3600, reason='Repeated request failures; account paused for one hour')


def status_summary(data, fixture=False, now=None):
    now = time.time() if now is None else now
    state, config = control(data, fixture), settings(data, fixture)
    if state.get('requiresVerification'):
        status, reason = 'needs_verification', state.get('reason')
    elif config['outreachPaused']:
        status, reason = 'paused', 'Outreach is paused'
    elif state.get('cooldownUntil', 0) > now:
        status, reason = 'cooling_down', state.get('reason')
    elif schedule_next(config, now) > now:
        status, reason = 'scheduled', 'Outside active hours'
    else:
        status, reason = 'active', None
    next_at, _ = eligible(data, 'message', fixture, now)
    return {'status': status, 'reason': reason, 'nextEligibleAt': next_at,
            'cooldownUntil': state.get('cooldownUntil'), 'liveSendsEnabled': False}
