// src/services/AutoScalingService.ts
import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { config } from '../config/config';
import { SystemMetrics } from '../types/interfaces';

export class AutoScalingService extends EventEmitter {
    private logger: Logger;
    private orchestrationService: any;
    private scalingCooldown: Map<string, number> = new Map();
    private scalingInterval: NodeJS.Timer | null = null;

    constructor() {
        super();
        this.logger = new Logger('AutoScalingService');
    }

    async initialize(): Promise<void> {
        this.logger.info('Auto-scaling service initialized (deployment disabled - monitoring only)', {
            enabled: config.orchestration.autoScaling.enabled,
            monitoringOnly: true,
            scaleUpThreshold: config.orchestration.autoScaling.scaleUpThreshold,
            scaleDownThreshold: config.orchestration.autoScaling.scaleDownThreshold
        });
    }

    start(orchestrationService: any): void {
        this.orchestrationService = orchestrationService;

        // Always start monitoring, even if deployment is disabled
        this.scalingInterval = setInterval(async () => {
            await this.evaluateScaling();
        }, 60000); // Check every minute

        this.logger.info('Auto-scaling monitoring started (no automatic deployment)');
    }

    async stop(): Promise<void> {
        if (this.scalingInterval) {
            // @ts-ignore
            clearInterval(this.scalingInterval);
            this.scalingInterval = null;
        }
        this.logger.info('Auto-scaling monitoring stopped');
    }

    private async evaluateScaling(): Promise<void> {
        try {
            const metrics = this.orchestrationService.getSystemMetrics();

            // Evaluate each region separately for monitoring
            for (const [region, regionMetrics] of Object.entries(metrics.byRegion)) {
                await this.evaluateRegionScaling(region, regionMetrics as any, metrics);
            }

        } catch (error) {
            this.logger.error('Error evaluating scaling:', error);
        }
    }

    private async evaluateRegionScaling(
        region: string,
        regionMetrics: any,
        globalMetrics: SystemMetrics
    ): Promise<void> {

        const { avgLoad, ffmpegNodes: nodeCount } = regionMetrics;
        const queueLength = globalMetrics.queueLength || 0;

        // Check if scaling would be needed (monitoring only)
        const wouldScaleUp = (
            avgLoad > config.orchestration.autoScaling.scaleUpThreshold ||
            queueLength > 5
        ) && nodeCount < config.orchestration.autoScaling.maxNodes;

        const wouldScaleDown = (
            avgLoad < config.orchestration.autoScaling.scaleDownThreshold &&
            queueLength === 0
        ) && nodeCount > config.orchestration.autoScaling.minNodes;

        if (wouldScaleUp) {
            this.logger.warn(`Region ${region} would benefit from more FFmpeg nodes`, {
                currentNodes: nodeCount,
                avgLoad: Math.round(avgLoad),
                queueLength,
                recommendation: 'Deploy additional FFmpeg nodes manually'
            });

            this.emit('scaleUpRecommended', {
                region,
                currentNodes: nodeCount,
                recommendedAction: 'deploy_additional_nodes',
                reason: avgLoad > 80 ? 'high_load' : 'queue_backlog',
                urgency: avgLoad > 90 ? 'critical' : 'high'
            });
        }

        if (wouldScaleDown) {
            this.logger.info(`Region ${region} has underutilized FFmpeg nodes`, {
                currentNodes: nodeCount,
                avgLoad: Math.round(avgLoad),
                recommendation: 'Consider removing idle nodes manually'
            });

            this.emit('scaleDownRecommended', {
                region,
                currentNodes: nodeCount,
                recommendedAction: 'consider_removing_idle_nodes',
                reason: 'low_utilization',
                urgency: 'low'
            });
        }
    }

