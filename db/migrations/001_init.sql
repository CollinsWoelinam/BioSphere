CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE species_observations (
    -- Generated on the device so offline sync retries are idempotent.
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    species_name VARCHAR(100) NOT NULL,
    is_invasive BOOLEAN NOT NULL DEFAULT FALSE,
    observer_type VARCHAR(20) NOT NULL DEFAULT 'RANGER'
        CHECK (observer_type IN ('RANGER', 'CITIZEN')),
    location GEOMETRY(Point, 4326) NOT NULL, -- WGS84 GPS point
    accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    altitude_m REAL,
    individual_count INTEGER NOT NULL DEFAULT 1 CHECK (individual_count > 0),
    habitat_notes TEXT,
    device_id VARCHAR(64),
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT location_is_valid_wgs84 CHECK (
        ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90
    )
);

-- Spatial index for bbox queries and density aggregation
CREATE INDEX idx_obs_location ON species_observations USING GIST (location);
-- Composite index for temporal-spatial trajectory queries
CREATE INDEX idx_obs_species_time ON species_observations (species_name, observed_at);
-- Time-slider queries across all species
CREATE INDEX idx_obs_time ON species_observations (observed_at);
