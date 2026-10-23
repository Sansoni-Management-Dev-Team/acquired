-- History retention/purging is an explicit administrative operation. The normal
-- agent role cannot delete a parent thread to bypass append-only message grants.
REVOKE DELETE ON agent_threads,agent_messages,agent_operations,agent_events,agent_runs,agent_responsibilities FROM acquire_agent_user;
