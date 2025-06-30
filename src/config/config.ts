import { ConfigLoader } from '../utils/ConfigLoader';
import { AppConfig } from '../types/interfaces';

const defaultConfig: AppConfig = {
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
    cors: {
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*']
    },
    orchestration: {
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
        nodeTimeoutMs: parseInt(process.env.NODE_TIMEOUT_MS || '60000'),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
        autoScaling: {
            enabled: false, // Auto-deployment disabled - monitoring only
            minNodes: parseInt(process.env.MIN_NODES || '2'),
            maxNodes: parseInt(process.env.MAX_NODES || '10'),
            scaleUpThreshold: parseInt(process.env.SCALE_UP_THRESHOLD || '80'),
            scaleDownThreshold: parseInt(process.env.SCALE_DOWN_THRESHOLD || '30'),
            cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD || '300')
        }
    },
    recording: {
        defaultQuality: 'medium',
        maxConcurrentPerNode: parseInt(process.env.MAX_CONCURRENT_PER_NODE || '6'),
        outputDirectory: process.env.OUTPUT_DIR || '/recordings',
        cleanupAfterDays: parseInt(process.env.CLEANUP_DAYS || '30')
    },
    alerts: {
        webhookUrl: process.env.ALERT_WEBHOOK_URL,
        emailRecipients: process.env.ALERT_EMAILS?.split(','),
        slackChannel: process.env.SLACK_CHANNEL
    },
    monitoring: {
        metricsInterval: parseInt(process.env.METRICS_INTERVAL || '15000'),
        enableDetailedLogging: process.env.DETAILED_LOGGING === 'true'
    }
};

export const config = ConfigLoader.load(defaultConfig);