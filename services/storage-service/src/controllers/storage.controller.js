const {minioClient, bucketName} = require('../config/minio.config');

//-------POST /api/storage/multipart/init-----------
async function initMultipartUpload(req,res) {
    try {
        const {filename, content, totalChunks} = req.body;

        if(!totalChunks || totalChunks <= 0) {
            return res.status(400).json({message: "Lack of chunks"});
        }

        const objectName = `file/${Date.now()}_${filename}`;
        
        const uploadId = await minioClient.initiateNewMultipartUpload(
            bucketName,
            objectName,
            {'Content-Type': content}
        );

        const presignedURLs = await Promise.all(
            Array.from({length: totalChunks}, (_,i) => {
                const partNumber = i+1;
                return minioClient.presignedUrl(
                    'PUT',
                    bucketName,
                    objectName,
                    3600,
                    {
                        uploadId,
                        partNumber,
                    }
                );
            })
        );
    
        return res.status(201).json({message: "Init multipart upload successfully",
            data: {uploadId, objectName, presignedURLs}});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/storage/multipart/complete-----------
async function completeMultipartUpload(req,res) {
    try {
        const {uploadId, objectName, etags} = req.body;
        const sortedEtags = [...etags].sort((a,b) => a.partNumber - b.partNumber);

        await minioClient.completeMultipartUpload(
            bucketName,
            objectName,
            uploadId,
            sortedEtags
        );

        return res.json({message: "Merge chunks successfully", data: {objectName}});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {initMultipartUpload, completeMultipartUpload}