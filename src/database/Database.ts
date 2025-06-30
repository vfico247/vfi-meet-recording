import { Pool, PoolClient } from 'pg';
import { Logger } from '../utils/Logger';
import { config } from '../config/config';
import {
    RoomServerNode,
    FFmpegNode,
    DistributedRecordingJob,
    SystemMetrics
} from '../types/interfaces';

export class Database {
    private static instance: Database;
    private pool: Pool;
    private logger: Logger;

    private constructor() {
        this.logger = new Logger('Database');
        this.pool = new Pool({
            host: config.database.host,
            port: config.database.port,
            database: config.database.database,
            user: config.database.username,
            password: config.database.password,
            ssl: config.database.ssl,
            min: config.database.pool.min,
            max: config.database.pool.max,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });

        this.setupEventHandlers();
    }

    static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    private setupEventHandlers(): void {
        this.pool.on('connect', () => {
            this.logger.info('Database connection established');
        });

        this.pool.on('error', (err) => {
            this.logger.error('Database pool error:', err);
        });
    }

    async connect(): Promise<void> {
        try {
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            this.logger.info('Database connected successfully');
        } catch (error) {
            this.logger.error('Failed to connect to database:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.pool.end();
            this.logger.info('Database disconnected');
        } catch (error) {
            this.logger.error('Error disconnecting from database:', error);
        }
    }

    async query(text: string, params?: any[]): Promise<any> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } finally {
            client.release();
        }
    }

    // ROOM SERVER OPERATIONS
    async saveRoomServer(roomServer: RoomServerNode): Promise<void> {
        const query = `
      INSERT INTO room_servers (
        id, url, region, rooms, capacity, current_load, 
        is_healthy, last_heartbeat, specs, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        url = EXCLUDED.url,
        region = EXCLUDED.region,
        rooms = EXCLUDED.rooms,
        capacity = EXCLUDED.capacity,
        current_load = EXCLUDED.current_load,
        is_healthy = EXCLUDED.is_healthy,
        last_heartbeat = EXCLUDED.last_heartbeat,
        specs = EXCLUDED.specs,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `;

        await this.query(query, [
            roomServer.id,
            roomServer.url,
            roomServer.region,
            JSON.stringify(roomServer.rooms),
            roomServer.capacity,
            roomServer.currentLoad,
            roomServer.isHealthy,
            new Date(roomServer.lastHeartbeat),
            JSON.stringify(roomServer.specs),
            JSON.stringify(roomServer.metadata || {})
        ]);
    }

    async getRoomServers(): Promise<RoomServerNode[]> {
        const query = 'SELECT * FROM room_servers WHERE is_healthy = true ORDER BY created_at';
        const result = await this.query(query);

        return result.rows.map(function (row: { id: any; url: any; region: any; rooms: string; capacity: any; current_load: any; is_healthy: any; last_heartbeat: string | number | Date; specs: string; metadata: string; }) {
            return ({
                id: row.id,
                url: row.url,
                region: row.region,
                rooms: JSON.parse(row.rooms),
                capacity: row.capacity,
                currentLoad: row.current_load,
                isHealthy: row.is_healthy,
                lastHeartbeat: new Date(row.last_heartbeat).getTime(),
                specs: JSON.parse(row.specs),
                metadata: JSON.parse(row.metadata)
            });
        });
    }

    // FFMPEG NODE OPERATIONS
    async saveFFmpegNode(ffmpegNode: FFmpegNode): Promise<void> {
        const query = `
      INSERT INTO ffmpeg_nodes (
        id, url, region, capacity, current_load, is_healthy, 
        last_heartbeat, specs, supported_codecs, active_jobs, 
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        url = EXCLUDED.url,
        region = EXCLUDED.region,
        capacity = EXCLUDED.capacity,
        current_load = EXCLUDED.current_load,
        is_healthy = EXCLUDED.is_healthy,
        last_heartbeat = EXCLUDED.last_heartbeat,
        specs = EXCLUDED.specs,
        supported_codecs = EXCLUDED.supported_codecs,
        active_jobs = EXCLUDED.active_jobs,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `;

        await this.query(query, [
            ffmpegNode.id,
            ffmpegNode.url,
            ffmpegNode.region,
            ffmpegNode.capacity,
            ffmpegNode.currentLoad,
            ffmpegNode.isHealthy,
            new Date(ffmpegNode.lastHeartbeat),
            JSON.stringify(ffmpegNode.specs),
            JSON.stringify(ffmpegNode.supportedCodecs),
            JSON.stringify(ffmpegNode.activeJobs),
            JSON.stringify(ffmpegNode.metadata || {})
        ]);
    }

    async getFFmpegNodes(): Promise<FFmpegNode[]> {
        const query = 'SELECT * FROM ffmpeg_nodes WHERE is_healthy = true ORDER BY created_at';
        const result = await this.query(query);

        return result.rows.map((row: { id: any; url: any; region: any; capacity: any; current_load: any; is_healthy: any; last_heartbeat: string | number | Date; specs: string; supported_codecs: string; active_jobs: string; metadata: string; }) => {
            return ({
                id: row.id,
                url: row.url,
                region: row.region,
                capacity: row.capacity,
                currentLoad: row.current_load,
                isHealthy: row.is_healthy,
                lastHeartbeat: new Date(row.last_heartbeat).getTime(),
                specs: JSON.parse(row.specs),
                supportedCodecs: JSON.parse(row.supported_codecs),
                activeJobs: JSON.parse(row.active_jobs),
                metadata: JSON.parse(row.metadata)
            });
        });
    }

    // RECORDING JOB OPERATIONS
    async saveRecordingJob(job: DistributedRecordingJob): Promise<void> {
        const query = `
      INSERT INTO recording_jobs (
        job_id, room_server_id, room_id, peer_id, peer_info, ffmpeg_node_id,
        rtp_streams, rtp_forwarding, options, status, start_time, end_time,
        output_path, error_message, requester_info, metrics, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
      ON CONFLICT (job_id) DO UPDATE SET
        ffmpeg_node_id = EXCLUDED.ffmpeg_node_id,
        rtp_forwarding = EXCLUDED.rtp_forwarding,
        status = EXCLUDED.status,
        end_time = EXCLUDED.end_time,
        output_path = EXCLUDED.output_path,
        error_message = EXCLUDED.error_message,
        metrics = EXCLUDED.metrics,
        updated_at = NOW()
    `;

        await this.query(query, [
            job.jobId,
            job.roomServerId,
            job.roomId,
            job.peerId,
            JSON.stringify(job.peerInfo),
            job.ffmpegNodeId,
            JSON.stringify(job.rtpStreams),
            JSON.stringify(job.rtpForwarding || {}),
            JSON.stringify(job.options),
            job.status,
            new Date(job.startTime),
            job.endTime ? new Date(job.endTime) : null,
            job.outputPath,
            job.errorMessage,
            JSON.stringify(job.requesterInfo),
            JSON.stringify(job.metrics || {})
        ]);
    }

    async updateRecordingJob(job: DistributedRecordingJob): Promise<void> {
        await this.saveRecordingJob(job); // Uses ON CONFLICT to update
    }

    async getActiveRecordingJobs(): Promise<DistributedRecordingJob[]> {
        const query = `
      SELECT * FROM recording_jobs 
      WHERE status IN ('pending', 'initializing', 'recording') 
      ORDER BY created_at DESC
    `;
        const result = await this.query(query);

        return result.rows.map(this.mapRowToRecordingJob);
    }

    async getRecordingJobHistory(filters: any): Promise<{ records: DistributedRecordingJob[], total: number }> {
        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (filters.status) {
            whereClause += ` AND status = ${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        if (filters.startDate) {
            whereClause += ` AND created_at >= ${paramIndex}`;
            params.push(filters.startDate);
            paramIndex++;
        }

        if (filters.endDate) {
            whereClause += ` AND created_at <= ${paramIndex}`;
            params.push(filters.endDate);
            paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM recording_jobs ${whereClause}`;
        const countResult = await this.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        // Get paginated records
        const offset = (filters.page - 1) * filters.limit;
        const recordsQuery = `
      SELECT * FROM recording_jobs ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${paramIndex} OFFSET ${paramIndex + 1}
    `;
        params.push(filters.limit, offset);

        const recordsResult = await this.query(recordsQuery, params);
        const records = recordsResult.rows.map(this.mapRowToRecordingJob);

        return { records, total };
    }

    private mapRowToRecordingJob(row: any): DistributedRecordingJob {
        // @ts-ignore
        return {
            jobId: row.job_id,
            roomServerId: row.room_server_id,
            roomId: row.room_id,
            peerId: row.peer_id,
            peerInfo: JSON.parse(row.peer_info),
            ffmpegNodeId: row.ffmpeg_node_id,
            rtpStreams: JSON.parse(row.rtp_streams),
            rtpForwarding: JSON.parse(row.rtp_forwarding),
            options: JSON.parse(row.options),
            status: row.status,
            startTime: new Date(row.start_time).getTime(),
            endTime: row.end_time ? new Date(row.end_time).getTime() : undefined,
            outputPath: row.output_path,
            errorMessage: row.error_message,
            requesterInfo: JSON.parse(row.requester_info),
            metrics: JSON.parse(row.metrics)
        };
    }

    // METRICS OPERATIONS
    async saveMetrics(metrics: SystemMetrics): Promise<void> {
        const query = `
      INSERT INTO system_metrics (
        timestamp, total_room_servers, healthy_room_servers,
        total_ffmpeg_nodes, healthy_ffmpeg_nodes, active_recordings,
        total_capacity, current_load, queue_length, regional_metrics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

        await this.query(query, [
            new Date(),
            metrics.totalRoomServers,
            metrics.healthyRoomServers,
            metrics.totalFFmpegNodes,
            metrics.healthyFFmpegNodes,
            metrics.activeRecordings,
            metrics.totalCapacity,
            metrics.currentLoad,
            metrics.queueLength || 0,
            JSON.stringify(metrics.byRegion)
        ]);
    }

    async getHistoricalMetrics(filters: any): Promise<any[]> {
        const query = `
      SELECT * FROM system_metrics
      WHERE timestamp >= $1 AND timestamp <= $2
      ORDER BY timestamp
    `;

        const result = await this.query(query, [filters.startDate, filters.endDate]);
        return result.rows;
    }
}