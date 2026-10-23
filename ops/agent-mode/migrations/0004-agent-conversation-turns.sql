ALTER TABLE agent_operations ADD COLUMN lease_until timestamptz;
ALTER TABLE agent_operations ADD COLUMN fence bigint NOT NULL DEFAULT 0;
