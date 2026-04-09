const axios = require('axios');
const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

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
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces-----------
async function getWorkspaces(req,res) {
    try {
        const userId = req.user.userId;
        const workspaces = await Workspace.find({'members.userId': userId});
        return res.json({data: workspaces});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces/:id-----------
async function getWorkspaceById(req,res) {
    try {
        return res.json({data: req.workspace});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/workspaces/:id/members-----------
async function addMember(req,res) {
    try {
        const workspace = req.workspace;
        const {email, permissions} = req.body;

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
        const workspace = req.workspace;
        const workspaceId = workspace._id;
            
        await Folder.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        await Document.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        workspace.deletedAt = new Date();
        await workspace.save();

        return res.json({message: "Deleted workspace"});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/workspaces/:id/members/:targetUserId-----------
async function removeMember(req,res) {
    try {
        const currentUserId = req.user.userId;
        const targetUserId = req.params.targetUserId;
        const workspace = req.workspace;

        const targetMember = workspace.members.find((m) => m.userId.toString() === targetUserId);
        if (!targetMember) {
            return res.status(400).json({message: "Member not in this workspace"});
        }

        const currentUserData = workspace.members.find((m) => m.userId.toString() === currentUserId);
        if (!currentUserData) {
            return res.status(403).json({message: "You are not a member of this workspace"});
        }

        const isSelfRemove = targetUserId === currentUserId;
        const isAdmin = currentUserData.role === "ADMIN";
        if (!isSelfRemove && !isAdmin) {
            return res.status(403).json({message: "Only Admin can remove other members"})
        }
        
        const adminCount = workspace.members.filter((m) => m.role === "ADMIN").length;
        if (isSelfRemove && targetMember.role === "ADMIN" && adminCount === 1) {
            return res.status(400).json({message: "Cannot leave workspace if you are only Admin"});
        }
        
        workspace.members = workspace.members.filter((m) => m.userId.toString() !== targetUserId);
        await workspace.save();

        return res.json({message: "Removed member out workspace"});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {createWorkspace, addMember, getWorkspaceById, getWorkspaces, removeMember, deleteWorkspace};