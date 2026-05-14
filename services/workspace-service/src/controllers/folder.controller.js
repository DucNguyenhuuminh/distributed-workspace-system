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
            return true;
        }
        const parentNode = await Folder.findById(currentParentId,'parentId');
        currentParentId = parentNode ? parentNode.parentId : null;
        depth++;
        if (depth > 100) {
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
            if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

            const member = workspace.members.find((m) => m.userId.toString() === userId);
            if (!member) return res.status(403).json({ message: 'You are not a member of this workspace' });

            const canEdit = member.role === 'ADMIN' || member.permissions.includes('editor');
            if (!canEdit) return res.status(403).json({ message: 'No permission to modify in this workspace' });
        }
        

        const folder = await Folder.create({
            name,
            workspaceId: workspaceId || null,
            parentId: parentId || null,
            createdBy: userId,
        });

        return res.status(201).json({message: "Created folder successful", data: folder});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/folders-----------
async function getFolders(req,res) {
    try {
        const userId = req.user.userId;
        const {workspaceId, parentId} = req.query;

        //check exists & permission
        if (workspaceId) {
            const workspace = await Workspace.findById(workspaceId);
            if (!workspace) {
                return res.status(404).json({message: "Workspace not found"});
            }
            const member = workspace.members.some((m) => m.userId.toString() === userId);
            if (!member) {
                return res.status(403).json({message: "You do not have permission to access this workspace"});
            }
        }

        let query = {};
        if (parentId) {
            query.parentId = parentId;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            }else {
                query.createdBy     = userId;
                query.workspaceId = null;
            }
        }else {
            if (workspaceId) {
                query.workspaceId = workspaceId;
                query.parentId    = null;
            } else {
                query.createdBy     = userId;
                query.workspaceId = null;
                query.parentId    = null;
            }
        }

        const folders = await Folder.find(query);
        return res.json({data: folders});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/folders/:id-----------
async function getFolderById(req,res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;

        // 1. Kiểm tra folder có tồn tại không
        const currentFolder = await Folder.findById(folderId);
        if (!currentFolder) {
            return res.status(404).json({message: "Folder not exist"});
        }

        // 2. Kiểm tra quyền truy cập (giống hệt logic cũ)
        if (currentFolder.workspaceId) {
            const workspace = await Workspace.findById(currentFolder.workspaceId);
            if (!workspace) return res.status(404).json({message: "Workspace not exist"});
            
            const member = workspace.members.some((m) => m.userId.toString() === userId);
            if (!member) return res.status(403).json({message: "You do not have permission to access this folder"});
        } else {
            if (currentFolder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "You do not have permission to access this folder"});
            }
        }

        // 3. Query lấy danh sách thư mục con (sub-folders)
        const folders = await Folder.find({
            parentId: folderId,
            deletedAt: null
        });

        let files = [];
        try {
            const response = await axios.get(`${FILE_SERVICE_URL}/api/files/internal/by-folders/getFiles`, {
                params: { 
                    folderId: folderId, 
                    deletedAt: null 
                },
                headers: { Authorization: req.headers.authorization },
            });
            files = response.data?.data || [];
        } catch(err){
            console.error("[workspace-service] Error while call File Service get files:", err.message);
            return res.status(500).json({message: "Error system when get all the files"});
        }
            
        const breadcrumb = await getBreadcrumbPath(folderId);

        // Trả về tất cả trong 1 response
        return res.json({
            data: {
                folderInfo: currentFolder,
                folders: folders,
                files: files,
                breadcrumb: breadcrumb
            }
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/rename-----------
async function renameFolder(req,res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;
        const {name} = req.body;

        //check exists & permission
        const folder = await Folder.findById(folderId);
        if (!folder) {
            return res.status(404).json({message: "Folder not exist"});
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "No permission to modify this folder"});
            }
        }else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                return res.status(403).json({message: "You are not a member of this workspace"});
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                return res.status(403).json({message: "No permission to modify folder in this workspace"});
            }
        }

        folder.name = name;
        await folder.save();
        
        return res.json({message: "Rename successfully", data: folder});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/folders/:id-----------
