const {s3Client, bucketName} = require('../config/minio.config');
const {
    CreateMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    ListPartsCommand,
    UploadPartCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

//==========HELPER===========
const sanitizeFilename = (str) => {
    if (!str) return "unnamed_file";
    return str
        .normalize("NFD") 
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D") 
        .replace(/[^a-zA-Z0-9.\-_]/g, "_")
        .replace(/_+/g, "_");
};
//=============================

//==========CONTROLLER===========
//-------POST /api/storage/multipart/init-----------
async function initMultipartUpload(req,res) {
    try {
        const {filename, mimeType, totalChunks} = req.body;

        if(!totalChunks || totalChunks <= 0) {
            console.warn(`[StorageController] Init failed: Lack of chunks for '${filename}'`);
            return res.status(400).json({message: "Lack of chunks"});
        }

        const safeFilename = sanitizeFilename(filename);
        const objectName = `file/${Date.now()}_${safeFilename}`;
        
        const command = new CreateMultipartUploadCommand({
            Bucket: bucketName,
            Key: objectName,
            ContentType: mimeType,
        });
        const uploadRes = await s3Client.send(command);
        const uploadId = uploadRes.UploadId;

        const presignedURLs = await Promise.all(
            Array.from({length: totalChunks},async (_,i) => {
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
        const {uploadId, objectName} = req.body;
        console.log(`[StorageController] Fetching ETags from S3 for UploadId: ${uploadId}`);
        const listCommand = new ListPartsCommand({
            Bucket: bucketName,
            Key: objectName,
            UploadId: uploadId
        });

        const listRes = await s3Client.send(listCommand);
        console.log("[DEBUG] Supabase ListParts Result:", JSON.stringify(listRes.Parts, null, 2));
        if (!listRes.Parts || listRes.Parts.length === 0) {
            return res.status(400).json({messsage: "No uploaded chunks found on S3"});
        }

        const sortedEtags = listRes.Parts.map((p) => {
            let etagVal = p.ETag || p.etag;

            if (typeof etagVal === 'string' && !etagVal.startsWith('"')) {
                etagVal = `"${etagVal}"`;
            }

            return {
                PartNumber: Number(p.PartNumber), 
                ETag: String(etagVal)             
            };
        }).sort((a, b) => a.PartNumber - b.PartNumber);

        const command = new CompleteMultipartUploadCommand({
            Bucket: bucketName,
            Key: objectName,
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