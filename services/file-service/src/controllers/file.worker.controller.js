const axios = require('axios');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL || 'http://localhost:3003';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3005';

//-------POST /api/files-worker/hash-----------
async function checkHash(req,res) {
    try {
        const userId = req.user.userId;
        const {filename, hashString, workspaceId, folderId} = req.body;

        if (!hashString) {
            return res.status(400).json({message: "Hash string is required"});
        }

        const existingPhysicalFile = await PhysicalFile.findOne({hashString});
        if (existingPhysicalFile) {
            if (workspaceId) {
                try {
                    const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
                        {headers: {Authorization: req.headers.authorization}}
                    );
                    const workspace = response.data.data;
                    const member = workspace.members.find((m) => m.userId.toString() === userId);
                    if (!member || !member.permissions.includes('upload')) {
                        return res.status(403).json({message:"No permission 'upload in this workspace'"});
                    }
                } catch(err) {
                    if (err.response?.status === 403) {
                        return res.status(403).json({ message: 'No permission in this workspace' });
                    }
                    return res.status(500).json({ message: 'Cannot connect to workspace-service' });
                }
            }

            const newFile = await Document.create({
                origianlName: filename,
                workspaceId: workspaceId || null,
                folderId: folderId || null,
                physicalFileId: existingPhysicalFile._id,
                uploadedBy: userId
            });

            return res.status(200).json({message: "Deduplication successful. File copy instantly", data: {document: newFile, isDuplicate: true}});
        }
        return res.status(404).json({message: "File is new. Proceed to multipart upload", data: {isDuplicate: false}});

    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/files-worker/init-----------
async function initUpload(req,res) {
    try {
        const userId = req.user.userId;
        const {filename, totalChunks, mimeType, sizeBytes, workspaceId, folderId} = req.body;

        if (workspaceId) {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}}
                );
                const workspace = response.data.data;
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member || !member.permissions.includes('upload')) {
                    return res.status(403).json({message:"No permission 'upload in this workspace'"});
                }
            } catch(err) {
                if (err.response?.status === 403) {
                    return res.status(403).json({ message: 'No permission in this workspace' });
                }
                return res.status(500).json({ message: 'Cannot connect to workspace-service' });
            }
        }

        let storageData;
        try {
            const response = await axios.post(`${STORAGE_SERVICE_URL}/api/storage/multipart/init`,{filename, mimeType, totalChunks});
            storageData = response.data.data;
        } catch(err) {
            return res.status(500).json({message: 'Cannot connect to storage-service'});
        }
        return res.status(201).json({
            message: "Init upload successfully",
            data: {
                uploadId:     storageData.uploadId,
                objectName:   storageData.objectName,
                presignedUrls: storageData.presignedUrls,
                meta: {filename, mimeType, sizeBytes, workspaceId, folderId },
            },
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/files-worker/merge-----------
async function mergeUpload(req,res) {
    try {
        const userId = req.user.userId;
        const {uploadId, etags, objectName, filename, totalChunks,
            mimeType, hashString ,sizeBytes, workspaceId, folderId} = req.body;
        
        try {
            await axios.post(`${STORAGE_SERVICE_URL}/api/storage/multipart/complete`, {uploadId, objectName, etags});
        } catch(err) {
            console.error("[file-worker] Error while call storage-service to merge file");
            return res.status(500).json({message: "Failed to merge chunks in storage-service"});
        }

        let physicalFile = await PhysicalFile.findOne({hashString});
        if (!physicalFile) {
            physicalFile = await PhysicalFile.create({
                hashString,
                minioObjectPath: objectName,
                sizeBytes,
                mimeType,
            });
        }

        const file = await Document.create({
            originalName: filename,
            workspaceId: workspaceId || null,
            folderId: folderId || null,
            physicalFileId: physicalFile._id,
            uploadedId: userId,
        });

        return res.status(200).json({message: "File merged and saved successful", data: file});
    } catch(err) {
        return res.json({message: err.message});
    }
}
module.exports = {initUpload, checkHash, mergeUpload};