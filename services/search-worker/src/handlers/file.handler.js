const axios = require('axios');
const { EVENTS, getQueue, QUEUES, addJob, jobIdFor, DEFAULT_JOB_OPTIONS } = require('shared');
const embedService   = require('../services/embed.service');
const extractService = require('../services/extract.service');

const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL;

async function saveEmbedding(documentId, textEmbedding, imageEmbedding) {
  await axios.patch(
    `${FILE_SERVICE_URL}/api/files/internal/${documentId}/embedding`,
    { textEmbedding, imageEmbedding }
  );
}

async function indexDocument({ documentId, objectName, mimeType, originalName, workspaceId, uploadedBy }) {
  if (!documentId || !objectName) {
    console.warn('[FileHandler] Skip — missing documentId or objectName');
    return;
  }

  const category = extractService.getMimeCategory(mimeType);
  if (!category) {
    console.log(`[FileHandler] Skip — unsupported MIME: ${mimeType}`);
    return;
  }

  const buffer = await extractService.downloadFile(objectName, originalName);

  let textEmbedding  = null;
  let imageEmbedding = null;

  if (category === 'text') {
    const text = await extractService.extractText(buffer, mimeType);
    if (text && text.length > 0) {
      textEmbedding = await embedService.embedText(text);
    }
  } else if (category === 'image') {
    imageEmbedding = await embedService.embedImage(buffer);
  }

  if (!textEmbedding && !imageEmbedding) {
    console.log(`[FileHandler] Skip — no embedding generated: ${documentId}`);
    return;
  }

  await saveEmbedding(documentId, textEmbedding, imageEmbedding);
  console.log(`[FileHandler] Embedded [${category}]: ${documentId}`);
}

const forwardToNotification = async (eventName, data) => {
  try {
    const jobId = jobIdFor(`${eventName}_noti`, data.fileId || Date.now());
    await addJob(QUEUES.NOTIFICATION,eventName,data,{...DEFAULT_JOB_OPTIONS, jobId});
    console.log(`[FileHandler] Redirect ${eventName} to notification-queue`);
  } catch(err) {
    console.error(`[NotificationHandler] Error redirecting ${eventName} to notification-queue:`, err.message);
  }
}

async function removeEmbedding(documentId) {
  await axios.patch(
    `${FILE_SERVICE_URL}/api/files/internal/${documentId}/embedding`,
    { textEmbedding: null, imageEmbedding: null }
  );
}

const fileHandlers = {
  [EVENTS.FILE_MERGED]: async (job) => {
    const { fileId, objectName, mimeType, 
      originalName, workspaceId, uploadedBy } = job.data;
    console.log(`[FileHandler] FILE_MERGED — ${fileId}`);
    await indexDocument({
      fileId:   fileId,
      objectName:   objectName,
      mimeType,
      originalName: originalName || '',
      workspaceId,
      uploadedBy,
    });
    await forwardToNotification(EVENTS.FILE_MERGED,job.data);
  },

  [EVENTS.FILE_TRASHED]: async (job) => {
    const { fileId, fileIds, documentId } = job.data;
    const ids = fileIds ? fileIds : [documentId || fileId];
    console.log(`[FileHandler] FILE_TRASHED — ${ids.join(', ')}`);
    for (const id of ids) {
      if (id) await removeEmbedding(id).catch((e) => console.error(e.message));
    }
  },

  [EVENTS.FILE_RESTORED]: async (job) => {
    const { fileId, objectName, mimeType, originalName, 
      workspaceId, uploadedBy } = job.data;
    console.log(`[FileHandler] FILE_RESTORED — ${fileId}`);
    await indexDocument({
      documentId:   fileId,
      objectName:   objectName,
      mimeType,
      originalName: originalName || '',
      workspaceId,
      uploadedBy,
    });
  },

  [EVENTS.FILE_MOVED]: async (job) => {
    const { fileId, objectName, mimeType, originalName, 
      newWorkspaceId, workspaceId, uploadedBy } = job.data;
    const resolvedId = fileId;
    console.log(`[FileHandler] FILE_MOVED — ${resolvedId}`);
    await indexDocument({
      documentId:   resolvedId,
      objectName:   objectName,
      mimeType,
      originalName: originalName || '',
      workspaceId:  newWorkspaceId || workspaceId,
      uploadedBy,
    });
  },
};

async function fileProcessor(job) {
  const handler = fileHandlers[job.name];
  if (!handler) return;
  try {
    await handler(job);
  } catch (err) {
    console.error(`[FileHandler] Error: ${job.name}:`, err.message);
    throw err;
  }
}

module.exports = { fileProcessor };