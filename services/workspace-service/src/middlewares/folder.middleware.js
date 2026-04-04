const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

async function checkFolderExists(req,res,next) {
    try {
        const folderId = req.params.id;
        const folder = await Folder.findById(req.params.id);

        if (!folder) {
            return res.status(404).json({message: "Folder not exist"});
        }
        req.folder = folder;
        if (folder.workspaceId) {
            const workspace = await Workspace.findById(folder.workspaceId);
            if (!workspace) {
                return res.status(404).json({message: "Workspace not exist"});
            }
            req.workspace = workspace;
        }
        next();
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

function checkFolderPermission(req,res,next) {
    try {
        const userId = req.user.userId;
        const folder = req.folder;

        if (!folder.workspaceId) {
            if (folder.createdBy.toString() !== userId) {
                return res.status(403).json({message: "You do not have permission to access this folder"});
            }
        }else {
            const workspace = req.workspace;
            const isMember = workspace.members.some((m) => m.userId.toString() === userId);
            if (!isMember) {
                return res.status(403).json({message: "You do not have permission to access this folder"});
            }
        }
        next();
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

async function verifyWorkspaceAccess(req,res,next) {
    try {
        const workspaceId = req.body.workspaceId || req.query.workspaceId;
        if (!workspaceId) {return next()};

        const userId = req.user.userId;
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({message: "Workspace not found"});
        }
        const isMember = workspace.members.some((m) => m.userId.toString() === userId);
        if (!isMember) {
            return res.status(403).json({message: "You do not have permission to access this folder"});
        }
        next();
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {checkFolderExists, checkFolderPermission, verifyWorkspaceAccess};