    // Get scaling recommendations for manual action
    async getScalingRecommendations(): Promise<any> {
        const metrics = this.orchestrationService.getSystemMetrics();
        const recommendations = [];

        for (const [region, regionMetrics] of Object.entries(metrics.byRegion)) {
            const rm = regionMetrics as any;

            if (rm.avgLoad > config.orchestration.autoScaling.scaleUpThreshold) {
                const urgency = rm.avgLoad > 90 ? 'critical' : rm.avgLoad > 85 ? 'high' : 'medium';

                recommendations.push({
                    region,
                    action: 'scale_up',
                    priority: urgency,
                    reason: `High load: ${Math.round(rm.avgLoad)}%`,
                    currentNodes: rm.ffmpegNodes,
                    recommendedNodes: rm.ffmpegNodes + (rm.avgLoad > 90 ? 2 : 1),
                    instructions: 'Deploy additional FFmpeg nodes manually',
                    estimatedBenefit: 'Reduce queue time and improve response time'
                });
            } else if (rm.avgLoad < config.orchestration.autoScaling.scaleDownThreshold && rm.ffmpegNodes > config.orchestration.autoScaling.minNodes) {
                recommendations.push({
                    region,
                    action: 'scale_down',
                    priority: 'low',
                    reason: `Low utilization: ${Math.round(rm.avgLoad)}%`,
                    currentNodes: rm.ffmpegNodes,
                    recommendedNodes: Math.max(config.orchestration.autoScaling.minNodes, rm.ffmpegNodes - 1),
                    instructions: 'Consider removing idle nodes to reduce costs',
                    estimatedBenefit: 'Cost savings from unused resources'
                });
            }
        }

        // Add global recommendations
        if (metrics.queueLength > 10) {
            recommendations.push({
                region: 'global',
                action: 'scale_up',
                priority: 'high',
                reason: `Large queue: ${metrics.queueLength} jobs waiting`,
                instructions: 'Deploy FFmpeg nodes in regions with highest queue',
                estimatedBenefit: 'Reduce recording wait times'
            });
        }

        return {
            timestamp: Date.now(),
            systemStatus: this.getSystemStatus(metrics),
            globalMetrics: {
                totalNodes: metrics.totalFFmpegNodes,
                healthyNodes: metrics.healthyFFmpegNodes,
                activeRecordings: metrics.activeRecordings,
                queueLength: metrics.queueLength,
                overallCapacityUsage: metrics.totalCapacity > 0 ?
                    Math.round((metrics.currentLoad / metrics.totalCapacity) * 100) : 0
            },
            recommendations,
            nextEvaluation: Date.now() + 60000 // Next check in 1 minute
        };
    }

    // Get alert status for immediate attention
    getAlertStatus(): any {
        const metrics = this.orchestrationService.getSystemMetrics();
        const alerts = [];

        // Critical alerts
        if (metrics.totalCapacity > 0 && (metrics.currentLoad / metrics.totalCapacity) > 0.95) {
            alerts.push({
                level: 'critical',
                message: 'System capacity at 95%+ utilization',
                action: 'Deploy additional FFmpeg nodes immediately',
                impact: 'New recording requests will be queued or rejected'
            });
        }

        // High priority alerts
        if (metrics.totalCapacity > 0 && (metrics.currentLoad / metrics.totalCapacity) > 0.9) {
            alerts.push({
                level: 'high',
                message: 'System capacity at 90%+ utilization',
                action: 'Deploy additional FFmpeg nodes soon',
                impact: 'Performance degradation expected'
            });
        }

        // Queue backlog alerts
        if (metrics.queueLength > 15) {
            alerts.push({
                level: 'high',
                message: `${metrics.queueLength} jobs queued`,
                action: 'Deploy more FFmpeg nodes to clear backlog',
                impact: 'Users experiencing delays in recording start'
            });
        } else if (metrics.queueLength > 5) {
            alerts.push({
                level: 'medium',
                message: `${metrics.queueLength} jobs queued`,
                action: 'Consider adding more FFmpeg nodes',
                impact: 'Slight delays in recording start'
            });
        }

        // Node health alerts
        const unhealthyNodes = metrics.totalFFmpegNodes - metrics.healthyFFmpegNodes;
        if (unhealthyNodes > 0) {
            alerts.push({
                level: unhealthyNodes > 2 ? 'high' : 'medium',
                message: `${unhealthyNodes} FFmpeg nodes are unhealthy`,
                action: 'Check node status and restart if needed',
                impact: 'Reduced system capacity and potential recording failures'
            });
        }

        // Regional imbalance alerts
        for (const [region, regionMetrics] of Object.entries(metrics.byRegion)) {
            const rm = regionMetrics as any;
            if (rm.avgLoad > 95) {
                alerts.push({
                    level: 'critical',
                    message: `Region ${region} overloaded: ${Math.round(rm.avgLoad)}%`,
                    action: `Deploy FFmpeg nodes in ${region} immediately`,
                    impact: `Recording failures in ${region}`
                });
            }
        }

        const overallStatus = this.determineOverallStatus(alerts);

        return {
            status: overallStatus,
            alerts,
            summary: {
                critical: alerts.filter(a => a.level === 'critical').length,
                high: alerts.filter(a => a.level === 'high').length,
                medium: alerts.filter(a => a.level === 'medium').length,
                low: alerts.filter(a => a.level === 'low').length
            },
            timestamp: Date.now(),
            nextCheck: Date.now() + 60000
        };
    }

    private determineOverallStatus(alerts: any[]): string {
        if (alerts.some(a => a.level === 'critical')) return 'critical';
        if (alerts.some(a => a.level === 'high')) return 'warning';
        if (alerts.some(a => a.level === 'medium')) return 'caution';
        return 'healthy';
    }

