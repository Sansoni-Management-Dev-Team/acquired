import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import diagnostics as diag
from adapter import request, PATHS
from test_service import setup, call

@pytest.fixture
def events(caplog):
    diag.LOGGER.addHandler(caplog.handler)
    try:
        yield caplog
    finally:
        diag.LOGGER.removeHandler(caplog.handler)

def records(events):
    return [json.loads(r.getMessage()) for r in events.records if r.name == diag.LOGGER.name]

def worker(evaluate):
    return SimpleNamespace(owner='hashed-owner',fixture=True,origin='https://www.linkedin.com',
        page=SimpleNamespace(url='https://www.linkedin.com/messaging/',evaluate=evaluate),
        context=SimpleNamespace(cookies=AsyncMock(return_value=[{'name':'JSESSIONID','value':'private-csrf'}])))

def test_provider_logs_before_and_after_with_one_trace_without_private_values(events):
    async def response(script,args):
        assert any(r['event']=='provider.request.start' for r in records(events))
        return {'status':400,'data':{'message':'private-response','serviceErrorCode':123},'redirect':False}
    with diag.context(trace_id='a'*32,action_id='b'*32):
        asyncio.run(request(worker(AsyncMock(side_effect=response)),PATHS['message'],'POST',{'text':'private-message'}))
    rows=records(events)
    assert rows[0]['event']=='provider.request.start'
    assert rows[-1]['event']=='provider.request.end' and rows[-1]['duration_ms']>=0
    assert {r['trace_id'] for r in rows}=={'a'*32}
    assert {r['action_id'] for r in rows}=={'b'*32}
    assert next(r for r in rows if r['event']=='provider.response')['service_error_code']==123
    serialized=json.dumps(rows)
    for private in ('private-csrf','private-message','private-response'):
        assert private not in serialized

def test_failure_identifies_exact_phase_without_exception_body(events):
    with pytest.raises(TimeoutError):
        asyncio.run(request(worker(AsyncMock(side_effect=TimeoutError('private-cookie and private-message'))),PATHS['message'],'POST',{}))
    errors=[r for r in records(events) if r['event'].endswith('.error')]
    assert [r['event'] for r in errors]==['provider.fetch.error','provider.request.error']
    assert all(r['error_type']=='TimeoutError' for r in errors)
    assert 'private-cookie' not in json.dumps(records(events))

def test_query_values_and_unknown_fields_never_enter_logs(events):
    path='/voyagerMessagingGraphQL/graphql?variables=(mailboxUrn:private-id,syncToken:private-token)'
    assert diag.endpoint(path)=='/voyagerMessagingGraphQL/graphql'
    diag.emit('test',body='private-body',headers={'authorization':'private-secret'},endpoint=diag.endpoint(path))
    assert not any('private-' in json.dumps(r) for r in records(events))

def test_http_trace_correlates_owner_lock_and_response(setup,events):
    client,_=setup
    response=call(client,'get','/connection')
    trace=response.headers['x-linkedin-trace-id']
    rows=records(events)
    assert len(trace)==32 and {r['trace_id'] for r in rows}=={trace}
    assert {'http.request.start','account.lock_wait.start','account.lock_wait.end','account.lock_released','http.response','http.request.end'} <= {r['event'] for r in rows}
    assert all('authorization' not in json.dumps(r) for r in rows)

def test_trace_header_is_validated_and_context_does_not_leak(setup,events):
    client,_=setup
    good=client.get('/connection?organizationId=o&userId=u',headers={'authorization':'Bearer '+__import__('server').SECRET,'x-linkedin-trace-id':'c'*32})
    assert good.headers['x-linkedin-trace-id']=='c'*32
    bad=client.get('/connection?organizationId=o&userId=u',headers={'authorization':'Bearer '+__import__('server').SECRET,'x-linkedin-trace-id':'private-secret'})
    assert bad.headers['x-linkedin-trace-id']!='private-secret'
    assert diag.CONTEXT.get()=={}


def test_file_log_survives_reopening_and_excludes_payloads(tmp_path):
    path = tmp_path/'diagnostics.jsonl'
    for event in ('provider.request.start', 'provider.request.end'):
        handler = diag.file_handler(path)
        diag.LOGGER.addHandler(handler)
        try:
            with diag.context(trace_id='d'*32):
                diag.emit(event, body='private-message', http_status=200)
        finally:
            diag.LOGGER.removeHandler(handler)
            handler.close()
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r['event'] for r in rows] == ['provider.request.start', 'provider.request.end']
    assert {r['trace_id'] for r in rows} == {'d'*32}
    assert 'private-message' not in path.read_text()
    assert path.stat().st_mode & 0o777 == 0o600


def test_file_rotation_is_bounded_and_retains_private_permissions(tmp_path):
    path = tmp_path/'diagnostics.jsonl'
    handler = diag.file_handler(path, max_bytes=150)
    diag.LOGGER.addHandler(handler)
    try:
        for _ in range(12): diag.emit('rotation.test', trace_id='e'*32)
    finally:
        diag.LOGGER.removeHandler(handler)
        handler.close()
    files = list(tmp_path.glob('diagnostics.jsonl*'))
    assert len(files) == 3
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in files)
    assert all(json.loads(line)['event'] == 'rotation.test' for p in files for line in p.read_text().splitlines())
