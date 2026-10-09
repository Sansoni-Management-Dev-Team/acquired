"""Fixture HTTP responses must pass the same conservative campaign parsers."""
import pytest
import server
import replies
from adapter import parse_relationship
from adapter import message_target
from test_service import setup


def test_fixture_profile_is_target_bound_and_opt_in(setup, monkeypatch):
    client, _ = setup
    path = '/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=fictional-alex'
    monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES', 'false')
    assert client.get(path).status_code == 404
    monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES', 'true')
    response = client.get(path)
    assert response.status_code == 200
    assert parse_relationship(response.json(), 'fictional-alex') == {'connected': False, 'recipient': 'urn:li:fsd_profile:fictional-alex'}
    assert client.get(path.replace('fictional-alex', 'real-person')).status_code == 404


@pytest.mark.parametrize('folder', replies.FOLDERS)
def test_fixture_folder_page_explicitly_proves_completion(setup, monkeypatch, folder):
    client, _ = setup
    monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES', 'true')
    response = client.get('/voyagerMessagingGraphQL/graphql', params={
        'queryId': 'messengerConversations.fixture',
        'variables': '(query:' + replies.category_query(folder) + ',count:20,mailboxUrn:urn:li:fsd_profile:fixture)',
    })
    assert response.status_code == 200
    assert replies.cursor_collection(response.json(), 'messengerConversationsByCategoryQuery', 'nextCursor') == ([], None)


def test_fixture_ui_captures_all_required_owner_bound_queries(setup, monkeypatch):
    client, _ = setup
    monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES', 'true')
    html = client.get('/fixture/inbox').text
    worker = server.Worker('fixture-test', 0, fixture=True)
    # The UI emits these requests in the actual browser, not injected scan state.
    import re
    from types import SimpleNamespace
    for path in re.findall(r"fetch\('([^']+)'\)", html):
        worker.capture(SimpleNamespace(url=worker.origin + path, method='GET'))
    assert replies.modern_queries_ready(worker.reply_queries)


def test_fixture_visible_inbox_retains_verified_message_target(setup, monkeypatch):
    client, _ = setup
    monkeypatch.setenv('LINKEDIN_ENABLE_FIXTURES', 'true')
    import re
    import shutil
    from types import SimpleNamespace
    worker = server.Worker('fixture-visible-inbox', 0, fixture=True)
    try:
        for path in re.findall(r"fetch\('([^']+)'\)", client.get('/fixture/inbox').text):
            worker.capture(SimpleNamespace(url=worker.origin + path, method='GET'))
        response = client.get(worker.conversation_request)
        assert response.status_code == 200
        assert message_target(response.json(), worker.mailbox, 'urn:li:fsd_profile:fictional-alex') == {
            'mailboxUrn': 'urn:li:fsd_profile:fixture',
            'conversationUrn': 'urn:li:msg_conversation:fixture-alex',
        }
    finally:
        shutil.rmtree(worker.directory)
