// src/models/RecordingJob.ts
import {
    DistributedRecordingJob,
    JobStatus,
    PeerInfo,
    RTPStreamInfo,
    RecordingOptions,
    RequesterInfo,
    JobMetrics
} from '../types/interfaces';
import { Logger } from '../utils/Logger';

export class RecordingJobModel {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('RecordingJobModel');
    }

    // Create new recording job
    create(data: {
        roomServerId: string;
        roomId: string;
        peerId: string;
        peerInfo: PeerInfo;
        rtpStreams: RTPStreamInfo[];
        options: RecordingOptions;
        requesterInfo: RequesterInfo;
    }): DistributedRecordingJob {
        const jobId = this.generateJobId();

        const job: DistributedRecordingJob = {
            jobId,
            roomServerId: data.roomServerId,
            roomId: data.roomId,
            peerId: data.peerId,
            peerInfo: data.peerInfo,
            ffmpegNodeId: '', // Will be assigned later
            rtpStreams: data.rtpStreams,
            options: {
                quality: data.options.quality || 'medium',
                format: data.options.format || 'mp4',
                includeAudio: data.options.includeAudio !== false,
                includeVideo: data.options.includeVideo !== false,
                ...(data.options.maxDuration && { maxDuration: data.options.maxDuration }),
                ...(data.options.customFFmpegArgs && { customFFmpegArgs: data.options.customFFmpegArgs })
            },
            status: 'pending',
            startTime: Date.now(),
            requesterInfo: data.requesterInfo
        };

        this.logger.info('Recording job created', {
            jobId: job.jobId,
            peerId: job.peerId,
            peerName: job.peerInfo.displayName,
            roomId: job.roomId,
            streamCount: job.rtpStreams.length
        });

        return job;
    }

    // Generate unique job ID
    private generateJobId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 8);
        return `rec-${timestamp}-${random}`;
    }

    // Create job from API request
    createFromRequest(request: any): DistributedRecordingJob {
        const validation = this.validate(request);
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        return this.create({
            roomServerId: request.roomServerId,
            roomId: request.roomId,
            peerId: request.peerId,
            peerInfo: request.peerInfo,
            rtpStreams: request.rtpStreams,
            options: request.options || {},
            requesterInfo: request.requesterInfo
        });
    }

    // Comprehensive validation
    validate(data: any): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Basic required fields
        if (!data.roomServerId || typeof data.roomServerId !== 'string') {
            errors.push('roomServerId is required and must be a string');
        }

        if (!data.roomId || typeof data.roomId !== 'string') {
            errors.push('roomId is required and must be a string');
        }

        if (!data.peerId || typeof data.peerId !== 'string') {
            errors.push('peerId is required and must be a string');
        }

        // Validate peer info
        if (!data.peerInfo || typeof data.peerInfo !== 'object') {
            errors.push('peerInfo is required and must be an object');
        } else {
            const peerInfoErrors = this.validatePeerInfo(data.peerInfo);
            errors.push(...peerInfoErrors);
        }

        // Validate RTP streams
        if (!data.rtpStreams || !Array.isArray(data.rtpStreams) || data.rtpStreams.length === 0) {
            errors.push('rtpStreams is required and must be a non-empty array');
        } else {
            const rtpStreamErrors = this.validateRtpStreams(data.rtpStreams);
            errors.push(...rtpStreamErrors);
        }

        // Validate options
        if (data.options && typeof data.options === 'object') {
            const optionsErrors = this.validateOptions(data.options);
            errors.push(...optionsErrors);
        }

        // Validate requester info
        if (!data.requesterInfo || typeof data.requesterInfo !== 'object') {
            errors.push('requesterInfo is required and must be an object');
        } else {
            if (!data.requesterInfo.ip || typeof data.requesterInfo.ip !== 'string') {
                errors.push('requesterInfo.ip is required and must be a string');
            }
            if (!data.requesterInfo.timestamp || typeof data.requesterInfo.timestamp !== 'number') {
                errors.push('requesterInfo.timestamp is required and must be a number');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private validatePeerInfo(peerInfo: any): string[] {
        const errors: string[] = [];

        if (!peerInfo.peerId || typeof peerInfo.peerId !== 'string') {
            errors.push('peerInfo.peerId is required and must be a string');
        }

        if (peerInfo.displayName !== undefined && typeof peerInfo.displayName !== 'string') {
            errors.push('peerInfo.displayName must be a string');
        }

        if (peerInfo.isAuthenticated !== undefined && typeof peerInfo.isAuthenticated !== 'boolean') {
            errors.push('peerInfo.isAuthenticated must be a boolean');
        }

        if (peerInfo.roles !== undefined && !Array.isArray(peerInfo.roles)) {
            errors.push('peerInfo.roles must be an array');
        }

        if (!peerInfo.joinTime || typeof peerInfo.joinTime !== 'number') {
            errors.push('peerInfo.joinTime is required and must be a number');
        }

        return errors;
    }

    private validateRtpStreams(rtpStreams: any[]): string[] {
        const errors: string[] = [];

        rtpStreams.forEach((stream, index) => {
            if (!stream.kind || !['audio', 'video'].includes(stream.kind)) {
                errors.push(`rtpStreams[${index}].kind must be 'audio' or 'video'`);
            }

            if (!stream.port || typeof stream.port !== 'number' || stream.port <= 0 || stream.port > 65535) {
                errors.push(`rtpStreams[${index}].port must be a valid port number (1-65535)`);
            }

            if (stream.payloadType === undefined || typeof stream.payloadType !== 'number' ||
                stream.payloadType < 0 || stream.payloadType > 127) {
                errors.push(`rtpStreams[${index}].payloadType must be a number between 0-127`);
            }

            if (stream.ssrc === undefined || typeof stream.ssrc !== 'number' || stream.ssrc < 0) {
                errors.push(`rtpStreams[${index}].ssrc must be a positive number`);
            }

            if (!stream.codecName || typeof stream.codecName !== 'string') {
                errors.push(`rtpStreams[${index}].codecName is required and must be a string`);
            }

            // Validate codec names
            const validCodecs = ['h264', 'h265', 'vp8', 'vp9', 'opus', 'aac', 'pcmu', 'pcma'];
            if (stream.codecName && !validCodecs.includes(stream.codecName.toLowerCase())) {
                errors.push(`rtpStreams[${index}].codecName '${stream.codecName}' is not supported`);
            }
        });

        // Check for duplicate ports
        const ports = rtpStreams.map(s => s.port);
        const uniquePorts = new Set(ports);
        if (ports.length !== uniquePorts.size) {
            errors.push('rtpStreams cannot have duplicate ports');
        }

        return errors;
    }

    private validateOptions(options: any): string[] {
        const errors: string[] = [];

        if (options.quality && !['low', 'medium', 'high'].includes(options.quality)) {
            errors.push('options.quality must be one of: low, medium, high');
        }

        if (options.format && !['mp4', 'webm', 'mkv'].includes(options.format)) {
            errors.push('options.format must be one of: mp4, webm, mkv');
        }

        if (options.includeAudio !== undefined && typeof options.includeAudio !== 'boolean') {
            errors.push('options.includeAudio must be a boolean');
        }

        if (options.includeVideo !== undefined && typeof options.includeVideo !== 'boolean') {
            errors.push('options.includeVideo must be a boolean');
        }

        if (options.maxDuration !== undefined &&
            (typeof options.maxDuration !== 'number' || options.maxDuration <= 0 || options.maxDuration > 7200000)) {
            errors.push('options.maxDuration must be a positive number (max 2 hours)');
        }

        if (options.customFFmpegArgs !== undefined && !Array.isArray(options.customFFmpegArgs)) {
            errors.push('options.customFFmpegArgs must be an array');
        }

        // Validate that at least audio or video is included
        if (options.includeAudio === false && options.includeVideo === false) {
            errors.push('At least one of includeAudio or includeVideo must be true');
        }

        return errors;
    }

    // Update job status with validation
    updateStatus(job: DistributedRecordingJob, newStatus: JobStatus, additionalData?: Partial<DistributedRecordingJob>): DistributedRecordingJob {
        // Validate status transition
        if (!this.isValidStatusTransition(job.status, newStatus)) {
            throw new Error(`Invalid status transition from ${job.status} to ${newStatus}`);
        }

        const updatedJob: DistributedRecordingJob = {
            ...job,
            status: newStatus,
            ...additionalData
        };

        // Set end time for terminal statuses
        if (['completed', 'failed', 'cancelled'].includes(newStatus) && !updatedJob.endTime) {
            updatedJob.endTime = Date.now();
        }

        // Log status change
        this.logger.info(`Job ${job.jobId} status changed`, {
            from: job.status,
            to: newStatus,
            peerId: job.peerId,
            peerName: job.peerInfo.displayName,
            duration: updatedJob.endTime ? updatedJob.endTime - job.startTime : undefined,
            errorMessage: updatedJob.errorMessage
        });

        return updatedJob;
    }

    // Validate status transitions
    private isValidStatusTransition(currentStatus: JobStatus, newStatus: JobStatus): boolean {
        const validTransitions: Record<JobStatus, JobStatus[]> = {
            'pending': ['initializing', 'failed', 'cancelled'],
            'initializing': ['recording', 'failed', 'cancelled'],
            'recording': ['completed', 'failed', 'cancelled'],
            'completed': [], // Terminal state
            'failed': [], // Terminal state
            'cancelled': [] // Terminal state
        };

        return validTransitions[currentStatus]?.includes(newStatus) || false;
    }

    // Job state checks
    isActive(job: DistributedRecordingJob): boolean {
        return ['pending', 'initializing', 'recording'].includes(job.status);
    }

    isTerminal(job: DistributedRecordingJob): boolean {
        return ['completed', 'failed', 'cancelled'].includes(job.status);
    }

    isPending(job: DistributedRecordingJob): boolean {
        return job.status === 'pending';
    }

    isRecording(job: DistributedRecordingJob): boolean {
        return job.status === 'recording';
    }

    isSuccessful(job: DistributedRecordingJob): boolean {
        return job.status === 'completed';
    }

    isFailed(job: DistributedRecordingJob): boolean {
        return job.status === 'failed';
    }

    // Duration calculations
    getDuration(job: DistributedRecordingJob): number {
        const endTime = job.endTime || Date.now();
        return endTime - job.startTime;
    }

    getEstimatedRemainingTime(job: DistributedRecordingJob): number | null {
        if (!job.options.maxDuration || this.isTerminal(job)) {
            return null;
        }

        const elapsed = this.getDuration(job);
        return Math.max(0, job.options.maxDuration - elapsed);
    }

    // Timeout checks
    hasTimedOut(job: DistributedRecordingJob, timeoutMs: number = 3600000): boolean {
        if (!this.isActive(job)) return false;

        const duration = this.getDuration(job);
        return duration > timeoutMs;
    }

    hasExceededMaxDuration(job: DistributedRecordingJob): boolean {
        if (!job.options.maxDuration || this.isTerminal(job)) return false;

        const duration = this.getDuration(job);
        return duration > job.options.maxDuration;
    }

    // Priority calculation for queue processing
    getPriority(job: DistributedRecordingJob): number {
        let priority = 50; // Base priority

        // Higher priority for authenticated users
        if (job.peerInfo.isAuthenticated) {
            priority += 20;
        }

        // Higher priority for moderators
        if (job.peerInfo.roles.includes('moderator')) {
            priority += 30;
        }

        // Higher priority for presenters
        if (job.peerInfo.roles.includes('presenter')) {
            priority += 15;
        }

        // Lower priority for older jobs (to prevent starvation)
        const age = Date.now() - job.startTime;
        if (age > 300000) { // 5 minutes
            priority += Math.min(20, Math.floor(age / 300000) * 5);
        }

        // Higher priority for simpler jobs (fewer streams)
        if (job.rtpStreams.length === 1) {
            priority += 10;
        } else if (job.rtpStreams.length > 3) {
            priority -= 5;
        }

        // Lower priority for high quality (resource intensive)
        if (job.options.quality === 'high') {
            priority -= 10;
        } else if (job.options.quality === 'low') {
            priority += 5;
        }

        return Math.max(0, Math.min(100, priority));
    }

    // Resource estimation
    estimateResourceRequirements(job: DistributedRecordingJob) {
        let cpuLoad = 1; // Base load
        let memoryMB = 200; // Base memory
        let networkMbps = 1; // Base network

        // Video streams require more resources
        const videoStreams = job.rtpStreams.filter(s => s.kind === 'video');
        cpuLoad += videoStreams.length * 1.5;
        memoryMB += videoStreams.length * 300;
        networkMbps += videoStreams.length * 2;

        // Audio streams
        const audioStreams = job.rtpStreams.filter(s => s.kind === 'audio');
        cpuLoad += audioStreams.length * 0.3;
        memoryMB += audioStreams.length * 50;
        networkMbps += audioStreams.length * 0.1;

        // Quality impact
        const qualityMultipliers = {
            high: { cpu: 1.8, memory: 1.5, network: 1.8 },
            medium: { cpu: 1.2, memory: 1.2, network: 1.2 },
            low: { cpu: 0.8, memory: 0.9, network: 0.8 }
        };

        const multiplier = qualityMultipliers[job.options.quality || 'medium'];
        cpuLoad *= multiplier.cpu;
        memoryMB *= multiplier.memory;
        networkMbps *= multiplier.network;

        // Format impact
        if (job.options.format === 'webm') {
            cpuLoad *= 1.1; // VP8/VP9 encoding is slightly more intensive
        }

        return {
            cpuLoad: Math.round(cpuLoad * 100) / 100,
            memoryMB: Math.round(memoryMB),
            networkMbps: Math.round(networkMbps * 100) / 100,
            estimatedDuration: job.options.maxDuration || 3600000, // 1 hour default
            diskSpaceMB: this.estimateDiskUsage(job),
            requiresGPU: job.options.quality === 'high' && videoStreams.length > 0
        };
    }

    private estimateDiskUsage(job: DistributedRecordingJob): number {
        const durationMinutes = (job.options.maxDuration || 3600000) / 60000;

        // Size per minute based on quality and streams
        const qualitySizes = { high: 3, medium: 1.5, low: 0.8 }; // MB per minute
        const baseSizePerMinute = qualitySizes[job.options.quality || 'medium'];

        // Stream count multiplier
        const videoStreams = job.rtpStreams.filter(s => s.kind === 'video').length;
        const audioStreams = job.rtpStreams.filter(s => s.kind === 'audio').length;
        const streamMultiplier = (videoStreams * 1.0) + (audioStreams * 0.1);

        return Math.round(durationMinutes * baseSizePerMinute * Math.max(1, streamMultiplier));
    }

    // Filename generation
    generateFilename(job: DistributedRecordingJob): string {
        const timestamp = new Date(job.startTime).toISOString().replace(/[:.]/g, '-');
        const userType = job.peerInfo.isAuthenticated ? 'user' : 'guest';
        const safeName = (job.peerInfo.displayName || 'unknown')
            .replace(/[^a-zA-Z0-9\-_]/g, '_')
            .substring(0, 20);
        const format = job.options.format || 'mp4';

        return `${timestamp}_${userType}_${safeName}_${job.peerId.slice(-8)}_${job.jobId.slice(-8)}.${format}`;
    }

    // Status descriptions
    getStatusDescription(job: DistributedRecordingJob): string {
        const statusDescriptions = {
            pending: 'Waiting for available FFmpeg node',
            initializing: 'Setting up recording infrastructure',
            recording: 'Recording in progress',
            completed: 'Recording completed successfully',
            failed: `Recording failed: ${job.errorMessage || 'Unknown error'}`,
            cancelled: 'Recording was cancelled by user request'
        };

        return statusDescriptions[job.status] || 'Unknown status';
    }

    // Statistics and summaries
    getStatistics(job: DistributedRecordingJob) {
        const duration = this.getDuration(job);
        const isCompleted = this.isTerminal(job);
        const resources = this.estimateResourceRequirements(job);

        return {
            jobId: job.jobId,
            peer: {
                id: job.peerId,
                name: job.peerInfo.displayName || 'Unknown',
                authenticated: job.peerInfo.isAuthenticated,
                roles: job.peerInfo.roles
            },
            room: {
                serverId: job.roomServerId,
                roomId: job.roomId
            },
            recording: {
                status: job.status,
                statusDescription: this.getStatusDescription(job),
                duration,
                durationFormatted: this.formatDuration(duration),
                startTime: job.startTime,
                endTime: job.endTime,
                isCompleted,
                isActive: this.isActive(job),
                outputPath: job.outputPath,
                estimatedSize: resources.diskSpaceMB
            },
            streams: {
                count: job.rtpStreams.length,
                audio: job.rtpStreams.filter(s => s.kind === 'audio').length,
                video: job.rtpStreams.filter(s => s.kind === 'video').length,
                codecs: [...new Set(job.rtpStreams.map(s => s.codecName))]
            },
            options: job.options,
            node: {
                ffmpegNodeId: job.ffmpegNodeId || null,
                assigned: !!job.ffmpegNodeId
            },
            priority: this.getPriority(job),
            resources,
            error: job.errorMessage || null,
            metrics: job.metrics || null
        };
    }

    getSummary(job: DistributedRecordingJob): string {
        const duration = this.getDuration(job);
        const durationStr = this.formatDuration(duration);
        const peerName = job.peerInfo.displayName || job.peerId.slice(-8);

        return `Job ${job.jobId.slice(-8)}: ${peerName} (${job.status}) - ${durationStr}`;
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // Metrics for multiple jobs
    getMetrics(jobs: DistributedRecordingJob[]) {
        const activeJobs = jobs.filter(job => this.isActive(job));
        const completedJobs = jobs.filter(job => job.status === 'completed');
        const failedJobs = jobs.filter(job => job.status === 'failed');

        const totalDuration = completedJobs.reduce((sum, job) => sum + this.getDuration(job), 0);
        const avgDuration = completedJobs.length > 0 ? totalDuration / completedJobs.length : 0;

        const totalJobs = completedJobs.length + failedJobs.length;
        const successRate = totalJobs > 0 ? (completedJobs.length / totalJobs) * 100 : 0;

        return {
            overview: {
                total: jobs.length,
                active: activeJobs.length,
                completed: completedJobs.length,
                failed: failedJobs.length,
                cancelled: jobs.filter(job => job.status === 'cancelled').length,
                successRate: Math.round(successRate * 100) / 100,
                averageDuration: Math.round(avgDuration)
            },
            byStatus: {
                pending: jobs.filter(job => job.status === 'pending').length,
                initializing: jobs.filter(job => job.status === 'initializing').length,
                recording: jobs.filter(job => job.status === 'recording').length,
                completed: completedJobs.length,
                failed: failedJobs.length,
                cancelled: jobs.filter(job => job.status === 'cancelled').length
            },
            byQuality: {
                low: jobs.filter(job => job.options.quality === 'low').length,
                medium: jobs.filter(job => job.options.quality === 'medium').length,
                high: jobs.filter(job => job.options.quality === 'high').length
            },
            byFormat: {
                mp4: jobs.filter(job => job.options.format === 'mp4').length,
                webm: jobs.filter(job => job.options.format === 'webm').length,
                mkv: jobs.filter(job => job.options.format === 'mkv').length
            },
            byUserType: {
                authenticated: jobs.filter(job => job.peerInfo.isAuthenticated).length,
                guest: jobs.filter(job => !job.peerInfo.isAuthenticated).length
            },
            performance: {
                avgSuccessfulDuration: avgDuration,
                totalRecordingTime: totalDuration,
                longestRecording: Math.max(...completedJobs.map(job => this.getDuration(job)), 0),
                shortestRecording: completedJobs.length > 0 ?
                    Math.min(...completedJobs.map(job => this.getDuration(job))) : 0
            }
        };
    }

    // Cleanup utilities
    getJobsForCleanup(jobs: DistributedRecordingJob[], maxAgeMs: number = 24 * 60 * 60 * 1000): DistributedRecordingJob[] {
        const cutoffTime = Date.now() - maxAgeMs;

        return jobs.filter(job =>
            this.isTerminal(job) &&
            (job.endTime || job.startTime) < cutoffTime
        );
    }

    getTimedOutJobs(jobs: DistributedRecordingJob[], timeoutMs: number = 3600000): DistributedRecordingJob[] {
        return jobs.filter(job => this.hasTimedOut(job, timeoutMs));
    }

    // Export for external systems
    exportJobData(job: DistributedRecordingJob) {
        return {
            jobId: job.jobId,
            metadata: {
                roomId: job.roomId,
                roomServerId: job.roomServerId,
                ffmpegNodeId: job.ffmpegNodeId,
                startTime: new Date(job.startTime).toISOString(),
                endTime: job.endTime ? new Date(job.endTime).toISOString() : null,
                duration: this.getDuration(job),
                filename: this.generateFilename(job)
            },
            peer: {
                id: job.peerId,
                displayName: job.peerInfo.displayName,
                isAuthenticated: job.peerInfo.isAuthenticated,
                roles: job.peerInfo.roles,
                joinTime: new Date(job.peerInfo.joinTime).toISOString()
            },
            recording: {
                status: job.status,
                statusDescription: this.getStatusDescription(job),
                options: job.options,
                outputPath: job.outputPath,
                errorMessage: job.errorMessage
            },
            streams: job.rtpStreams.map(stream => ({
                kind: stream.kind,
                codecName: stream.codecName,
                payloadType: stream.payloadType,
                port: stream.port,
                ssrc: stream.ssrc
            })),
            requester: {
                ip: job.requesterInfo.ip,
                userAgent: job.requesterInfo.userAgent,
                timestamp: new Date(job.requesterInfo.timestamp).toISOString()
            },
            metrics: job.metrics,
            resourceEstimates: this.estimateResourceRequirements(job)
        };
    }

    // Batch operations
    updateMultipleJobs(jobs: DistributedRecordingJob[], updates: Partial<DistributedRecordingJob>): DistributedRecordingJob[] {
        return jobs.map(job => ({
            ...job,
            ...updates
        }));
    }

    filterJobsByStatus(jobs: DistributedRecordingJob[], statuses: JobStatus[]): DistributedRecordingJob[] {
        return jobs.filter(job => statuses.includes(job.status));
    }

    filterJobsByPeer(jobs: DistributedRecordingJob[], peerId: string): DistributedRecordingJob[] {
        return jobs.filter(job => job.peerId === peerId);
    }

    filterJobsByRoom(jobs: DistributedRecordingJob[], roomId: string): DistributedRecordingJob[] {
        return jobs.filter(job => job.roomId === roomId);
    }

    filterJobsByNode(jobs: DistributedRecordingJob[], nodeId: string): DistributedRecordingJob[] {
        return jobs.filter(job => job.ffmpegNodeId === nodeId);
    }

    sortJobsByPriority(jobs: DistributedRecordingJob[]): DistributedRecordingJob[] {
        return jobs.sort((a, b) => this.getPriority(b) - this.getPriority(a));
    }

    sortJobsByStartTime(jobs: DistributedRecordingJob[], ascending: boolean = true): DistributedRecordingJob[] {
        return jobs.sort((a, b) =>
            ascending ? a.startTime - b.startTime : b.startTime - a.startTime
        );
    }
}