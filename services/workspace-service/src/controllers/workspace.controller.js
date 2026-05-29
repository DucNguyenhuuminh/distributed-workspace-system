const axios = require('axios');
const Workspace = require('../models/workspace.model');
const Folder = require('../models/folder.model');
const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;

const {addJob} = require('shared/queue/queueProducer');
const {queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared/queue/queue.config');

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
        console.log(`[WorkspaceController] Workspace created successfully. ID: ${workspace._id}`);

        try {
            await addJob(
                queueForEvent(EVENTS.WORKSPACE_CREATED),
                EVENTS.WORKSPACE_CREATED,
                {
                    workspaceId: workspace._id.toString(), 
                    createdBy: userId, 
                    name: workspace.name,
                },
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.WORKSPACE_CREATED, workspace._id.toString())}
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue WORKSPACE_CREATED job', jobErr);
        }

        return res.status(201).json({message: "Create workspace successfully", data: workspace});
    } catch(err) {
        console.error(`[WorkspaceController] System error in createWorkspace:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces-----------
async function getWorkspaces(req,res) {
    try {
        const userId = req.user.userId;
        const workspaces = await Workspace.find({'members.userId': userId});
        console.log(`[WorkspaceController] Found ${workspaces.length} workspaces for user: ${userId}`);
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
            console.warn(`[WorkspaceController] Workspace not found. ID: ${workspaceId}`);
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.some((m) => m.userId.toString() === userId);
        if (!member) {
            console.warn(`[WorkspaceController] Permission denied. User ${userId} is not a member of workspace ${workspaceId}`);
            return res.status(403).json({message: "You do not have permission to access" });
        }

        console.log(`[WorkspaceController] Successfully fetched workspace details. ID: ${workspaceId}`);
        return res.json({data: workspace});
    } catch(err) {
        console.error(`[WorkspaceController] System error in getWorkspaceById:`, err.message);
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
            console.warn(`[WorkspaceController] Add member failed: Workspace not found. ID: ${workspaceId}`);
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== "ADMIN") {
            console.warn(`[WorkspaceController] Add member failed: User ${adminId} is not ADMIN in workspace ${workspaceId}`);
            return res.status(403).json({ message: "Only Admin can perform this action" });
        }

        let targetUser;
        try {
            console.log(`[WorkspaceController] Requesting Auth Service to find user by email: ${email}`);
            const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/internal/find-by-email`,
                {params: {email}}
            );
            targetUser = response.data.data;
        } catch(err) {
            if (err.response?.status === 404) {
                console.warn(`[WorkspaceController] Add member failed: User email '${email}' not found in Auth Service`);
                return res.status(404).json({message: "User not exist in this system"});
            }
            console.error(`[WorkspaceController] Failed to connect to Auth Service:`, err.message);
            return res.status(500).json({message: "Cannot connect to auth-service"});
        }

        const already = workspace.members.some((m) => m.userId.toString() === targetUser._id.toString());
        if (already) {
            console.warn(`[WorkspaceController] Add member failed: User ${targetUser._id} is already in workspace ${workspaceId}`);
            return res.status(400).json({message: "Member already in group workspace"});
        }

        workspace.members.push({
            userId: targetUser._id,
            role: "MEMBER",
            permissions: permissions || 'viewer',
        });
        await workspace.save();
        console.log(`[WorkspaceController] Successfully added user ${targetUser._id} to workspace ${workspaceId}`);

        try {
            await addJob(
                queueForEvent(EVENTS.MEMBER_ADDED),
                EVENTS.MEMBER_ADDED,
                { 
                    workspaceId: workspace._id.toString(), 
                    targetUserId: targetUser._id.toString(),  
                    workspaceName: workspace.name,
                    actorId: adminId,
                },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspace._id.toString()}-${targetUser._id.toString()}`) }
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue MEMBER_ADDED job', jobErr);
        }

        return res.json({message: "Adding member success", data: workspace});
    } catch (err) {
        console.error(`[WorkspaceController] System error in addMember:`, err.message);
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
            console.warn(`[WorkspaceController] Delete workspace failed: Workspace not found. ID: ${workspaceId}`);
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== "ADMIN") {
            console.warn(`[WorkspaceController] Delete workspace failed: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: "Only Admin can perform this action" });
        }
        try {
            console.log(`[WorkspaceController] Calling File Service to clean up internal files for workspace ${workspaceId}`);
            await axios.delete(`${FILE_SERVICE_URL}/api/files/internal/by-workspace/${workspaceId}`);
        } catch(err) {
            console.error(`[WorkspaceController] Failed to clean internal files via File Service:`, err.message);
        }
        
        await Folder.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        console.log(`[WorkspaceController] Soft-deleted all folders for workspace ${workspaceId}`);
        
        workspace.deletedAt = new Date();
        await workspace.save();
        console.log(`[WorkspaceController] Workspace ${workspaceId} marked as deleted`);

        try {
            await addJob(
                queueForEvent(EVENTS.WORKSPACE_DELETED),
                EVENTS.WORKSPACE_DELETED,
                { 
                    workspaceId: workspace._id.toString(), 
                    name: workspace.name,  
                    memberIds: workspace.members.map(m => m.userId.toString()),
                    actorId: adminId,
                },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.WORKSPACE_DELETED, workspace._id.toString()) }
            );
        } catch (jobErr) {
            console.error('[Queue Error] Failed to enqueue WORKSPACE_DELETED job', jobErr);
        }

        return res.json({message: "Deleted workspace"});
    } catch(err) {
        console.error(`[WorkspaceController] System error in deleteWorkspace:`, err.message);
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
            console.warn(`[WorkspaceController] Remove member failed: Workspace not found. ID: ${workspaceId}`);
            return res.status(404).json({ message: "Workspace not exist" });
        }
        const targetMember = workspace.members.find((m) => m.userId.toString() === targetUserId);
        if (!targetMember) {
            console.warn(`[WorkspaceController] Remove member failed: Target user ${targetUserId} not in workspace`);
            return res.status(400).json({message: "Member not in this workspace"});
        }

        const currentUserData = workspace.members.find((m) => m.userId.toString() === currentUserId);
        if (!currentUserData) {
            console.warn(`[WorkspaceController] Remove member failed: Current user ${currentUserId} not in workspace`);
            return res.status(403).json({message: "You are not a member of this workspace"});
        }

        const isSelfRemove = targetUserId === currentUserId;
        const isAdmin = currentUserData.role === "ADMIN";
        if (!isSelfRemove && !isAdmin) {
            console.warn(`[WorkspaceController] Remove member failed: User ${currentUserId} is not Admin to remove others`);
            return res.status(403).json({message: "Only Admin can remove other members"})
        }
        
        const adminCount = workspace.members.filter((m) => m.role === "ADMIN").length;
        if (isSelfRemove && targetMember.role === "ADMIN" && adminCount === 1) {
            console.warn(`[WorkspaceController] Remove member failed: User ${currentUserId} is the last Admin`);
            return res.status(400).json({message: "Cannot leave workspace if you are only Admin"});
        }
        
        workspace.members = workspace.members.filter((m) => m.userId.toString() !== targetUserId);
        await workspace.save();
        console.log(`[WorkspaceController] Successfully removed user ${targetUserId} from workspace ${workspaceId}`);

        try {
            await addJob(
                queueForEvent(EVENTS.MEMBER_REMOVED),
                EVENTS.MEMBER_REMOVED,
                { 
                    workspaceId: workspace._id.toString(), 
                    targetUserId, 
                    removedBy: currentUserId,
                    workspaceName: workspace.name 
                },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_REMOVED, `${workspace._id.toString()}-${targetUserId}`) }
            );
        } catch(jobErr) {
            console.error('[Queue Error] Failed to enqueue MEMBER_REMOVED job', jobErr);
        }

        return res.json({message: "Removed member out workspace"});
    } catch (err) {
        console.error(`[WorkspaceController] System error in removeMember:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------PATCH /api/workspaces/:id/members/:targetUserId/permission-----------
async function setUserPermission(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const targetUserId = req.params.targetUserId;
        const {permissions} = req.body;

        //check permission & exists
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[WorkspaceController] Set permission failed: Workspace not found. ID: ${workspaceId}`);
            return res.status(400).json({message: "Workspace not exist"})
        }
        const targetMember = workspace.members.find((m) => m.userId.toString() === targetUserId);
        if (!targetMember) {
            console.warn(`[WorkspaceController] Set permission failed: Target user ${targetUserId} not in workspace`);
            return res.status(400).json({message: "Member not in this workspace"});
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== "ADMIN") {
            console.warn(`[WorkspaceController] Set permission failed: User ${adminId} is not Admin`);
            return res.status(403).json({message: "You are not an Admin to set permission"});
        }
        if (permissions) {
            targetMember.permissions = permissions;
        }
        await workspace.save();
        console.log(`[WorkspaceController] Successfully updated permission for user ${targetUserId} in workspace ${workspaceId}`);

        try {
            await addJob(
                queueForEvent(EVENTS.MEMBER_PERMISSION),
                EVENTS.MEMBER_PERMISSION,
                {
                    workspaceId: workspace._id.toString(), 
                    workspaceName: workspace.name, 
                    targetUserId: targetUserId, 
                    actorId: adminId, 
                    newPermissions: targetMember.permissions?.[0] || 'view'
                },
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_PERMISSION, `${workspaceId}-${targetUserId}-${Date.now()}`)}
            );
        } catch(jobErr) {
            console.error('Queue Error] Failed to enqueue MEMBER_REMOVED job', jobErr);
        }

        return res.json({message: "Set permission successfully", data: workspace});
    } catch(err) {
        console.error(`[WorkspaceController] System error in setUserPermission:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    createWorkspace, 
    addMember, 
    getWorkspaceById, 
    getWorkspaces, 
    removeMember, 
    deleteWorkspace, 
    setUserPermission
};