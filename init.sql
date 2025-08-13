-- init.sql - Database initialization for 56k Knowledge Hub
-- PostgreSQL version

-- Create database user if not exists (for PostgreSQL)
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'hub_user') THEN

      CREATE ROLE hub_user LOGIN PASSWORD 'secure_password';
   END IF;
END
$do$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE knowledge_hub TO hub_user;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    email VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    avatar TEXT,
    google_id VARCHAR(255),
    clickup_token TEXT,
    selected_claude_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(36) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    title VARCHAR(255),
    messages TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configuration table (for app settings)
CREATE TABLE IF NOT EXISTS configuration (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API usage tracking table
CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
    service VARCHAR(50) NOT NULL, -- 'claude', 'clickup', 'google'
    endpoint VARCHAR(255),
    tokens_used INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table (for persistent sessions)
CREATE TABLE IF NOT EXISTS user_sessions (
    sid VARCHAR(255) PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user_email ON conversations(user_email);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_email ON api_usage(user_email);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON user_sessions(expire);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at 
    BEFORE UPDATE ON conversations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configuration_updated_at 
    BEFORE UPDATE ON configuration 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial configuration
INSERT INTO configuration (key, value) VALUES 
    ('app_version', '1.0.0'),
    ('db_schema_version', '1.0'),
    ('setup_completed', 'true')
ON CONFLICT (key) DO NOTHING;

-- Grant permissions to tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hub_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hub_user;

-- Comments for documentation
COMMENT ON TABLE users IS 'Stores user authentication and preferences';
COMMENT ON TABLE conversations IS 'Stores chat conversations and messages';
COMMENT ON TABLE api_usage IS 'Tracks API usage for monitoring and billing';
COMMENT ON TABLE configuration IS 'Stores application configuration settings';
COMMENT ON TABLE user_sessions IS 'Stores user session data';

COMMENT ON COLUMN users.email IS 'Primary key - user email from Google OAuth';
COMMENT ON COLUMN users.clickup_token IS 'Encrypted ClickUp OAuth token';
COMMENT ON COLUMN conversations.messages IS 'JSON array of conversation messages';
COMMENT ON COLUMN api_usage.tokens_used IS 'Number of tokens used (for Claude API)';

-- Success message
SELECT 'Database initialization completed successfully!' as status;