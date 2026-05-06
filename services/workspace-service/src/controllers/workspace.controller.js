const axios = require('axios');
const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');
const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || 'http://localhost:3002';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

const{addJob, queueForEvent, jobIdFor,EVENTS,DEFAULT_JOB_OPTIONS} = require('shared');

//-------------------LOGIC--------------------

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
                permissions: 'editor',
            }],
        });

        try {
            await addJob(
                queueForEvent(EVENTS.WORKSPACE_CREATED),
                EVENTS.WORKSPACE_CREATED,
                {workspaceId: workspace._id.toString(), createdBy: userId, workspace: workspace.toObject()},
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.WORKSPACE_CREATED, workspace._id.toString())}
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue WORKSPACE_CREATED job', jobErr);
        }

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
        const workspaceId = req.params.id;
        const userId = req.user.userId;

        // check exists & permission 
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.some((m) => m.userId.toString() === userId);
        if (!member) {
            return res.status(403).json({message: "You do not have permission to access" });
        }

        return res.json({data: workspace});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/workspaces/:id/members-----------
async function addMember(req,res) {
    try {
        const workspaceId = req.params.id;
        const adminId = req.user.userId;
        const {email, permissions} = req.body;

        //check exists & permission
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== "ADMIN") {
            return res.status(403).json({ message: "Only Admin can perform this action" });
        }

        let targetUser;
        try {
            const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/internal/find-by-email`,
                {params: {email}}
            );
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
            permissions: permissions || 'viewer',
        });
        await workspace.save();

        try {
            await addJob(
                queueForEvent(EVENTS.MEMBER_ADDED),
                EVENTS.MEMBER_ADDED,
                { workspaceId: workspace._id.toString(), targetUserId: targetUser._id.toString(), email, actoreId: adminId, workspaceName: workspace.name, workspace: workspace.toObject() },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspace._id.toString()}:${targetUser._id.toString()}`) }
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue MEMBER_ADDED job', jobErr);
        }

        return res.json({message: "Adding member success", data: workspace});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/workspaces/:id-----------
async function deleteWorkspace(req,res) {
    try {
        const workspaceId = req.params.id;
        const adminId = req.user.userId;
        
        //check exists & permission
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== "ADMIN") {
            return res.status(403).json({ message: "Only Admin can perform this action" });
        }
            
        await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-workspace/${workspaceId}`);
        await Folder.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        
        workspace.deletedAt = new Date();
        await workspace.save();

        try {
            await addJob(
                queueForEvent(EVENTS.WORKSPACE_DELETED),
                EVENTS.WORKSPACE_DELETED,
                { workspaceId: workspace._id.toString(), name: workspace.name, actorId: adminId, membersId: workspace.members.map(m => m.userId.toString()) },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.WORKSPACE_DELETED, workspace._id.toString()) }
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue WORKSPACE_DELETED job', jobErr);
        }

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
        const workspaceId = req.params.id;

        //check exists & permission
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
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

        try {
            await addJob(
                queueForEvent(EVENTS.MEMBER_REMOVED),
                EVENTS.MEMBER_REMOVED,
                { workspaceId: workspace._id.toString(), targetUserId, removedBy: currentUserId, actorId: currentUserId, workspaceName: workspace.name, workspace: workspace.toObject() },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_REMOVED, `${workspace._id.toString()}:${targetUserId}`) }
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue MEMBER_REMOVED job', jobErr);
        }

        return res.json({message: "Removed member out workspace"});
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {createWorkspace, addMember, getWorkspaceById, getWorkspaces, removeMember, deleteWorkspace};