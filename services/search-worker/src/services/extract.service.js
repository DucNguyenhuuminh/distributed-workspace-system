const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
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

async function extractText(buffer, mimeType) {
    if (mimeType === 'application/pdf') {
        const data = await pdfParse(buffer);
        return data.text?.trim() || null;
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') {
        const data = await mammoth.extractRawText({buffer});
        return data.value?.trim() || null;
    }

    if (mimeType === 'text/plain') {
        return buffer.toString('utf-8').trim() || null;
    }

    return null;
}

module.exports = {isSupportedMime, downloadFile, extractText};