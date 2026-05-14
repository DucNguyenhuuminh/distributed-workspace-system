const { EVENTS, addJob, QUEUES, jobIdFor, DEFAULT_JOB_OPTIONS }    = require('shared');
const chromaService = require('../config/chroma.config');

const forwardToNotification = async (eventName, data) => {
  try {
    const jobId = jobIdFor(`${eventName}_noti`, data.workspaceId || Date.now());
    await addJob(QUEUES.NOTIFICATION, eventName, data, {...DEFAULT_JOB_OPTIONS, jobId});
    console.log(`[WorkspaceHandler] Redirect ${eventName} to notification-queue`);
  } catch(err) {
    console.error(`[NotificationHandler] Error redirecting ${eventName} to notification-queue:`,err.message);
  }
}

const workspaceHandlers = {

  [EVENTS.WORKSPACE_CREATED]: async (job) => {
    const { workspaceId, createdBy } = job.data;
    console.log(`[WorkspaceHandler] WORKSPACE_CREATED — ${workspaceId} by ${createdBy}`);
    await forwardToNotification(EVENTS.WORKSPACE_CREATED,job.data);
  },

  [EVENTS.WORKSPACE_DELETED]: async (job) => {
    const { workspaceId, name, actorId, memberIds } = job.data;
    console.log(`[WorkspaceHandler] WORKSPACE_DELETED — ${workspaceId}`);

    await chromaService.deleteByWorkspace(workspaceId);
    console.log(`[WorkspaceHandler] Deleted all vectors for workspace: ${workspaceId}`);
    await forwardToNotification(EVENTS.WORKSPACE_DELETED,job.data);
  }
};

async function workspaceProcessor(job) {
  const handler = workspaceHandlers[job.name];
  if (!handler) {
    console.warn(`[WorkspaceHandler] Unknown event: ${job.name} -data: `,job.data);
    return;
  }
  try {
    await handler(job);
  } catch (err) {
    console.error(`[WorkspaceHandler] Error processing ${job.name}:`, {
      workspaceId: job.data?.workspaceId,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

module.exports = { workspaceProcessor };