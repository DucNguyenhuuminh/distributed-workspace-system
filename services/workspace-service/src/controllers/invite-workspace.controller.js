const axios = require('axios');
const Workspace = require('../models/workspace.model');
const WorkspaceInvite = require('../models/workspace-invite.model');
const JoinRequest = require('../models/join-request.model');
const {addJob} = require('shared/queue/queueProducer');
const {queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared/queue/queue.config');

// ---------POST /api/workspaces/:id/invite ------------------------
async function createInviteLink(req,res) {
    try {
        const userId = req.user.userId;
        const workspaceId = req.params.id;
        const {expiresInHours=null, autoApprove=false}=req.body;
        console.log(`[InviteController] User ${userId} attempting to create invite link for workspace ${workspaceId}`);

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Create invite failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const member = workspace.members.find((m) => m.userId.toString() === userId);
        if (!member) {
            console.warn(`[InviteController] Create invite denied: User ${userId} is not a member of workspace ${workspaceId}`);
            return res.status(403).json({ message: 'Only Admin can create invite link' });
        }

        const expiredAt = expiresInHours
            ? new Date(Date.now() + parseInt(expiresInHours)*3600*1000)
            : null;
        
        const invite = await WorkspaceInvite.create({
            workspaceId,
            createdBy: userId,
            expiredAt,
            autoApprove,
            workspaceName: workspace.name
        });

        const inviteUrl = `${process.env.FRONTEND_URL}/invite/${invite.token}`;
        console.log(`[InviteController] Successfully created invite link. Token: ${invite.token}`);

        return res.status(201).json({
            message: 'Invite link created',
            data: {
                token: invite.token,
                inviteUrl,
                workspaceName: workspace.name,
                autoApprove,
                expiredAt: invite.expiredAt,
            }
        });
    } catch(err) {
        console.error(`[InviteController] System error in createInviteLink:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ---------GET /api/workspaces/invite/:token ------------------------
async function getInviteInfo(req,res) {
    try {
        const {token} = req.params;
        console.log(`[InviteController] Fetching info for invite token: ${token}`);

        const invite = await WorkspaceInvite.findOne({token});
        if (!invite) {
            console.warn(`[InviteController] Get invite info failed: Token ${token} not found`);
            return res.status(404).json({ message: 'Invite link not found' });
        }
        if (invite.isRevoked) {
            console.warn(`[InviteController] Get invite info failed: Token ${token} has been revoked`);
            return res.status(403).json({ message: 'Invite link has been revoked' });
        }
        if (invite.expiredAt && new Date() > invite.expiredAt) {
            console.warn(`[InviteController] Get invite info failed: Token ${token} has expired`);
            return res.status(403).json({ message: 'Invite link has expired' });
        }
        const workspace = await Workspace.findById(invite.workspaceId).select('name members');
        console.log(`[InviteController] Valid token ${token}. Returning info for workspace ${invite.workspaceId}`);

        return res.json({
            message: 'Invite link valid',
            data:{
                workspaceId: invite.workspaceId,
                workspaceName: invite.workspaceName || workspace ?.name,
                memberCount: workspace?.members?.length || 0,
                autoApprove: invite.autoApprove,
                expiredAt: invite.expiredAt
            }
        });                                                                                                                               
    } catch(err) {
        console.error(`[InviteController] System error in getInviteInfo:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ---------POST /api/workspaces/invite/:token/join ------------------------
async function joinWorkspace(req,res) {
    try {
        const userId = req.user.userId;
        const {token} = req.params;
        const {message: userMessage} = req.body;
        console.log(`[InviteController] User ${userId} attempting to join workspace via token: ${token}`);

        const invite = await WorkspaceInvite.findOne({token});
        if (!invite) {
            console.warn(`[InviteController] Join failed: Token ${token} not found`);
            return res.status(404).json({ message: 'Invite link not found' });
        }
        if (invite.isRevoked) {
            console.warn(`[InviteController] Join failed: Token ${token} is revoked`);
            return res.status(403).json({ message: 'Invite link has been revoked' });
        }
        if (invite.expiredAt && new Date() > invite.expiredAt) {
            console.warn(`[InviteController] Join failed: Token ${token} has expired`);
            return res.status(403).json({ message: 'Invite link has expired' });
        }

        const workspaceId = invite.workspaceId.toString();
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Join failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const alreadyMember = workspace.members.some((m) => m.userId.toString() === userId);
        if (alreadyMember) {
            console.warn(`[InviteController] Join failed: User ${userId} is already a member of workspace ${workspaceId}`);
            return res.status(409).json({ message: 'You are already a member' });
        }

        let userInfo =  {email: '', username: ''};
        try {
            console.log(`[InviteController] Fetching user info for ${userId} from Auth Service`);
            const response = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-id`, {params: {id: userId}});
            userInfo = response.data.data;
        } catch(err) {
            console.error(`[InviteController] Cannot fetch user info from Auth Service:`, err.message);
        }

        // Auto Approve = true
        if (invite.autoApprove) {
            console.log(`[InviteController] Auto-approve is ON. Adding user ${userId} to workspace ${workspaceId} directly`);
            workspace.members.push({
                userId,
                role: 'MEMBER',
                permissions: 'viewer',
            });

            try {
                await addJob(
                    queueForEvent(EVENTS.MEMBER_ADDED),
                    EVENTS.MEMBER_ADDED,
                    {
                        workspaceId,
                        targetUserId: userId,
                        workspaceName: workspace.name,
                        actorId: invite.createdBy.toString(),
                    },
                    {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${userId}`)}
                );
                console.log(`[InviteController] Enqueued MEMBER_ADDED job for user ${userId}`);
            } catch(jobErr) {
                console.error('[Queue Error] MEMBER_ADDED:', jobErr.message);
            }

            return res.json({message: 'You have been added to the workspace',
                data: {status: 'approved', workspaceId, workspaceName: workspace.name},
            });
        }

        // Auto Approve = false
        console.log(`[InviteController] Auto-approve is OFF. Creating Join Request for user ${userId}`);
        const existingRequest = await JoinRequest.findOne({
            workspaceId,
            userId,
            status: 'pending'
        });

        if (existingRequest) {
            console.warn(`[InviteController] Join failed: User ${userId} already has a pending request in workspace ${workspaceId}`);
            return res.status(409).json({message: 'You already have a pending request',
                data: {requestId: existingRequest._id}
            });
        }

        const joinRequest = await JoinRequest.create({
            workspaceId,
            userId,
            inviteToken: token,
            message: userMessage || null,
            userEmail: userInfo.email,
            userName: userInfo.username
        });
        console.log(`[InviteController] Join Request created successfully. ID: ${joinRequest._id}`);

        try {
            const admin = workspace.members.find(m => m.role === 'ADMIN');
            if (admin) {
                await addJob(
                    queueForEvent(EVENTS.NOTIFY_USER),
                    EVENTS.NOTIFY_USER,
                    {
                        userId: admin.userId.toString(),       
                        actorId: userId,
                        type: 'JOIN_REQUEST',
                        title: 'Request to join workspace',
                        message:   `${userInfo.username || userInfo.email} wants to join workspace "${workspace.name}"`,
                        actionUrl: `/workspaces/${workspaceId}/requests`,
                        metadata:  { requestId: joinRequest._id, workspaceId, userId },
                    },
                    {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${userId}`)}
                );
                console.log(`[InviteController] Enqueued NOTIFY_USER job to Admin ${admin.userId}`);
            }
        } catch(jobErr) {
            console.error('[Queue Error] JOIN_REQUEST notification:', jobErr.message);
        }

        return res.status(201).json({
            message: 'Join request sent. Waiting for Admin approval',
            data: {status: 'pending', requestId: joinRequest._id}
        });
    } catch(err) {
        console.error(`[InviteController] System error in joinWorkspace:`, err.message);
        if (err.code === 11000) {
            return res.status(409).json({ message: 'You already have a pending request' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ---------GET /api/workspaces/:id/requests ------------------------
async function getJoinRequests(req, res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const { status = 'pending' } = req.query;

        console.log(`[InviteController] Admin ${adminId} fetching '${status}' requests for workspace ${workspaceId}`);

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Fetch requests failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            console.warn(`[InviteController] Fetch requests denied: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: 'Only Admin can view requests' });
        }

        const requests = await JoinRequest.find({ workspaceId, status }).sort({ created: -1 });
        console.log(`[InviteController] Successfully fetched ${requests.length} requests`);
        
        return res.json({data: requests});
    } catch (err) {
        console.error(`[InviteController] System error in getJoinRequests:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ---------PATCH /api/workspaces/:id/requests/:requestId ------------------------
async function reviewJoinRequest(req, res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const requestId = req.params.requestId;
        const { action } = req.body;

        console.log(`[InviteController] Admin ${adminId} reviewing request ${requestId} with action: ${action}`);

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'action must be approve or reject' });
        }
        
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Review failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            console.warn(`[InviteController] Review denied: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: 'Only Admin can review requests' });
        }

        const request = await JoinRequest.findOne({
            _id: requestId,
            workspaceId,
            status: 'pending',
        });
        if (!request) {
            console.warn(`[InviteController] Review failed: Request ${requestId} not found or already reviewed`);
            return res.status(404).json({ message: 'Request not found or already reviewed' });
        }

        request.status = action === 'approve' ? 'approved' : 'rejected';
        request.reviewedBy = adminId;
        request.reviewedAt = new Date();
        await request.save();

        if (action === 'approve') {
            const alreadyMember = workspace.members.some((m) => m.userId.toString() === request.userId.toString());
            if (!alreadyMember) {
                workspace.members.push({
                    userId: request.userId.toString(),
                    role: 'MEMBER',
                    permissions: 'viewer'
                });
                await workspace.save();
                console.log(`[InviteController] User ${request.userId} approved and added to workspace ${workspaceId}`);
            }

            try {
                await addJob(
                    queueForEvent(EVENTS.MEMBER_ADDED),
                    EVENTS.MEMBER_ADDED,
                    {
                        workspaceId,
                        targetUserId: request.userId.toString(),
                        workspaceName: workspace.name,
                        actorId: adminId,
                    },
                    { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${request.userId}`) }
                );
                console.log(`[InviteController] Enqueued MEMBER_ADDED job for approved user ${request.userId}`);
            } catch (jobErr) {
                console.error('[Queue Error] MEMBER_ADDED:', jobErr.message);
            }
            
        } else {
            console.log(`[InviteController] Request ${requestId} rejected. Preparing notification for user ${request.userId}`);
            try {
                await addJob(
                    queueForEvent(EVENTS.NOTIFY_USER),
                    EVENTS.NOTIFY_USER,
                    {
                        userId: request.userId.toString(),
                        actorId: adminId,
                        type: 'JOIN_REJECTED',
                        title: 'Your request has been denied',
                        message: `Your request to join workspace "${workspace.name}" has been denied by the administrator.`,
                        actionUrl: null,
                        metadata: { workspaceId, requestId },
                    },
                    { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.NOTIFY_USER, `reject_${requestId}_${Date.now()}`) }
                );
                console.log(`[InviteController] Enqueued NOTIFY_USER job for rejected request ${requestId}`);
            } catch (jobErr) {
                console.error('[Queue Error] NOTIFY_USER (Join Rejected):', jobErr.message);
            }
        }

        return res.json({
            message: `Request ${action}d successfully`,
            data: { status: request.status },
        });
    } catch (err) {
        console.error(`[InviteController] System error in reviewJoinRequest:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ---------PATCH /api/workspaces/:id/requests/approved-all ------------------------
async function approveAllRequests(req, res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;

        console.log(`[InviteController] Admin ${adminId} requesting to approve ALL pending requests in workspace ${workspaceId}`);

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Approve All failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            console.warn(`[InviteController] Approve All denied: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: 'Only Admin can approve requests' });
        }

        const pendingRequests = await JoinRequest.find({
            workspaceId,
            status: 'pending',
        });

        if (!pendingRequests.length) {
            console.log(`[InviteController] No pending requests found to approve for workspace ${workspaceId}`);
            return res.json({ message: 'No pending requests', data: { approved: 0 } });
        }

        let approved = 0;
        for (const request of pendingRequests) {
            const alreadyMember = workspace.members.some(
                (m) => m.userId.toString() === request.userId.toString()
            );

            if (!alreadyMember) {
                workspace.members.push({
                    userId: request.userId,
                    role: 'MEMBER',
                    permissions: 'viewer',
                });
                approved++;
            }

            request.status = 'approved';
            request.reviewedBy = adminId;
            request.reviewedAt = new Date();
            await request.save();

            try {
                await addJob(
                    queueForEvent(EVENTS.MEMBER_ADDED),
                    EVENTS.MEMBER_ADDED,
                    {
                        workspaceId,
                        targetUserId: request.userId.toString(),
                        workspaceName: workspace.name,
                        actorId: adminId,
                    },
                    { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${request.userId}`) }
                );
            } catch (jobErr) {
                console.error(`[Queue Error] MEMBER_ADDED bulk (User ${request.userId}):`, jobErr.message);
            }
        }

        await workspace.save();
        console.log(`[InviteController] Successfully approved ${approved} requests in workspace ${workspaceId}`);

        return res.json({
            message: `Approved ${approved} requests`,
            data: { approved, total: pendingRequests.length },
        });
    } catch (err) {
        console.error(`[InviteController] System error in approveAllRequests:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ---------DELETE /api/workspaces/:id/invite/:token ------------------------
async function revokeInviteLink(req, res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const { token } = req.params;

        console.log(`[InviteController] Admin ${adminId} requesting to revoke token ${token}`);

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Revoke failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            console.warn(`[InviteController] Revoke denied: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: 'Only Admin can revoke invite links' });
        }

        const invite = await WorkspaceInvite.findOneAndUpdate(
            { token, workspaceId },
            { $set: { isRevoked: true } },
            { new: true }
        );
        
        if (!invite) {
            console.warn(`[InviteController] Revoke failed: Token ${token} not found in DB`);
            return res.status(404).json({ message: 'Invite link not found' });
        }

        console.log(`[InviteController] Successfully revoked invite link ${token}`);
        return res.json({ message: 'Invite link revoked' });
    } catch (err) {
        console.error(`[InviteController] System error in revokeInviteLink:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

// ----- GET /api/workspaces/:id/invites ------------------------
async function getInviteLinks(req, res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;

        console.log(`[InviteController] Admin ${adminId} fetching invite links for workspace ${workspaceId}`);

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            console.warn(`[InviteController] Fetch invites failed: Workspace ${workspaceId} not found`);
            return res.status(404).json({ message: 'Workspace not found' });
        }

        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            console.warn(`[InviteController] Fetch invites denied: User ${adminId} is not ADMIN`);
            return res.status(403).json({ message: 'Only Admin can view invite links' });
        }

        const invites = await WorkspaceInvite.find({ workspaceId }).sort({ createdAt: -1 });
        console.log(`[InviteController] Successfully fetched ${invites.length} invite links`);
        
        return res.json({ data: invites });
    } catch (err) {
        console.error(`[InviteController] System error in getInviteLinks:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//----- GET /api/workspaces/:id/requests/my ------------------------
async function getMyJoinRequest(req, res) {
    try {
        const userId = req.user.userId;
        const workspaceId = req.params.id;

        console.log(`[InviteController] User ${userId} checking their join request status in workspace ${workspaceId}`);

        const request = await JoinRequest.findOne({ workspaceId, userId }).sort({ createdAt: -1 });
        if (!request) {
            console.log(`[InviteController] No join request found for user ${userId} in workspace ${workspaceId}`);
            return res.status(404).json({ message: 'No request found' });
        }

        console.log(`[InviteController] Found request ${request._id} for user ${userId}`);
        return res.json({ data: request });
    } catch (err) {
        console.error(`[InviteController] System error in getMyJoinRequest:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

module.exports = {
    createInviteLink,
    getInviteInfo,
    joinWorkspace,
    getJoinRequests,
    reviewJoinRequest,
    approveAllRequests,
    revokeInviteLink,
    getInviteLinks,
    getMyJoinRequest
}