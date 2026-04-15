const {minioClient, bucketName} = require('../config/minio.config');

//-------POST /api/storage/multipart/init-----------
async function initMultipartUpload(req,res) {
    try {
        const {filename, mimeType, totalChunks} = req.body;

        if(!totalChunks || totalChunks <= 0) {
            return res.status(400).json({message: "Lack of chunks"});
        }

        const objectName = `file/${Date.now()}_${filename}`;
        
        const uploadId = await minioClient.initiateNewMultipartUpload(
            bucketName,
            objectName,
            {'Content-Type': mimeType}
        );

        const presignedURLs = await Promise.all(
            Array.from({length: totalChunks}, (_,i) => {
                const partNumber = i+1;
                return minioClient.presignedUrl(
                    'PUT',
                    bucketName,
                    objectName,
                    7*3600,
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
        console.error("[storage-service] initMultipartUpload error:", err.response?.data || err.message);
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/storage/multipart/complete-----------
async function completeMultipartUpload(req,res) {
    try {
        const {uploadId, objectName, etags} = req.body;
        const sortedEtags = [...etags].map(e => ({
            part: e.partNumber,
            etag: e.etag
        })).sort((a,b) => a.part - b.part);

        await minioClient.completeMultipartUpload(
            bucketName,
            objectName,
            uploadId,
            sortedEtags
        );

        return res.json({message: "Merge chunks successfully", data: {objectName}});
    } catch(err) {
        console.error("[storage-service] completeMultipartUpload error:", err.response?.data || err.message);
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/storage/file/url-----------
async function getDownloadURL(req,res) {
    try {
        const {objectName, originalName, action} = req.query;

        if (!objectName) {
            return res.status(400).json({message: "Object name is required"});
        }

        let resHeaders = {};
        if (action === 'download') {
            resHeaders = {'response-content-disposition': `attachment; filename="${originalName|| 'file'}"`};
        }else {
            resHeaders = {'response-content-disposition': 'inline'};
        }

        const url = await minioClient.presignedGetObject(
            bucketName,
            objectName,
            7*3600,
            resHeaders
        );
        return res.json({message: "Get download URL successfully", data: {url}});
    } catch(err) {
        console.error("[storage-service] getDownloadURL error:", err.response?.data || err.message);
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/storage/file/-----------
async function deleteDupFile(req,res) {
    try {
        const {objectName} = req.body;

        await minioClient.removeObject(bucketName, objectName);
        return res.json({message: "Delete file successfully"});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {initMultipartUpload, completeMultipartUpload, getDownloadURL, deleteDupFile};