-- Bumping token_version invalidates every token issued to the user (sign out everywhere).
ALTER TABLE users
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN disabled_at TIMESTAMP WITH TIME ZONE;

-- Photos are re-encoded on upload with all metadata (including EXIF GPS) stripped.
-- The id is generated on the device so mobile uploads are idempotent.
CREATE TABLE observation_photos (
    id UUID PRIMARY KEY,
    observation_id UUID NOT NULL REFERENCES species_observations (id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users (id) ON DELETE SET NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_photos_observation ON observation_photos (observation_id);
