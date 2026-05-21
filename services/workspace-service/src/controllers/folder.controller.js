const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');
const axios = require('axios');
const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || 'http://localhost:3002';

const {addJob, queueForEvent, jobIdFor, DEFAULT_JOB_OPTIONS, EVENTS} = require('shared');

//-------------------HELPER--------------------
async function getBreadcrumbPath(folderId) {
    const breadcrumb = [];
    let currentId = folderId;

    while(currentId) {
        const folder = await Folder.findById(currentId);
        if (!folder)  break;

        breadcrumb.unshift({
            _id: folder._id,
            name: folder.name,
            parentId: folder.parentId
        });
        currentId = folder.parentId;
    }
    return breadcrumb;
}

// Using for delete
async function getAllDescendantIds(rootFolderId) {
    let descendantIds = [];
    let queue = [rootFolderId];

    while(queue.length > 0) {
        const children = await Folder.find({parentId: {$in: queue}}).setOptions({includeDeleted: true});
        const childIds = children.map(c => c._id.toString());
        if (childIds.length === 0) break;
        descendantIds.push(...childIds);
        queue = childIds;
    }
    return descendantIds;
}

async function isCircularMove(sourceFolderId, targetParentId) {
    let currentParentId = targetParentId;
    let depth = 0;

    while(currentParentId) {
        if (currentParentId.toString() === sourceFolderId.toString()) {
            console.warn(`[FolderController] Circular move detected for source ${sourceFolderId} into target ${targetParentId}`);
            return true;
        }
        const parentNode = await Folder.findById(currentParentId,'parentId');
        currentParentId = parentNode ? parentNode.parentId : null;
        depth++;
        if (depth > 100) {
            console.error(`[FolderController] System Error: Tree depth exceeded 100 during circular move check`);
            throw new Error("System Error: Tree depth exceeded");
        }
    }
    return false;
}
//-------------------HELPER--------------------

