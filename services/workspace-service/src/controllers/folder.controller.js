const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');
const {getBreadcrumbPath, getAllDescendantIds, isCircularMove} = require('../utils/folder.util');


//-------POST /api/folders-----------
async function createFolder(req,res) {
    try {
        const userId = req.user.userId;
        const {name, parentId, workspaceId} = req.body;

        if (workspaceId) {
            const ws = req.workspace || await Workspace.findById(workspaceId);
            if (!ws) {
                return res.status(404).json({message: "Workspace not found"});
            }
            const targetMember = ws.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) {
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }
            const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("upload");
            if (!canUpload) {
                return res.status(403).json({ message: "No 'upload' permission in this workspace" });
            }
        }

        if (parentId) {
            const parentFolder = await Folder.findById(parentId);
            if (!parentFolder) {
                return res.status(404).json({ message: "Parent folder not found" });
            }

            const pWsId = parentFolder.workspaceId ? parentFolder.workspaceId.toString() : null;
            const reqWsId = workspaceId ? workspaceId.toString() : null;
            if (pWsId !== reqWsId) {
                return res.status(400).json({ message: "Workspace ID mismatch with Parent Folder" });
            }
        }

        const folder = await Folder.create({
            name,
            workspaceId: workspaceId || null,
            ownerId: workspaceId ? null: userId,
            parentId: parentId || null,
            createdBy: userId,
        });

        return res.status(201).json({message: "Create folder successfully", data: folder});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/folders-----------
async function getFolders(req,res) {
    try {
        const userId = req.user.userId;
        const {workspaceId, parentId} = req.query;

        let query = {};
        if (parentId) {
            query.parentId = parentId;
        }else {
            query.parentId = null;
            if (workspaceId) {
                query.workspaceId = workspaceId;
            }else {
                query.ownerId = userId;
                query.workspaceId = null;
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
        const breadcrumb = await getBreadcrumbPath(req.folder._id);

        return res.json({data: req.folder, breadcrumb: breadcrumb});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/rename-----------
async function renameFolder(req,res) {
    try {
        const folder = req.folder;
        folder.name = req.body.name;
        await folder.save();
        
        return res.json({message: "Rename successfully", data: folder});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/folders/:id-----------
async function deleteFolder(req,res) {
    try {
        const folderId = req.folder._id.toString();
        const childFolderIds = await getAllDescendantIds(folderId);
        const allFolderIds = [folderId, ...childFolderIds];

        await Folder.updateMany(
            {_id: {$in: allFolderIds}},
            {deletedAt: new Date()}
        );
        await Document.updateMany(
            {folderId: {$in: allFolderIds}},
            {deletedAt: new Date()}
        );

        return res.json({message: "Folder deleted successfully"});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/move-----------
async function moveFolder(req, res) {
    try {
        const userId = req.user.userId;
        const sourceFolder = req.folder;
        const { newParentId, targetWorkspaceId } = req.body;

        if (newParentId && sourceFolder._id.toString() === newParentId) {
            return res.status(400).json({ message: "Cannot move folder into itself" });
        }

        let finalWorkspaceId = null;
        let finalOwnerId = userId;
        let workspaceIdToVerify = null;

        if (newParentId) {
            //Move to other folder
            const targetFolder = await Folder.findById(newParentId);
            if (!targetFolder) {
                return res.status(404).json({ message: "Target parent folder not found" });
            }

            finalWorkspaceId = targetFolder.workspaceId;
            finalOwnerId = finalWorkspaceId ? null : userId;

            if (!finalWorkspaceId) {
                if (targetFolder.createdBy.toString() !== userId) {
                    return res.status(403).json({ message: "No permission to move to the target folder" });
                }
            } else {
                workspaceIdToVerify = finalWorkspaceId;
            }

        } else if (targetWorkspaceId) {
            //Move to root workspace
            finalWorkspaceId = targetWorkspaceId;
            finalOwnerId = null;
            workspaceIdToVerify = targetWorkspaceId;

        } else {
            //Move to child to root in owner Drive
            if (sourceFolder.ownerId && sourceFolder.ownerId.toString() !== userId) {
                return res.status(403).json({ message: "Cannot move another user's folder to your My Drive root" });
            }
            finalWorkspaceId = null;
            finalOwnerId = userId;
        }

        if (workspaceIdToVerify) {
            const ws = await Workspace.findById(workspaceIdToVerify);
            if (!ws) return res.status(404).json({ message: "Target workspace not found" });

            const targetMember = ws.members.find((m) => m.userId.toString() === userId);
            if (!targetMember) return res.status(403).json({ message: "You are not a member of the target workspace" });

            const canUpload = targetMember.role === "ADMIN" || targetMember.permissions.includes("upload");
            if (!canUpload) return res.status(403).json({ message: "No 'upload' permission for target workspace" });
        }

        const isCircular = await isCircularMove(sourceFolder._id, newParentId);
        if (isCircular) {
            return res.status(400).json({ message: "Cannot move a folder into its subfolder" });
        }
        
        sourceFolder.parentId = newParentId || null;
        sourceFolder.workspaceId = finalWorkspaceId;
        sourceFolder.ownerId = finalOwnerId;
        await sourceFolder.save();

        return res.json({ message: "Folder moved successfully", data: sourceFolder });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports = {createFolder,renameFolder,deleteFolder,moveFolder,getFolders,getFolderById};