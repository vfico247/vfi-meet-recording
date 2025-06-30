import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { RoomServerNode, FFmpegNode } from '../types/interfaces';

export class NodeManager extends EventEmitter {
    private logger: Logger;
    private portAllocations: Map<string, Set<number>> = new Map();

    constructor() {
        super();
        this.logger = new Logger('NodeManager');
    }

    async initialize(): Promise<void> {
        this.logger.info('Node Manager initialized');
    }

    // PORT ALLOCATION MANAGEMENT
    async allocateRTPPorts(nodeId: string, count: number): Promise<number[]> {
        if (!this.portAllocations.has(nodeId)) {
            this.portAllocations.set(nodeId, new Set());
        }

        const allocatedPorts = this.portAllocations.get(nodeId)!;
        const newPorts: number[] = [];
        let currentPort = 5000; // Starting port

        while (newPorts.length < count && currentPort < 6000) {
            if (!allocatedPorts.has(currentPort)) {
                allocatedPorts.add(currentPort);
                newPorts.push(currentPort);
            }
            currentPort += 2; // RTP uses even ports, RTCP uses odd
        }

        if (newPorts.length < count) {
            throw new Error(`Could not allocate ${count} ports for node ${nodeId}`);
        }

        this.logger.debug(`Allocated ports for node ${nodeId}`, { ports: newPorts });
        return newPorts;
    }

    releasePorts(nodeId: string, ports: number[]): void {
        const allocatedPorts = this.portAllocations.get(nodeId);
        if (allocatedPorts) {
            ports.forEach(port => allocatedPorts.delete(port));
            this.logger.debug(`Released ports for node ${nodeId}`, { ports });
        }
    }

    // NODE HEALTH ASSESSMENT
    assessNodeHealth(node: RoomServerNode | FFmpegNode): {
        isHealthy: boolean;
        reasons: string[];
        score: number;
    } {
        const reasons: string[] = [];
        let score = 100;

        // Check heartbeat freshness
        const timeSinceHeartbeat = Date.now() - node.lastHeartbeat;
        if (timeSinceHeartbeat > 60000) { // 1 minute
            reasons.push('Stale heartbeat');
            score -= 30;
        } else if (timeSinceHeartbeat > 30000) { // 30 seconds
            reasons.push('Delayed heartbeat');
            score -= 10;
        }

        // Check load
        const loadPercentage = (node.currentLoad / node.capacity) * 100;
        if (loadPercentage > 90) {
            reasons.push('High load');
            score -= 20;
        } else if (loadPercentage > 80) {
            reasons.push('Moderate load');
            score -= 10;
        }

        // Check if explicitly marked unhealthy
        if (!node.isHealthy) {
            reasons.push('Marked unhealthy');
            score -= 50;
        }

        const isHealthy = score >= 50 && node.isHealthy;

        return { isHealthy, reasons, score };
    }

    // NODE PERFORMANCE METRICS
    calculateNodePerformance(node: FFmpegNode): {
        efficiency: number;
        reliability: number;
        performance: number;
    } {
        // This would typically use historical data
        const efficiency = Math.max(0, 100 - (node.currentLoad / node.capacity) * 100);
        const reliability = node.isHealthy ? 100 : 0;
        const performance = node.specs.hasGPU ? 100 : 80;

        return { efficiency, reliability, performance };
    }

    // NODE CAPABILITY ASSESSMENT
    assessNodeCapabilities(node: FFmpegNode, requirements: any): {
        canHandle: boolean;
        score: number;
        limitations: string[];
    } {
        const limitations: string[] = [];
        let score = 100;

        // Check codec support
        if (requirements.codecRequirements) {
            const unsupportedCodecs = requirements.codecRequirements.filter(
                (codec: string) => !node.supportedCodecs.includes(codec)
            );
            if (unsupportedCodecs.length > 0) {
                limitations.push(`Unsupported codecs: ${unsupportedCodecs.join(', ')}`);
                score -= 30;
            }
        }

        // Check hardware requirements
        if (requirements.preferGPU && !node.specs.hasGPU) {
            limitations.push('No GPU acceleration');
            score -= 20;
        }

        if (requirements.minCPUCores && node.specs.cpuCores < requirements.minCPUCores) {
            limitations.push('Insufficient CPU cores');
            score -= 25;
        }

        if (requirements.minRAM && node.specs.ram < requirements.minRAM) {
            limitations.push('Insufficient RAM');
            score -= 25;
        }

        // Check current load
        if (node.currentLoad >= node.capacity) {
            limitations.push('At capacity');
            score = 0;
        }

        const canHandle = score >= 50 && node.currentLoad < node.capacity;

        return { canHandle, score, limitations };
    }

