// const Minio = require('minio');

// const minioClient =  new Minio.Client({
//     endPoint: process.env.MINIO_ENDPOINT,
//     port: parseInt(process.env.MINIO_PORT) || 9000,
//     useSSL: true,
//     accessKey: process.env.MINIO_ACCESS_KEY,
//     secretKey: process.env.MINIO_SECRET_KEY,
// });

// const bucketName = process.env.MINIO_BUCKET;
// async function initMinio() {
//     try {
//         const exists = await minioClient.bucketExists(bucketName);
//         if (!exists) {
//             await minioClient.makeBucket(bucketName);
//             console.log(`[storage-service] MinIO Bucket "${bucketName}" created`);
//         }else {
//             console.log(`[storage-service] MinIO Bucket "${bucketName} already exists"`);
//         }
//         console.log(`[storage-service] MinIO initialized for bucket: ${bucketName}`)
//     } catch(err) {
//         console.error('[storage-service] MinIO init error:', err.message);
//         throw err;
//     }
// }

const {S3Client} = require('@aws-sdk/client-s3');

const endpointUrl = process.env.MINIO_ENDPOINT.startsWith('http')
    ? `${process.env.MINIO_ENDPOINT}/storage/v1/s3`
    : `https://${process.env.MINIO_ENDPOINT}/storage/v1/s3`;

const s3Client = new S3Client({
    forcePathStyle: true,
    region: 'ap-southeast-2',
    endpoint: endpointUrl,
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY,
    }
});

const bucketName = process.env.MINIO_BUCKET;

async function initMinio() {
    try {
        console.log(`[storage-service] AWS S3 Client initialized for bucket: ${bucketName}`);
    } catch(err) {
        console.error('[storage-service] S3 init error:', err);
        throw err;
    }
}

module.exports = {
    s3Client,
    bucketName,
    initMinio
}