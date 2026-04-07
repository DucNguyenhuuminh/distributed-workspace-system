const Minio = require('minio');

const minioClient =  new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
});

const bucketName = process.env.MINIO_BUCKET;
const initMinio = async () => {
    try {
        const exists = await minioClient.bucketExists(bucketName);
        if (!exists) {
            await minioClient.makeBucket(bucketName);
            console.log(`[storage-service] MinIO Bucket ${bucketName} created`);
        }else {
            console.log(`[storage-service] MinIO Bucket ${bucketName} already exists`);
        }
    } catch(err) {
        console.error('[storage-service] MinIO init error:', err.message);
        throw err;
    }
}

module.exports = {minioClient, bucketName, initMinio};