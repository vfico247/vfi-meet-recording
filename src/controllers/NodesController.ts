import { Request, Response } from 'express';
import { OrchestrationService } from '../services/OrchestrationService';
import { Logger } from '../utils/Logger';
import Joi from 'joi';

export class NodesController {
    private orchestrationService: OrchestrationService;
    private logger: Logger;

    constructor(orchestrationService: OrchestrationService) {
        this.orchestrationService = orchestrationService;
        this.logger = new Logger('NodesController');
    }

    // REGISTER ROOM SERVER
    async registerRoomServer(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                serverId: Joi.string().required(),
                url: Joi.string().uri().required(),
                region: Joi.string().required(),
                rooms: Joi.array().items(Joi.string()).default([]),
                capacity: Joi.number().min(1).max(1000).required(),
                specs: Joi.object({
                    cpuCores: Joi.number().min(1).required(),
                    ram: Joi.number().min(1).required(),
                    hasGPU: Joi.boolean().default(false),
                    diskSpace: Joi.number().min(1).required()
                }).required(),
                metadata: Joi.object().default({})
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

            const serverId = await this.orchestrationService.registerRoomServer(value);

            this.logger.info('Room server registered', { serverId, url: value.url });

            res.status(201).json({
                success: true,
                message: 'Room server registered successfully',
                data: {
                    serverId,
                    registrationTime: Date.now()
                }
            });

        } catch (error) {
            this.logger.error('Failed to register room server:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to register room server'
            });
        }
    }

    // REGISTER FFMPEG NODE
    async registerFFmpegNode(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                url: Joi.string().uri().required(),
                region: Joi.string().required(),
                specs: Joi.object({
                    cpuCores: Joi.number().min(1).required(),
                    ram: Joi.number().min(1).required(),
                    hasGPU: Joi.boolean().default(false),
                    gpuMemory: Joi.number().min(0),
                    diskSpace: Joi.number().min(1).required(),
                    networkBandwidth: Joi.number().min(0)
                }).required(),
                supportedCodecs: Joi.array().items(Joi.string()).default(['h264', 'vp8', 'opus']),
                metadata: Joi.object().default({})
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

            const nodeId = await this.orchestrationService.registerFFmpegNode(value);

            this.logger.info('FFmpeg node registered', { nodeId, url: value.url });

            res.status(201).json({
                success: true,
                message: 'FFmpeg node registered successfully',
                data: {
                    nodeId,
                    registrationTime: Date.now()
                }
            });

        } catch (error) {
            this.logger.error('Failed to register FFmpeg node:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to register FFmpeg node'
            });
        }
    }

    // ROOM SERVER HEARTBEAT
    async roomServerHeartbeat(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                serverId: Joi.string().required(),
                currentLoad: Joi.number().min(0).required(),
                rooms: Joi.array().items(Joi.string()).default([]),
                systemMetrics: Joi.object().default({})
            });

            const { error, value } = schema.validate(req.body);
            if (error) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid heartbeat data'
                });
                return;
            }

            await this.orchestrationService.updateRoomServerHeartbeat(value.serverId, value);

            res.json({
                success: true,
                message: 'Heartbeat received',
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to process room server heartbeat:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to process heartbeat'
            });
        }
    }

    // FFMPEG NODE HEARTBEAT
    async ffmpegNodeHeartbeat(req: Request, res: Response): Promise<void> {
        try {
            const schema = Joi.object({
                nodeId: Joi.string().required(),
                currentLoad: Joi.number().min(0).required(),
                activeJobs: Joi.array().items(Joi.string()).default([]),
                systemMetrics: Joi.object().default({})
            });

            const { error, value } = schema.validate(req.body);
            if (error) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid heartbeat data'
                });
                return;
            }

            await this.orchestrationService.updateFFmpegNodeHeartbeat(value.nodeId, value);

            res.json({
                success: true,
                message: 'Heartbeat received',
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to process FFmpeg node heartbeat:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to process heartbeat'
            });
        }
    }

    // LIST NODES
    async listNodes(req: Request, res: Response): Promise<void> {
        try {
            const nodeType = req.query.type as string;
            const region = req.query.region as string;
            const healthyOnly = req.query.healthy === 'true';

            const nodes = this.orchestrationService.getNodes({
                type: nodeType,
                region,
                healthyOnly
            });

            res.json({
                success: true,
                data: nodes,
                count: nodes.length
            });

        } catch (error) {
            this.logger.error('Failed to list nodes:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to list nodes'
            });
        }
    }

    // GET NODE STATUS
    async getNodeStatus(req: Request, res: Response): Promise<void> {
        try {
            const { nodeId } = req.params;
            const nodeType = req.query.type as string;

            const node = this.orchestrationService.getNode(nodeId, nodeType);
            if (!node) {
                res.status(404).json({
                    success: false,
                    error: 'Node not found'
                });
                return;
            }

            res.json({
                success: true,
                data: node
            });

        } catch (error) {
            this.logger.error('Failed to get node status:', error);

            res.status(500).json({
                success: false,
                error: 'Failed to get node status'
            });
        }
    }

    // REMOVE NODE
    async removeNode(req: Request, res: Response): Promise<void> {
        try {
            const { nodeId } = req.params;
            const nodeType = req.query.type as string;

            await this.orchestrationService.removeNode(nodeId, nodeType);

            this.logger.info('Node removed', { nodeId, type: nodeType });

            res.json({
                success: true,
                message: 'Node removed successfully'
            });

        } catch (error) {
            this.logger.error('Failed to remove node:', error);

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to remove node'
            });
        }
    }
}