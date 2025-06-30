// src/routes/scaling.ts
import { Router, Request, Response } from 'express';
import { AutoScalingService } from '../services/AutoScalingService';
import { OrchestrationService } from '../services/OrchestrationService';
import { Logger } from '../utils/Logger';
import { ErrorUtils } from '../utils/NetworkUtils';

const router = Router();
const logger = new Logger('ScalingRoutes');

// Initialize services (these would be injected in real implementation)
let orchestrationService: OrchestrationService;
let autoScalingService: AutoScalingService;

// Initialize route dependencies
export const initializeScalingRoutes = (orchService: OrchestrationService, autoService: AutoScalingService) => {
    orchestrationService = orchService;
    autoScalingService = autoService;
};

// Get scaling recommendations
router.get('/recommendations', async (req: Request, res: Response) => {
    try {
        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        const recommendations = await autoScalingService.getScalingRecommendations();

        logger.info('Scaling recommendations requested', {
            recommendationCount: recommendations.recommendations?.length || 0,
            systemStatus: recommendations.systemStatus
        });

        res.json({
            success: true,
            data: recommendations,
            message: 'Scaling recommendations generated successfully'
        });

    } catch (error) {
        logger.error('Failed to get scaling recommendations:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get system alerts
router.get('/alerts', async (req: Request, res: Response) => {
    try {
        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        const alertStatus = autoScalingService.getAlertStatus();

        logger.info('Alert status requested', {
            status: alertStatus.status,
            alertCount: alertStatus.alerts?.length || 0
        });

        res.json({
            success: true,
            data: alertStatus,
            message: 'Alert status retrieved successfully'
        });

    } catch (error) {
        logger.error('Failed to get alert status:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get performance metrics
router.get('/performance', async (req: Request, res: Response) => {
    try {
        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        const performanceMetrics = autoScalingService.getPerformanceMetrics();

        res.json({
            success: true,
            data: performanceMetrics,
            timestamp: Date.now()
        });

    } catch (error) {
        logger.error('Failed to get performance metrics:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get scaling statistics
router.get('/statistics', async (req: Request, res: Response) => {
    try {
        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        const statistics = autoScalingService.getScalingStatistics();

        res.json({
            success: true,
            data: statistics,
            timestamp: Date.now()
        });

    } catch (error) {
        logger.error('Failed to get scaling statistics:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Force immediate scaling evaluation
router.post('/evaluate', async (req: Request, res: Response) => {
    try {
        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        logger.info('Manual scaling evaluation triggered');

        const evaluation = await autoScalingService.forceEvaluation();

        res.json({
            success: true,
            data: evaluation,
            message: 'Scaling evaluation completed'
        });

    } catch (error) {
        logger.error('Failed to perform scaling evaluation:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get node removal recommendations for specific region
router.get('/regions/:region/removal-candidates', async (req: Request, res: Response) => {
    try {
        const { region } = req.params;

        if (!autoScalingService) {
            res.status(503).json({
                success: false,
                error: 'Auto-scaling service not available'
            });
            return;
        }

        const candidates = await autoScalingService.recommendNodeRemoval(region);

        logger.info('Node removal candidates requested', {
            region,
            candidateCount: candidates.length
        });

        res.json({
            success: true,
            data: {
                region,
                candidates,
                recommendations: candidates.length > 0 ?
                    'Nodes can be safely removed - no active jobs' :
                    'No nodes available for removal',
                timestamp: Date.now()
            }
        });

    } catch (error) {
        logger.error('Failed to get node removal candidates:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get system capacity overview
router.get('/capacity', async (req: Request, res: Response) => {
    try {
        if (!orchestrationService) {
            res.status(503).json({
                success: false,
                error: 'Orchestration service not available'
            });
            return;
        }

        const metrics = orchestrationService.getSystemMetrics();

        const capacityOverview = {
            global: {
                totalCapacity: metrics.totalCapacity,
                currentLoad: metrics.currentLoad,
                available: metrics.totalCapacity - metrics.currentLoad,
                utilizationPercentage: metrics.totalCapacity > 0 ?
                    Math.round((metrics.currentLoad / metrics.totalCapacity) * 100) : 0,
                queueLength: metrics.queueLength || 0
            },
            nodes: {
                total: metrics.totalFFmpegNodes,
                healthy: metrics.healthyFFmpegNodes,
                unhealthy: metrics.totalFFmpegNodes - metrics.healthyFFmpegNodes
            },
            regions: Object.entries(metrics.byRegion).map(([region, data]: [string, any]) => ({
                region,
                nodes: data.ffmpegNodes,
                capacity: data.capacity,
                load: data.load,
                available: data.capacity - data.load,
                utilizationPercentage: Math.round(data.avgLoad),
                status: data.avgLoad > 90 ? 'critical' :
                    data.avgLoad > 80 ? 'warning' :
                        data.avgLoad > 70 ? 'normal' :
                            data.avgLoad > 30 ? 'light' : 'idle'
            })),
            timestamp: Date.now()
        };

        res.json({
            success: true,
            data: capacityOverview
        });

    } catch (error) {
        logger.error('Failed to get capacity overview:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Get scaling history (if implemented)
router.get('/history', async (req: Request, res: Response) => {
    try {
        const hours = parseInt(req.query.hours as string) || 24;
        const limit = parseInt(req.query.limit as string) || 100;

        // This would typically come from database
        const scalingHistory = {
            period: `${hours} hours`,
            events: [
                // Example scaling events
                {
                    timestamp: Date.now() - 3600000,
                    type: 'scale_up_recommended',
                    region: 'us-east-1',
                    reason: 'High load: 85%',
                    action: 'manual_intervention_required'
                },
                {
                    timestamp: Date.now() - 7200000,
                    type: 'alert_generated',
                    level: 'warning',
                    message: 'Queue length: 8 jobs',
                    action: 'monitoring'
                }
            ],
            summary: {
                scaleUpRecommendations: 3,
                scaleDownRecommendations: 1,
                alertsGenerated: 5,
                manualInterventionsRequired: 2
            },
            timestamp: Date.now()
        };

        res.json({
            success: true,
            data: scalingHistory
        });

    } catch (error) {
        logger.error('Failed to get scaling history:', error);

        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

// Health check for scaling service
router.get('/health', async (req: Request, res: Response) => {
    try {
        const health = {
            autoScalingService: autoScalingService ? 'available' : 'unavailable',
            orchestrationService: orchestrationService ? 'available' : 'unavailable',
            mode: 'monitoring_only',
            features: {
                recommendations: true,
                alerts: true,
                performanceMetrics: true,
                autoDeployment: false,
                manualScaling: true
            },
            timestamp: Date.now()
        };

        const statusCode = health.autoScalingService === 'available' &&
        health.orchestrationService === 'available' ? 200 : 503;

        res.status(statusCode).json({
            success: statusCode === 200,
            data: health
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: ErrorUtils.getErrorMessage(error),
            timestamp: Date.now()
        });
    }
});

export default router;