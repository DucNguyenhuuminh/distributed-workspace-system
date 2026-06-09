// const axios = require('axios');

// const HF_TOKEN = process.env.HF_TOKEN;
// const TEXT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
// const IMAGE_MODEL = 'sentence-transformers/clip-ViT-B-32';

// const HF_HEADERS = {
//     Authorization: `Bearer ${HF_TOKEN}`,
//     'Content-Type': 'application/json',
// }

// async function callWithRetry(url, payload, retries = 3) {
//     for (let i = 0; i < retries; i++) {
//         try {
//             const res = await axios.post(url, payload, {headers: HF_HEADERS, timeout: 30000});
//             return res.data;
//         } catch(err) {
//             const status = err.response?.status;
//             if (status === 503 && i < retries -1) {
//                 console.log(`[EmbedService] Model loading, retry ${i + 1}/${retries}...`);
//                 await new Promise(resolve => setTimeout(resolve,5000));
//                 continue;
//             }
//             throw err;
//         }
//     }
// }

class PipelineSingleton {
  static textTask  = 'feature-extraction';
  static textModel = 'Xenova/all-MiniLM-L6-v2';
  static textInstance = null;

  static imageTask  = 'image-feature-extraction';
  static imageModel = 'Xenova/clip-vit-base-patch32';
  static imageInstance = null;

  static async getTextInstance() {
    if (!this.textInstance) {
      console.log('[EmbedService] Loading text model...');
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      this.textInstance = await pipeline(this.textTask, this.textModel);
      console.log('[EmbedService] Text model ready');
    }
    return this.textInstance;
  }

  static async getImageInstance() {
    if (!this.imageInstance) {
      console.log('[EmbedService] Loading CLIP model...');
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      this.imageInstance = await pipeline(this.imageTask, this.imageModel);
      console.log('[EmbedService] Image model ready');
    }
    return this.imageInstance;
  }
}

async function embedText(text) {
    if (!text || text.trim().length === 0) {
        return null;
    }
    // const result = await callWithRetry(`https://api-inference.huggingface.co/pipeline/feature-extraction/${TEXT_MODEL}`,
    //     {inputs: text.slice(0,512)}
    // );
    // const vector = Array.isArray(result[0]) ? result[0] : result;
    // return vector;
    try {
        const extractor = await PipelineSingleton.getTextInstance();
        const output    = await extractor(text.slice(0, 512), {
        pooling:   'mean',
        normalize: true,
        });
        return Array.from(output.data);
    } catch (err) {
        console.error('[EmbedService] Text embed error:', err.message);
        return null;
    }
}

async function embedImage(imageBuffer) {
    if (!imageBuffer) {
        return null;
    }
    // const base64 = imageBuffer.toString('base64');
    // const result = await callWithRetry(`https://api-inference.huggingface.co/pipeline/feature-extraction/${IMAGE_MODEL}`,
    //     {inputs: base64}
    // );
    // const vector = Array.isArray(result[0]) ? result[0] : result;
    // return vector;
    try {
        const extractor = await PipelineSingleton.getImageInstance();
        const base64Str = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
        const output    = await extractor(base64Str);
        return Array.from(output.data);
    } catch (err) {
        console.error('[EmbedService] Image embed error:', err.message);
        return null;
    }
}

module.exports = {
    embedText,
    embedImage,
};