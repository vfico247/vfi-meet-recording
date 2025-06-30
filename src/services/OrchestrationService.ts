import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { Database } from '../database/Database';
import { LoadBalancerService } from './LoadBalancerService';
import { NodeManager } from './NodeManager';
import { AutoScalingService } from './AutoScalingService';
import {
    RoomServerNode,
    FFmpegNode,
    DistributedRecordingJob,
    DistributedRecordingRequest,
    RTPForwardingConfig,
    SystemMetrics,
    JobStatus
} from '../types/interfaces';

export class OrchestrationService extends EventEmitter {
    private logger: Logger;
    private database: Database;
    private loadBalancer: LoadBalancerService;
    private nodeManager: NodeManager;
    private autoScaling: AutoScalingService;

    private roomServers: Map<string, RoomServerNode> = new Map();
    private ffmpegNodes: Map<string, FFmpegNode> = new Map();
    private activeJobs: Map<string, DistributedRecordingJob> = new Map();
    private jobQueue: DistributedRecordingJob[] = [];

    private healthCheckInterval: NodeJS.Timer | null = null;
    private metricsInterval: NodeJS.Timer | null = null;
    private subscribers: Set<any> = new Set();

    constructor() {
        super();
        this.logger = new Logger('OrchestrationService');
        this.database = Database.getInstance();
        this.loadBalancer = new LoadBalancerService();
        this.nodeManager = new NodeManager();
        this.autoScaling = new AutoScalingService();
    }

    async initialize(): Promise<void> {
        this.logger.info('Initializing Orchestration Service...');

        // Initialize sub-services
        await this.nodeManager.initialize();
        await this.autoScaling.initialize();

        // Restore state from database
        await this.restoreState();

        // Setup event handlers
        this.setupEventHandlers();

        this.logger.info('Orchestration Service initialized successfully');
    }

    // ROOM SERVER MANAGEMENT
    async registerRoomServer(registration: any): Promise<string> {
        const roomServer: RoomServerNode = {
            id: registration.serverId,
            url: registration.url,
            region: registration.region,
            rooms: registration.rooms || [],
            capacity: registration.capacity,
            currentLoad: 0,
            isHealthy: true,
            lastHeartbeat: Date.now(),
            specs: registration.specs,
            metadata: registration.metadata
        };

        this.roomServers.set(roomServer.id, roomServer);

        // Save to database
        await this.database.saveRoomServer(roomServer);

        this.logger.info('Room server registered:', {
            id: roomServer.id,
            url: roomServer.url,
            region: roomServer.region,
            capacity: roomServer.capacity
        });

        this.emit('roomServerRegistered', roomServer);
        this.broadcastToSubscribers('node_registered', { type: 'room-server', node: roomServer });

        return roomServer.id;
    }

