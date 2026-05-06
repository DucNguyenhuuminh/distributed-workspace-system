const {EVENTS} = require('shared');

const folderHandlers = {

  [EVENTS.FOLDER_CREATED]: async (job) => {
    const { folderId, workspaceId } = job.data;
    console.log(`[FolderHandler] FOLDER_CREATED — ${folderId}`);
  },

  [EVENTS.FOLDER_RENAMED]: async (job) => {
    const { folderId } = job.data;
    console.log(`[FolderHandler] FOLDER_RENAMED — ${folderId}`);
  },

  [EVENTS.FOLDER_TRASHED]: async (job) => {
    const { folderId, allFolderIds } = job.data;
    console.log(`[FolderHandler] FOLDER_TRASHED — ${folderId}, total: ${allFolderIds?.length}`);
  },

  [EVENTS.FOLDER_RESTORED]: async (job) => {
    const { folderId } = job.data;
    console.log(`[FolderHandler] FOLDER_RESTORED — ${folderId}`);
  },

  [EVENTS.FOLDER_MOVED]: async (job) => {
    const { folderId, newParentId, newWorkspaceId } = job.data;
    console.log(`[FolderHandler] FOLDER_MOVED — ${folderId}`);
  },
};

async function folderProcessor(job) {
  const handler = folderHandlers[job.name];
  if (!handler) {
    console.warn(`[FolderHandler] Unknown event: ${job.name}`);
    return;
  }
  try {
    await handler(job);
  } catch (err) {
    console.error(`[FolderHandler] Error processing:`, err.message);
    throw err;
  }
}

module.exports = { folderProcessor };