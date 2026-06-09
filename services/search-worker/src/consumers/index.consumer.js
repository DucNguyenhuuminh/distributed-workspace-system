const {createWorker, QUEUES} = require('shared');
const {fileProcessor} = require('../handlers/file.handler');

function startAllConsumers() {
    createWorker(QUEUES.FILE, fileProcessor, {concurrency: 1, lockDuration: 300000, maxStalledCount: 5, retryDelay: 10000});
    console.log('[Consumer] file-queue ready for AI Search');
}

module.exports = {startAllConsumers};