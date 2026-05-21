const axios = require('axios');
const mongoose = require('mongoose');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');
const WORKSPACE_SERVICE_URL = process.env.WORKSPACE_SERVICE_URL || 'http://localhost:3003';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3005';

const {addJob, queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared');

//-------GET /api/files-----------
async function getFiles(req,res) {
    try {
        const userId = req.user.userId;
        let {workspaceId, folderId} = req.query;

        if (workspaceId === "null" || workspaceId === "undefined") workspaceId = null;
        if (folderId === "null" || folderId === "undefined") folderId = null;

        let query = {};
        if (folderId) {
            query.folderId = folderId;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            }else {
                query.uploadedBy = userId;
                query.workspaceId = null;
            }
        }else {
            query.folderId = null;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            }else {
                query.uploadedBy = userId;
                query.workspaceId = null;
            }
        }

        const files = await Document.find(query).populate('physicalFileId', 'sizeBytes mimeType minioObjectPath').sort({createdAt:-1});
        console.log(`[FileController] Successfully fetched ${files.length} files`);
        return res.json({data: files});
    } catch(err) {
        console.error(`[FileController] System error in getFiles:`, err.message);
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
            console.warn(`[FileController] Get file failed: File not found. ID: ${fileId}`);
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Permission denied: Personal file ${fileId} does not belong to user ${userId}`);
                return res.status(403).json({ message: "You not have permission to access this file" });
            }
        } else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    { headers: { Authorization: req.headers.authorization } });
                const workspace = response.data?.data;
                if (!workspace) {
                    console.warn(`[FileController] Get file failed: Workspace ${file.workspaceId} not found`);
                    return res.status(404).json({ message: "Workspace not found" });
                }
                const member = workspace.members.find(m => m.userId.toString() === userId);
                if (!member) {
                    console.warn(`[FileController] Permission denied: User ${userId} not a member of workspace ${file.workspaceId}`);
                    return res.status(403).json({ message: "You not have permission to access this file" });
                }
            } catch (err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({ message: "Cannot connect to workspace-service" });
            }
        }
        
        console.log(`[FileController] Successfully fetched details for file: ${fileId}`);
        return res.json({data: file});
    } catch(err) {
        console.error(`[FileController] System error in getFileById:`, err.message);
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
            console.warn(`[FileController] Rename failed: File not found. ID: ${fileId}`);
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Rename failed: Personal file ${fileId} does not belong to user ${userId}`);
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data?.data;
                if (!workspace) return res.status(404).json({ message: "Workspace not found" });
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member) {
                    console.warn(`[FileController] Rename failed: User ${userId} not a member of workspace ${file.workspaceId}`);
                    return res.status(403).json({message: "You not have permission in this workspace"});
                }
            } catch(err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        file.originalName = name;
        await file.save();
        console.log(`[FileController] Successfully renamed file to '${name}'`);

        try {
            await addJob(
                queueForEvent(EVENTS.FILE_RENAMED),
                EVENTS.FILE_RENAMED,
                {fileId, newName: name, actorId: userId, fileName: file.originalName, workspaceId: file.workspaceId},
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_RENAMED, file._id.toString())}
            );
            console.log(`[FileController] Enqueued FILE_RENAMED job for file: ${fileId}`);
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_RENAMED job', jobErr.message);
        }

        return res.json({message: "Rename successfully", data: file});
    } catch(err) {
        console.error(`[FileController] System error in renameFile:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/files/:id-----------
async function deleteFile(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = await Document.findById(fileId);
        if (!file) {
            console.warn(`[FileController] Delete failed: File not found. ID: ${fileId}`);
            return res.status(404).json({message: "File not exists"});
        }
        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Delete failed: Personal file ${fileId} does not belong to user ${userId}`);
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data?.data;
                if (!workspace) return res.status(404).json({ message: "Workspace not found" });
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member || member.role !== "ADMIN") {
                    console.warn(`[FileController] Delete failed: User ${userId} is not ADMIN in workspace ${file.workspaceId}`);
                    return res.status(403).json({message: "You not have permission in this workspace"});
                }
            } catch(err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }
        
        await Document.updateOne(
            {_id: fileId},
            {deletedAt: new Date()}
        );
        console.log(`[FileController] Successfully soft-deleted file: ${fileId}`);

        try {
            await addJob(
                queueForEvent(EVENTS.FILE_TRASHED),
                EVENTS.FILE_TRASHED,
                {fileId, actorId: userId, fileName: file.originalName, workspaceId: file.workspaceId},
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_TRASHED,fileId)}
            );
            console.log(`[FileController] Enqueued FILE_TRASHED job for file: ${fileId}`);
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_TRASHED job', jobErr.message);
        }

        return res.json({message: "File deleted successfully", data: {file}});
    } catch(err) {
        console.error(`[FileController] System error in deleteFile:`, err.message);
        return res.status(500).json({message: err.message}); 
    }
}

