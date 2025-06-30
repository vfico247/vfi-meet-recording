// src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { ConfigLoader } from './utils/ConfigLoader';
import { Logger } from './utils/Logger';
import { Database } from './database/Database';
import { OrchestrationService } from './services/OrchestrationService';

// Import routes
import nodeRoutes from './routes/nodes';
import recordingRoutes from './routes/recordings';
import healthRoutes from './routes/health';
import scalingRoutes, { initializeScalingRoutes } from './routes/scaling';

// Import middleware
import { LoggingMiddleware } from './middleware/LoggingMiddleware';

class RecordingOrchestratorApp {
    private app: express.Application;
    private server: any;
    private wss: WebSocketServer;
    private orchestrationService: OrchestrationService;
    private database: Database;
    private logger: Logger;
    private config: any;

    constructor() {
        this.config = ConfigLoader.load();
        this.logger = new Logger('RecordingOrchestrator');
        this.app = express();
        this.database = new Database();
        this.orchestrationService = new OrchestrationService();
    }

    async initialize(): Promise<void> {
        try {
            // Initialize database
            await this.database.connect();
            this.logger.info('Database connected successfully');

            // Initialize services
            await this.orchestrationService.initialize();
            this.logger.info('Orchestration service initialized');

            // Initialize scaling routes with service dependencies
            initializeScalingRoutes(this.orchestrationService, this.orchestrationService.getAutoScalingService());

            // Setup Express app
            this.setupMiddleware();
            this.setupRoutes();
            this.setupErrorHandling();

            // Setup WebSocket server
            this.setupWebSocket();

            // Start server
            this.startServer();

            // Start background services
            this.startBackgroundServices();

            // Log configuration summary
            this.logConfigurationSummary();

        } catch (error) {
            this.logger.error('Failed to initialize application:', error);
            process.exit(1);
        }
    }

    private setupMiddleware(): void {
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors({
            origin: this.config.cors.allowedOrigins,
            credentials: true
        }));

        // Performance middleware
        this.app.use(compression());

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));

        // Custom middleware
        this.app.use(LoggingMiddleware);
        // Note: AuthMiddleware removed for simplified deployment
    }

    private setupRoutes(): void {
        // API routes
        this.app.use('/api/nodes', nodeRoutes);
        this.app.use('/api/recordings', recordingRoutes);
        this.app.use('/api/scaling', scalingRoutes); // New scaling routes
        this.app.use('/health', healthRoutes);

        // Root endpoint
        this.app.get('/', (req, res) => {
            const configSummary = ConfigLoader.getConfigSummary(this.config);

            res.json({
                service: 'EduMeet Recording Orchestrator',
                version: process.env.npm_package_version || '1.0.0',
                status: 'running',
                mode: configSummary.autoScaling.mode,
                features: configSummary.features,
                endpoints: {
                    nodes: '/api/nodes',
                    recordings: '/api/recordings',
                    scaling: '/api/scaling',
                    health: '/health'
                },
                timestamp: new Date().toISOString()
            });
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Endpoint not found',
                path: req.originalUrl,
                availableEndpoints: [
                    '/api/nodes',
                    '/api/recordings',
                    '/api/scaling',
                    '/health'
                ]
            });
        });
    }

    private setupErrorHandling(): void {
        this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.logger.error('Unhandled error:', error);

            const errorMessage = error instanceof Error ? error.message : 'Something went wrong';

            res.status(error.status || 500).json({
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? errorMessage : 'Something went wrong',
                timestamp: new Date().toISOString()
            });
        });
    }

    private setupWebSocket(): void {
        this.server = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws, req) => {
            this.logger.info('WebSocket connection established', { ip: req.socket.remoteAddress });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    this.handleWebSocketMessage(ws, data);
                } catch (error) {
                    this.logger.error('Invalid WebSocket message:', error);
                }
            });

            ws.on('close', () => {
                this.logger.info('WebSocket connection closed');
            });
        });
    }

    private handleWebSocketMessage(ws: any, data: any): void {
        switch (data.type) {
            case 'subscribe_metrics':
                this.orchestrationService.subscribeToMetrics(ws);
                break;
            case 'subscribe_recordings':
                this.orchestrationService.subscribeToRecordings(ws);
                break;
            case 'subscribe_scaling_alerts':
                this.subscribeToScalingAlerts(ws);
                break;
            default:
                this.logger.warn('Unknown WebSocket message type:', data.type);
        }
    }

    private subscribeToScalingAlerts(ws: any): void {
        const autoScalingService = this.orchestrationService.getAutoScalingService();

        if (autoScalingService) {
            autoScalingService.subscribeToScalingEvents((event) => {
                try {
                    if (ws.readyState === 1) { // WebSocket.OPEN
                        ws.send(JSON.stringify({
                            type: 'scaling_alert',
                            data: event
                        }));
                    }
                } catch (error) {
                    this.logger.error('Failed to send scaling alert via WebSocket:', error);
                }
            });
        }
    }

    private startServer(): void {
        const port = this.config.server.port || 8080;

        this.server.listen(port, () => {
            this.logger.info(`Recording Orchestrator started on port ${port}`);
            this.logger.info('Environment:', process.env.NODE_ENV || 'development');
            this.logger.info('Available endpoints:');
            this.logger.info('  - REST API: http://localhost:' + port + '/api');
            this.logger.info('  - Health: http://localhost:' + port + '/health');
            this.logger.info('  - Scaling: http://localhost:' + port + '/api/scaling');
            this.logger.info('  - WebSocket: ws://localhost:' + port);
        });
    }

    private startBackgroundServices(): void {
        // Start health monitoring
        this.orchestrationService.startHealthMonitoring();

        // Start auto-scaling (monitoring only)
        this.orchestrationService.startAutoScaling();

        // Start metrics collection
        this.orchestrationService.startMetricsCollection();

        this.logger.info('Background services started');
    }

    private logConfigurationSummary(): void {
        const configSummary = ConfigLoader.getConfigSummary(this.config);

        this.logger.info('Configuration Summary:', {
            mode: configSummary.autoScaling.mode,
            autoDeployment: configSummary.features.autoDeployment,
            monitoring: configSummary.features.monitoring,
            alerts: {
                webhook: configSummary.alerts.webhook,
                email: configSummary.alerts.email,
                slack: configSummary.alerts.slack
            },
            database: `${configSummary.database.host}:${configSummary.database.port}`,
            thresholds: configSummary.autoScaling.thresholds
        });

        if (!configSummary.autoScaling.enabled) {
            this.logger.info('🔧 Manual Scaling Mode: Deploy FFmpeg nodes manually, system will provide recommendations');
        }
    }

    async shutdown(): Promise<void> {
        this.logger.info('Shutting down Recording Orchestrator...');

        // Close WebSocket server
        this.wss.close();

        // Stop orchestration service
        await this.orchestrationService.shutdown();

        // Close database connection
        await this.database.disconnect();

        // Close HTTP server
        this.server.close(() => {
            this.logger.info('Server closed');
            process.exit(0);
        });
    }
}

// Application startup
const app = new RecordingOrchestratorApp();

// Handle shutdown gracefully
process.on('SIGTERM', () => app.shutdown());
process.on('SIGINT', () => app.shutdown());

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start application
app.initialize().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
});

export default app;