import { Request, Response } from 'express';
import { OrchestrationService } from '../services/OrchestrationService';
import { Logger } from '../utils/Logger';

export class MetricsController {
    private orchestrationService: OrchestrationService;
    private logger: Logger;

    constructor(orchestrationService: OrchestrationService) {
        this.orchestrationService = orchestrationService;
        this.logger = new Logger('MetricsController');
    }

    // GET SYSTEM METRICS
    async getSystemMetrics(req: Request, res: Response): Promise<void> {
        try {
            const metrics = this.orchestrationService.getSystemMetrics();

            res.json({
                success: true,
                data: metrics,
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to get system metrics:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to get system metrics'
            });
        }
    }

    // GET REGIONAL METRICS
    async getRegionalMetrics(req: Request, res: Response): Promise<void> {
        try {
            const { region } = req.params;

            const metrics = this.orchestrationService.getRegionalMetrics(region);

            res.json({
                success: true,
                data: metrics,
                region,
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to get regional metrics:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to get regional metrics'
            });
        }
    }

    // GET HISTORICAL METRICS
    async getHistoricalMetrics(req: Request, res: Response): Promise<void> {
        try {
            const startDate = req.query.start as string;
            const endDate = req.query.end as string;
            const interval = req.query.interval as string || 'hour';

            if (!startDate || !endDate) {
                res.status(400).json({
                    success: false,
                    error: 'Start and end dates are required'
                });
                return;
            }

            const metrics = await this.orchestrationService.getHistoricalMetrics({
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                interval
            });

            res.json({
                success: true,
                data: metrics,
                interval,
                dateRange: { start: startDate, end: endDate }
            });

        } catch (error) {
            this.logger.error('Failed to get historical metrics:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to get historical metrics'
            });
        }
    }

    // GET PERFORMANCE STATS
    async getPerformanceStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await this.orchestrationService.getPerformanceStats();

            res.json({
                success: true,
                data: stats,
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to get performance stats:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to get performance stats'
            });
        }
    }
}
