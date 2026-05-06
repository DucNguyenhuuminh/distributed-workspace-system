const {EVENTS} = require('shared');
const chromaService = require('../config/chroma.config');
const extractService = require('../services/extract.service');

async function indexDocument({documentId, objectName, mimeType, workspaceId, uploadedBy}) {
    if (!extractService.isSupportedMime(mimeType)) {
        console.log(`[FileHandler] Skipping unsupported MIME type: ${mimeType}`);
        return;
    }

    const buffer = await extractService.downloadFile(objectName);
    const text = await extractService.extractText(buffer,mimeType);

    if (!text || text.length === 0) {
        console.log(`[FileHandler]  No text extracted from document ${documentId}`);
        return;
    }

    await chromaService.upsertDocuments({
        id: documentId,
        document: text.slice(0, 5000),
        metadata: {documentId, workspaceId: workspaceId || null, uploadedBy, mimeType},
    });

    console.log(`[FileHandler] Indexed: ${documentId}`);
}

//---------HANDLERS---------
const fileHandlers = {
    [EVENTS.FILE_UPLOAD]: async (job) => {
        console.log(`[FileHandler] FILE_UPLOAD - ${job.data.documentId}`);
        await indexDocument(job.data);
    },

    [EVENTS.FILE_MERGED]: async (job) => {
        console.log(`[FileHandler] FILE_MERGED - ${job.data.documentId}`);
        await indexDocument(job.data);
    },

    [EVENTS.FILE_RENAMED]: async (job) => {
        const { documentId, newName } = job.data;
        console.log(`[FileHandler] FILE_RENAMED — ${documentId}`);
    },

    [EVENTS.FILE_TRASHED]: async (job) => {
        const { documentId } = job.data;
        console.log(`[FileHandler] FILE_TRASHED — ${documentId}`);
        await chromaService.deleteById(documentId);
        console.log(`[FileHandler] Deleted from ChromaDB: ${documentId}`);
    },

    [EVENTS.FILE_RESTORED]: async (job) => {
        console.log(`[FileHandler] FILE_RESTORED — ${job.data.documentId}`);
        await indexDocument(job.data);
    },

    [EVENTS.FILE_MOVED]: async (job) => {
        const { documentId, objectName, mimeType, newFolderId, newWorkspaceId, uploadedBy,} = job.data;
        console.log(`[FileHandler] FILE_MOVED — ${documentId}`);
        await chromaService.deleteById(documentId);
        await indexDocument({
            documentId,
            objectName,
            mimeType,
            workspaceId: newWorkspaceId || null,
            uploadedBy:  uploadedBy,
        });
        console.log(`[FileHandler] Deleted from ChromaDB: ${documentId} `);
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