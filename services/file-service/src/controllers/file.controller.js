const axios = require('axios');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');
const { json } = require('express');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL || 'http://localhost:3003';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3005';

//-------GET /api/files/-----------
async function getFiles(req,res) {
    try {
        const userId = req.user.userId;
        const {workspaceId, folderId} = req.body;

        let query = {};
        if (folderId) {
            query.folderId = folderId;
        }else {
            query.folderId = null;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            }else {
                query.uploadedBy = userId;
                query.workspaceId = null;
            }
        }

        const files = await Document.find(query).populate({path:'physicalFileId'}, 
                                                            {path:'sizeBytes'},
                                                            {path:'mimeType'},
                                                            {path:'minioObjectPath'})
                                                            .sort({createdAt:-1});
        return res.json({data: files});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/files/:id-----------
async function getFileById(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = await Document.findById(fileId).populate('physicalFileId');
        if (!file) {
            return res.status(404).json({message: "File not exists"});
        }

        const isOwner = file.uploadedBy.toString() === userId;
        if (!isOwner && !file.workspaceId) {
            return res.status(403).json({message: "You not have permission to access this file"});
        }
        return res.json({data: req.file});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/files/:id/rename-----------
async function renameFile(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const {name} = req.body;

        const file = await Document.findById(fileId);
        if (!file) {
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                
                const workspace = response.data.data;
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member) {
                    return res.status(403).json({message: "You not have permission in this workspace"});
                }
            } catch(err) {
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        file.originalName = name;
        await file.save();

        return res.json({message: "Rename successfully", data: file});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/files/:id-----------

//-------GET /api/files/:id/link-----------
async function getFileLink(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const action = req.query.action || 'preview';

        const file = await Document.findById(fileId).populate('physicalFileId');
        if (!file) {
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspace/${workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data.data;
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member || member.permissions.includes('download', 'preview')) {
                    return res.status(403).json({message: "You not have permission in this workspace"});
                }
            } catch(err) {
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        const objectName = file.physicalFileId.minioObjectPath;
        const originalName = file.originalName;

        const storageServiceUrl = await axios.get(`${STORAGE_SERVICE_URL}/api/storage/file/url`,
            {params: {
                objectName: objectName,
                originalName: originalName,
                action: action
            }}
        );
        
        const presignedUrl = storageServiceUrl.data.data.url;

        return res.json({
            success: true,
            message: "Take link successfully",
            data: {url: presignedUrl}
        });
    } catch(err) {
        console.error("[file-service] Error while create link:", err.message);
        if (err.storageServiceUrl) {
            return res.status(err.storageServiceUrl.status).json(err.response.data);
        }
        return res.status(500).json({message: "Error system while handle link"});
    }
}
//-------PUT /api/files/:id/move/:targetFileId-----------
