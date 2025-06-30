-- Recording Orchestrator Database Schema

-- Room Servers table
CREATE TABLE IF NOT EXISTS room_servers (
                                            id VARCHAR(255) PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    region VARCHAR(100) NOT NULL,
    rooms JSONB DEFAULT '[]',
    capacity INTEGER NOT NULL,
    current_load INTEGER DEFAULT 0,
    is_healthy BOOLEAN DEFAULT true,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    specs JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

-- FFmpeg Nodes table
CREATE TABLE IF NOT EXISTS ffmpeg_nodes (
                                            id VARCHAR(255) PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    region VARCHAR(100) NOT NULL,
    capacity INTEGER NOT NULL,
    current_load INTEGER DEFAULT 0,
    is_healthy BOOLEAN DEFAULT true,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    specs JSONB NOT NULL,
    supported_codecs JSONB DEFAULT '[]',
    active_jobs JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

-- Recording Jobs table
CREATE TABLE IF NOT EXISTS recording_jobs (
                                              job_id VARCHAR(255) PRIMARY KEY,
    room_server_id VARCHAR(255) NOT NULL,
    room_id VARCHAR(255) NOT NULL,
    peer_id VARCHAR(255) NOT NULL,
    peer_info JSONB NOT NULL,
    ffmpeg_node_id VARCHAR(255),
    rtp_streams JSONB NOT NULL,
    rtp_forwarding JSONB DEFAULT '{}',
    options JSONB NOT NULL,
    status VARCHAR(50) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
                           output_path VARCHAR(1000),
    error_message TEXT,
    requester_info JSONB NOT NULL,
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

-- System Metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
                                              id SERIAL PRIMARY KEY,}