const axios = require('axios');
const Document = require('../models/documents.model');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL || 'http://localhost:3003';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3005';

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
                if (!member || member.permissions.includes('upload')) {
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
            const response = await axios.get(`${STORAGE_SERVICE_URL}/api/storage/multipart/init`,{filename, content, totalChunks});
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

module.exports = {initUpload};