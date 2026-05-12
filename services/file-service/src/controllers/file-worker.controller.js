const axios = require('axios');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL || 'http://localhost:3003';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3005';

const {addJob,queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared');

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
                    if (!member) {
                        return res.status(403).json({message:"You are not a member of this workspace"});
                    }
                    const canEdit = member.role === 'ADMIN' || member.permissions.includes("editor");
                    if (!canEdit) {
                        return res.status(403).json({message: "No permission to upload in this workspace"});
                    }
                } catch(err) {
                    if (err.response?.status === 403) {
                        return res.status(403).json({ message: 'No permission in this workspace' });
                    }
                    return res.status(500).json({ message: 'Cannot connect to workspace-service' });
                }   
            }

            const newFile = await Document.create({
                originalName: filename,
                workspaceId: workspaceId || null,
                folderId: folderId || null,
                physicalFileId: existingPhysicalFile._id,
                uploadedBy: userId,
            });

            try {
                await addJob(
                    queueForEvent(EVENTS.FILE_MERGED),
                    EVENTS.FILE_MERGED,
                    {
                        fileId: newFile._id.toString(),
                        minioObjectPath: existingPhysicalFile.minioObjectPath,
                        originalName: newFile.originalName, 
                        mimeType: existingPhysicalFile.mimeType, 
                        sizeBytes: existingPhysicalFile.sizeBytes, 
                        hashString, 
                        workspaceId, 
                        folderId, 
                        uploadedBy: userId,
                        actorId: userId, 
                        isDuplicate: true 
                    },
                    {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_MERGED,newFile._id.toString())}
                );
            } catch(jobErr) {
                console.error('[Queue Error] Failed to enqueue FILE_MERGED job in checkHash', jobErr);
            }

            return res.status(200).json({message: "Deduplication successful. File copy instantly", data: {document: newFile, isDuplicate: true}});
        }
        return res.status(200).json({message: "File is new. Proceed to multipart upload", data: {isDuplicate: false}});

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
                if (!member) {
                    return res.status(403).json({message:"You are not a member of this workspace"});
                }
                const canEdit = member.role === 'ADMIN' || member.permissions.includes("editor");
                if (!canEdit) {
                    return res.status(403).json({message: "No permission to upload in this workspace"});
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
                presignedUrls: storageData.presignedURLs,
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
        const {uploadId, etags, minioObjectPath, filename, totalChunks,
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
                minioObjectPath,
                sizeBytes,
                mimeType,
            });
        }

        const file = await Document.create({
            originalName: filename,
            workspaceId: workspaceId || null,
            folderId: folderId || null,
            physicalFileId: physicalFile._id,
            uploadedBy: userId,
        });

        try {
            await addJob(
                queueForEvent(EVENTS.FILE_MERGED),
                EVENTS.FILE_MERGED,
                {
                    fileId: file._id.toString(),  
                    minioObjectPath: minioObjectPath, 
                    originalName: filename, 
                    totalChunks,
                    mimeType,
                    sizeBytes,      
                    hashString,     
                    workspaceId, 
                    folderI, 
                    uploadedBy: userId,
                    actorId: userId,
                    isDuplicate: false
                },
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_MERGED, file._id.toString())}
            );
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_MERGED job', jobErr);
        }

        return res.status(200).json({message: "File merged and saved successful", data: file});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}
module.exports = {
    initUpload, 
    checkHash, 
    mergeUpload
};