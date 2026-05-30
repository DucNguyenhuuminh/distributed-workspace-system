const axios = require('axios');

const HF_TOKEN = process.env.HF_TOKEN;
const TEXT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const IMAGE_MODEL = 'sentence-transformers/clip-ViT-B-32';

const HF_HEADERS = {
    Authorization: `Bearer ${HF_TOKEN}`,
    'Content-Type': 'application/json',
}

async function callWitRetry(url, payload, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.post(url, payload, {headers: HF_HEADERS, timeout: 30000});
            return res.data;
        } catch(err) {
            const status = err.response?.status;
            if (status === 503 && i < retries -1) {
                console.log(`[EmbedService] Model loading, retry ${i + 1}/${retries}...`);
                await new Promise(resolve => setTimeout(resolve,5000));
                continue;
            }
            throw err;
        }
    }
}

async function embedText(text) {
    if (!text || text.trim().length === 0) {
        return null;
    }
    const result = await callWithRetry(`https://api-inference.huggingface.co/pipeline/feature-extraction/${TEXT_MODEL}`,
        {inputs: text.slice(0,512)}
    );
    const vector = Array.isArray(result[0]) ? result[0] : result;
    return vector;
}

async function embedImage(imageBuffer) {
    if (!imageBuffer) {
        return null;
    }
    const base64 = imageBuffer.toString('base64');
    const result = await callWithRetry(`https://api-inference.huggingface.co/pipeline/feature-extraction/${IMAGE_MODEL}`,
        {inputs: base64}
    );
    const vector = Array.isArray(result[0]) ? result[0] : result;
    return vector;
}

module.exports = {
    embedText,
    embedImage,
};