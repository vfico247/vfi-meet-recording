import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { Logger } from '../utils/Logger';

const logger = new Logger('ValidationMiddleware');

export const validateRequest = (schema: {
    body?: Joi.ObjectSchema;
    query?: Joi.ObjectSchema;
    params?: Joi.ObjectSchema;
}) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            // Validate request body
            if (schema.body) {
                const { error, value } = schema.body.validate(req.body);
                if (error) {
                    logger.warn('Request body validation failed', {
                        path: req.path,
                        errors: error.details.map(d => d.message)
                    });

                    res.status(400).json({
                        success: false,
                        error: 'Validation error',
                        details: error.details.map(d => ({
                            field: d.path.join('.'),
                            message: d.message
                        }))
                    });
                    return;
                }
                req.body = value;
            }

            // Validate query parameters
            if (schema.query) {
                const { error, value } = schema.query.validate(req.query);
                if (error) {
                    logger.warn('Query validation failed', {
                        path: req.path,
                        errors: error.details.map(d => d.message)
                    });

                    res.status(400).json({
                        success: false,
                        error: 'Query validation error',
                        details: error.details.map(d => ({
                            field: d.path.join('.'),
                            message: d.message
                        }))
                    });
                    return;
                }
                req.query = value;
            }

            // Validate path parameters
            if (schema.params) {
                const { error, value } = schema.params.validate(req.params);
                if (error) {
                    logger.warn('Params validation failed', {
                        path: req.path,
                        errors: error.details.map(d => d.message)
                    });

                    res.status(400).json({
                        success: false,
                        error: 'Parameter validation error',
                        details: error.details.map(d => ({
                            field: d.path.join('.'),
                            message: d.message
                        }))
                    });
                    return;
                }
                req.params = value;
            }

            next();

        } catch (error) {
            logger.error('Validation middleware error:', error);

            res.status(500).json({
                success: false,
                error: 'Validation processing error'
            });
        }
    };
};

// Common validation schemas
export const commonSchemas = {
    pagination: Joi.object({
        page: Joi.number().min(1).default(1),
        limit: Joi.number().min(1).max(100).default(20)
    }),

    jobId: Joi.object({
        jobId: Joi.string().required()
    }),

    nodeId: Joi.object({
        nodeId: Joi.string().required()
    }),

    dateRange: Joi.object({
        startDate: Joi.date().iso(),
        endDate: Joi.date().iso().min(Joi.ref('startDate'))
    })
};