    // NODE MAINTENANCE
    async performNodeMaintenance(nodeId: string, nodeType: 'room-server' | 'ffmpeg-node'): Promise<void> {
        this.logger.info(`Performing maintenance on ${nodeType} ${nodeId}`);

        // Release allocated ports
        if (this.portAllocations.has(nodeId)) {
            this.portAllocations.delete(nodeId);
        }

        // Emit maintenance event
        this.emit('nodeMaintenance', { nodeId, nodeType, timestamp: Date.now() });
    }

    // NODE DISCOVERY HELPERS
    extractNodeInfo(registrationData: any): any {
        return {
            capabilities: this.analyzeCapabilities(registrationData.specs),
            estimatedCapacity: this.estimateCapacity(registrationData.specs),
            qualityScore: this.calculateQualityScore(registrationData.specs),
            regionLatency: this.estimateRegionLatency(registrationData.region)
        };
    }

    private analyzeCapabilities(specs: any): string[] {
        const capabilities: string[] = [];

        if (specs.hasGPU) {
            capabilities.push('hardware-acceleration');
        }

        if (specs.cpuCores >= 8) {
            capabilities.push('high-cpu');
        }

        if (specs.ram >= 16 * 1024 * 1024 * 1024) { // 16GB
            capabilities.push('high-memory');
        }

        if (specs.networkBandwidth >= 1000) { // 1Gbps
            capabilities.push('high-bandwidth');
        }

        return capabilities;
    }

    private estimateCapacity(specs: any): number {
        let capacity = specs.cpuCores * 1.5;

        if (specs.hasGPU) {
            capacity *= 2;
        }

        const ramCapacity = Math.floor(specs.ram / (500 * 1024 * 1024));
        return Math.min(capacity, ramCapacity, 12);
    }

    private calculateQualityScore(specs: any): number {
        let score = 50; // Base score

        score += specs.cpuCores * 5;
        score += Math.min((specs.ram / (1024 * 1024 * 1024)), 32) * 2; // GB of RAM

        if (specs.hasGPU) {
            score += 20;
            if (specs.gpuMemory) {
                score += Math.min(specs.gpuMemory / 1024, 10); // GB of GPU memory
            }
        }

        if (specs.networkBandwidth) {
            score += Math.min(specs.networkBandwidth / 100, 10); // Network quality
        }

        return Math.min(score, 100);
    }

    private estimateRegionLatency(region: string): number {
        // This would typically use real latency measurements
        const latencyMap: Record<string, number> = {
            'us-east-1': 10,
            'us-west-1': 20,
            'eu-west-1': 30,
            'ap-southeast-1': 50,
            'default': 25
        };

        return latencyMap[region] || latencyMap['default'];
    }

    // CLEANUP OPERATIONS
    async cleanupNode(nodeId: string): Promise<void> {
        // Release ports
        this.releasePorts(nodeId, []);
        this.portAllocations.delete(nodeId);

        this.logger.info(`Cleaned up node ${nodeId}`);
    }

    getNodeStatistics(): any {
        return {
            totalPortAllocations: Array.from(this.portAllocations.values())
                .reduce((sum, ports) => sum + ports.size, 0),
            nodesWithAllocations: this.portAllocations.size,
            portsByNode: Object.fromEntries(
                Array.from(this.portAllocations.entries())
                    .map(([nodeId, ports]) => [nodeId, ports.size])
            )
        };
    }
}