const axios = require('axios');
const TIKA_URL = process.env.TIKA_URL;

const TEXT_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/html',
    'text/csv',
];

const IMAGE_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/bmp',
];

function getMimeCategory(mimeType) {
    if (TEXT_MIME_TYPES.includes(mimeType))  return 'text';
    if (IMAGE_MIME_TYPES.includes(mimeType)) return 'image'; 
    return null;
}

function isSupportedMime(mimeType) {
    return getMimeCategory(mimeType) !== null;
}

async function downloadFile(objectName, originalName) {
    if (!objectName) {
        throw new Error(`downloadFile: objectName is required, got: ${objectName}`);
    }

    const response = await axios.get(`${process.env.STORAGE_SERVICE_URL}/api/storage/file/url`,
        {params: {objectName, originalName, action: 'view'}}
    );
    
    const {url} = response.data.data;
    if (!url) {
        throw new Error('No download URL returned from storage service');
    }
    console.log(`[ExtractService] URL tải file thực tế là: ${url}`);
    const fileResponse = await axios.get(url, {responseType: 'arraybuffer'});
    return Buffer.from(fileResponse.data);
}

async function extractText(buffer, mimeType) {
    try {
        const response = await axios.put(`${TIKA_URL}/tika`, buffer, {
            headers: {
                'Content-Type': mimeType,
                'Accept': 'text/plain',
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 30000,
        });

        const text = response.data?.trim();
        return text?.length > 0 ? text : null;
    } catch(err) {
        console.error(`[ExtractionService] Tika error for ${mimeType}:`, err.message);
        return null;
    }
}

module.exports = {
    isSupportedMime, 
    downloadFile, 
    extractText,
    getMimeCategory,
};