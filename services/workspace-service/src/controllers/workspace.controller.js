const axios = require('axios');
const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

//Helper
async function check_workspace(workspace) {
    if (!workspace) {
        return { status: 404, message: "Workspace not exist" };
    }
    return null;
}

async function check_member_permission(workspace, userId) {
    const isMember = workspace.members.some((m) => m.userId.toString() === userId);
    if (!isMember) {
        return { status: 403, message: "You do not have permission to access" };
    }
    return null;
}

async function check_admin(workspace, adminId) {
    const member = workspace.members.find((m) => m.userId.toString() === adminId);
    if (!member || member.role !== 'ADMIN') {
        return { status: 403, message: "Only Admin can perform this action" };
    }
    return null;
}

//-------POST /api/workspaces-----------
async function createWorkspace(req,res) {
    try {
        const {name} = req.body;
        const userId = req.user.userId;

        const workspace = await Workspace.create({
            name,
            createdBy: userId,
            members: [{
                userId,
                role: "ADMIN",
                permissions: ["preview", "download", "upload"],
            }],
        });

        return res.status(201).json({message: "Create workspace successfully", data: workspace});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces-----------
async function getWorkspaces(req,res) {
    try {
        const userId = req.user.userId;
        const workspaces = await Workspace.find({'members.userId': userId});
        return res.json({data: workspaces});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces/:id-----------
async function getWorkspaceById(req,res) {
    try {
        const userId = req.user.userId;
        const workspaceId = req.params.id;

        const workspace = await Workspace.findById(workspaceId);
         const wsError = check_workspace(workspace);
        if (wsError) return res.status(wsError.status).json({ message: wsError.message });

        const permError = check_member_permission(workspace, userId);
        if (permError) return res.status(permError.status).json({ message: permError.message });

        return res.json({data: workspace});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/workspaces/:id/members-----------
async function addMember(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const {email,permissions} = req.body;

        const workspace = await Workspace.findById(workspaceId);
        const wsError = check_workspace(workspace);
        if (wsError) return res.status(wsError.status).json({ message: wsError.message });

        const adminError = check_admin(workspace, adminId);
        if (adminError) return res.status(adminError.status).json({ message: adminError.message });

        let targetUser;
        try {
            const response = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-email`,{params: {email}});
            targetUser = response.data.data;
        } catch(err) {
            if (err.response?.status === 404) {
                return res.status(404).json({message: "User not exist in this system"});
            }
            return res.status(500).json({message: "Cannot connect to auth-service"});
        }

        const already = workspace.members.some((m) => m.userId.toString() === targetUser._id.toString());
        if (already) {
            return res.status(400).json({message: "Member already in group workspace"});
        }

        workspace.members.push({
            userId: targetUser._id,
            role: "MEMBER",
            permissions: permissions || ["preview"],
        });
        await workspace.save();

        return res.json({message: "Adding member success", data: workspace});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/workspaces/:id-----------
async function deleteWorkspace(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;

        const workspace = await Workspace.findById(workspaceId);
        const wsError = check_workspace(workspace);        
        if (wsError) return res.status(wsError.status).json({ message: wsError.message });

        const adminError = check_admin(workspace, adminId);
        if (adminError) return res.status(adminError.status).json({ message: adminError.message });

        const Document = require('../models/document.model');

        await Folder.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        await Document.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        await Workspace.findByIdAndUpdate(workspaceId,{deletedAt: new Date()});

        return res.json({message: "Deleted workspace"});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/workspaces/:id/members/:targetUserId-----------
async function removeMember(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const targetUserId = req.params.targetUserId;

        const workspace = await Workspace.findById(workspaceId);
        const wsError = check_workspace(workspace);      // ← truyền workspace
        if (wsError) return res.status(wsError.status).json({ message: wsError.message });

        const adminError = check_admin(workspace, adminId);
        if (adminError) return res.status(adminError.status).json({ message: adminError.message });


        const targetMember = workspace.members.find((m) => m.userId.toString() === targetUserId);
        if (!targetMember) {
            return res.status(400).json({message: "Member not in this workspace"});
        }

        const adminCount = workspace.members.filter((m) => m.role === "ADMIN").length;
        const isSelfRemove = targetUserId === adminId;
        if (isSelfRemove && adminCount === 1) {
            return res.status(400).json({message: "Cannot out workspace if only Admin"});
        }

        workspace.members = workspace.members.filter((m) => m.userId.toString() !== targetUserId);
        await workspace.save();

        return res.json({message: "Removed member out workspace"});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {createWorkspace, addMember, getWorkspaceById, getWorkspaces, removeMember, deleteWorkspace};