    async registerFFmpegNode(registration: any): Promise<string> {
        const nodeId = `ffmpeg-${registration.region}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

        const ffmpegNode: FFmpegNode = {
            id: nodeId,
            url: registration.url,
            region: registration.region,
            capacity: this.calculateNodeCapacity(registration.specs),
            currentLoad: 0,
            isHealthy: true,
            lastHeartbeat: Date.now(),
            specs: registration.specs,
            supportedCodecs: registration.supportedCodecs || ['h264', 'vp8', 'opus'],
            activeJobs: [],
            metadata: registration.metadata
        };

        this.ffmpegNodes.set(nodeId, ffmpegNode);

        // Save to database
        await this.database.saveFFmpegNode(ffmpegNode);

        this.logger.info('FFmpeg node registered:', {
            id: nodeId,
            url: ffmpegNode.url,
            region: ffmpegNode.region,
            capacity: ffmpegNode.capacity,
            hasGPU: ffmpegNode.specs.hasGPU
        });

        this.emit('ffmpegNodeRegistered', ffmpegNode);
        this.broadcastToSubscribers('node_registered', { type: 'ffmpeg-node', node: ffmpegNode });

        return nodeId;
    }

    // DISTRIBUTED RECORDING MANAGEMENT
    async startDistributedRecording(request: DistributedRecordingRequest): Promise<string> {
        const jobId = `rec-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

        this.logger.info('Starting distributed recording:', {
            jobId,
            roomServerId: request.roomServerId,
            peerId: request.peerInfo.peerId,
            peerName: request.peerInfo.displayName
        });

        // Validate room server
        const roomServer = this.roomServers.get(request.roomServerId);
        if (!roomServer || !roomServer.isHealthy) {
            throw new Error(`Room server ${request.roomServerId} is not available`);
        }

        // Create job
        const job: DistributedRecordingJob = {
            jobId,
            roomServerId: request.roomServerId,
            roomId: request.roomId,
            peerId: request.peerId,
            peerInfo: request.peerInfo,
            ffmpegNodeId: '', // Will be assigned
            rtpStreams: request.rtpStreams,
            options: request.options,
            status: 'pending',
            startTime: Date.now(),
            requesterInfo: request.requesterInfo
        };

        // Try to assign FFmpeg node immediately
        const selectedNode = await this.loadBalancer.selectOptimalFFmpegNode(
            Array.from(this.ffmpegNodes.values()),
            {
                region: roomServer.region,
                codecRequirements: this.extractCodecRequirements(request.rtpStreams),
                estimatedLoad: this.estimateRecordingLoad(request.rtpStreams, request.options)
            }
        );

        if (selectedNode) {
            // Assign immediately
            await this.assignJobToNode(job, selectedNode, roomServer);
        } else {
            // Add to queue
            this.jobQueue.push(job);
            this.logger.info(`Job ${jobId} queued. Queue length: ${this.jobQueue.length}`);
        }

        // Track job
        this.activeJobs.set(jobId, job);

        // Save to database
        await this.database.saveRecordingJob(job);

        this.emit('recordingJobCreated', job);
        this.broadcastToSubscribers('recording_started', job);

        return jobId;
    }

    private async assignJobToNode(
        job: DistributedRecordingJob,
        ffmpegNode: FFmpegNode,
        roomServer: RoomServerNode
    ): Promise<void> {
        try {
            job.status = 'initializing';
            job.ffmpegNodeId = ffmpegNode.id;

            // Setup RTP forwarding
            await this.setupRTPForwarding(job, roomServer, ffmpegNode);

            // Start recording on FFmpeg node
            await this.startRecordingOnNode(job, ffmpegNode);

            // Update load counters
            roomServer.currentLoad++;
            ffmpegNode.currentLoad++;
            ffmpegNode.activeJobs.push(job.jobId);

            job.status = 'recording';

            // Update database
            await this.database.updateRecordingJob(job);

            this.logger.info(`Job ${job.jobId} assigned to FFmpeg node ${ffmpegNode.id}`);

        } catch (error) {
            job.status = 'failed';
            job.errorMessage = error.message;

            this.logger.error(`Failed to assign job ${job.jobId}:`, error);
            this.emit('recordingJobFailed', job, error);
        }
    }

