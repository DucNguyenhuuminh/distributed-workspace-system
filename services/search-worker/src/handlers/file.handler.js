const {EVENTS, jobIdFor, QUEUES, DEFAULT_JOB_OPTIONS, addJob} = require('shared');
const chromaService = require('../config/chroma.config');
const extractService = require('../services/extract.service');
const embedService = require('../services/embed.service');

async function indexDocument({fileId, objectName, mimeType, originalName, workspaceId, uploadedBy}) {
  if (!fileId || !objectName) {
    console.error('[FileHandler] Missing fileId or objectName:', {fileId, objectName});
    return;
  }
  const category = extractService.getMimeCategory(mimeType);
  if (!category) {
    console.log(`[FileHandler] Skip — unsupported MIME: ${mimeType}`);
    return;
  }

  try {
    console.log(`[FileHandler] Processing: fileId: ${fileId}, path: ${objectName}`);
    const buffer = await extractService.downloadFile(objectName, originalName);

    let embedding;
    let documentText;
    
    if (category === 'text') {
      const text = await extractService.extractText(buffer, mimeType);
      if (!text || text.length === 0) {
        console.log(`[FileHandler] Skip — no text: ${fileId}`);
        return;
      }
      const meta = await extractService.extractMetadata(buffer, mimeType);
      const enrichedText = buildEnrichedText(text, meta);
      embedding    = await embedService.embed(enrichedText.slice(0, 512));
      documentText = enrichedText.slice(0, 5000);
    } else if (category === 'image') {
      embedding    = await embedService.embedImage(buffer, mimeType);
      documentText = `[Image] ${originalName || 'image file'}`;
    }

    await chromaService.upsert({
    id:        fileId,
    embedding,
    document:  documentText,
    metadata: {
      documentId: fileId,
      workspaceId:  workspaceId  || '',
      uploadedBy:   uploadedBy   || '',
      mimeType,
      contentType:  category, 
      originalName: originalName || '',
    },
  })

    console.log(`[FileHandler] Indexed: ${fileId}`);
  } catch(err) {
    console.error(`[FileHandler] Failed to index ${fileId}:`,err.message);
    throw err;
  }
}

function buildEnrichedText(text, meta) {
  const parts = [text];

  // Thêm tiêu đề tài liệu nếu có
  if (meta['dc:title'])         parts.unshift(`Title: ${meta['dc:title']}`);
  if (meta['dc:subject'])       parts.push(`Subject: ${meta['dc:subject']}`);
  if (meta['dc:description'])   parts.push(`Description: ${meta['dc:description']}`);

  // Thêm tác giả
  if (meta['dc:creator'])       parts.push(`Author: ${meta['dc:creator']}`);

  // Keywords giúp tìm kiếm tốt hơn
  if (meta['meta:keyword'])     parts.push(`Keywords: ${meta['meta:keyword']}`);

  return parts.join('\n');
}

async function deleteFromChroma(ids) {
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    if (!id)  continue;
    try {
      await chromaService.deleteById(String(id));
      console.log(`[FileHandler] Deleted from ChromaDB: ${id}`);
    } catch(err) {
      console.error(`[FileHandler] Failed to delete ${id} from ChromaDB:`, err.message);
    }
  }
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

//---------HANDLERS---------
const fileHandlers = {
  [EVENTS.FILE_MERGED]:   async (job) => {
    const data = job.data;
    console.log(`[FileHandler] FILE_MERGED —`, {fileId: data.fileId, objectName: data.objectName});
    if (!data.fileId || !data.objectName) {
      console.error('[FileHandler] Invalid FILE_MERGED data:', data);
      return;
    }
    await indexDocument(data);
    await forwardToNotification(EVENTS.FILE_MERGED,job.data);
  },

  [EVENTS.FILE_TRASHED]:  async (job) => {
    const { fileId, fileIds } = job.data;
    const idsToDelete = fileIds? fileIds : fileId;
    console.log(`[FileHandler] FILE_TRASHED — ${fileId}`);
    await deleteFromChroma(idsToDelete);
  },

  [EVENTS.FILE_RESTORED]: async (job) => {
    const {fileId, objectName, mimeType, originalName, workspaceId, uploadedBy} = job.data;
    console.log(`[FileHandler] FILE_RESTORED — ${fileId}`);
    await indexDocument({
      fileId, 
      objectName, 
      mimeType,
      originalName: originalName || ' ',
      workspaceId, 
      uploadedBy 
    });
  },

  [EVENTS.FILE_MOVED]:    async (job) => {
    const { fileId, objectName, mimeType, originalName, newWorkspaceId, uploadedBy } = job.data;
    console.log(`[FileHandler] FILE_MOVED — ${fileId}`);
    await chromaService.deleteById(fileId);
    await indexDocument({ 
      fileId, 
      objectName, 
      mimeType,
      originalName: originalName || ' ',
      workspaceId: newWorkspaceId || null, 
      uploadedBy 
    });
  },
};

//---------PROCESSOR---------
async function fileProcessor(job) {
    const handler = fileHandlers[job.name];
    if (!handler) {
        console.warn(`[FileHandler] Unknown event: ${job.name} - skipping`);
        return;
    }

    try {
        await handler(job);
    } catch(err) {
        console.error(`[FileHandler] Error processing ${job.name}:`, err.message);
        throw err;
    }
}

module.exports = {fileProcessor};