import { Request, Response } from 'express';
import { OrchestrationService } from '../services/OrchestrationService';
import { Logger } from '../utils/Logger';
import { ValidationMiddleware } from '../middleware/ValidationMiddleware';
import Joi from 'joi';

export class RecordingController {
    private orchestrationService: OrchestrationService;
    private logger: Logger;

    constructor(orchestrationService: OrchestrationService) {
        this.orchestrationService = orchestrationService;
        this.logger = new Logger('RecordingController');
    }

    // START DISTRIBUTED RECORDING
    async startRecording(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                roomServerId: Joi.string().required(),
                roomId: Joi.string().required(),
                peerId: Joi.string().required(),
                peerInfo: Joi.object({
                    peerId: Joi.string().required(),
                    displayName: Joi.string().allow(''),
                    isAuthenticated: Joi.boolean().default(false),
                    roles: Joi.array().items(Joi.string()).default([]),
                    joinTime: Joi.number().required()
                }).required(),
                rtpStreams: Joi.array().items(Joi.object({
                    kind: Joi.string().valid('audio', 'video').required(),
                    port: Joi.number().required(),
                    payloadType: Joi.number().required(),
                    ssrc: Joi.number().required(),
                    codecName: Joi.string().required()
                })).min(1).required(),
                options: Joi.object({
                    quality: Joi.string().valid('low', 'medium', 'high').default('medium'),
                    format: Joi.string().valid('mp4', 'webm', 'mkv').default('mp4'),
                    includeAudio: Joi.boolean().default(true),
                    includeVideo: Joi.boolean().default(true),
                    maxDuration: Joi.number().min(1).max(7200) // Max 2 hours
                }).default({}),
                requesterInfo: Joi.object({
                    userId: Joi.string().allow(''),
                    ip: Joi.string().required(),
                    userAgent: Joi.string().allow(''),
                    timestamp: Joi.number().required()
                }).required()
            });

            const { error, value } = schema.validate(req.body);
            if (error) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.details.map(d => d.message)
                });
                return;
            }

            const jobId = await this.orchestrationService.startDistributedRecording(value);

            this.logger.info('Recording started successfully', {
                jobId,
                peerId: value.peerInfo.peerId,
                roomId: value.roomId
            });

            res.status(201).json({
                success: true,
                message: 'Recording started successfully',
                data: {
                    jobId,
                    status: 'pending',
                    timestamp: Date.now()
                }
            });

        } catch (error) {
            this.logger.error('Failed to start recording:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to start recording',
                timestamp: Date.now()
            });
        }
    }

    // STOP DISTRIBUTED RECORDING
    async stopRecording(req: Request, res: Response): Promise<void> {
        try {
            const { jobId } = req.params;

            if (!jobId) {
                res.status(400).json({
                    success: false,
                    error: 'Job ID is required'
                });
                return;
            }

            const result = await this.orchestrationService.stopDistributedRecording(jobId);

            this.logger.info('Recording stopped successfully', { jobId });

            res.json({
                success: true,
                message: 'Recording stopped successfully',
                data: {
                    jobId,
                    result,
                    timestamp: Date.now()
                }
            });

        } catch (error) {
            this.logger.error('Failed to stop recording:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to stop recording',
                timestamp: Date.now()
            });
        }
    }

    // GET RECORDING STATUS
    async getRecordingStatus(req: Request, res: Response): Promise<void> {
        try {
            const { jobId } = req.params;

            const job = this.orchestrationService.getRecordingJob(jobId);
            if (!job) {
                res.status(404).json({
                    success: false,
                    error: 'Recording job not found'
                });
                return;
            }

            res.json({
                success: true,
                data: {
                    jobId: job.jobId,
                    status: job.status,
                    peerId: job.peerId,
                    peerName: job.peerInfo.displayName,
                    startTime: job.startTime,
                    endTime: job.endTime,
                    duration: job.endTime ? job.endTime - job.startTime : Date.now() - job.startTime,
                    outputPath: job.outputPath,
                    errorMessage: job.errorMessage,
                    ffmpegNodeId: job.ffmpegNodeId,
                    roomServerId: job.roomServerId
                }
            });

        } catch (error) {
            this.logger.error('Failed to get recording status:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get recording status'
            });
        }
    }

    // LIST ACTIVE RECORDINGS
    async listActiveRecordings(req: Request, res: Response): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const roomId = req.query.roomId as string;
            const region = req.query.region as string;

            const recordings = this.orchestrationService.getActiveRecordings({
                page,
                limit,
                roomId,
                region
            });

            res.json({
                success: true,
                data: recordings,
                pagination: {
                    page,
                    limit,
                    total: recordings.length
                }
            });

        } catch (error) {
            this.logger.error('Failed to list recordings:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to list recordings'
            });
        }
    }

    // GET RECORDING HISTORY
    async getRecordingHistory(req: Request, res: Response): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const status = req.query.status as string;
            const startDate = req.query.startDate as string;
            const endDate = req.query.endDate as string;

            const history = await this.orchestrationService.getRecordingHistory({
                page,
                limit,
                status,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined
            });

            res.json({
                success: true,
                data: history.records,
                pagination: {
                    page,
                    limit,
                    total: history.total,
                    totalPages: Math.ceil(history.total / limit)
                }
            });

        } catch (error) {
            this.logger.error('Failed to get recording history:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get recording history'
            });
        }
    }

    // HANDLE RECORDING EVENTS FROM FFMPEG NODES
    async handleRecordingEvent(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                jobId: Joi.string().required(),
                event: Joi.string().valid('started', 'progress', 'completed', 'failed').required(),
                data: Joi.object().default({})
            });

            const { error, value } = schema.validate(req.body);
            if (error) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid event data'
                });
                return;
            }

            await this.orchestrationService.handleRecordingEvent(value);

            res.json({
                success: true,
                message: 'Event processed successfully'
            });

        } catch (error) {
            this.logger.error('Failed to handle recording event:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process event'
            });
        }
    }
}