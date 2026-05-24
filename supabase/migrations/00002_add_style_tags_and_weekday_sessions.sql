
-- Add rest_days to bars
ALTER TABLE bars ADD COLUMN rest_days text[] DEFAULT '{}';

-- Add style_tags to artists
ALTER TABLE artists ADD COLUMN style_tags text[] DEFAULT '{}';

-- Update bar_sessions to support weekday-specific config
ALTER TABLE bar_sessions ADD COLUMN weekday smallint;
ALTER TABLE bar_sessions ADD COLUMN singers_per_session smallint DEFAULT 1;
ALTER TABLE bar_sessions ADD COLUMN style_tags text[] DEFAULT '{}';

-- Drop existing unique constraint if it exists
ALTER TABLE bar_sessions DROP CONSTRAINT IF EXISTS bar_sessions_bar_id_session_number_key;

-- Add composite unique constraint for bar_id + weekday + session_number
ALTER TABLE bar_sessions ADD CONSTRAINT bar_sessions_bar_weekday_session_unique UNIQUE (bar_id, weekday, session_number);

-- Create index on weekday for faster lookup
CREATE INDEX IF NOT EXISTS bar_sessions_bar_weekday_idx ON bar_sessions(bar_id, weekday);
