export interface RoomServerNode {
    id: string;
    url: string;
    region: string;
    rooms: string[];
    capacity: number;
    currentLoad: number;
    isHealthy: boolean;
    lastHeartbeat: number;
    specs: NodeSpecs;
    metadata?: Record<string, any>;
}

export interface FFmpegNode {
    id: string;
    url: string;
    region: string;
    capacity: number;
    currentLoad: number;
    isHealthy: boolean;
    lastHeartbeat: number;
    specs: NodeSpecs;
    supportedCodecs: string[];
    activeJobs: string[];
    metadata?: Record<string, any>;
}

export interface NodeSpecs {
    cpuCores: number;
    ram: number; // in bytes
    hasGPU: boolean;
    gpuMemory?: number;
    diskSpace: number;
    networkBandwidth?: number;
}

export interface DistributedRecordingJob {
    jobId: string;
    roomServerId: string;
    roomId: string;
    peerId: string;
    peerInfo: PeerInfo;
    ffmpegNodeId: string;
    rtpStreams: RTPStreamInfo[];
    rtpForwarding?: RTPForwardingConfig;
    options: RecordingOptions;
    status: JobStatus;
    startTime: number;
    endTime?: number;
    outputPath?: string;
    errorMessage?: string;
    requesterInfo: RequesterInfo;
    metrics?: JobMetrics;
}

export interface PeerInfo {
    peerId: string;
    displayName: string;
    isAuthenticated: boolean;
    roles: string[];
    joinTime: number;
    userAgent?: string;
    ip?: string;
    sessionId?: string;
}

export interface RTPStreamInfo {
    kind: 'audio' | 'video';
    port: number;
    payloadType: number;
    ssrc: number;
    codecName: string;
    clockRate?: number;
    channels?: number;
}

export interface RecordingOptions {
    quality: 'low' | 'medium' | 'high';
    format: 'mp4' | 'webm' | 'mkv';
    includeAudio: boolean;
    includeVideo: boolean;
    maxDuration?: number;
    customFFmpegArgs?: string[];
}

export interface RTPForwardingConfig {
    jobId: string;
    peerId: string;
    targetNode: {
        ip: string;
        ports: number[];
    };
    rtpStreams: RTPStreamInfo[];
}

export interface RequesterInfo {
    userId?: string;
    ip: string;
    userAgent?: string;
    timestamp: number;
}

export interface JobMetrics {
    processingTime?: number;
    outputFileSize?: number;
    averageFPS?: number;
    peakCPUUsage?: number;
    peakMemoryUsage?: number;
}

export interface SystemMetrics {
    totalRoomServers: number;
    healthyRoomServers: number;
    totalFFmpegNodes: number;
    healthyFFmpegNodes: number;
    activeRecordings: number;
    totalCapacity: number;
    currentLoad: number;
    queueLength: number;
    byRegion: Record<string, RegionMetrics>;
}

export interface RegionMetrics {
    roomServers: number;
    ffmpegNodes: number;
    activeRecordings: number;
    capacity: number;
    load: number;
    avgLoad: number;
}

export interface DistributedRecordingRequest {
    roomServerId: string;
    roomId: string;
    peerId: string;
    peerInfo: PeerInfo;
    rtpStreams: RTPStreamInfo[];
    options: RecordingOptions;
    requesterInfo: RequesterInfo;
}

export interface NodeRegistration {
    url: string;
    region: string;
    specs: NodeSpecs;
    metadata?: Record<string, any>;
}

export interface RoomServerRegistration extends NodeRegistration {
    serverId: string;
    rooms: string[];
    capacity: number;
}

export interface FFmpegNodeRegistration extends NodeRegistration {
    supportedCodecs: string[];
}

export interface RecordingRequirements {
    region: string;
    codecRequirements: string[];
    estimatedLoad: number;
    preferGPU?: boolean;
    minCPUCores?: number;
    minRAM?: number;
}

export interface AutoScalingConfig {
    enabled: boolean;
    minNodes: number;
    maxNodes: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    cooldownPeriod: number; // in seconds
}

export interface AlertConfig {
    webhookUrl?: string | undefined;
    emailRecipients?: string[] | undefined;
    slackChannel?: string | undefined;
}

export interface AppConfig {
    server: {
        port: number;
        host: string;
        environment: string;
    };
    database: {
        host: string;
        port: number;
        database: string;
        username: string;
        password: string;
        ssl: boolean;
        pool: {
            min: number;
            max: number;
        };
    };
    redis: {
        host: string;
        port: number;
        password?: string | undefined;
        db: number;
    };
    cors: {
        allowedOrigins: string[];
    };
    orchestration: {
        healthCheckInterval: number;
        nodeTimeoutMs: number;
        maxRetries: number;
        autoScaling: AutoScalingConfig;
    };
    recording: {
        defaultQuality: string;
        maxConcurrentPerNode: number;
        outputDirectory: string;
        cleanupAfterDays: number;
    };
    alerts: AlertConfig;
    monitoring: {
        metricsInterval: number;
        enableDetailedLogging: boolean;
    };
}


export type JobStatus = 'pending' | 'initializing' | 'recording' | 'completed' | 'failed' | 'cancelled';
export type NodeType = 'room-server' | 'ffmpeg-node';
export type EventType = 'node_registered' | 'node_failed' | 'recording_started' | 'recording_completed' | 'system_overload';