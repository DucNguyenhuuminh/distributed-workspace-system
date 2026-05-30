const {createWorker, QUEUES} = require('shared');
const {fileProcessor} = require('../handlers/file.handler');
const {workspaceProcessor} = require('../handlers/workspace.handler');
const {notificationProcessor} = require('../handlers/noti.handler');

function startAllConsumers() {
    createWorker(QUEUES.NOTIFICATION, notificationProcessor, {concurrency: 10});
    console.log('[Consumer] notification-queue');

    createWorker(QUEUES.GENERAL, notificationProcessor, {concurrency: 5});
    console.log('[Consumer] general-queue');
}

module.exports = {startAllConsumers};