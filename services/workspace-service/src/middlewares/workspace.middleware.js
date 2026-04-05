const mongoose = require('mongoose');
const Workspace = require('../models/workspace.model');

async function checkWorkspaceExists(req,res,next) {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid Workspace ID format" });
        }

        const workspace = await Workspace.findById(req.params.id);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
        req.workspace = workspace;
        next();
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

function requireAdminRole(req,res,next) {
    const adminId = req.user.userId;
    const workspace = req.workspace;

    const member = workspace.members.find((m) => m.userId.toString() === adminId);
    if (!member || member.role !== "ADMIN") {
        return res.status(403).json({ message: "Only Admin can perform this action" });
    }
    next();
}

function requireMemberRole(req,res,next) {
    const userId = req.user.userId;
    const workspace = req.workspace;

    const isMember = workspace.members.some((m) => m.userId.toString() === userId);
    if (!isMember) {
        return res.status(403).json({message: "You do not have permission to access" });
    }
    next();
}

module.exports = {checkWorkspaceExists,requireAdminRole,requireMemberRole};