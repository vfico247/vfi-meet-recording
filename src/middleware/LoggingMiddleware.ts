import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';

const logger = new Logger('HTTPRequest');

export const LoggingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const originalSend = res.send;

    // Override res.send to capture response
    res.send = function(body: any) {
        const duration = Date.now() - startTime;

        // Log request details
        logger.info('HTTP Request', {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection.remoteAddress,
            contentLength: res.get('Content-Length') || 0
        });

        // Log errors
        if (res.statusCode >= 400) {
            logger.warn('HTTP Error', {
                method: req.method,
                url: req.originalUrl,
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip
            });
        }

        // Call original send
        return originalSend.call(this, body);
    };

    next();
};