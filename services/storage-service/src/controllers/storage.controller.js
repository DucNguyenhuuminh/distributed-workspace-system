const {s3Client, bucketName} = require('../config/minio.config');
const {
    CreateMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    UploadPartCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

//-------POST /api/storage/multipart/init-----------
async function initMultipartUpload(req,res) {
    try {
        const {filename, mimeType, totalChunks} = req.body;

        if(!totalChunks || totalChunks <= 0) {
            console.warn(`[StorageController] Init failed: Lack of chunks for '${filename}'`);
            return res.status(400).json({message: "Lack of chunks"});
        }

        const objectName = `file/${Date.now()}_${filename}`;
        
        const command = new CreateMultipartUploadCommand({
            Bucket: bucketName,
            Key: objectName,
            ContentType: mimeType,
        });
        const uploadRes = await s3Client.send(command);
        const uploadId = uploadRes.UploadId;

        const presignedURLs = await Promise.all(
            Array.from({length: totalChunks}, (_,i) => {
                const partNumber = i+1;
                const partCommand = new UploadPartCommand({
                    Bucket: bucketName,
                    Key: objectName,
                    UploadId: uploadId,
                    PartNumber: partNumber,
                });
                return await getSignedUrl(s3Client, partCommand, {expiresIn: 25200});
            })
        );
        
        console.log(`[StorageController] Successfully generated ${totalChunks} presigned URLs. UploadId: ${uploadId}`);
        return res.status(201).json({
            message: "Init multipart upload successfully",
            data: {uploadId, objectName, presignedURLs}
        });
    } catch(err) {
        console.error("[StorageController] initMultipartUpload error:", err.response?.data || err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/storage/multipart/complete-----------
async function completeMultipartUpload(req,res) {
    try {
        const {uploadId, objectName, etags} = req.body;
        const sortedEtags = [...etags].map(e => ({
            PartNumber: e.partNumber,
            ETag: e.etag
        })).sort((a,b) => a.PartNumber - b.PartNumber);

        const command = new CompleteMultipartUploadCommand({
            Bucket: bucketName,
            Key: objectNamem,
            UploadId: uploadId,
            MultipartUpload: {Parts: sortedEtags}
        });

        await s3Client.send(command);

        console.log(`[StorageController] Successfully merged chunks for object: ${objectName}`);
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
            console.warn(`[StorageController] Get URL failed: Object name is missing`);
            return res.status(400).json({message: "Object name is required"});
        }

        let responseDisposition = action === 'download'
            ? `attachment; filename="${originalName || 'file'}"`
            : 'inline';
        
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectName,
            ResponseContentDisposition: responseDisposition
        });

        const url = await getSignedUrl(s3Client, command, {expiresIn: 25200});
        console.log(`[StorageController] Successfully generated presigned URL for: ${objectName}`);
        return res.json({message: "Get download URL successfully", data: {url}});
    } catch(err) {
        console.error("[StorageController] getDownloadURL error:", err.response?.data || err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/storage/file/-----------
async function deleteDupFile(req,res) {
    try {
        const {objectName} = req.body;

        const command = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: objectName,
        });

        await s3Client.send(command); 
        console.log(`[StorageController] Successfully deleted physical object: ${objectName}`);
        return res.json({message: "Delete file successfully"});
    } catch(err) {
        console.error("[StorageController] System error in deleteDupFile:", err.message);
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    initMultipartUpload, 
    completeMultipartUpload, 
    getDownloadURL, 
    deleteDupFile
};