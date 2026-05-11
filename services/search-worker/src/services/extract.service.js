const axios = require('axios');
const TIKA_URL = process.env.TIKA_URL;

const SUPPORTED_MIME_TYPES = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain',
    'text/html',
    'text/csv',
    // Image
    'image/png',
    'image/jpeg',
    'image/jpg',
];

function isSupportedMime(mimeType) {
    return SUPPORTED_MIME_TYPES.includes(mimeType);
}

async function downloadFile(objectName) {
    const response = await axios.get(`${process.env.STORAGE_SERVICE_URL}/api/storage/file/url`,
        {params: {objectName, action: 'viewer'}}
    );
    const {url} = response.data.data;

    const fileResponse = await axios.get(url, {responseType: 'arraybuffer'});
    return Buffer.from(fileResponse.data);
}

async function extract(buffer, mimeType) {
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

module.exports = {isSupportedMime, downloadFile, extract};