    private async setupRTPForwarding(
        job: DistributedRecordingJob,
        roomServer: RoomServerNode,
        ffmpegNode: FFmpegNode
    ): Promise<void> {

        // Allocate RTP ports on FFmpeg node
        const rtpPorts = await this.allocateRTPPorts(ffmpegNode, job.rtpStreams.length);

        const forwardingConfig: RTPForwardingConfig = {
            jobId: job.jobId,
            peerId: job.peerId,
            targetNode: {
                ip: this.extractIPFromURL(ffmpegNode.url),
                ports: rtpPorts
            },
            rtpStreams: job.rtpStreams.map((stream, index) => ({
                ...stream,
                port: rtpPorts[index]
            }))
        };

        // Configure room server to forward RTP
        const response = await fetch(`${roomServer.url}/configure-rtp-forwarding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(forwardingConfig),
            timeout: 10000
        });

        if (!response.ok) {
            throw new Error(`Failed to configure RTP forwarding: ${response.statusText}`);
        }

        job.rtpForwarding = forwardingConfig;

        this.logger.info(`RTP forwarding configured for job ${job.jobId}`, {
            targetIP: forwardingConfig.targetNode.ip,
            ports: forwardingConfig.targetNode.ports
        });
    }

    private async startRecordingOnNode(
        job: DistributedRecordingJob,
        ffmpegNode: FFmpegNode
    ): Promise<void> {

        const recordingRequest = {
            jobId: job.jobId,
            peerInfo: job.peerInfo,
            rtpStreams: job.rtpForwarding!.rtpStreams,
            options: job.options,
            roomInfo: {
                roomServerId: job.roomServerId,
                roomId: job.roomId
            },
            orchestratorCallbackUrl: `${process.env.ORCHESTRATOR_CALLBACK_URL}/recording-events`
        };

        const response = await fetch(`${ffmpegNode.url}/start-recording`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(recordingRequest),
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`Failed to start recording on FFmpeg node: ${response.statusText}`);
        }

        this.logger.info(`Recording started on FFmpeg node ${ffmpegNode.id} for job ${job.jobId}`);
    }

    async stopDistributedRecording(jobId: string): Promise<string> {
        const job = this.activeJobs.get(jobId);
        if (!job) {
            throw new Error(`Recording job ${jobId} not found`);
        }

        this.logger.info(`Stopping distributed recording ${jobId}`);

        try {
            // Stop recording on FFmpeg node
            const ffmpegNode = this.ffmpegNodes.get(job.ffmpegNodeId);
            if (ffmpegNode) {
                await this.stopRecordingOnNode(job, ffmpegNode);
            }

            // Stop RTP forwarding on room server
            const roomServer = this.roomServers.get(job.roomServerId);
            if (roomServer) {
                await this.stopRTPForwarding(job, roomServer);
            }

            // Update job status
            job.status = 'completed';
            job.endTime = Date.now();

            // Update database
            await this.database.updateRecordingJob(job);

            // Cleanup
            this.activeJobs.delete(jobId);

            this.emit('recordingJobCompleted', job);
            this.broadcastToSubscribers('recording_completed', job);

            return job.outputPath || `Recording ${jobId} completed`;

        } catch (error) {
            job.status = 'failed';
            job.errorMessage = error.message;
            job.endTime = Date.now();

            this.logger.error(`Failed to stop recording ${jobId}:`, error);
            this.emit('recordingJobFailed', job, error);

            throw error;
        }
    }

    private async stopRecordingOnNode(job: DistributedRecordingJob, ffmpegNode: FFmpegNode): Promise<void> {
        const response = await fetch(`${ffmpegNode.url}/stop-recording`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: job.jobId }),
            timeout: 10000
        });

        if (response.ok) {
            // Update node load
            ffmpegNode.currentLoad = Math.max(0, ffmpegNode.currentLoad - 1);
            ffmpegNode.activeJobs = ffmpegNode.activeJobs.filter(id => id !== job.jobId);
        }
    }

    private async stopRTPForwarding(job: DistributedRecordingJob, roomServer: RoomServerNode): Promise<void> {
        const response = await fetch(`${roomServer.url}/stop-rtp-forwarding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: job.jobId }),
            timeout: 10000
        });

        if (response.ok) {
            // Update room server load
            roomServer.currentLoad = Math.max(0, roomServer.currentLoad - 1);
        }
    }

    // HEALTH MONITORING
    startHealthMonitoring(): void {
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthChecks();
        }, 30000); // Every 30 seconds

        this.logger.info('Health monitoring started');
    }

    private async performHealthChecks(): Promise<void> {
        const now = Date.now();
        const timeoutMs = 60000; // 1 minute timeout

        // Check room servers
        for (const [id, roomServer] of this.roomServers) {
            if (now - roomServer.lastHeartbeat > timeoutMs) {
                await this.handleUnhealthyRoomServer(id, roomServer);
            }
        }

        // Check FFmpeg nodes
        for (const [id, ffmpegNode] of this.ffmpegNodes) {
            if (now - ffmpegNode.lastHeartbeat > timeoutMs) {
                await this.handleUnhealthyFFmpegNode(id, ffmpegNode);
            }
        }

        // Process job queue
        await this.processJobQueue();
    }

    private async handleUnhealthyRoomServer(id: string, roomServer: RoomServerNode): Promise<void> {
        roomServer.isHealthy = false;

        this.logger.warn(`Room server ${id} is unhealthy`);

        // Find jobs that need to be handled
        const affectedJobs = Array.from(this.activeJobs.values())
            .filter(job => job.roomServerId === id && job.status === 'recording');

        for (const job of affectedJobs) {
            job.status = 'failed';
            job.errorMessage = 'Room server became unhealthy';
            job.endTime = Date.now();

            // Try to cleanup FFmpeg node
            const ffmpegNode = this.ffmpegNodes.get(job.ffmpegNodeId);
            if (ffmpegNode) {
                await this.stopRecordingOnNode(job, ffmpegNode).catch(() => {});
            }
        }

        this.emit('roomServerUnhealthy', roomServer);
    }

    private async handleUnhealthyFFmpegNode(id: string, ffmpegNode: FFmpegNode): Promise<void> {
        ffmpegNode.isHealthy = false;

        this.logger.warn(`FFmpeg node ${id} is unhealthy`);

        // Find jobs that need to be reassigned
        const affectedJobs = Array.from(this.activeJobs.values())
            .filter(job => job.ffmpegNodeId === id && job.status === 'recording');

        for (const job of affectedJobs) {
            // Try to reassign to another node
            const newNode = await this.loadBalancer.selectOptimalFFmpegNode(
                Array.from(this.ffmpegNodes.values()).filter(n => n.isHealthy && n.id !== id),
                {
                    region: job.peerInfo.displayName || 'default',
                    codecRequirements: this.extractCodecRequirements(job.rtpStreams),
                    estimatedLoad: 1
                }
            );

            if (newNode) {
                // Reassign to new node
                const roomServer = this.roomServers.get(job.roomServerId);
                if (roomServer) {
                    job.status = 'pending';
                    job.ffmpegNodeId = '';
                    await this.assignJobToNode(job, newNode, roomServer);
                }
            } else {
                // No available nodes, mark as failed
                job.status = 'failed';
                job.errorMessage = 'No available FFmpeg nodes for reassignment';
                job.endTime = Date.now();
            }
        }

        this.emit('ffmpegNodeUnhealthy', ffmpegNode);
    }

    private async processJobQueue(): Promise<void> {
        if (this.jobQueue.length === 0) return;

        const availableNodes = Array.from(this.ffmpegNodes.values())
            .filter(node => node.isHealthy && node.currentLoad < node.capacity);

        for (const job of this.jobQueue.slice()) {
            const roomServer = this.roomServers.get(job.roomServerId);
            if (!roomServer || !roomServer.isHealthy) continue;

            const selectedNode = await this.loadBalancer.selectOptimalFFmpegNode(
                availableNodes,
                {
                    region: roomServer.region,
                    codecRequirements: this.extractCodecRequirements(job.rtpStreams),
                    estimatedLoad: this.estimateRecordingLoad(job.rtpStreams, job.options)
                }
            );

            if (selectedNode) {
                // Remove from queue
                const index = this.jobQueue.indexOf(job);
                if (index > -1) {
                    this.jobQueue.splice(index, 1);
                }

                // Assign to node
                await this.assignJobToNode(job, selectedNode, roomServer);

                // Remove from available nodes list for this iteration
                const nodeIndex = availableNodes.indexOf(selectedNode);
                if (nodeIndex > -1) {
                    availableNodes.splice(nodeIndex, 1);
                }
            }
        }
    }

    // METRICS AND MONITORING
    startMetricsCollection(): void {
        this.metricsInterval = setInterval(() => {
            const metrics = this.getSystemMetrics();
            this.broadcastToSubscribers('metrics_update', metrics);

            // Store metrics in database for historical analysis
            this.database.saveMetrics(metrics).catch(error => {
                this.logger.error('Failed to save metrics:', error);
            });
        }, 15000); // Every 15 seconds

        this.logger.info('Metrics collection started');
    }

    startAutoScaling(): void {
        this.autoScaling.start(this);
        this.logger.info('Auto-scaling started');
    }

    getSystemMetrics(): SystemMetrics {
        const roomServerMetrics = Array.from(this.roomServers.values());
        const ffmpegNodeMetrics = Array.from(this.ffmpegNodes.values());

        return {
            totalRoomServers: roomServerMetrics.length,
            healthyRoomServers: roomServerMetrics.filter(rs => rs.isHealthy).length,
            totalFFmpegNodes: ffmpegNodeMetrics.length,
            healthyFFmpegNodes: ffmpegNodeMetrics.filter(fn => fn.isHealthy).length,
            activeRecordings: this.activeJobs.size,
            queueLength: this.jobQueue.length,
            totalCapacity: ffmpegNodeMetrics.reduce((sum, node) => sum + node.capacity, 0),
            currentLoad: ffmpegNodeMetrics.reduce((sum, node) => sum + node.currentLoad, 0),
            byRegion: this.getMetricsByRegion()
        };
    }

    private getMetricsByRegion(): Record<string, any> {
        const regions: Record<string, any> = {};

        // Process FFmpeg nodes by region
        for (const node of this.ffmpegNodes.values()) {
            if (!regions[node.region]) {
                regions[node.region] = {
                    roomServers: 0,
                    ffmpegNodes: 0,
                    activeRecordings: 0,
                    capacity: 0,
                    load: 0
                };
            }

            regions[node.region].ffmpegNodes++;
            regions[node.region].capacity += node.capacity;
            regions[node.region].load += node.currentLoad;
            regions[node.region].activeRecordings += node.activeJobs.length;
        }

        // Process room servers by region
        for (const roomServer of this.roomServers.values()) {
            if (!regions[roomServer.region]) {
                regions[roomServer.region] = {
                    roomServers: 0,
                    ffmpegNodes: 0,
                    activeRecordings: 0,
                    capacity: 0,
                    load: 0
                };
            }

            regions[roomServer.region].roomServers++;
        }

        // Calculate average load percentages
        for (const region of Object.keys(regions)) {
            const metrics = regions[region];
            metrics.avgLoad = metrics.capacity > 0 ?
                (metrics.load / metrics.capacity) * 100 : 0;
        }

        return regions;
    }

    // UTILITY METHODS
    private calculateNodeCapacity(specs: any): number {
        let capacity = specs.cpuCores * 1.5; // 1.5 recordings per core

        if (specs.hasGPU) {
            capacity *= 2; // GPU can handle 2x more
        }

        const ramCapacity = Math.floor(specs.ram / (500 * 1024 * 1024)); // 500MB per recording

        return Math.min(capacity, ramCapacity, 12); // Max 12 per node
    }

    private extractCodecRequirements(rtpStreams: any[]): string[] {
        return [...new Set(rtpStreams.map(stream => stream.codecName))];
    }

    private estimateRecordingLoad(rtpStreams: any[], options: any): number {
        let load = 1; // Base load

        if (rtpStreams.some(s => s.kind === 'video')) {
            load += options.quality === 'high' ? 2 : options.quality === 'medium' ? 1 : 0.5;
        }

        return load;
    }

    private async allocateRTPPorts(ffmpegNode: FFmpegNode, count: number): Promise<number[]> {
        // Request available ports from FFmpeg node
        const response = await fetch(`${ffmpegNode.url}/allocate-ports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
            timeout: 5000
        });

        if (!response.ok) {
            throw new Error('Failed to allocate RTP ports');
        }

        const result = await response.json();
        return result.ports;
    }

    private extractIPFromURL(url: string): string {
        const match = url.match(/^https?:\/\/([^:\/]+)/);
        return match ? match[1] : 'localhost';
    }

    // EVENT HANDLING
    private setupEventHandlers(): void {
        this.on('recordingJobCompleted', (job) => {
            this.logger.info(`Recording job completed: ${job.jobId}`, {
                duration: job.endTime! - job.startTime,
                peer: job.peerInfo.displayName,
                outputPath: job.outputPath
            });
        });

        this.on('recordingJobFailed', (job, error) => {
            this.logger.error(`Recording job failed: ${job.jobId}`, {
                error: error.message,
                peer: job.peerInfo.displayName
            });
        });
    }

    // WEBSOCKET SUBSCRIPTIONS
    subscribeToMetrics(ws: any): void {
        this.subscribers.add(ws);

        // Send current metrics immediately
        const metrics = this.getSystemMetrics();
        ws.send(JSON.stringify({ type: 'metrics', data: metrics }));

        ws.on('close', () => {
            this.subscribers.delete(ws);
        });
    }

    subscribeToRecordings(ws: any): void {
        // Send current active recordings
        const activeRecordings = Array.from(this.activeJobs.values());
        ws.send(JSON.stringify({ type: 'recordings', data: activeRecordings }));
    }

    private broadcastToSubscribers(type: string, data: any): void {
        const message = JSON.stringify({ type, data, timestamp: Date.now() });

        for (const ws of this.subscribers) {
            try {
                if (ws.readyState === 1) { // WebSocket.OPEN
                    ws.send(message);
                }
            } catch (error) {
                this.logger.error('Failed to send WebSocket message:', error);
                this.subscribers.delete(ws);
            }
        }
    }

    // STATE MANAGEMENT
    private async restoreState(): Promise<void> {
        try {
            // Restore room servers
            const roomServers = await this.database.getRoomServers();
            for (const roomServer of roomServers) {
                this.roomServers.set(roomServer.id, roomServer);
            }

            // Restore FFmpeg nodes
            const ffmpegNodes = await this.database.getFFmpegNodes();
            for (const ffmpegNode of ffmpegNodes) {
                this.ffmpegNodes.set(ffmpegNode.id, ffmpegNode);
            }

            // Restore active jobs
            const activeJobs = await this.database.getActiveRecordingJobs();
            for (const job of activeJobs) {
                this.activeJobs.set(job.jobId, job);
            }

            this.logger.info('State restored from database', {
                roomServers: this.roomServers.size,
                ffmpegNodes: this.ffmpegNodes.size,
                activeJobs: this.activeJobs.size
            });

        } catch (error) {
            this.logger.error('Failed to restore state:', error);
        }
    }

    // HEARTBEAT HANDLING
    async updateRoomServerHeartbeat(serverId: string, data: any): Promise<void> {
        const roomServer = this.roomServers.get(serverId);
        if (roomServer) {
            roomServer.lastHeartbeat = Date.now();
            roomServer.currentLoad = data.currentLoad || roomServer.currentLoad;
            roomServer.rooms = data.rooms || roomServer.rooms;
            roomServer.isHealthy = true;
        }
    }

    async updateFFmpegNodeHeartbeat(nodeId: string, data: any): Promise<void> {
        const ffmpegNode = this.ffmpegNodes.get(nodeId);
        if (ffmpegNode) {
            ffmpegNode.lastHeartbeat = Date.now();
            ffmpegNode.currentLoad = data.currentLoad || ffmpegNode.currentLoad;
            ffmpegNode.activeJobs = data.activeJobs || ffmpegNode.activeJobs;
            ffmpegNode.isHealthy = true;
        }
    }

    // CLEANUP
    async shutdown(): Promise<void> {
        this.logger.info('Shutting down Orchestration Service...');

        // Stop intervals
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }

        // Stop auto-scaling
        await this.autoScaling.stop();

        // Close WebSocket connections
        for (const ws of this.subscribers) {
            ws.close();
        }

        this.logger.info('Orchestration Service shut down');
    }
}