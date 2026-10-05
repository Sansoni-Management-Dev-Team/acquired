import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
import policy


def config(data=None, **patch):
    data = data or {'actions': {}}
    policy.control(data)['settings'] = policy.validate_settings(policy.settings(data), {
        'timezone':'UTC', 'activeDays':list(range(7)), 'startHour':0, 'endHour':24,
        'minSpacingSeconds':1,'maxSpacingSeconds':1, **patch,
    })
    return data


def test_validation_blocks_invalid_timezone_and_limits():
    for patch in [{'timezone':'Not/AZone'}, {'activeDays':[]}, {'keepAliveDays':[]}, {'keepAliveDays':[7]}, {'messagesDaily':101},
                  {'minSpacingSeconds':600,'maxSpacingSeconds':10}, {'proxy':{}}, {'keepAliveEnabled':1},
                  {'invitationsDaily':20,'invitationsWeekly':10}]:
        with pytest.raises(ValueError): policy.validate_settings(policy.DEFAULTS,patch)


def test_attempts_use_overall_and_action_budgets_and_expire():
    data=config(messagesDaily=1)
    assert policy.reserve(data,'message',now=10000)==(10000,None)
    due,reason=policy.reserve(data,'message',now=10002)
    assert due==96400 and reason=='messagesDaily limit reached'
    assert policy.usage(data,now=10002)['requestsDaily']['used']==1
    assert policy.reserve(data,'read',now=10002)==(10002,None)
    assert policy.usage(data,now=10002)['requestsDaily']['used']==2
    assert policy.reserve(data,'message',now=96400)==(96400,None)


def test_weekly_limit_and_reduced_limit_wait_for_enough_expiries():
    data=config(invitationsDaily=2,invitationsWeekly=2)
    policy.reserve(data,'invite',now=10000)
    policy.reserve(data,'invite',now=10002)
    assert policy.eligible(data,'invite',now=10004)[0]==10000+7*86400
    policy.control(data)['settings']['invitationsWeekly']=1
    assert policy.eligible(data,'invite',now=10004)[0]==10002+7*86400


def test_schedule_and_dst_do_not_use_fixed_utc_offset():
    settings={**policy.DEFAULTS,'activeDays':[0,1,2,3,4]}
    friday=datetime(2026,10,2,18,tzinfo=ZoneInfo('Australia/Melbourne')).timestamp()
    monday=policy.schedule_next(settings,friday)
    local=datetime.fromtimestamp(monday,ZoneInfo(settings['timezone']))
    assert (local.weekday(),local.hour)==(0,9)
    assert local.utcoffset().total_seconds()==11*3600
    assert policy.schedule_next(settings,monday+1)==monday+1


def test_cooldown_verification_and_pause_are_independent():
    data=config()
    policy.provider_result(data,{'status':429,'retryAfter':1800},now=10000)
    assert policy.eligible(data,'message',now=10001)[0]==11800
    policy.provider_result(data,{'status':401},now=10002)
    assert policy.eligible(data,'read',now=10003)[0] is None
    policy.control(data)['requiresVerification']=False
    policy.control(data)['settings']['outreachPaused']=True
    assert policy.eligible(data,'message',now=12000)[0] is None
    assert policy.eligible(data,'keepalive',now=12000)[0]==12000
    assert policy.eligible(data,'read',now=12000)[0]==12000


def test_invitation_limit_and_circuit_breaker():
    data=config()
    policy.provider_result(data,{'status':422,'data':{'type':'cannot_resend_yet'}},now=10000)
    assert policy.control(data)['cooldownUntil']==10000+7*86400
    data=config()
    for _ in range(3): policy.provider_result(data,{'status':500},now=10000)
    assert policy.control(data)['cooldownUntil']==13600
    policy.provider_result(data,{'status':200},now=10001)
    assert policy.control(data)['failures']==0
    assert policy.control(data)['cooldownUntil']==13600


def test_fixture_budgets_do_not_spend_live_allowance():
    data={'actions':{}}
    policy.control(data,True)['settings']={**policy.DEFAULTS,'timezone':'UTC','activeDays':list(range(7)),'startHour':0,'endHour':24}
    policy.reserve(data,'message',fixture=True,now=10000)
    assert policy.usage(data,True,10000)['messagesDaily']['used']==1
    assert policy.usage(data,False,10000)['messagesDaily']['used']==0


@pytest.mark.parametrize('day',[10,11])
def test_weekend_keep_alive_is_independent_of_outreach_days(day):
    now=datetime(2026,10,day,10,tzinfo=ZoneInfo('Australia/Melbourne')).timestamp()
    data={'actions':{}}
    assert policy.eligible(data,'keepalive',now=now)==(now,None)
    assert policy.eligible(data,'message',now=now)[0]>now
    policy.control(data)['settings']={'outreachPaused':True}
    assert policy.eligible(data,'keepalive',now=now)==(now,None)
    assert policy.eligible(data,'message',now=now)[0] is None
    policy.control(data)['settings']['keepAliveDays']=[0,1,2,3,4]
    assert policy.eligible(data,'keepalive',now=now)[0]>now
