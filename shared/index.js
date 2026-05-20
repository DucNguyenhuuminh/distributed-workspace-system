const {authMiddleware,verifyToken,requireRole} = require('./middlewares/auth.middleware');
const {validateRequest} = require('./middlewares/validate.middleware');
const {getQueue, addJob} = require('./queue/queueProducer');
const {createWorker} = require('./queue/queueWorker');
const {EVENTS,DEFAULT_JOB_OPTIONS, queueForEvent, jobIdFor,QUEUES, EVENT_QUEUE_MAP} = require('./queue/queue.config');

module.exports = {authMiddleware, verifyToken, requireRole, validateRequest,
    getQueue, addJob, createWorker,
    EVENTS,DEFAULT_JOB_OPTIONS, queueForEvent, jobIdFor, QUEUES, EVENT_QUEUE_MAP
};