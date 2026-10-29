-- Individually identified animals, usually fitted with a GPS collar.
CREATE TABLE individuals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,          -- field code, e.g. "E-017"
    species_name VARCHAR(100) NOT NULL REFERENCES species (species_name),
    name VARCHAR(100),
    sex CHAR(1) CHECK (sex IN ('F', 'M', 'U')) DEFAULT 'U',
    collar_id VARCHAR(64),                     -- manufacturer serial / Movebank tag id
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Telemetry is kept apart from sightings: collars log on a fixed schedule whether or
-- not anyone sees the animal, so mixing them would swamp species-level analyses with
-- a few individuals' paths, and volumes are orders of magnitude higher.
CREATE TABLE telemetry_fixes (
    id BIGSERIAL PRIMARY KEY,
    individual_id UUID NOT NULL REFERENCES individuals (id) ON DELETE CASCADE,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL,
    hdop REAL,                                 -- GPS dilution of precision, if the collar reports it
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Re-importing an overlapping collar download must not duplicate fixes.
    UNIQUE (individual_id, recorded_at),
    CONSTRAINT fix_is_valid_wgs84 CHECK (
        ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90
    )
);
CREATE INDEX idx_fixes_location ON telemetry_fixes USING GIST (location);
