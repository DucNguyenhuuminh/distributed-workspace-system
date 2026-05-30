const {createWorker, QUEUES} = require('shared');
const {fileProcessor} = require('../handlers/file.handler');

function startAllConsumers() {
    createWorker(QUEUES.FILE, fileProcessor, {concurrency: 3});
    console.log('[Consumer] file-queue ready for AI Search');
}

module.exports = {startAllConsumers};