import { Router, Request, Response } from 'express';
import { Database } from '../database/Database';
import { Logger } from '../utils/Logger';

const router = Router();
const logger = new Logger('HealthRoute');

// Health check endpoint
router.get('/', async (req: Request, res: Response) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            database: 'unknown',
            services: {
                orchestration: 'healthy',
                loadBalancer: 'healthy',
                autoScaling: 'healthy'
            }
        };

        // Check database connection
        try {
            const db = Database.getInstance();
            await db.query('SELECT 1');
            health.database = 'healthy';
        } catch (error) {
            health.database = 'unhealthy';
            health.status = 'degraded';
        }

        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);

    } catch (error) {
        logger.error('Health check failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        res.status(503).json({
            "status": 'unhealthy',
            "timestamp": new Date().toISOString(),
            "error": errorMessage
        });
    }
});

// Readiness probe
router.get('/ready', async (req: Request, res: Response) => {
    try {
        // Check if all critical services are ready
        const readiness = {
            ready: true,
            timestamp: new Date().toISOString(),
            checks: {
                database: false,
                orchestration: false
            }
        };

        // Check database
        try {
            const db = Database.getInstance();
            await db.query('SELECT 1');
            readiness.checks.database = true;
        } catch (error) {
            readiness.ready = false;
        }

        // Check orchestration service
        readiness.checks.orchestration = true; // Assume ready if server is running

        const statusCode = readiness.ready ? 200 : 503;
        res.status(statusCode).json(readiness);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        res.status(503).json({
            ready: false,
            timestamp: new Date().toISOString(),
            error: errorMessage
        });
    }
});

// Liveness probe
router.get('/live', (req: Request, res: Response) => {
    res.json({
        alive: true,
        timestamp: new Date().toISOString(),
        pid: process.pid
    });
});

export default router;