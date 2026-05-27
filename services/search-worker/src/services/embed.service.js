let pipeline;
let env;
let RawImage;

const initTransformers = async() => {
    if (!pipeline || !env || !RawImage) {
        const transformers = await import('@xenova/transformers');
        pipeline = transformers.pipeline;
        env = transformers.env;
        RawImage = transformers.RawImage;
        env.backends.onnx.wasm.numThreads = 1;
    }
};

const TEXT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';

let textExtractor = null;
let clipExtractor = null;

async function loadTextModel() {
    await initTransformers();
    if (!textExtractor) {
        console.log('[EmbedService] Loading model......');
        textExtractor = await pipeline('feature-extraction', TEXT_MODEL);
        console.log('[EmbedService] Model loaded');
    }
    return textExtractor;
}

async function loadClipModel() {
    await initTransformers();
    if (!clipExtractor) {
        console.log('[EmbedService] Loading CLIP model...');
        clipExtractor = await pipeline('zero-shot-image-classification', CLIP_MODEL, {
            quantized = true;
        });
        console.log('[EmbedService] CLIP model loaded');
    }
    return clipExtractor;
}

async function embed(text) {
    const model = await loadTextModel();
    const output = await model(text, {
        pooling: 'mean',
        normalize: true,
    });
    return Array.from(output.data);
}

async function embedImage(imageBuffer, mimeType) {
    await initTransformers();
    const model = await loadClipModel();
    const image = await RawImage.fromBlob(
        new Blob([imageBuffer], {type: mimeType})
    );
    const output = await model.processor(image);
    const features = await model.model.get_image_features(output);
    return Array.from(features.data); 
}

// async function embedBatch(texts) {
//     const model = await loadModel();
//     const outputs = await model(texts, {
//         pooling: 'mean',
//         normalize: true,
//     });
//     return Array.from(outputs.data);
// }

async function loadModels() {
    await loadTextModel();
    await loadClipModel();
}

module.exports = {
    embed, 
    embedImage, 
    loadModels, 
    TEXT_MODEL, 
    CLIP_MODEL
};