//-------PUT /api/files/:id/restore-----------
async function restoreFile(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = await Document.collection.findOne({ _id: new mongoose.Types.ObjectId(fileId) });
        if (!file) {
            console.warn(`[FileController] Restore failed: File not found. ID: ${fileId}`);
            return res.status(404).json({ message: "File not exists" });
        }
        if (!file.deletedAt) {
            console.warn(`[FileController] Restore failed: File ${fileId} is not in trash`);
            return res.status(400).json({ message: "File not in the trash" });
        }

        const now = new Date();
        const deletedTime = new Date(file.deletedAt);
        const diffInMilliseconds = now.getTime() - deletedTime.getTime();
        const diffInDays = diffInMilliseconds / (1000 * 60 * 60 * 24);

        if (diffInDays > 10) {
            console.warn(`[FileController] Restore failed: File ${fileId} has been in trash over 10 days`);
            return res.status(400).json({message: "Can not restore. File already in trash over 10 days"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Restore failed: Personal file ${fileId} does not belong to user ${userId}`);
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data?.data;
                if (!workspace) return res.status(404).json({ message: "Workspace not found" });
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member || member.role !== "ADMIN") {
                    console.warn(`[FileController] Restore failed: User ${userId} is not ADMIN in workspace ${file.workspaceId}`);
                    return res.status(403).json({message: "Only Workspace's Admin can move this file"});
                }
            } catch(err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        await Document.updateOne(
            { _id: new mongoose.Types.ObjectId(fileId) },
            { $set: { deletedAt: null } }
        );

        file.deletedAt = null;
        const physicalFile = await PhysicalFile.findById(file.physicalFileId);
        if (!physicalFile) {
            console.warn(`[FileController] Restore warning: Physical file not found for document ${fileId}`);
            return res.status(404).json({ message: "Physical file not found" });
        }

        console.log(`[FileController] Successfully restored file: ${fileId}`);

        try{
            await addJob(
                queueForEvent(EVENTS.FILE_RESTORED),
                EVENTS.FILE_RESTORED,
                {
                    fileId, 
                    minioObjectPath: physicalFile.minioObjectPath,
                    mimeType: physicalFile.mimeType,
                    originalName: file.originalName,
                    workspaceId: file.workspaceId,
                    uploadedBy: userId
                },
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_RESTORED, fileId)}
            );
            console.log(`[FileController] Enqueued FILE_RESTORED job for file: ${fileId}`);
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_RESTORED job', jobErr.message);
        }

        return res.json({ message: "Restore file successfully", data: file });
    } catch(err) {
        console.error(`[FileController] System error in restoreFile:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------GET /api/files/:id/link-----------
async function getFileLink(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const action = req.query.action || 'view';

        const file = await Document.findById(fileId).populate('physicalFileId');
        if (!file) {
            console.warn(`[FileController] Get link failed: File not found. ID: ${fileId}`);
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Get link failed: Personal file does not belong to user ${userId}`);
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data?.data;
                if (!workspace) return res.status(404).json({ message: "Workspace not found" });
                const member = workspace.members.find(m => m.userId.toString() === userId);
                if (!member) {
                    console.warn(`[FileController] Get link failed: User ${userId} is not in workspace ${file.workspaceId}`);
                    return res.status(403).json({ message: "You not have permission in this workspace" });
                }
                // permissions can be array or string in different seeds
                const perms = member.permissions;
                const allowed = member.role === 'ADMIN' || (perms && (Array.isArray(perms) ? perms.includes(action) : String(perms).includes(action)));
                if (!allowed) {
                    console.warn(`[FileController] Get link failed: User ${userId} lacks permission '${action}'`);
                    return res.status(403).json({ message: "You not have permission in this workspace" });
                }
            } catch(err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        const objectName = file.physicalFileId.minioObjectPath;
        const originalName = file.originalName;

        console.log(`[FileController] Calling Storage Service to get presigned URL for ${objectName}`);
        const storageServiceUrl = await axios.get(`${STORAGE_SERVICE_URL}/api/storage/file/url`,
            {params: {
                objectName: objectName,
                originalName: originalName,
                action: action
            }}
        );
        
        const presignedUrl = storageServiceUrl.data.data.url;
        console.log(`[FileController] Successfully generated link for file: ${fileId}`);

        return res.json({
            success: true,
            message: "Take link successfully",
            data: {url: presignedUrl}
        });
    } catch(err) {
        console.error("[FileController] Error while create link:", err.message);
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        return res.status(500).json({message: "Error system while handle link"});
    }
}

//-------PUT /api/files/:id/move/:targetFolderId-----------
async function moveFile(req,res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const targetFolderId = req.params.targetFolderId;

        const file = await Document.findById(fileId);
        if (!file) {
            console.warn(`[FileController] Move failed: File not found. ID: ${fileId}`);
            return res.status(404).json({message: "File not exists"});
        }

        if (!file.workspaceId) {
            if (file.uploadedBy.toString() !== userId) {
                console.warn(`[FileController] Move failed: Personal file does not belong to user ${userId}`);
                return res.status(403).json({message: "You not have permission to access this file"});
            }
        }else {
            try {
                const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
                    {headers: {Authorization: req.headers.authorization}});
                const workspace = response.data?.data;
                if (!workspace) return res.status(404).json({ message: "Workspace not found" });
                const member = workspace.members.find((m) => m.userId.toString() === userId);
                if (!member || member.role !== "ADMIN") {
                    console.warn(`[FileController] Move failed: User ${userId} is not ADMIN in workspace`);
                    return res.status(403).json({message: "Only Workspace's Admin can move this file"});
                }
            } catch(err) {
                console.error(`[FileController] System error checking workspace permissions:`, err.message);
                return res.status(500).json({message: "Cannot connect to workspace-service"});
            }
        }

        if (targetFolderId === null || targetFolderId === "null") {
            file.folderId = null;
        }else {
            file.folderId = targetFolderId;
        }
        await file.save();
        
        console.log(`[FileController] Successfully moved file: ${fileId}`);
        const physicalFile = await PhysicalFile.findById(file.physicalFileId);
        
        try {
            await addJob(
                queueForEvent(EVENTS.FILE_MOVED),
                EVENTS.FILE_MOVED,
                {documentId:     file._id.toString(),
                    objectName:     physicalFile.minioObjectPath,
                    mimeType:       physicalFile.mimeType,         
                    newFolderId:    targetFolderId || null,
                    newWorkspaceId: file.workspaceId || null,
                    actorId: userId,
                    fileName: file.originalName},
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_MOVED, fileId)}
            );
            console.log(`[FileController] Enqueued FILE_MOVED job for file: ${fileId}`);
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue FILE_MOVED job', jobErr.message);
        }

        return res.json({message: "Move file successfully", data: {file}});
    } catch(err) {
        console.error(`[FileController] System error in moveFile:`, err.message);
        return res.status(500).json({message: err.message});  
    }
}

//-------GET /api/files/trash-----------
async function getTrashedFiles(req,res) {
    try {
        const userId = req.user.userId;
        const {workspaceId} = req.query;

        let query = {deletedAt: {$ne: null}};

        if (workspaceId) {
            let workspace;
            const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${workspaceId}`, {
                headers: {Authorization: req.headers.authorization}
            });
            workspace = response.data?.data;

            if (!workspace) {
                console.warn(`[FileController] Get trash failed: Workspace ${workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const member = workspace.members.find((m) => m.userId.toString() === userId);
            if (!member) {
                console.warn(`[FileController] Get trash failed: User ${userId} not in workspace ${workspaceId}`);
                return res.status(403).json({ message: "Không có quyền truy cập" });
            }

            query.workspaceId = workspaceId;
        }else {
            query.uploadedBy = userId;
            query.workspaceId = null;
        }

        const files = await Document.find(query)
                        .setOptions({includeDeleted: true})
                        .populate('physicalFileId', 'sizeBytes mimeType minioObjectPath')
                        .sort({deletedAt:-1});
        
        console.log(`[FileController] Successfully fetched ${files.length} trashed files`);
        return res.json({success: true, data: files});
    } catch(err) {
        console.error(`[FileController] System error in getTrashedFiles:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/files/trash/empty-----------
async function emptyTrash(req, res) {
  try {
    const userId = req.user.userId;

    const trashedFiles = await Document.find({
      uploadedBy:  userId,
      workspaceId: null,
      deletedAt:   { $ne: null },
    }).setOptions({includeDeleted: true}).populate('physicalFileId');

    if (trashedFiles.length === 0) {
      console.log(`[FileController] Empty trash: No files found in trash for user ${userId}`);
      return res.json({ message: 'Trash is empty' });
    }

    const fileIds      = trashedFiles.map((f) => f._id.toString());
    const physicalFiles = trashedFiles.map((f) => f.physicalFileId).filter(Boolean);

    await Document.deleteMany({ _id: { $in: fileIds } }).setOptions({includeDeleted: true});
    console.log(`[FileController] Removed ${fileIds.length} document references from DB`);

    const uniquePhysicalFiles = [
      ...new Map(physicalFiles.map((pf) => [pf._id.toString(), pf])).values(),
    ];

    for (const pf of uniquePhysicalFiles) {
      const usageCount = await Document.countDocuments({ physicalFileId: pf._id }).setOptions({includeDeleted: true});
      if (usageCount === 0) {
        console.log(`[FileController] Usage count is 0 for physical file ${pf._id}. Proceeding to delete from Storage Service.`);
        await axios.delete(`${STORAGE_SERVICE_URL}/api/storage/file`, {
          data:    { objectName: pf.minioObjectPath },
          headers: { Authorization: req.headers.authorization },
        }).catch((e) => console.error(`[Storage] Error deleting ${pf.minioObjectPath}:`, e.message));
        await PhysicalFile.findByIdAndDelete(pf._id);
      }
    }

    try {
      await addJob(
        queueForEvent(EVENTS.FILE_TRASHED),
        EVENTS.FILE_TRASHED,
        { fileIds, actorId: userId},
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_TRASHED, `empty-trash-${userId}`) }
      );
      console.log(`[FileController] Enqueued FILE_TRASHED job for empty trash operation`);
    } catch (jobErr) {
      console.error('[Queue Error] emptyTrash failed to enqueue job:', jobErr.message);
    }

    console.log(`[FileController] Successfully emptied personal trash for user ${userId}`);
    return res.json({ message: `Emptied ${fileIds.length} files from trash` });
  } catch (err) {
    console.error(`[FileController] System error in emptyTrash:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

//-------DELETE /api/files/:id/force-----------
async function forceDeleteFile(req, res) {
  try {
    const userId = req.user.userId;
    const fileId = req.params.id;

    const file = await Document.findById(fileId)
      .setOptions({ includeDeleted: true })
      .populate('physicalFileId');

    if (!file) {
      console.warn(`[FileController] Force delete failed: File not found. ID: ${fileId}`);
      return res.status(404).json({ message: 'File not exist' });
    }
    if (!file.deletedAt) {
      console.warn(`[FileController] Force delete failed: File ${fileId} is not in trash`);
      return res.status(400).json({ message: 'File is not in trash. Move to trash first' });
    }
    if (!file.workspaceId) {
      if (file.uploadedBy.toString() !== userId) {
        console.warn(`[FileController] Force delete failed: Personal file does not belong to user ${userId}`);
        return res.status(403).json({ message: 'You have no permission to force delete this file' });
      }
    } else {
      try {
        const response = await axios.get(`${WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
          { headers: { Authorization: req.headers.authorization } }
        );
        const workspace = response.data?.data;
        const member    = workspace.members.find((m) => m.userId.toString() === userId);
        if (!member || member.role !== 'ADMIN') {
          console.warn(`[FileController] Force delete failed: User ${userId} is not Admin in workspace`);
          return res.status(403).json({ message: 'Only Admin can force delete file' });
        }
      } catch (err) {
        if (err.response?.status === 404) {
          console.warn(`[FileController] Force delete failed: Workspace ${file.workspaceId} not found`);
          return res.status(404).json({ message: 'Workspace not found' });
        }
        console.error(`[FileController] Failed to connect to Workspace Service:`, err.message);
        return res.status(500).json({ message: 'Cannot connect to workspace-service' });
      }
    }

    await Document.findByIdAndDelete(fileId).setOptions({includeDeleted: true});
    console.log(`[FileController] Removed document ${fileId} from MongoDB`);

    const usageCount = await Document.countDocuments({
      physicalFileId: file.physicalFileId._id,
    }).setOptions({includeDeleted: true});

    if (usageCount === 0) {
      console.log(`[FileController] Usage count is 0 for physical file ${file.physicalFileId._id}. Proceeding to delete from Storage Service.`);
      await axios.delete(`${STORAGE_SERVICE_URL}/api/storage/file`, {
        data:    { objectName: file.physicalFileId.minioObjectPath },
        headers: { Authorization: req.headers.authorization },
      }).catch((e) => console.error('[Storage] Skip error:', e.message));

      await PhysicalFile.findByIdAndDelete(file.physicalFileId._id);
    }

    try {
      await addJob(
        queueForEvent(EVENTS.FILE_TRASHED),
        EVENTS.FILE_TRASHED,
        { fileIds: [fileId], actorId: userId },
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_TRASHED, fileId) }
      );
      console.log(`[FileController] Enqueued FILE_TRASHED job for force delete operation`);
    } catch (jobErr) {
      console.error('[Queue Error] forceDeleteFile failed to enqueue job:', jobErr.message);
    }

    console.log(`[FileController] Successfully force-deleted file: ${fileId}`);
    return res.json({ message: 'File permanently deleted', data: fileId });
  } catch (err) {
    console.error(`[FileController] System error in forceDeleteFile:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
    getFiles,
    getFileById,
    getFileLink,
    renameFile,
    deleteFile,
    restoreFile,
    moveFile, 
    emptyTrash, 
    forceDeleteFile, 
    getTrashedFiles
};
