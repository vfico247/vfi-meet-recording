# EduMeet Recording Orchestrator

A distributed recording orchestration service for EduMeet that manages multiple room servers and FFmpeg nodes to provide scalable video recording capabilities.

## Features

- **Distributed Architecture**: Manages multiple room servers and FFmpeg nodes
- **Auto-scaling**: Automatically scales FFmpeg nodes based on load
- **Load Balancing**: Intelligent job distribution across nodes
- **Health Monitoring**: Real-time health checks and failover
- **RESTful API**: Complete REST API for recording management
- **WebSocket Support**: Real-time metrics and event streaming
- **Multi-region Support**: Deploy across multiple regions
- **Fault Tolerance**: Automatic job reassignment on node failure

## Quick Start

### Using Docker Compose

1. Clone the repository
2. Copy environment file: `cp .env.example .env`
3. Start services: `docker-compose -f docker/docker-compose.yml up -d`

### Manual Installation

1. Install dependencies: `npm install`
2. Set up database: Create PostgreSQL database and run migrations
3. Configure environment: Copy `.env.example` to `.env` and update values
4. Build: `npm run build`
5. Start: `npm start`

## API Documentation

### Authentication
All API endpoints (except health checks and node registration) require JWT authentication:

```bash
Authorization: Bearer <your-jwt-token>
```

### Core Endpoints

#### Start Recording
```bash
POST /api/recordings/start
Content-Type: application/json

{
  "roomServerId": "room-server-1",
  "roomId": "room-123",
  "peerId": "peer-456",
  "peerInfo": {
    "peerId": "peer-456",
    "displayName": "John Doe",
    "isAuthenticated": true,
    "roles": ["participant"],
    "joinTime": 1640995200000
  },
  "rtpStreams": [
    {
      "kind": "audio",
      "port": 5004,
      "payloadType": 111,
      "ssrc": 12345678,
      "codecName": "opus"
    },
    {
      "kind": "video",
      "port": 5006,
      "payloadType": 96,
      "ssrc": 87654321,
      "codecName": "h264"
    }
  ],
  "options": {
    "quality": "medium",
    "format": "mp4",
    "includeAudio": true,
    "includeVideo": true
  },
  "requesterInfo": {
    "ip": "192.168.1.100",
    "timestamp": 1640995200000
  }
}
```

#### Stop Recording
```bash
POST /api/recordings/{jobId}/stop
```

#### Node Registration
```bash
# Register Room Server
POST /api/nodes/room-servers/register
{
  "serverId": "room-server-1",
  "url": "http://room-server:3443",
  "region": "us-east-1",
  "capacity": 100,
  "specs": {
    "cpuCores": 8,
    "ram": 16777216000,
    "hasGPU": false,
    "diskSpace": 107374182400
  }
}

# Register FFmpeg Node
POST /api/nodes/ffmpeg-nodes/register
{
  "url": "http://ffmpeg-node:3000",
  "region": "us-east-1",
  "specs": {
    "cpuCores": 4,
    "ram": 8388608000-- System Metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_room_servers INTEGER NOT NULL,
    healthy_room_servers INTEGER NOT NULL,
    total_ffmpeg_nodes INTEGER NOT NULL,
    healthy_ffmpeg_nodes INTEGER NOT NULL,
    active_recordings INTEGER NOT NULL,
    total_capacity INTEGER NOT NULL,
    current_load INTEGER NOT NULL,
    queue_length INTEGER DEFAULT 0,
    regional_metrics JSONB DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_room_servers_region ON room_servers(region);
CREATE INDEX IF NOT EXISTS idx_room_servers_healthy ON room_servers(is_healthy);
CREATE INDEX IF NOT EXISTS idx_ffmpeg_nodes_region ON ffmpeg_nodes(region);
CREATE INDEX IF NOT EXISTS idx_ffmpeg_nodes_healthy ON ffmpeg_nodes(is_healthy);
CREATE INDEX IF NOT EXISTS idx_recording_jobs_status ON recording_jobs(status);
CREATE INDEX IF NOT EXISTS idx_recording_jobs_created_at ON recording_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);

-- Foreign key constraints
ALTER TABLE recording_jobs 
ADD CONSTRAINT fk_recording_jobs_room_server 
FOREIGN KEY (room_server_id) REFERENCES room_servers(id) ON DELETE CASCADE;

ALTER TABLE recording_jobs 
ADD CONSTRAINT fk_recording_jobs_ffmpeg_node 
FOREIGN KEY (ffmpeg_node_id) REFERENCES ffmpeg_nodes(id) ON DELETE SET NULL;