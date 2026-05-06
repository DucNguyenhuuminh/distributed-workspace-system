const { EVENTS }    = require('shared');
const chromaService = require('../config/chroma.config');

const workspaceHandlers = {

  [EVENTS.WORKSPACE_CREATED]: async (job) => {
    const { workspaceId, createdBy } = job.data;
    console.log(`[WorkspaceHandler] WORKSPACE_CREATED — ${workspaceId}`);
  },

  // Xóa workspace → xóa toàn bộ vector của workspace khỏi ChromaDB
  [EVENTS.WORKSPACE_DELETED]: async (job) => {
    const { workspaceId } = job.data;
    console.log(`[WorkspaceHandler] WORKSPACE_DELETED — ${workspaceId}`);

    await chromaService.deleteByWorkspace(workspaceId);
    console.log(`[WorkspaceHandler] Deleted all vectors for workspace: ${workspaceId}`);
  },

  [EVENTS.MEMBER_ADDED]: async (job) => {
    const { workspaceId, targetUserId } = job.data;
    console.log(`[WorkspaceHandler] MEMBER_ADDED — ws: ${workspaceId}, user: ${targetUserId}`);
    // TODO: gửi notification
  },

  [EVENTS.MEMBER_REMOVED]: async (job) => {
    const { workspaceId, targetUserId } = job.data;
    console.log(`[WorkspaceHandler] MEMBER_REMOVED — ws: ${workspaceId}, user: ${targetUserId}`);
    // TODO: gửi notification
  },
};

async function workspaceProcessor(job) {
  const handler = workspaceHandlers[job.name];
  if (!handler) {
    console.warn(`[WorkspaceHandler] Unknown event: ${job.name}`);
    return;
  }
  try {
    await handler(job);
  } catch (err) {
    console.error(`[WorkspaceHandler] Error processing ${job.name}:`, err.message);
    throw err;
  }
}

module.exports = { workspaceProcessor };