async function deleteFolder(req,res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;
        const childFolderIds = await getAllDescendantIds(folderId);
        const allFolderIds = [folderId, ...childFolderIds];

        //check exists & permission
        const folder = await Folder.findById(folderId);
        if (!folder) {
            return res.status(404).json({message: "Folder not exist"});
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "No permission to modify this folder"});
            }
        }else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                return res.status(403).json({message: "You are not a member of this workspace"});
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                return res.status(403).json({message: "No permission to modify folder in this workspace"});
            }
        }
        try {
            await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders`, {
                data: { folderIds: allFolderIds },
                headers: { Authorization: req.headers.authorization }
            });
        } catch(err) {
            console.error("[workspace-service] Error while call File Service delete file:", err.message);
            return res.status(500).json({message: "Error system when delete all the files"});
        }
        
        await Folder.updateMany(
            {_id: {$in: allFolderIds}},
            {deletedAt: new Date()}
        );

        return res.json({message: "Folder deleted successfully"});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/restore-----------
async function restoreFolder(req,res) {
    try {
        const folderId = req.params.id;
        const userId = req.user.userId;

        //check exists & permission
        const folder = await Folder.findById(folderId).setOptions({includeDeleted: true});
        if (!folder) {
            return res.status(404).json({message: "Folder not exist"});
        }
        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "No permission to modify this folder"});
            }
        }else {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                return res.status(404).json({ message: "Workspace not found" });
            }
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                return res.status(403).json({message: "You are not a member of this workspace"});
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                return res.status(403).json({message: "No permission to modify folder in this workspace"});
            }
        }

        //check deleted time
        if (!folder.deletedAt) {
            return res.status(400).json({message: "Folder not in the trash"});
        }

        // delete logic
        const now = new Date();
        const deletedTime = new Date(folder.deletedAt);
        const diffInMilliseconds = now.getTime() - deletedTime.getTime();
        const diffInDays = diffInMilliseconds/(1000*60*60*24);

        if (diffInDays > 10) {
            return res.status(400).json({message: "Can not restore. File already in trash over 10 days"})
        }

        const childFolderIds = await getAllDescendantIds(folder._id);
        const allFoldersIds = [folder._id.toString(), ...childFolderIds];

        try {
            await axios.put(`${FILE_SERVICE_URL}/api/files/internal/by-folders/restore`,
                {folderIds: allFoldersIds},
                {headers: {Authorization: req.headers.authorization}}
            );
        } catch(err) {
            console.error("[workspace-service] Error while call File Service restore file:", err.message);
            return res.status(500).json({message: "Error system when restore all sub-folders"});
        }

        await Folder.updateMany(
            {_id: {$in: allFoldersIds}},
            {deletedAt: null}
        );

        return res.json({message: "Restore folder successfully", data: folder});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/move-----------
async function moveFolder(req,res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;
        const {newParentId, targetWorkspaceId} = req.body;

        //check exists & permission
        const sourceFolder = await Folder.findById(folderId);
        if (!sourceFolder) {
            return res.status(404).json({message: "Folder not exist"});
        }
        if (!sourceFolder.workspaceId) {
            if (sourceFolder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "No permission to modify this folder"});
            }
        }else {
            const workspace = await Workspace.findById(sourceFolder.workspaceId);
            const targetMember = workspace.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                return res.status(403).json({message: "You are not a member of this workspace"});
            }

            const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
            if (!canEdit) {
                return res.status(403).json({message: "No permission to modify folder in this workspace"});
            }
        }
        if (newParentId && sourceFolder._id.toString() === newParentId) {
            return res.status(400).json({message: "Cannot move folder into itself"});
        }

        let finalWorkspaceId = null;
        let finalOwnerId = userId;

        if (newParentId) {
            const targetFolder = await Folder.findById(newParentId);
            if (!targetFolder) {
                return res.status(404).json({message: "Target parent folder not found"});
            }

            finalWorkspaceId = targetFolder.workspaceId;
            finalOwnerId = targetFolder.workspaceId ? null : userId;

            if (!targetFolder.workspaceId) {
                if (targetFolder.createdBy.toString() !== userId) {
                    return res.status(403).json({message: "No permission to move to the target folder"});
                }
            }else {
                const Ws = await Workspace.findById(targetFolder.workspaceId);
                if (!Ws) {
                    return res.status(404).json({message: "Target workspace not found"});
                }
                const targetMember = Ws.members.find((m) => m.userId.toString() === userId);
                if (!targetMember) {
                    return res.status(403).json({message: "No permission to move to the target workspace"});
                }
                const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
                if (!canUpload) { 
                    return res.status(403).json({message: "No permission to move to the target workspace"});
                }
            }
        }else {
            if (targetWorkspaceId) {
                const Ws = await Workspace.findById(targetWorkspaceId);
                if (!Ws) {
                    return res.status(404).json({message: "Target workspace not found"});
                }
                const targetMember = Ws.members.find((m) => m.userId.toString() === userId);
                if (!targetMember) {
                    return res.status(403).json({message: "You are not a member of the target workspace"});
                }
                const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("editor");
                if (!canUpload) {
                    return res.status(403).json({message: "No 'editor' permission"});
                }

                finalWorkspaceId = targetWorkspaceId;
                finalOwnerId = null;
            }else {
                finalWorkspaceId = null;
                finalOwnerId = userId;
            }
        }

        const isCircular = await isCircularMove(sourceFolder._id, newParentId);
        if (isCircular) {
            return res.status(400).json({message: "Cannot move a folder into its subfolder"});
        }
        
        sourceFolder.parentId = newParentId || null;
        sourceFolder.workspaceId = finalWorkspaceId;
        sourceFolder.createdBy = finalOwnerId;
        await sourceFolder.save();

        return res.json({message: "Folder moved successfully", data: sourceFolder});
    } catch(err) {
        return res.status(500).json({message: err.message});
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
                return res.status(404).json({ message: "Workspace not found" });
            }
            const member = workspace.members.find((m) => m.userId.toString() === userId);
            if (!member) {
                return res.status(403).json({ message: "Không có quyền truy cập" });
            }

            query.workspaceId = workspaceId;
        } else {
            query.createdBy = userId;
            query.workspaceId = null;
        }

        const trashedFolders = await Folder.find(query).setOptions({includeDeleted: true}).sort({ deletedAt: -1 });
        return res.json({ success: true, data: trashedFolders });

    } catch(err) {
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
      return res.json({ message: 'Trash is empty' });
    }

    let allFolderIds = [];
    for (const f of trashedFolders) {
      const descendants = await getAllDescendantIds(f._id);
      allFolderIds.push(f._id.toString(), ...descendants);
    }
    allFolderIds = [...new Set(allFolderIds)];

    try {
      await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders/force`, {
          data:    { folderIds: allFolderIds },
          headers: { Authorization: req.headers.authorization },
        }
      );
    } catch (err) {
        console.error("[workspace-service] Error while call File Service clean the files:", err.message);
        return res.status(500).json({message: "Error system when cleaning all the files"});
    }
    await Folder.deleteMany({ _id: { $in: allFolderIds } });

    try {
      await addJob(
        queueForEvent(EVENTS.FOLDER_TRASHED),
        EVENTS.FOLDER_TRASHED,
        { allFolderIds, actorId: userId },
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FOLDER_TRASHED, `empty-folder-trash-${userId}`) }
      );
    } catch (jobErr) {
      console.error('[Queue Error] emptyTrashFolder:', jobErr.message);
    }

    return res.json({ message: `Emptied ${trashedFolders.length} folders from trash` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

//-------DELETE /api/folders/trash/:id/force-----------
async function forceDeleteFolder(req, res) {
  try {
    const userId   = req.user.userId;
    const folderId = req.params.id;

    const folder = await Folder.findById(folderId)
      .setOptions({ includeDeleted: true });

    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }
    if (!folder.deletedAt) {
      return res.status(400).json({ message: 'Folder is not in trash. Move to trash first' });
    }
    if (!folder.workspaceId) {
      if (folder.createdBy.toString() !== userId) {
        return res.status(403).json({ message: 'No permission to force delete this folder' });
      }
    } else {
      const workspace = await Workspace.findById(folder.workspaceId);
      if (!workspace) {
        return res.status(404).json({ message: 'Workspace not found' });
      }
      const member = workspace.members.find((m) => m.userId.toString() === userId);
      if (!member || member.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Only Admin can force delete folder' });
      }
    }

    const childFolderIds = await getAllDescendantIds(folderId);
    const allFolderIds   = [folderId, ...childFolderIds];

    try {
      await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-folders/force`, {
          data:    { folderIds: allFolderIds },
          headers: { Authorization: req.headers.authorization },
        }
      );
    } catch (err) {
        console.error("[workspace-service] Error while call File Service force force file:", err.message);
        return res.status(500).json({message: "Error system when force delete file"});
    }

    await Folder.deleteMany({ _id: { $in: allFolderIds } });

    try {
      await addJob(
        queueForEvent(EVENTS.FOLDER_TRASHED),
        EVENTS.FOLDER_TRASHED,
        { allFolderIds, actorId: userId },
        { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FOLDER_TRASHED, folderId) }
      );
    } catch (jobErr) {
      console.error('[Queue Error] forceDeleteFolder:', jobErr.message);
    }

    return res.json({ message: 'Folder permanently deleted' });
  } catch (err) {
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