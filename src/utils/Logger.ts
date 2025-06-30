import winston from 'winston';
import { config } from '../config/config';

export class Logger {
    private logger: winston.Logger;
    private context: string;

    constructor(context: string = 'App') {
        this.context = context;

        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.printf(({ level, message, timestamp, context, ...meta }) => {
                    const contextStr = context ? `[${context}] ` : '';
                    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level.toUpperCase()}] ${contextStr}${message}${metaStr}`;
                })
            ),
            defaultMeta: { context: this.context },
            transports: [
                // Console transport
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),

                // File transport for errors
                new winston.transports.File({
                    filename: 'logs/error.log',
                    level: 'error',
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                }),

                // File transport for all logs
                new winston.transports.File({
                    filename: 'logs/combined.log',
                    maxsize: 5242880, // 5MB
                    maxFiles: 10
                })
            ],
            exceptionHandlers: [
                new winston.transports.File({ filename: 'logs/exceptions.log' })
            ],
            rejectionHandlers: [
                new winston.transports.File({ filename: 'logs/rejections.log' })
            ]
        });

        // Create logs directory if it doesn't exist
        const fs = require('fs');
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
        }
    }

    info(message: string, meta?: any): void {
        this.logger.info(message, meta);
    }

    error(message: string, error?: any): void {
        if (error instanceof Error) {
            this.logger.error(message, {
                error: error.message,
                stack: error.stack,
                ...error
            });
        } else {
            this.logger.error(message, error);
        }
    }

    warn(message: string, meta?: any): void {
        this.logger.warn(message, meta);
    }

    debug(message: string, meta?: any): void {
        this.logger.debug(message, meta);
    }

    verbose(message: string, meta?: any): void {
        this.logger.verbose(message, meta);
    }

    // Create child logger with additional context
    child(additionalContext: string): Logger {
        const childLogger = new Logger(`${this.context}:${additionalContext}`);
        return childLogger;
    }

    // Performance timing utility
    time(label: string): void {
        this.logger.profile(label);
    }

    timeEnd(label: string): void {
        this.logger.profile(label);
    }
}