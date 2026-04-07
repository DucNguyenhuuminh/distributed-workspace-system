const mongoose = require('mongoose');
const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

async function checkFolderExists(req,res,next) {
    try {
        const folderId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(folderId)) {
            return res.status(400).json({ message: "Invalid Folder ID format" });
        }

        const folder = await Folder.findById(folderId);
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
}

function requireFolderEditPermission(req,res,next) {
    const userId = req.user.userId;
    const folder = req.folder;

    if (!folder.workspaceId) {
        if (folder.createdBy.toString() !== userId) {
            return res.status(403).json({message: "No permission to modify this folder"});
        }
    }else {
        const workspace = req.workspace;
        const targetMember = workspace.members.find((m) => m.userId.toString === userId);
        if (!targetMember) {
            return res.status(403).json({message: "You are not a member of this workspace"});
        }

        const canEdit = targetMember.role === "ADMIN" || targetMember.permissions.includes("upload");
        if (!canEdit) {
            return res.status(403).json({message: "No permission to modify folder in this workspace"});
        }
    }
    next();
}

async function verifyWorkspaceAccess(req,res,next) {
    try {
        const workspaceId = req.body.workspaceId || req.query.workspaceId;
        if (!workspaceId)   return next();

        if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
            return res.status(400).json({ message: "Invalid Workspace ID format" });
        }

        const userId = req.user.userId;
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({message: "Workspace not found"});
        }
        const isMember = workspace.members.some((m) => m.userId.toString() === userId);
        if (!isMember) {
            return res.status(403).json({message: "You do not have permission to access this folder"});
        }
        req.workspace = workspace;
        next();
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {checkFolderExists, checkFolderPermission, verifyWorkspaceAccess, requireFolderEditPermission};