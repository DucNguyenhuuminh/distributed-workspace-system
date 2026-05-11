const {createWorker, QUEUES} = require('shared');
const {fileProcessor} = require('../handlers/file.handler');
const {workspaceProcessor} = require('../handlers/workspace.handler');
const {folderProcessor} = require('../handlers/folder.handler');
const {notificationProcessor} = require('../handlers/noti.handler');
const { create } = require('../../../file-service/src/models/documents.model');

function startAllConsumers() {
    createWorker(QUEUES.FILE, fileProcessor, {concurrency: 3});
    console.log('[Consumer] file-queue');

    createWorker(QUEUES.FOLDER, folderProcessor, {concurrency: 5});
    console.log('[Consumer] folder-queue');

    createWorker(QUEUES.WORKSPACE, workspaceProcessor, {concurrency: 5});
    console.log('[Consumer] workspace-queue');

    createWorker(QUEUES.NOTIFICATION, notificationProcessor, {concurrency: 10});
    console.log('[Consumer] notifaction-queue');

    createWorker(QUEUES.GENERAL, notificationProcessor, {concurrency: 5});
    console.log('[Consumer] general-queue');
}

module.exports = {startAllConsumers};