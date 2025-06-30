import { Router } from 'express';
import { RecordingController } from '../controllers/RecordingController';
import { OrchestrationService } from '../services/OrchestrationService';

const router = Router();
const orchestrationService = new OrchestrationService();
const recordingController = new RecordingController(orchestrationService);

// Recording management routes (no auth required)
router.post('/start', (req, res) => recordingController.startRecording(req, res));
router.post('/:jobId/stop', (req, res) => recordingController.stopRecording(req, res));
router.get('/:jobId/status', (req, res) => recordingController.getRecordingStatus(req, res));
router.get('/active', (req, res) => recordingController.listActiveRecordings(req, res));
router.get('/history', (req, res) => recordingController.getRecordingHistory(req, res));

// Event handling (called by FFmpeg nodes)
router.post('/events', (req, res) => recordingController.handleRecordingEvent(req, res));

export default router;