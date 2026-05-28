const axios = require('axios');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL;
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL;

const {addJob} = require('shared/queue/queueProducer');
const {queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared/queue/queue.config');

//-------POST /api/files-worker/hash-----------
async function checkHash(req,res) {
    try {
        const userId = req.user.userId;
        const {filename, hashString, workspaceId, folderId} = req.body;

        if (!hashString) {
            console.warn(`[FileWorkerController] Check hash failed: Missing hash string`);
            return res.status(400).json({message: "Hash string is required"});
        }

        const existingPhysicalFile = await PhysicalFile.findOne({hashString});
        if (existingPhysicalFile) {
            console.log(`[FileWorkerController] Duplicate physical file found. ID: ${existingPhysicalFile._id}`);
            
            if (workspaceId) {
                try {
                    const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
                        {headers: {Authorization: req.headers.authorization}}
                    );
                    const workspace = response.data.data;
                    const member = workspace.members.find((m) => m.userId.toString() === userId);
                    if (!member) {
                        console.warn(`[FileWorkerController] Deduplication failed: User ${userId} not a member of workspace ${workspaceId}`);
                        return res.status(403).json({message:"You are not a member of this workspace"});
                    }
                    const canEdit = member.role === 'ADMIN' || member.permissions.includes("editor");
                    if (!canEdit) {
                        console.warn(`[FileWorkerController] Deduplication failed: User ${userId} lacks 'editor' permission`);
                        return res.status(403).json({message: "No permission to upload in this workspace"});
                    }
                } catch(err) {
                    if (err.response?.status === 403) {
                        console.warn(`[FileWorkerController] Workspace service returned 403 forbidden`);
                        return res.status(403).json({ message: 'No permission in this workspace' });
                    }
                    console.error(`[FileWorkerController] Failed to connect to workspace service:`, err.message);
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

            console.log(`[FileWorkerController] Deduplication successful. Instant copy created. Document ID: ${newFile._id}`);
            return res.status(200).json({message: "Deduplication successful. File copy instantly", data: {document: newFile, isDuplicate: true}});
        }
        
        console.log(`[FileWorkerController] File is new. Proceeding to normal upload flow.`);
        return res.status(200).json({message: "File is new. Proceed to multipart upload", data: {isDuplicate: false}});

    } catch(err) {
        console.error(`[FileWorkerController] System error in checkHash:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/files-worker/init-----------
async function initUpload(req,res) {
    try {
        const userId = req.user.userId;
        const {filename ,totalChunks, mimeType, sizeBytes, workspaceId, folderId} = req.body;

        if (workspaceId) {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}}
                );
                const workspace = response.data.data;
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member) {
                    console.warn(`[FileWorkerController] Init upload failed: User ${userId} not in workspace`);
                    return res.status(403).json({message:"You are not a member of this workspace"});
                }
                const canEdit = member.role === 'ADMIN' || member.permissions.includes("editor");
                if (!canEdit) {
                    console.warn(`[FileWorkerController] Init upload failed: User ${userId} lacks 'editor' permission`);
                    return res.status(403).json({message: "No permission to upload in this workspace"});
                }
            } catch(err) {
                if (err.response?.status === 403) {
                    return res.status(403).json({ message: 'No permission in this workspace' });
                }
                console.error(`[FileWorkerController] Failed to connect to workspace service:`, err.message);
                return res.status(500).json({ message: 'Cannot connect to workspace-service' });
            }
        }

        let storageData;
        try {
            console.log(`[FileWorkerController] Calling Storage Service to initialize multipart upload`);
            const response = await axios.post(`${STORAGE_SERVICE_URL}/api/storage/multipart/init`,{filename, mimeType, totalChunks});
            storageData = response.data.data;
        } catch(err) {
            console.error('[FileWorkerController] Storage service error during init:', err.response?.data || err.message);
            return res.status(500).json({message: 'Cannot connect to storage-service'});
        }

        console.log(`[FileWorkerController] Init upload successfully. UploadId generated.`);
        return res.status(201).json({
            message: "Init upload successfully",
            data: {
                uploadId:     storageData.uploadId,
                originalName: filename,
                objectName: storageData.objectName,
                presignedUrls: storageData.presignedURLs,
                meta: {filename, mimeType, sizeBytes, workspaceId, folderId },
            },
        });
    } catch(err) {
        console.error(`[FileWorkerController] System error in initUpload:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/files-worker/merge-----------
async function mergeUpload(req,res) {
    try {
        const userId = req.user.userId;
        const {uploadId, etags, minioObjectPath, objectName, filename, totalChunks,
            mimeType, hashString ,sizeBytes, workspaceId, folderId} = req.body;
            
        try {
            console.log(`[FileWorkerController] Calling Storage Service to merge chunks`);
            await axios.post(`${STORAGE_SERVICE_URL}/api/storage/multipart/complete`, {uploadId, objectName});
        } catch(err) {
            console.error("[FileWorkerController] Error while call storage-service to merge file", err.message);
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
            console.log(`[FileWorkerController] Created new physical file record. ID: ${physicalFile._id}`);
        }

        const file = await Document.create({
            originalName: filename,
            workspaceId: workspaceId || null,
            folderId: folderId || null,
            physicalFileId: physicalFile._id,
            uploadedBy: userId,
        });
        console.log(`[FileWorkerController] Created new document record. ID: ${file._id}`);

        try {
            await addJob(
                queueForEvent(EVENTS.FILE_MERGED),
                EVENTS.FILE_MERGED,
                {
                    fileId: file._id.toString(),  
                    minioObjectPath, 
                    originalName: file.originalName, 
                    totalChunks,
                    mimeType,
                    sizeBytes,      
                    hashString,     
                    workspaceId, 
                    folderId, 
                    uploadedBy: userId,
                    actorId: userId,
                    isDuplicate: false
                },
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_MERGED, file._id.toString())}
            );
            console.log(`[FileWorkerController] Enqueued FILE_MERGED job for file: ${file._id}`);
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_MERGED job', jobErr.message);
        }

        console.log(`[FileWorkerController] Successfully merged chunks and saved document '${filename}'`);
        return res.status(200).json({message: "File merged and saved successful", data: file});
    } catch(err) {
        console.error(`[FileWorkerController] System error in mergeUpload:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    initUpload, 
    checkHash, 
    mergeUpload
};