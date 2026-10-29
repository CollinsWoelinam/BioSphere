-- Record of security-relevant admin actions: account changes and species-registry edits.
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    target VARCHAR(200) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
