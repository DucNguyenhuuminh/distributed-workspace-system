const {EVENTS} = require('shared');
const chromaService = require('../config/chroma.config');
const extractService = require('../services/extract.service');
const embedService = require('../services/embed.service');

async function indexDocument({fileId, minioObjectPath, mimeType, originalName, workspaceId, uploadedBy}) {
  if (!fileId) {
    console.error('[FileHandler] Missing fileId:', {fileId, minioObjectPath});
    return;
  }
  if (!minioObjectPath) {
    console.error('[FileHandler] Missing minioObjectPath:', {fileId, minioObjectPath});
  }
  if (!extractService.isSupportedMime(mimeType)) {
      console.log(`[FileHandler] Skipping unsupported MIME type: ${mimeType}`);
      return;
  }

  try {
    console.log(`[FileHandler] Processing: ${fileId, minioObjectPath}`);
    const buffer = await extractService.downloadFile(minioObjectPath, originalName);
    const text = await extractService.extract(buffer, mimeType);

    if (!text || text.length === 0) {
        console.log(`[FileHandler]  No text extracted from document ${fileId}`);
        return;
    }

    const embedding = await embedService.embed(text.slice(0,512));

    await chromaService.upsert({
        id: fileId,
        embedding,
        document: text.slice(0, 5000),
        metadata: {fileId, workspaceId: workspaceId || null, uploadedBy, mimeType},
    });

    console.log(`[FileHandler] Indexed: ${fileId}`);
  } catch(err) {
    console.error(`[FileHandler] Failed to index ${fileId}:`,err.message);
    throw err;
  }
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

//---------HANDLERS---------
const fileHandlers = {
  [EVENTS.FILE_MERGED]:   async (job) => {
    const data = job.data;
    console.log(`[FileHandler] FILE_MERGED —`, {fileId: data.fileId, minioObjectPath: data.minioObjectPath});
    if (!data.fileId || !data.minioObjectPath) {
      console.error('[FileHandler] Invalid FILE_MERGED data:', data);
      return;
    }
    await indexDocument(data);
  },
  [EVENTS.FILE_RENAMED]:  async (job) => {
    console.log(`[FileHandler] FILE_RENAMED — ${job.data.fileId}`);
  },
  [EVENTS.FILE_TRASHED]:  async (job) => {
    const { fileId, fileIds } = job.data;
    const idsToDelete = fileIds? fileIds : fileId;
    console.log(`[FileHandler] FILE_TRASHED — ${fileId}`);
    await deleteFromChroma(idsToDelete);
  },
  [EVENTS.FILE_RESTORED]: async (job) => {
    const {fileId, minioObjectPath, mimeType, originalName, workspaceId, uploadedBy} = job.data;
    console.log(`[FileHandler] FILE_RESTORED — ${fileId}`);
    await indexDocument({
      fileId, 
      minioObjectPath, 
      mimeType,
      originalName: originalName || ' ',
      workspaceId, 
      uploadedBy 
    });
  },
  [EVENTS.FILE_MOVED]:    async (job) => {
    const { fileId, minioObjectPath, mimeType, originalName, newWorkspaceId, uploadedBy } = job.data;
    console.log(`[FileHandler] FILE_MOVED — ${fileId}`);
    await chromaService.deleteById(documentId);
    await indexDocument({ 
      fileId, 
      minioObjectPath, 
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