// src/services/LoadBalancerService.ts
import { Logger } from '../utils/Logger';
import { FFmpegNode, RoomServerNode, RecordingRequirements } from '../types/interfaces';

interface RegionData {
    nodes: number;
    totalLoad: number;
    totalCapacity: number;
    loadPercentage?: number;
}

export class LoadBalancerService {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('LoadBalancerService');
    }

    async selectOptimalFFmpegNode(
        availableNodes: FFmpegNode[],
        requirements: RecordingRequirements
    ): Promise<FFmpegNode | null> {

        this.logger.debug('Selecting optimal FFmpeg node', {
            availableNodes: availableNodes.length,
            requirements
        });

        // Filter by availability
        const healthyNodes = availableNodes.filter(node =>
            node.isHealthy && node.currentLoad < node.capacity
        );

        if (healthyNodes.length === 0) {
            this.logger.warn('No healthy FFmpeg nodes available');
            return null;
        }

        // Filter by region preference
        const preferredRegionNodes = healthyNodes.filter(node =>
            node.region === requirements.region
        );

        const candidateNodes = preferredRegionNodes.length > 0 ?
            preferredRegionNodes : healthyNodes;

        // Filter by codec support
        const codecCompatibleNodes = candidateNodes.filter(node =>
            requirements.codecRequirements.every(codec =>
                node.supportedCodecs.includes(codec)
            )
        );

        const finalCandidates = codecCompatibleNodes.length > 0 ?
            codecCompatibleNodes : candidateNodes;

        // Filter by hardware requirements
        let hardwareFilteredNodes = finalCandidates;
        if (requirements.preferGPU) {
            const gpuNodes = finalCandidates.filter(node => node.specs.hasGPU);
            if (gpuNodes.length > 0) {
                hardwareFilteredNodes = gpuNodes;
            }
        }

        if (requirements.minCPUCores) {
            hardwareFilteredNodes = hardwareFilteredNodes.filter(node =>
                node.specs.cpuCores >= requirements.minCPUCores!
            );
        }

        if (requirements.minRAM) {
            hardwareFilteredNodes = hardwareFilteredNodes.filter(node =>
                node.specs.ram >= requirements.minRAM!
            );
        }

        // Score and select
        const scoredNodes = hardwareFilteredNodes.map(node => ({
            node,
            score: this.calculateNodeScore(node, requirements)
        }));

        if (scoredNodes.length === 0) {
            this.logger.warn('No nodes meet hardware requirements');
            return null;
        }

        scoredNodes.sort((a, b) => b.score - a.score);

        const selectedNode = scoredNodes[0].node;

        this.logger.info('FFmpeg node selected', {
            nodeId: selectedNode.id,
            score: scoredNodes[0].score,
            region: selectedNode.region,
            currentLoad: selectedNode.currentLoad,
            capacity: selectedNode.capacity
        });

        return selectedNode;
    }

    private calculateNodeScore(node: FFmpegNode, requirements: RecordingRequirements): number {
        let score = 0;

        // Capacity score (40% weight)
        const capacityScore = ((node.capacity - node.currentLoad) / node.capacity) * 40;
        score += capacityScore;

        // Region match bonus (25% weight)
        if (node.region === requirements.region) {
            score += 25;
        } else {
            // Penalty for cross-region
            score -= 10;
        }

        // Hardware score (20% weight)
        if (node.specs.hasGPU && requirements.estimatedLoad > 2) {
            score += 20;
        } else if (!node.specs.hasGPU && requirements.estimatedLoad <= 1) {
            score += 10; // CPU nodes better for light loads
        }

        // CPU cores bonus (10% weight)
        const cpuBonus = Math.min(node.specs.cpuCores * 2, 10);
        score += cpuBonus;

        // Load penalty (5% weight)
        const loadPenalty = (node.currentLoad / node.capacity) * 5;
        score -= loadPenalty;

        // Codec compatibility bonus
        const codecMatch = requirements.codecRequirements.every(codec =>
            node.supportedCodecs.includes(codec)
        );
        if (codecMatch) {
            score += 5;
        }

        return Math.max(score, 0);
    }

    selectOptimalRoomServer(
        roomServers: RoomServerNode[],
        roomId?: string
    ): RoomServerNode | null {

        const availableServers = roomServers.filter(server =>
            server.isHealthy && server.currentLoad < server.capacity
        );

        if (availableServers.length === 0) {
            this.logger.warn('No available room servers');
            return null;
        }

        // If room ID provided, check if any server already hosts it
        if (roomId) {
            const existingServer = availableServers.find(server =>
                server.rooms.includes(roomId)
            );
            if (existingServer) {
                this.logger.info('Room server selected (existing room)', {
                    serverId: existingServer.id,
                    roomId
                });
                return existingServer;
            }
        }

        // Select least loaded server
        const selectedServer = availableServers.reduce((least, current) => {
            const leastLoadPercent = least.currentLoad / least.capacity;
            const currentLoadPercent = current.currentLoad / current.capacity;
            return currentLoadPercent < leastLoadPercent ? current : least;
        });

        this.logger.info('Room server selected (load balancing)', {
            serverId: selectedServer.id,
            currentLoad: selectedServer.currentLoad,
            capacity: selectedServer.capacity
        });

        return selectedServer;
    }

    // Calculate optimal distribution of jobs across nodes
    calculateOptimalDistribution(
        jobs: any[],
        nodes: FFmpegNode[]
    ): Map<string, string[]> {
        const distribution = new Map<string, string[]>();
        const nodeLoads = new Map<string, number>();

        // Initialize
        for (const node of nodes) {
            distribution.set(node.id, []);
            nodeLoads.set(node.id, node.currentLoad);
        }

        // Sort jobs by estimated load (heaviest first)
        const sortedJobs = jobs.sort((a, b) =>
            this.estimateJobLoad(b) - this.estimateJobLoad(a)
        );

        // Assign jobs using greedy algorithm
        for (const job of sortedJobs) {
            let bestNode: FFmpegNode | null = null;
            let lowestLoad = Infinity;

            for (const node of nodes) {
                const currentLoad = nodeLoads.get(node.id) || 0;
                const loadPercentage = currentLoad / node.capacity;

                if (currentLoad < node.capacity && loadPercentage < lowestLoad) {
                    bestNode = node;
                    lowestLoad = loadPercentage;
                }
            }

            if (bestNode) {
                distribution.get(bestNode.id)!.push(job.jobId);
                nodeLoads.set(bestNode.id, nodeLoads.get(bestNode.id)! + 1);
            }
        }

        return distribution;
    }

    private estimateJobLoad(job: any): number {
        let load = 1; // Base load

        if (job.rtpStreams?.some((s: any) => s.kind === 'video')) {
            const quality = job.options?.quality || 'medium';
            load += quality === 'high' ? 2 : quality === 'medium' ? 1 : 0.5;
        }

        return load;
    }

    // Get load balancing statistics
    getLoadBalancingStats(nodes: FFmpegNode[]): any {
        const stats = {
            totalNodes: nodes.length,
            healthyNodes: nodes.filter(n => n.isHealthy).length,
            totalCapacity: nodes.reduce((sum, node) => sum + node.capacity, 0),
            totalLoad: nodes.reduce((sum, node) => sum + node.currentLoad, 0),
            averageLoadPercentage: 0,
            nodeDistribution: {} as Record<string, any>,
            regionDistribution: {} as Record<string, RegionData>
        };

        // Calculate average load percentage
        if (stats.totalCapacity > 0) {
            stats.averageLoadPercentage = (stats.totalLoad / stats.totalCapacity) * 100;
        }

        // Node distribution
        for (const node of nodes) {
            const loadPercentage = (node.currentLoad / node.capacity) * 100;
            stats.nodeDistribution[node.id] = {
                load: node.currentLoad,
                capacity: node.capacity,
                loadPercentage: Math.round(loadPercentage),
                region: node.region,
                hasGPU: node.specs.hasGPU
            };
        }

        // Region distribution - FIXED TYPE ISSUE
        const regionGroups: Record<string, RegionData> = {};

        for (const node of nodes) {
            if (!regionGroups[node.region]) {
                regionGroups[node.region] = {
                    nodes: 0,
                    totalLoad: 0,
                    totalCapacity: 0
                };
            }
            regionGroups[node.region].nodes++;
            regionGroups[node.region].totalLoad += node.currentLoad;
            regionGroups[node.region].totalCapacity += node.capacity;
        }

        // Fixed: Properly typed Object.entries iteration
        for (const [region, data] of Object.entries(regionGroups)) {
            stats.regionDistribution[region] = {
                ...data,
                loadPercentage: data.totalCapacity > 0 ?
                    Math.round((data.totalLoad / data.totalCapacity) * 100) : 0
            };
        }

        return stats;
    }

    // Advanced load balancing strategies
    selectNodeWithStrategy(
        nodes: FFmpegNode[],
        strategy: 'round_robin' | 'least_connections' | 'weighted_least_connections' | 'resource_based' = 'least_connections'
    ): FFmpegNode | null {

        const healthyNodes = nodes.filter(node =>
            node.isHealthy && node.currentLoad < node.capacity
        );

        if (healthyNodes.length === 0) return null;

        switch (strategy) {
            case 'round_robin':
                return this.selectRoundRobin(healthyNodes);

            case 'least_connections':
                return this.selectLeastConnections(healthyNodes);

            case 'weighted_least_connections':
                return this.selectWeightedLeastConnections(healthyNodes);

            case 'resource_based':
                return this.selectResourceBased(healthyNodes);

            default:
                return this.selectLeastConnections(healthyNodes);
        }
    }

    private selectRoundRobin(nodes: FFmpegNode[]): FFmpegNode {
        // Simple round-robin based on node ID hash
        const sortedNodes = nodes.sort((a, b) => a.id.localeCompare(b.id));
        const index = Date.now() % sortedNodes.length;
        return sortedNodes[index];
    }

    private selectLeastConnections(nodes: FFmpegNode[]): FFmpegNode {
        return nodes.reduce((least, current) =>
            current.currentLoad < least.currentLoad ? current : least
        );
    }

    private selectWeightedLeastConnections(nodes: FFmpegNode[]): FFmpegNode {
        return nodes.reduce((best, current) => {
            const bestRatio = best.currentLoad / best.capacity;
            const currentRatio = current.currentLoad / current.capacity;
            return currentRatio < bestRatio ? current : best;
        });
    }

    private selectResourceBased(nodes: FFmpegNode[]): FFmpegNode {
        // Score based on CPU, memory, and current load
        const scoredNodes = nodes.map(node => ({
            node,
            score: this.calculateResourceScore(node)
        }));

        scoredNodes.sort((a, b) => b.score - a.score);
        return scoredNodes[0].node;
    }

    private calculateResourceScore(node: FFmpegNode): number {
        const loadRatio = node.currentLoad / node.capacity;
        const cpuScore = node.specs.cpuCores * 10;
        const gpuBonus = node.specs.hasGPU ? 50 : 0;
        const loadPenalty = loadRatio * 100;

        return cpuScore + gpuBonus - loadPenalty;
    }

    // Health check for nodes
    checkNodeHealth(node: FFmpegNode): boolean {
        const now = Date.now();
        const maxHeartbeatAge = 60000; // 1 minute

        if (now - node.lastHeartbeat > maxHeartbeatAge) {
            return false;
        }

        if (node.currentLoad > node.capacity) {
            return false;
        }

        return node.isHealthy;
    }

    // Get performance recommendations
    getPerformanceRecommendations(nodes: FFmpegNode[]): any[] {
        const recommendations = [];

        for (const node of nodes) {
            const loadPercentage = (node.currentLoad / node.capacity) * 100;

            if (loadPercentage > 90) {
                recommendations.push({
                    nodeId: node.id,
                    type: 'overload',
                    message: `Node ${node.id} is overloaded (${Math.round(loadPercentage)}%)`,
                    priority: 'high',
                    action: 'Consider adding more nodes or redistributing load'
                });
            } else if (loadPercentage < 10 && nodes.length > 2) {
                recommendations.push({
                    nodeId: node.id,
                    type: 'underutilized',
                    message: `Node ${node.id} is underutilized (${Math.round(loadPercentage)}%)`,
                    priority: 'low',
                    action: 'Consider removing this node to reduce costs'
                });
            }

            if (!node.isHealthy) {
                recommendations.push({
                    nodeId: node.id,
                    type: 'unhealthy',
                    message: `Node ${node.id} is marked as unhealthy`,
                    priority: 'critical',
                    action: 'Check node status and restart if necessary'
                });
            }
        }

        return recommendations;
    }

    // Predict future load based on current trends
    predictLoad(nodes: FFmpegNode[], timeHorizonMinutes: number = 30): any {
        const currentTime = Date.now();
        const predictions = [];

        for (const node of nodes) {
            const currentLoadPercentage = (node.currentLoad / node.capacity) * 100;

            // Simple linear prediction based on current load trend
            // In real implementation, this would use historical data
            const predictedLoad = Math.min(100, currentLoadPercentage * 1.1);

            predictions.push({
                nodeId: node.id,
                currentLoad: currentLoadPercentage,
                predictedLoad,
                timeHorizon: timeHorizonMinutes,
                confidence: predictedLoad > 80 ? 'high' : 'medium',
                recommendation: predictedLoad > 90 ? 'scale_up' :
                    predictedLoad < 20 ? 'scale_down' : 'maintain'
            });
        }

        return {
            timestamp: currentTime,
            timeHorizonMinutes,
            predictions,
            summary: {
                nodesNeedingAttention: predictions.filter(p => p.predictedLoad > 80).length,
                overallTrend: predictions.reduce((sum, p) => sum + p.predictedLoad, 0) / predictions.length
            }
        };
    }
}