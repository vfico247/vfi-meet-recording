import { NodeSpecs } from '../types/interfaces';
import { Logger } from '../utils/Logger';

export class FFmpegNodeModel {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('FFmpegNodeModel');
    }

    // Create new FFmpeg node instance
    create(data: {
        url: string;
        region: string;
        specs: NodeSpecs;
        supportedCodecs?: string[];
        metadata?: Record<string, any>;
    }) {
        const nodeId = this.generateNodeId(data.region);

        return {
            id: nodeId,
            url: data.url,
            region: data.region,
            capacity: this.calculateCapacity(data.specs),
            currentLoad: 0,
            isHealthy: true,
            lastHeartbeat: Date.now(),
            specs: data.specs,
            supportedCodecs: data.supportedCodecs || ['h264', 'vp8', 'opus'],
            activeJobs: [],
            metadata: data.metadata || {},
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    private generateNodeId(region: string): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 4);
        return `ffmpeg-${region}-${timestamp}-${random}`;
    }

    // Calculate node capacity based on specs
    private calculateCapacity(specs: NodeSpecs): number {
        let capacity = specs.cpuCores * 1.5; // 1.5 recordings per core

        if (specs.hasGPU) {
            capacity *= 2; // GPU can handle 2x more
        }

        // RAM constraint (500MB per recording)
        const ramCapacity = Math.floor(specs.ram / (500 * 1024 * 1024));

        // Return minimum of CPU and RAM capacity, max 12 per node
        return Math.min(capacity, ramCapacity, 12);
    }

    // Validate FFmpeg node data
    validate(data: any): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!data.url || typeof data.url !== 'string') {
            errors.push('url is required and must be a string');
        }

        if (!data.region || typeof data.region !== 'string') {
            errors.push('region is required and must be a string');
        }

        if (!data.specs || typeof data.specs !== 'object') {
            errors.push('specs is required and must be an object');
        } else {
            const specsErrors = this.validateSpecs(data.specs);
            errors.push(...specsErrors);
        }

        if (data.supportedCodecs && !Array.isArray(data.supportedCodecs)) {
            errors.push('supportedCodecs must be an array');
        }

        // Validate URL format
        try {
            new URL(data.url);
        } catch {
            errors.push('url must be a valid URL');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private validateSpecs(specs: any): string[] {
        const errors: string[] = [];

        if (!specs.cpuCores || typeof specs.cpuCores !== 'number' || specs.cpuCores <= 0) {
            errors.push('specs.cpuCores is required and must be a positive number');
        }

        if (!specs.ram || typeof specs.ram !== 'number' || specs.ram <= 0) {
            errors.push('specs.ram is required and must be a positive number');
        }

        if (specs.hasGPU !== undefined && typeof specs.hasGPU !== 'boolean') {
            errors.push('specs.hasGPU must be a boolean');
        }

        if (!specs.diskSpace || typeof specs.diskSpace !== 'number' || specs.diskSpace <= 0) {
            errors.push('specs.diskSpace is required and must be a positive number');
        }

        return errors;
    }

    // Update FFmpeg node properties
    update(ffmpegNode: any, updates: Partial<any>) {
        const updatedNode = {
            ...ffmpegNode,
            ...updates,
            updatedAt: Date.now()
        };

        // Log significant changes
        if (updates.isHealthy !== undefined && updates.isHealthy !== ffmpegNode.isHealthy) {
            this.logger.info(`FFmpeg node ${ffmpegNode.id} health changed`, {
                from: ffmpegNode.isHealthy,
                to: updates.isHealthy
            });
        }

        if (updates.currentLoad !== undefined && updates.currentLoad !== ffmpegNode.currentLoad) {
            this.logger.debug(`FFmpeg node ${ffmpegNode.id} load changed`, {
                from: ffmpegNode.currentLoad,
                to: updates.currentLoad,
                capacity: ffmpegNode.capacity
            });
        }

        return updatedNode;
    }

    // Add job to node
    addJob(ffmpegNode: any, jobId: string) {
        const updatedNode = {
            ...ffmpegNode,
            currentLoad: ffmpegNode.currentLoad + 1,
            activeJobs: [...ffmpegNode.activeJobs, jobId],
            updatedAt: Date.now()
        };

        this.logger.debug(`Job ${jobId} added to FFmpeg node ${ffmpegNode.id}`, {
            newLoad: updatedNode.currentLoad,
            capacity: ffmpegNode.capacity
        });

        return updatedNode;
    }

    // Remove job from node
    removeJob(ffmpegNode: any, jobId: string) {
        const updatedNode = {
            ...ffmpegNode,
            currentLoad: Math.max(0, ffmpegNode.currentLoad - 1),
            activeJobs: ffmpegNode.activeJobs.filter((id: string) => id !== jobId),
            updatedAt: Date.now()
        };

        this.logger.debug(`Job ${jobId} removed from FFmpeg node ${ffmpegNode.id}`, {
            newLoad: updatedNode.currentLoad,
            capacity: ffmpegNode.capacity
        });

        return updatedNode;
    }

    // Calculate node performance score
    calculatePerformanceScore(ffmpegNode: any): number {
        let score = 100;

        // Check heartbeat freshness
        const timeSinceHeartbeat = Date.now() - ffmpegNode.lastHeartbeat;
        if (timeSinceHeartbeat > 60000) {
            score -= 40;
        } else if (timeSinceHeartbeat > 30000) {
            score -= 20;
        }

        // Check load
        const loadPercentage = (ffmpegNode.currentLoad / ffmpegNode.capacity) * 100;
        if (loadPercentage > 90) {
            score -= 30;
        } else if (loadPercentage > 80) {
            score -= 15;
        }

        // Check health status
        if (!ffmpegNode.isHealthy) {
            score -= 50;
        }

        // Bonus for GPU
        if (ffmpegNode.specs.hasGPU) {
            score += 10;
        }

        return Math.max(0, score);
    }

    // Check codec support
    supportsCodecs(ffmpegNode: any, requiredCodecs: string[]): boolean {
        return requiredCodecs.every(codec =>
            ffmpegNode.supportedCodecs.includes(codec)
        );
    }

    // Get node capabilities
    getCapabilities(ffmpegNode: any) {
        return {
            hardware: {
                cpuCores: ffmpegNode.specs.cpuCores,
                ram: ffmpegNode.specs.ram,
                hasGPU: ffmpegNode.specs.hasGPU,
                gpuMemory: ffmpegNode.specs.gpuMemory,
                diskSpace: ffmpegNode.specs.diskSpace
            },
            encoding: {
                supportedCodecs: ffmpegNode.supportedCodecs,
                maxConcurrent: ffmpegNode.capacity,
                preferredFormats: ffmpegNode.specs.hasGPU ? ['h264', 'h265'] : ['h264', 'vp8']
            },
            performance: {
                score: this.calculatePerformanceScore(ffmpegNode),
                efficiency: this.calculateEfficiency(ffmpegNode),
                reliability: ffmpegNode.isHealthy ? 100 : 0
            }
        };
    }

    private calculateEfficiency(ffmpegNode: any): number {
        if (ffmpegNode.capacity === 0) return 0;

        const utilizationRate = (ffmpegNode.currentLoad / ffmpegNode.capacity) * 100;

        // Optimal utilization is around 70-80%
        if (utilizationRate >= 70 && utilizationRate <= 80) {
            return 100;
        } else if (utilizationRate < 70) {
            return 80 + (utilizationRate / 70) * 20;
        } else {
            return Math.max(50, 100 - (utilizationRate - 80) * 2);
        }
    }

    // Get node statistics
    getStatistics(ffmpegNode: any) {
        const loadPercentage = (ffmpegNode.currentLoad / ffmpegNode.capacity) * 100;

        return {
            id: ffmpegNode.id,
            region: ffmpegNode.region,
            load: {
                current: ffmpegNode.currentLoad,
                capacity: ffmpegNode.capacity,
                percentage: Math.round(loadPercentage),
                available: ffmpegNode.capacity - ffmpegNode.currentLoad
            },
            health: {
                isHealthy: ffmpegNode.isHealthy,
                score: this.calculatePerformanceScore(ffmpegNode),
                lastHeartbeat: ffmpegNode.lastHeartbeat,
                timeSinceHeartbeat: Date.now() - ffmpegNode.lastHeartbeat
            },
            jobs: {
                active: ffmpegNode.activeJobs.length,
                list: ffmpegNode.activeJobs
            },
            capabilities: this.getCapabilities(ffmpegNode),
            uptime: Date.now() - ffmpegNode.createdAt
        };
    }

    // Check if node can accept new job
    canAcceptJob(ffmpegNode: any, jobRequirements?: any): boolean {
        if (!ffmpegNode.isHealthy) return false;
        if (ffmpegNode.currentLoad >= ffmpegNode.capacity) return false;

        if (jobRequirements) {
            // Check codec support
            if (jobRequirements.codecs && !this.supportsCodecs(ffmpegNode, jobRequirements.codecs)) {
                return false;
            }

            // Check hardware requirements
            if (jobRequirements.requireGPU && !ffmpegNode.specs.hasGPU) {
                return false;
            }
        }

        return true;
    }
}