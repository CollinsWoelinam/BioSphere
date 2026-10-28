CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(254) NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'RESEARCHER', 'RANGER', 'CITIZEN')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));

-- Species registry. Sensitive species (poaching targets) have their exact
-- locations generalised for anyone below RANGER.
CREATE TABLE species (
    species_name VARCHAR(100) PRIMARY KEY,
    is_invasive BOOLEAN NOT NULL DEFAULT FALSE,
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO species (species_name, is_invasive)
SELECT species_name, bool_or(is_invasive) FROM species_observations GROUP BY species_name;

INSERT INTO species (species_name, is_sensitive) VALUES
    ('Diceros bicornis', TRUE),
    ('Ceratotherium simum', TRUE),
    ('Smutsia temminckii', TRUE)
ON CONFLICT (species_name) DO UPDATE SET is_sensitive = TRUE;

ALTER TABLE species_observations
    ADD COLUMN observer_id UUID REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX idx_obs_observer ON species_observations (observer_id);
