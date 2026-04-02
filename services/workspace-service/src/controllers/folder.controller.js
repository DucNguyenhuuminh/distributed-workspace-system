const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

//Helper
async function check_membership(workspaceId, userId) {
    const workspace = Workspace.findById(workspaceId);
    if (!workspace) return null;
    return workspace.members.find((m) => m.userId.toString() === userId) || null;
}

async function check_folder(folder) {
    if (!folder) {
        throw new Error("Folder not exist");
    }
}

async function check_permission_userDrive_or_workspaceDrive(folder, userId) {
    if (!folder.workspaceId) {
        if (folder.createdBy.toString() !== userId) {
            throw new Error("You not have permission to access folder");
        }
    }else {
        const member = await check_membership(folder.workspaceId.toString(), userId);
        if (!member) {
            throw new Error("You not have permission to access folder in workspace")
        }
    }
}

async function get_all_subfolders(parentId) {
    const children = await Folder.find({parentId});
    let ids = children.map((f) => f._id);
    for (const child of children) {
        const grandChildren = await get_all_subfolders(child._id);
        ids = ids.concat(grandChildren);
    }
    return ids;
}

async function get_breadcrumb_path(folderId) {
    const breadcrumb = [];
    let currentId = folderId;

    while(currentId) {
        const folder = await Folder.findById(currentId);
        if (!folderId)  break;

        breadcrumb.unshift({
            _id: folder._id,
            name: folder.name,
            parentId: folder.parentId
        });
        currentId = folder.parentId;
    }
    return breadcrumb;
}

//-------POST /api/folders-----------
async function createFolder(req,res) {
    try {
        const userId = req.user.userId;
        const {name, parentId, workspaceId} = req.body;

        if (workspaceId) {
            const member = await check_membership(workspaceId, userId);
            if (!member) {
                return res.status(403).json({message: "You not have permission to access workspace"});
            }
        }

        const folder = await Folder.create({
            name,
            workspaceId: workspaceId || null,
            ownerId: workspaceId ? null: userId,
            parentId: parentId || null,
            createdBy: userId,
        });

        return res.status(201).json({message: "Created folder successful", data: folder});
    } catch (err) {
        return res.status(500).json({messsage: err.messsage});
    }
}

//-------GET /api/folders-----------
async function getFolders(req,res) {
    try {
        const userId = req.user.userId;
        const {workspaceId, parentId} = req.query;

        let query = {parentId: parentId || null};
        if (workspaceId) {
            const member = await check_membership(workspaceId, userId);
            if (!member) {
                return res.status(403).json({message: "You not have permission to access workspace"});
            }
            query.workspaceId = workspaceId;
        } else {
            query.ownerId = userId;
            query.workspaceId = null;
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
        const userId = req.user.userId;
        const folderId = req.param.id;

        const folder = await Folder.findById(folderId);
        check_folder(folder);
        check_permission_userDrive_or_workspaceDrive(folder,userId);

        const breadcrumb = await get_breadcrumb_path(folderId);
        return res.json({data: folder, breadcrumb: breadcrumb});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/folders/:id/rename-----------
async function renameFolder(req,res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;
        const {name} = req.body;

        const folder = await Folder.findById(folderId);
        check_folder(folder);
        check_permission_userDrive_or_workspaceDrive(folder,userId);

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

        const folder = await Folder.findById(folderId);
        check_folder(folder);
        check_permission_userDrive_or_workspaceDrive(folder,userId);

        const Document = require('../models/document.model');

        const childFolderIds = await get_all_subfolders(folderId);
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
async function moveFolder(req,res) {
    try {
        const userId = req.user.userId;
        const folderId = req.params.id;
        const {newParentId} = req.body;

        const [sourceFolder, targetFolder] = await Promise.all([
            Folder.findById(folderId),
            Folder.findById(newParentId),
        ]);

        check_folder(sourceFolder);
        check_folder(targetFolder);
        check_permission_userDrive_or_workspaceDrive(sourceFolder,userId);
        check_permission_userDrive_or_workspaceDrive(targetFolder,userId);

        const childIds = await get_all_subfolders(folderId);
        const isCircular = childIds.some((id) => id.toString() === newParentId);
        if (isCircular) {
            return res.status(400).json({message: "Cannot move folder into itself or its subfolder"});
        }
        
        sourceFolder.parentId = newParentId;
        sourceFolder.workspaceId = targetFolder.workspaceId || null;
        sourceFolder.ownerId = targetFolder.workspaceId ? null: userId;
        await sourceFolder.save();

        return res.json({message: "Folder moved successfully", data: sourceFolder});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {createFolder,renameFolder,deleteFolder,moveFolder,getFolders,getFolderById};