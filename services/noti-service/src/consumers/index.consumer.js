const {createWorker, QUEUES} = require('shared');
const {notificationProcessor} = require('../handlers/noti.handler');
const {workspaceProcessor} = require('../handlers/workspace.handler');

function startAllConsumers() {
    createWorker(QUEUES.WORKSPACE, workspaceProcessor, {concurrency: 5});
    console.log('[Consumer] workspace-queue');

    createWorker(QUEUES.NOTIFICATION, notificationProcessor, {concurrency: 10});
    console.log('[Consumer] notification-queue');

    createWorker(QUEUES.GENERAL, notificationProcessor, {concurrency: 5});
    console.log('[Consumer] general-queue');
}

module.exports = {startAllConsumers};