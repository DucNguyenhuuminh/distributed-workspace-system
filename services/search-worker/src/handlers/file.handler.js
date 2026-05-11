const {EVENTS} = require('shared');
const chromaService = require('../config/chroma.config');
const extractService = require('../services/extract.service');
const embedService = require('../services/embed.service');

async function indexDocument({documentId, objectName, mimeType, workspaceId, uploadedBy}) {
    if (!extractService.isSupportedMime(mimeType)) {
        console.log(`[FileHandler] Skipping unsupported MIME type: ${mimeType}`);
        return;
    }

    const buffer = await extractService.downloadFile(objectName);
    const text = await extractService.extract(buffer, mimeType);

    if (!text || text.length === 0) {
        console.log(`[FileHandler]  No text extracted from document ${documentId}`);
        return;
    }

    const embedding = await embedService.embed(text.slice(0,512));

    await chromaService.upsert({
        id: documentId,
        embedding,
        document: text.slice(0, 5000),
        metadata: {documentId, workspaceId: workspaceId || null, uploadedBy, mimeType},
    });

    console.log(`[FileHandler] Indexed: ${documentId}`);
}

//---------HANDLERS---------
const fileHandlers = {
  [EVENTS.FILE_UPLOAD]:   async (job) => {
    console.log(`[FileHandler] FILE_UPLOAD — ${job.data.documentId}`);
    await indexDocument(job.data);
  },
  [EVENTS.FILE_MERGED]:   async (job) => {
    console.log(`[FileHandler] FILE_MERGED — ${job.data.documentId}`);
    await indexDocument(job.data);
  },
  [EVENTS.FILE_RENAMED]:  async (job) => {
    console.log(`[FileHandler] FILE_RENAMED — ${job.data.documentId}`);
  },
  [EVENTS.FILE_TRASHED]:  async (job) => {
    const { documentId } = job.data;
    console.log(`[FileHandler] FILE_TRASHED — ${documentId}`);
    await chromaService.deleteById(documentId);
  },
  [EVENTS.FILE_RESTORED]: async (job) => {
    console.log(`[FileHandler] FILE_RESTORED — ${job.data.documentId}`);
    await indexDocument(job.data);
  },
  [EVENTS.FILE_MOVED]:    async (job) => {
    const { documentId, objectName, mimeType, newWorkspaceId, uploadedBy } = job.data;
    console.log(`[FileHandler] FILE_MOVED — ${documentId}`);
    await chromaService.deleteById(documentId);
    await indexDocument({ documentId, objectName, mimeType, workspaceId: newWorkspaceId, uploadedBy });
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