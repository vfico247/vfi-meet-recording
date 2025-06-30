// src/utils/ConfigLoader.ts
import * as dotenv from 'dotenv';
import { Logger } from './Logger';

const logger = new Logger('ConfigLoader');

export class ConfigLoader {
    static load(defaultConfig?: any): any {
        // Load environment variables from .env file
        dotenv.config();

        logger.info('Loading configuration', {
            nodeEnv: process.env.NODE_ENV,
            configFile: process.env.CONFIG_FILE || 'default'
        });

        // Merge default config with environment variables
        const config = {
            ...defaultConfig,
            server: {
                port: parseInt(process.env.PORT || '8080'),
                host: process.env.HOST || '0.0.0.0',
                environment: process.env.NODE_ENV || 'development'
            },
            database: {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                database: process.env.DB_NAME || 'recording_orchestrator',
                username: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD || 'password',
                ssl: process.env.DB_SSL === 'true',
                pool: {
                    min: parseInt(process.env.DB_POOL_MIN || '2'),
                    max: parseInt(process.env.DB_POOL_MAX || '10')
                }
            },
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD,
                db: parseInt(process.env.REDIS_DB || '0')
            },
            orchestration: {
                healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
                nodeTimeoutMs: parseInt(process.env.NODE_TIMEOUT_MS || '60000'),
                maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
                autoScaling: {
                    enabled: process.env.AUTO_SCALING_ENABLED === 'true',
                    minNodes: parseInt(process.env.MIN_NODES || '2'),
                    maxNodes: parseInt(process.env.MAX_NODES || '10'),
                    scaleUpThreshold: parseInt(process.env.SCALE_UP_THRESHOLD || '80'),
                    scaleDownThreshold: parseInt(process.env.SCALE_DOWN_THRESHOLD || '30'),
                    cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD || '300')
                }
            },
            recording: {
                defaultQuality: process.env.DEFAULT_QUALITY || 'medium',
                maxConcurrentPerNode: parseInt(process.env.MAX_CONCURRENT_PER_NODE || '6'),
                outputDirectory: process.env.OUTPUT_DIR || '/recordings',
                cleanupAfterDays: parseInt(process.env.CLEANUP_DAYS || '30')
            },
            alerts: {
                webhookUrl: process.env.ALERT_WEBHOOK_URL,
                emailRecipients: process.env.ALERT_EMAILS?.split(','),
                slackChannel: process.env.SLACK_CHANNEL,
                enableScalingAlerts: process.env.ENABLE_SCALING_ALERTS === 'true',
                scalingAlertCooldown: parseInt(process.env.SCALING_ALERT_COOLDOWN || '300')
            },
            monitoring: {
                metricsInterval: parseInt(process.env.METRICS_INTERVAL || '15000'),
                enableDetailedLogging: process.env.DETAILED_LOGGING === 'true'
            }
        };

        // Validate required configuration
        this.validateConfig(config);

        logger.info('Configuration loaded successfully', {
            autoScaling: config.orchestration.autoScaling.enabled,
            monitoringMode: !config.orchestration.autoScaling.enabled ? 'monitoring_only' : 'full_auto_scaling'
        });

        return config;
    }

    private static validateConfig(config: any): void {
        const requiredFields = [
            'server.port',
            'database.host',
            'database.database'
            // Note: JWT secret validation removed as auth is disabled
        ];

        for (const field of requiredFields) {
            const value = this.getNestedValue(config, field);
            if (value === undefined || value === null || value === '') {
                throw new Error(`Required configuration field missing: ${field}`);
            }
        }

        // Validate port ranges
        if (config.server.port < 1 || config.server.port > 65535) {
            throw new Error('Server port must be between 1 and 65535');
        }

        if (config.database.port < 1 || config.database.port > 65535) {
            throw new Error('Database port must be between 1 and 65535');
        }

        // Validate auto-scaling thresholds
        if (config.orchestration.autoScaling.scaleUpThreshold <= config.orchestration.autoScaling.scaleDownThreshold) {
            throw new Error('Scale up threshold must be higher than scale down threshold');
        }

        if (config.orchestration.autoScaling.minNodes >= config.orchestration.autoScaling.maxNodes) {
            throw new Error('Max nodes must be greater than min nodes');
        }

        // Validate monitoring intervals
        if (config.monitoring.metricsInterval < 5000) {
            logger.warn('Metrics interval is very low (<5s), this may impact performance');
        }

        if (config.orchestration.healthCheckInterval < 10000) {
            logger.warn('Health check interval is very low (<10s), this may impact performance');
        }

        // Note: JWT secret validation removed for simplified deployment
        // Warn if auto-scaling is enabled (should be false for manual deployment)
        if (config.orchestration.autoScaling.enabled) {
            logger.warn('Auto-scaling is enabled but auto-deployment is not implemented in this version');
        }
    }

    private static getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((current, key) =>
            current && current[key] !== undefined ? current[key] : undefined, obj
        );
    }

    // Helper method to get configuration summary
    static getConfigSummary(config: any): any {
        return {
            environment: config.server.environment,
            port: config.server.port,
            database: {
                host: config.database.host,
                port: config.database.port,
                database: config.database.database,
                ssl: config.database.ssl
            },
            autoScaling: {
                enabled: config.orchestration.autoScaling.enabled,
                mode: config.orchestration.autoScaling.enabled ? 'auto' : 'manual',
                thresholds: {
                    scaleUp: config.orchestration.autoScaling.scaleUpThreshold,
                    scaleDown: config.orchestration.autoScaling.scaleDownThreshold
                }
            },
            alerts: {
                webhook: !!config.alerts.webhookUrl,
                email: !!config.alerts.emailRecipients?.length,
                slack: !!config.alerts.slackChannel
            },
            features: {
                authentication: config.auth.jwtSecret !== 'not-used-auth-disabled',
                monitoring: true,
                autoDeployment: false,
                manualScaling: true
            }
        };
    }
}