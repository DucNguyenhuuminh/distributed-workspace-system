const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');

//Helper
async function check_workspace(workspace) {
    if (!workspace) {
        throw new Error("Workspace not exist");
    }
}

async function check_member_permission(workspace, userId) {
    const isMember = workspace.members.some((m) => m.userId.toString() === userId);
    if (!isMember) {
        throw new Error("You not have permission to access");
    }
}

async function check_admin(workspace, adminId) {
    const isAdmin = workspace.members.find((m) => m.userId.toString() === adminId);
    if (!isAdmin || isAdmin.role !== "ADMIN") {
        throw new Error("Only Admin can add members");
    }
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
        check_workspace(workspace);
        check_member_permission(workspace,  userId);

        return res.json({data: workspace});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces/:id/members-----------
async function addMember(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const {email,permissions} = req.body;

        const workspace = await Workspace.findById(workspaceId);
        check_workspace(workspace);
        check_admin(workspace, adminId);

        const User = require('../../../auth-service/src/models/auth.model');
        const targetUser = await User.findOne({email});
        if (!targetUser) {
            return res.status(404).json({message: "User not exist in the system"});
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
        check_workspace(workspaceId);
        check_admin(workspace, adminId);

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
        check_workspace(workspaceId);
        check_admin(workspace, adminId);

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