//-------------------LOGICS--------------------
//-------POST /api/folders-----------
async function createFolder(req,res) {
    try {
        const userId = req.user.userId;
        const {name, parentId, workspaceId} = req.body;

        //check exists & permission
        if (workspaceId) {
            const workspace = await Workspace.findById(workspaceId);
            if (!workspace){
                console.warn(`[FolderController] Create folder failed: Workspace ${workspaceId} not found`);
                return res.status(404).json({ message: 'Workspace not found' });
            }
            const member = workspace.members.find((m) => m.userId.toString() === userId);
            if (!member) {
                console.warn(`[FolderController] Create folder failed: User ${userId} not in workspace ${workspaceId}`);
                return res.status(403).json({ message: 'You are not a member of this workspace' });
            }
            const canEdit = member.role === 'ADMIN' || member.permissions.includes('editor');
            if (!canEdit) {
                console.warn(`[FolderController] Create folder failed: User ${userId} lacks 'editor' permission in workspace ${workspaceId}`);
                return res.status(403).json({ message: 'No permission to modify in this workspace' });
            }
        }
        
        const folder = await Folder.create({
            name,
            workspaceId: workspaceId || null,
            parentId: parentId || null,
            createdBy: userId,
        });

        console.log(`[FolderController] Successfully created folder. ID: ${folder._id}`);
        return res.status(201).json({message: "Created folder successful", data: folder});
    } catch (err) {
        console.error(`[FolderController] System error in createFolder:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/folders-----------
async function getFolders(req, res) {
    try {
        const userId = req.user.userId;
        const { workspaceId, parentId } = req.query;

        //check exists & permission
        if (workspaceId) {
            const workspace = await Workspace.findById(workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Get folders failed: Workspace ${workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const member = workspace.members.some((m) => m.userId.toString() === userId);
            if (!member) {
                console.warn(`[FolderController] Get folders failed: User ${userId} not in workspace ${workspaceId}`);
                return res.status(403).json({ message: "You do not have permission to access this workspace" });
            }
        }

        let query = {};
        if (parentId) {
            query.parentId = parentId;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            } else {
                query.createdBy = userId;
                query.workspaceId = null;
            }
        } else {
            if (workspaceId) {
                query.workspaceId = workspaceId;
                query.parentId = null;
            } else {
                query.createdBy = userId;
                query.workspaceId = null;
                query.parentId = null;
            }
        }

        const folders = await Folder.find(query);
        console.log(`[FolderController] Successfully fetched ${folders.length} folders`);
        return res.json({ data: folders });
    } catch (err) {
        console.error(`[FolderController] System error in getFolders:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------GET /api/folders/:id-----------
async function getFolderById(req, res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;

        const currentFolder = await Folder.findById(folderId);
        if (!currentFolder) {
            console.warn(`[FolderController] Folder not found. ID: ${folderId}`);
            return res.status(404).json({ message: "Folder not exist" });
        }

        // Check access permissions
        if (currentFolder.workspaceId) {
            const workspace = await Workspace.findById(currentFolder.workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Workspace ${currentFolder.workspaceId} associated with folder not found`);
                return res.status(404).json({ message: "Workspace not exist" });
            }
            
            const member = workspace.members.some((m) => m.userId.toString() === userId);
            if (!member) {
                console.warn(`[FolderController] Permission denied for user ${userId} accessing workspace folder ${folderId}`);
                return res.status(403).json({ message: "You do not have permission to access this folder" });
            }
        } else {
            if (currentFolder.createdBy.toString() !== userId) {
                console.warn(`[FolderController] Permission denied for user ${userId} accessing personal folder ${folderId}`);
                return res.status(403).json({ message: "You do not have permission to access this folder" });
            }
        }

        const folders = await Folder.find({
            parentId: folderId,
            deletedAt: null
        });

        let files = [];
        try {
            console.log(`[FolderController] Requesting File Service to get files for folder: ${folderId}`);
            const response = await axios.get(`${FILE_SERVICE_URL}/api/files/internal/by-folders/getFiles`, {
                params: { folderId: folderId, deletedAt: null },
                headers: { Authorization: req.headers.authorization },
            });
            files = response.data?.data || [];
        } catch (err) {
            console.error(`[FolderController] Failed to fetch files from File Service for folder ${folderId}:`, err.message);
            return res.status(500).json({ message: "Error system when get all the files" });
        }
            
        const breadcrumb = await getBreadcrumbPath(folderId);

        console.log(`[FolderController] Successfully fetched folder details for ID: ${folderId}`);
        return res.json({
            data: {
                folderInfo: currentFolder,
                folders: folders,
                files: files,
                breadcrumb: breadcrumb
            }
        });
    } catch (err) {
        console.error(`[FolderController] System error in getFolderById:`, err.message);
        return res.status(500).json({ message: err.message });
    }
} 

//-------PUT /api/folders/:id/rename-----------
async function renameFolder(req, res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;
        const { name } = req.body;

        //check exists & permission
        const folder = await Folder.findById(folderId);
        if (!folder) {
            console.warn(`[FolderController] Rename failed: Folder not found. ID: ${folderId}`);
            return res.status(404).json({ message: "Folder not exist" });
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                console.warn(`[FolderController] Rename failed: Personal folder ${folderId} does not belong to user ${userId}`);
                return res.status(403).json({ message: "No permission to modify this folder" });
            }
        } else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Rename failed: Workspace ${folder.workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                console.warn(`[FolderController] Rename failed: User ${userId} not a member of workspace`);
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                console.warn(`[FolderController] Rename failed: User ${userId} lacks 'editor' permission`);
                return res.status(403).json({ message: "No permission to modify folder in this workspace" });
            }
        }

        folder.name = name;
        await folder.save();
        
        console.log(`[FolderController] Successfully renamed folder ${folderId}`);
        return res.json({ message: "Rename successfully", data: folder });
    } catch (err) {
        console.error(`[FolderController] System error in renameFolder:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------DELETE /api/folders/:id-----------
async function deleteFolder(req, res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;        
        const childFolderIds = await getAllDescendantIds(folderId);
        const allFolderIds = [folderId, ...childFolderIds];

        //check exists & permission
        const folder = await Folder.findById(folderId);
        if (!folder) {
            console.warn(`[FolderController] Delete failed: Folder not found. ID: ${folderId}`);
            return res.status(404).json({ message: "Folder not exist" });
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                console.warn(`[FolderController] Delete failed: Personal folder ${folderId} does not belong to user ${userId}`);
                return res.status(403).json({ message: "No permission to modify this folder" });
            }
        } else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Delete failed: Workspace ${folder.workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                console.warn(`[FolderController] Delete failed: User ${userId} not a member of workspace`);
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                console.warn(`[FolderController] Delete failed: User ${userId} lacks 'editor' permission`);
                return res.status(403).json({ message: "No permission to modify folder in this workspace" });
            }
        }

        try {
            console.log(`[FolderController] Calling File Service to soft delete internal files for folder hierarchy: ${folderId}`);
            await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders`, {
                data: { folderIds: allFolderIds },
                headers: { Authorization: req.headers.authorization }
            });
        } catch (err) {
            console.error(`[FolderController] Failed to soft delete files via File Service for folder ${folderId}:`, err.message);
            return res.status(500).json({ message: "Error system when delete all the files" });
        }
        
        await Folder.updateMany(
            { _id: { $in: allFolderIds } },
            { deletedAt: new Date() }
        );

        console.log(`[FolderController] Successfully soft-deleted folder hierarchy starting at ${folderId}`);
        return res.json({ message: "Folder deleted successfully" });
    } catch (err) {
        console.error(`[FolderController] System error in deleteFolder:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------PUT /api/folders/:id/restore-----------
async function restoreFolder(req, res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;

        //check exists & permission
        const folder = await Folder.findById(folderId).setOptions({ includeDeleted: true });
        if (!folder) {
            console.warn(`[FolderController] Restore failed: Folder not found. ID: ${folderId}`);
            return res.status(404).json({ message: "Folder not exist" });
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                console.warn(`[FolderController] Restore failed: Personal folder ${folderId} does not belong to user ${userId}`);
                return res.status(403).json({ message: "No permission to modify this folder" });
            }
        } else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Restore failed: Workspace ${folder.workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                console.warn(`[FolderController] Restore failed: User ${userId} not a member of workspace`);
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                console.warn(`[FolderController] Restore failed: User ${userId} lacks 'editor' permission`);
                return res.status(403).json({ message: "No permission to modify folder in this workspace" });
            }
        }

        //check deleted time
        if (!folder.deletedAt) {
            console.warn(`[FolderController] Restore failed: Folder ${folderId} is not in trash`);
            return res.status(400).json({ message: "Folder not in the trash" });
        }

        // delete logic
        const now = new Date();
        const deletedTime = new Date(folder.deletedAt);
        const diffInMilliseconds = now.getTime() - deletedTime.getTime();
        const diffInDays = diffInMilliseconds / (1000 * 60 * 60 * 24);

        if (diffInDays > 10) {
            console.warn(`[FolderController] Restore failed: Folder ${folderId} has been in trash over 10 days`);
            return res.status(400).json({ message: "Can not restore. File already in trash over 10 days" });
        }

        const childFolderIds = await getAllDescendantIds(folder._id);
        const allFoldersIds = [folder._id.toString(), ...childFolderIds];

        try {
            console.log(`[FolderController] Calling File Service to restore internal files for folder hierarchy: ${folderId}`);
            await axios.put(`${FILE_SERVICE_URL}/api/files/internal/by-folders/restore`,
                { folderIds: allFoldersIds },
                { headers: { Authorization: req.headers.authorization } }
            );
        } catch (err) {
            console.error(`[FolderController] Failed to restore files via File Service for folder ${folderId}:`, err.message);
            return res.status(500).json({ message: "Error system when restore all sub-folders" });
        }

        await Folder.updateMany(
            { _id: { $in: allFoldersIds } },
            { deletedAt: null }
        );

        console.log(`[FolderController] Successfully restored folder hierarchy starting at ${folderId}`);
        return res.json({ message: "Restore folder successfully", data: folder });
    } catch (err) {
        console.error(`[FolderController] System error in restoreFolder:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------PUT /api/folders/:id/move-----------
async function moveFolder(req, res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;
        const { newParentId, targetWorkspaceId } = req.body;

        //check exists & permission
        const sourceFolder = await Folder.findById(folderId);
        if (!sourceFolder) {
            console.warn(`[FolderController] Move failed: Source folder not found. ID: ${folderId}`);
            return res.status(404).json({ message: "Folder not exist" });
        }
        if (!sourceFolder.workspaceId) {
            if (sourceFolder.createdBy.toString() !== userId) {
                console.warn(`[FolderController] Move failed: Personal folder ${folderId} does not belong to user ${userId}`);
                return res.status(403).json({ message: "No permission to modify this folder" });
            }
        } else {
            const workspace = await Workspace.findById(sourceFolder.workspaceId);
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                console.warn(`[FolderController] Move failed: User ${userId} not a member of source workspace`);
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                console.warn(`[FolderController] Move failed: User ${userId} lacks 'editor' permission in source workspace`);
                return res.status(403).json({ message: "No permission to modify folder in this workspace" });
            }
        }
        
        if (newParentId && sourceFolder._id.toString() === newParentId) {
            console.warn(`[FolderController] Move failed: Cannot move folder ${folderId} into itself`);
            return res.status(400).json({ message: "Cannot move folder into itself" });
        }

        let finalWorkspaceId = null;
        let finalOwnerId = sourceFolder.createdBy;

        if (newParentId) {
            const targetFolder = await Folder.findById(newParentId);
            if (!targetFolder) {
                console.warn(`[FolderController] Move failed: Target parent folder not found. ID: ${newParentId}`);
                return res.status(404).json({ message: "Target parent folder not found" });
            }

            finalWorkspaceId = targetFolder.workspaceId;

            if (!targetFolder.workspaceId) {
                if (targetFolder.createdBy.toString() !== userId) {
                    console.warn(`[FolderController] Move failed: No permission to move into target personal folder ${newParentId}`);
                    return res.status(403).json({ message: "No permission to move to the target folder" });
                }
            } else {
                const Ws = await Workspace.findById(targetFolder.workspaceId);
                if (!Ws) {
                    console.warn(`[FolderController] Move failed: Target workspace ${targetFolder.workspaceId} not found`);
                    return res.status(404).json({ message: "Target workspace not found" });
                }
                const targetMember = Ws.members.find((m) => m.userId.toString() === userId);
                if (!targetMember) {
                    console.warn(`[FolderController] Move failed: User ${userId} not a member of target workspace`);
                    return res.status(403).json({ message: "No permission to move to the target workspace" });
                }
                const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
                if (!canUpload) { 
                    console.warn(`[FolderController] Move failed: User ${userId} lacks 'editor' permission in target workspace`);
                    return res.status(403).json({ message: "No permission to move to the target workspace" });
                }
            }
        } else {
            if (targetWorkspaceId) {
                const Ws = await Workspace.findById(targetWorkspaceId);
                if (!Ws) {
                    console.warn(`[FolderController] Move failed: Target workspace ${targetWorkspaceId} not found`);
                    return res.status(404).json({ message: "Target workspace not found" });
                }
                const targetMember = Ws.members.find((m) => m.userId.toString() === userId);
                if (!targetMember) {
                    console.warn(`[FolderController] Move failed: User ${userId} not a member of target workspace ${targetWorkspaceId}`);
                    return res.status(403).json({ message: "You are not a member of the target workspace" });
                }
                const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
                if (!canUpload) {
                    console.warn(`[FolderController] Move failed: User ${userId} lacks 'editor' permission in target workspace`);
                    return res.status(403).json({ message: "No 'editor' permission" });
                }

                finalWorkspaceId = targetWorkspaceId;
            } else {
                finalWorkspaceId = null;
                finalOwnerId = userId;
            }
        }

        const isCircular = await isCircularMove(sourceFolder._id, newParentId);
        if (isCircular) {
            return res.status(400).json({ message: "Cannot move a folder into its subfolder" });
        }
        
        sourceFolder.parentId = newParentId || null;
        sourceFolder.workspaceId = finalWorkspaceId;
        sourceFolder.createdBy = finalOwnerId;
        await sourceFolder.save();

        console.log(`[FolderController] Successfully moved folder ${folderId}`);
        return res.json({ message: "Folder moved successfully", data: sourceFolder });
    } catch (err) {
        console.error(`[FolderController] System error in moveFolder:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------GET /api/folders/trash-----------
async function getTrashedFolders(req, res) {
    try {
        const userId = req.user.userId;
        const { workspaceId } = req.query;

        let query = { deletedAt: { $ne: null } };

        if (workspaceId) {
            const workspace = await Workspace.findById(workspaceId);
            if (!workspace) {
                console.warn(`[FolderController] Get trash failed: Workspace ${workspaceId} not found`);
                return res.status(404).json({ message: "Workspace not found" });
            }
            const member = workspace.members.find((m) => m.userId.toString() === userId);
            if (!member) {
                console.warn(`[FolderController] Get trash failed: User ${userId} not in workspace ${workspaceId}`);
                return res.status(403).json({ message: "Không có quyền truy cập" });
            }

            query.workspaceId = workspaceId;
        } else {
            query.createdBy = userId;
            query.workspaceId = null;
        }

        const trashedFolders = await Folder.find(query).setOptions({ includeDeleted: true }).sort({ deletedAt: -1 });
        console.log(`[FolderController] Successfully fetched ${trashedFolders.length} trashed folders`);
        return res.json({ success: true, data: trashedFolders });

    } catch (err) {
        console.error(`[FolderController] System error in getTrashedFolders:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------DELETE /api/folders/trash/empty-----------
async function emptyTrashFolder(req, res) {
  try {
    const userId = req.user.userId;

    const trashedFolders = await Folder.find({
      createdBy:   userId,
      workspaceId: null,
      deletedAt:   { $ne: null },
    }).setOptions({ includeDeleted: true });

    if (trashedFolders.length === 0) {
      console.log(`[FolderController] Empty trash: No folders found in trash for user ${userId}`);
      return res.json({ message: 'Trash is empty' });
    }

    let allFolderIds = [];
    for (const f of trashedFolders) {
      const descendants = await getAllDescendantIds(f._id);
      allFolderIds.push(f._id.toString(), ...descendants);
    }
    allFolderIds = [...new Set(allFolderIds)];
    console.log(`[FolderController] Preparing to permanently delete ${allFolderIds.length} folders`);

    try {
      console.log(`[FolderController] Calling File Service to force delete files in emptied folders`);
      await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders/force`, {
          data:    { folderIds: allFolderIds },
          headers: { Authorization: req.headers.authorization },
        }
      );
    } catch (err) {
        console.error(`[FolderController] Failed to force delete internal files via File Service:`, err.message);
        return res.status(500).json({ message: "Error system when cleaning all the files" });
    }
    
    await Folder.deleteMany({ _id: { $in: allFolderIds } });
    console.log(`[FolderController] Successfully deleted ${allFolderIds.length} folders from MongoDB`);

    try {
      await addJob(
        queueForEvent(EVENTS.FOLDER_TRASHED),
        EVENTS.FOLDER_TRASHED,
        { allFolderIds, actorId: userId },
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FOLDER_TRASHED, `empty-folder-trash-${userId}`) }
      );
      console.log(`[FolderController] Enqueued FOLDER_TRASHED job for empty trash operation`);
    } catch (jobErr) {
      console.error(`[Queue Error] emptyTrashFolder failed to enqueue job:`, jobErr.message);
    }

    return res.json({ message: `Emptied ${trashedFolders.length} folders from trash` });
  } catch (err) {
    console.error(`[FolderController] System error in emptyTrashFolder:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

//-------DELETE /api/folders/trash/:id/force-----------
async function forceDeleteFolder(req, res) {
  try {
    const userId   = req.user.userId;
    const folderId = req.params.id;
    console.log(`[FolderController] Request to force delete folder ${folderId} by user ${userId}`);

    const folder = await Folder.findById(folderId)
      .setOptions({ includeDeleted: true });

    if (!folder) {
      console.warn(`[FolderController] Force delete failed: Folder not found. ID: ${folderId}`);
      return res.status(404).json({ message: 'Folder not found' });
    }
    if (!folder.deletedAt) {
      console.warn(`[FolderController] Force delete failed: Folder ${folderId} is not in trash`);
      return res.status(400).json({ message: 'Folder is not in trash. Move to trash first' });
    }
    if (!folder.workspaceId) {
      if (folder.createdBy.toString() !== userId) {
        console.warn(`[FolderController] Force delete failed: Personal folder does not belong to user ${userId}`);
        return res.status(403).json({ message: 'No permission to force delete this folder' });
      }
    } else {
      const workspace = await Workspace.findById(folder.workspaceId);
      if (!workspace) {
        console.warn(`[FolderController] Force delete failed: Workspace ${folder.workspaceId} not found`);
        return res.status(404).json({ message: 'Workspace not found' });
      }
      const member = workspace.members.find((m) => m.userId.toString() === userId);
      if (!member || member.role !== 'ADMIN') {
        console.warn(`[FolderController] Force delete failed: User ${userId} is not Admin in workspace`);
        return res.status(403).json({ message: 'Only Admin can force delete folder' });
      }
    }

    const childFolderIds = await getAllDescendantIds(folderId);
    const allFolderIds   = [folderId, ...childFolderIds];

    try {
      console.log(`[FolderController] Calling File Service to force delete files in folder hierarchy ${folderId}`);
      await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders/force`, {
          data:    { folderIds: allFolderIds },
          headers: { Authorization: req.headers.authorization },
        }
      );
    } catch (err) {
        console.error(`[FolderController] Failed to force delete internal files via File Service:`, err.message);
        return res.status(500).json({ message: "Error system when force delete file" });
    }

    await Folder.deleteMany({ _id: { $in: allFolderIds } });
    console.log(`[FolderController] Successfully force-deleted folder hierarchy ${folderId} from MongoDB`);

    try {
      await addJob(
        queueForEvent(EVENTS.FOLDER_TRASHED),
        EVENTS.FOLDER_TRASHED,
        { allFolderIds, actorId: userId },
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FOLDER_TRASHED, folderId) }
      );
      console.log(`[FolderController] Enqueued FOLDER_TRASHED job for force delete operation`);
    } catch (jobErr) {
      console.error(`[Queue Error] forceDeleteFolder failed to enqueue job:`, jobErr.message);
    }

    return res.json({ message: 'Folder permanently deleted' });
  } catch (err) {
    console.error(`[FolderController] System error in forceDeleteFolder:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    getFolders,
    getFolderById,
    restoreFolder, 
    getTrashedFolders, 
    forceDeleteFolder, 
    emptyTrashFolder
};