    private getSystemStatus(metrics: SystemMetrics): string {
        const capacityUsage = metrics.totalCapacity > 0 ?
            (metrics.currentLoad / metrics.totalCapacity) * 100 : 0;

        if (capacityUsage > 95) return 'overloaded';
        if (capacityUsage > 85) return 'high_load';
        if (capacityUsage > 70) return 'moderate_load';
        if (capacityUsage > 30) return 'normal';
        return 'underutilized';
    }

    // Manual node management helpers
    async recommendNodeRemoval(region: string): Promise<any[]> {
        const nodes = this.orchestrationService.getFFmpegNodesByRegion(region);
        const candidates = this.selectNodesForRemoval(nodes);

        return candidates.map(node => ({
            nodeId: node.id,
            reason: node.currentLoad === 0 ? 'idle' : 'lowest_load',
            currentLoad: node.currentLoad,
            lastHeartbeat: node.lastHeartbeat,
            recommendation: 'Safe to remove - no active jobs'
        }));
    }

    private selectNodesForRemoval(nodes: any[]): any[] {
        // Find nodes with lowest load and no active jobs
        const idleNodes = nodes.filter(node => node.currentLoad === 0 && node.isHealthy);

        if (idleNodes.length > 0) {
            // Remove oldest idle nodes first
            return idleNodes
                .sort((a, b) => a.lastHeartbeat - b.lastHeartbeat)
                .slice(0, 1); // Only recommend removing one at a time
        }

        return [];
    }

    // Performance tracking
    getPerformanceMetrics(): any {
        const metrics = this.orchestrationService.getSystemMetrics();

        return {
            efficiency: {
                capacityUtilization: metrics.totalCapacity > 0 ?
                    Math.round((metrics.currentLoad / metrics.totalCapacity) * 100) : 0,
                nodeUtilization: metrics.totalFFmpegNodes > 0 ?
                    Math.round((metrics.healthyFFmpegNodes / metrics.totalFFmpegNodes) * 100) : 0,
                queueEfficiency: metrics.queueLength === 0 ? 100 :
                    Math.max(0, 100 - (metrics.queueLength * 10))
            },
            availability: {
                healthyNodes: metrics.healthyFFmpegNodes,
                totalNodes: metrics.totalFFmpegNodes,
                healthPercentage: metrics.totalFFmpegNodes > 0 ?
                    Math.round((metrics.healthyFFmpegNodes / metrics.totalFFmpegNodes) * 100) : 0
            },
            load: {
                current: metrics.currentLoad,
                capacity: metrics.totalCapacity,
                available: metrics.totalCapacity - metrics.currentLoad,
                queueLength: metrics.queueLength
            },
            regions: Object.entries(metrics.byRegion).map(([region, data]: [string, any]) => ({
                region,
                nodes: data.ffmpegNodes,
                load: Math.round(data.avgLoad),
                status: data.avgLoad > 90 ? 'overloaded' :
                    data.avgLoad > 70 ? 'high' :
                        data.avgLoad > 30 ? 'normal' : 'underutilized'
            }))
        };
    }

    // Configuration and status
    getScalingStatistics(): any {
        return {
            mode: 'monitoring_only',
            autoDeploymentEnabled: false,
            monitoringEnabled: true,
            cooldownStatus: Object.fromEntries(this.scalingCooldown.entries()),
            configuration: {
                ...config.orchestration.autoScaling,
                note: 'Auto-deployment disabled - monitoring and recommendations only'
            },
            lastEvaluationTime: Date.now(),
            nextEvaluationTime: Date.now() + 60000,
            features: {
                loadMonitoring: true,
                alertGeneration: true,
                recommendations: true,
                autoDeployment: false,
                nodeRemoval: false
            }
        };
    }

    // Event handlers for external integration
    subscribeToScalingEvents(callback: (event: any) => void): void {
        this.on('scaleUpRecommended', (data) => {
            callback({
                type: 'scale_up_recommended',
                data,
                timestamp: Date.now()
            });
        });

        this.on('scaleDownRecommended', (data) => {
            callback({
                type: 'scale_down_recommended',
                data,
                timestamp: Date.now()
            });
        });
    }

    // Manual trigger for immediate evaluation
    async forceEvaluation(): Promise<any> {
        this.logger.info('Manual scaling evaluation triggered');
        await this.evaluateScaling();

        return {
            message: 'Scaling evaluation completed',
            recommendations: await this.getScalingRecommendations(),
            alerts: this.getAlertStatus(),
            timestamp: Date.now()
        };
    }
}