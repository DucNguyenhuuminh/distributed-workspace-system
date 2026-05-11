const {pipeline} = require('@xenova/transformers');

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
let extractor = null;

async function loadModel() {
    if (!extractor) {
        console.log('[EmbedService] Loading model......');
        extractor = await pipeline('feature-extraction', MODEL_NAME);
        console.log('[EmbedService] Model loaded');
    }
    return extractor;
}

async function embed(text) {
    const model = await loadModel();
    const output = await model(text, {
        pooling: 'mean',
        normalize: true,
    });
    return Array.from(output.data);
}

async function embedBatch(texts) {
    const model = await loadModel();
    const outputs = await model(texts, {
        pooling: 'mean',
        normalize: true,
    });
    return Array.from(outputs.data);
}

module.exports = {embed, embedBatch, loadModel, MODEL_NAME};