import { Router } from 'express';
import { NodesController } from '../controllers/NodesController';
import { OrchestrationService } from '../services/OrchestrationService';

const router = Router();
const orchestrationService = new OrchestrationService();
const nodesController = new NodesController(orchestrationService);

// Node registration
router.post('/room-servers/register', (req, res) => nodesController.registerRoomServer(req, res));
router.post('/ffmpeg-nodes/register', (req, res) => nodesController.registerFFmpegNode(req, res));

// Heartbeats
router.post('/room-servers/heartbeat', (req, res) => nodesController.roomServerHeartbeat(req, res));
router.post('/ffmpeg-nodes/heartbeat', (req, res) => nodesController.ffmpegNodeHeartbeat(req, res));

// Node management (no auth required for simplified deployment)
router.get('/', (req, res) => nodesController.listNodes(req, res));
router.get('/:nodeId', (req, res) => nodesController.getNodeStatus(req, res));
router.delete('/:nodeId', (req, res) => nodesController.removeNode(req, res));

export default router;