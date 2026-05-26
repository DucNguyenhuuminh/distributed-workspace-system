const axios = require('axios');
const Workspace = require('../models/workspace.model');
const WorkspaceInvite = require('../models/workspace-invite.model');
const JoinRequest = require('../models/join-request.model');
const {addJob} = require('../../../../shared/queue/queueProducer');
const {queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('../../../../shared/queue/queue.config');

// ---------POST /api/workspaces/:id/invite ------------------------
async function createInviteLink(req,res) {
    try {
        const userId = req.user.userId;
        const workspaceId = req.params.id;
        const {expiresInHours=null, autoApprove=false}=req.body;

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const member = workspace.members.find((m) => m.userId.toString() === userId);
        if (!member) {
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
        return res.status(500).json({ message: err.message });
    }
}

// ---------GET /api/workspaces/invite/:token ------------------------
async function getInviteInfo(req,res) {
    try {
        const {token} = req.params;

        const invite = await WorkspaceInvite.findOne({token});
        if (!invite) {
            return res.status(404).json({ message: 'Invite link not found' });
        }
        if (invite.isRevoked) {
            return res.status(403).json({ message: 'Invite link has been revoked' });
        }
        if (invite.expiredAt && new Date() > invite.expiredAt) {
            return res.status(403).json({ message: 'Invite link has expired' });
        }
        const workspace = await Workspace.findById(invite.workspaceId).select('name members');

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
        return res.status(500).json({ message: err.message });
    }
}

// ---------POST /api/workspaces/invite/:token/join ------------------------
async function joinWorkspace(req,res) {
    try {
        const userId = req.user.userId;
        const {token} = req.params;
        const {message: userMessage} = req.body;

        const invite = await WorkspaceInvite.findOne({token});
        if (!invite) {
            return res.status(404).json({ message: 'Invite link not found' });
        }
        if (invite.isRevoked) {
            return res.status(403).json({ message: 'Invite link has been revoked' });
        }
        if (invite.expiredAt && new Date() > invite.expiredAt) {
            return res.status(403).json({ message: 'Invite link has expired' });
        }

        const workspaceId = invite.workspaceId.toString();
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        const alreadyMember = workspace.members.some((m) => m.userId.toString() === userId);
        if (alreadyMember) {
            return res.status(409).json({ message: 'You are already a member' });
        }

        let userInfo =  {email: '', username: ''};
        try {
            const response = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-email`, {params: {email: ''}});
            userInfo = response.data.data;
        } catch(err) {
            console.error('[InviteController] Cannot fetch user info:', err.message);
        }

        // Auto Approve = true
        if (invite.autoApprove) {
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
            } catch(jobErr) {
                console.error('[Queue Error] MEMBER_ADDED:', jobErr.message);
            }

            return res.json({
                message: 'You have been added to the workspace',
                data:    { status: 'approved', workspaceId, workspaceName: workspace.name },
            });
        }

        // Auto Approve = false
        const existingRequest = await JoinRequest.findOne({
            workspaceId,
            userId,
            status: 'pending'
        });

        if (existingRequest) {
            return res.status(409).json({
                message: 'You already have a pending request',
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
        } catch(jobErr) {
            console.error('[Queue Error] MEMBER_ADDED:', jobErr.message);
        }

        return res.status(201).json({
            message: 'Join request sent. Waiting for Admin approval',
            data: {status: 'pending', requestId: joinRequest._id}
        });
    } catch(err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'You already have a pending request' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ---------GET /api/workspaces/:id/requests ------------------------
async function getJoinRequests(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const {status = 'pending'} = req.query;

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Only Admin can view requests' });
        }

        const requests = await JoinRequest.find({workspaceId, status}).sort({created: -1});
        return res.json({data: requests});
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

// ---------PATCH /api/workspaces/:id/requests/:requestId ------------------------
async function reviewJoinRequest(req,res) {
    try {
        const adminId = req.user.userId;
        const workspaceId = req.params.id;
        const requestId = req.params.requestId;
        const {action} = req.body;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'action must be approve or reject' });
        }
        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }
        const member = workspace.members.find((m) => m.userId.toString() === adminId);
        if (!member || member.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Only Admin can review requests' });
        }

        const request = await JoinRequest.findOne({
            _id: requestId,
            workspaceId,
            status: 'pending',
        });
        if (!request) {
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
            }

            try {
                await addJob(
                queueForEvent(EVENTS.MEMBER_ADDED),
                EVENTS.MEMBER_ADDED,
                {
                    workspaceId,
                    targetUserId:  request.userId.toString(),
                    workspaceName: workspace.name,
                    actorId:       adminId,
                },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${request.userId}`) }
                );
            } catch (jobErr) {
                console.error('[Queue Error] MEMBER_ADDED:', jobErr.message);
            }
        }else {
            try {
                await addJob(
                queueForEvent(EVENTS.NOTIFY_USER),
                EVENTS.NOTIFY_USER,
                {
                    userId:    request.userId.toString(),
                    type:      'GENERAL',
                    title:     'You request have been denied',
                    message:   `Your request joining workspace "${workspace.name}" has been denied`,
                    actionUrl: null,
                    metadata:  { workspaceId },
                },
                { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.NOTIFY_USER, `reject_${requestId}`) }
                );
            } catch (jobErr) {
                console.error('[Queue Error] NOTIFY_USER:', jobErr.message);
            }
        }

        return res.json({
            message: `Request ${action}d successfully`,
            data: {status: request.status},
        });
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

// ---------PATCH /api/workspaces/:id/requests/approved-all ------------------------
async function approveAllRequests(req, res) {
  try {
    const adminId     = req.user.userId;
    const workspaceId = req.params.id;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
        return res.status(404).json({ message: 'Workspace not found' });
    }
    const member = workspace.members.find((m) => m.userId.toString() === adminId);
    if (!member || member.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only Admin can approve requests' });
    }

    const pendingRequests = await JoinRequest.find({
      workspaceId,
      status: 'pending',
    });

    if (!pendingRequests.length) {
      return res.json({ message: 'No pending requests', data: { approved: 0 } });
    }

    let approved = 0;

    for (const request of pendingRequests) {
      const alreadyMember = workspace.members.some(
        (m) => m.userId.toString() === request.userId.toString()
      );

      if (!alreadyMember) {
        workspace.members.push({
          userId:      request.userId,
          role:        'MEMBER',
          permissions: 'viewer',
        });
        approved++;
      }

      request.status     = 'approved';
      request.reviewedBy = adminId;
      request.reviewedAt = new Date();
      await request.save();

      try {
        await addJob(
          queueForEvent(EVENTS.MEMBER_ADDED),
          EVENTS.MEMBER_ADDED,
          {
            workspaceId,
            targetUserId:  request.userId.toString(),
            workspaceName: workspace.name,
            actorId:       adminId,
          },
          { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.MEMBER_ADDED, `${workspaceId}_${request.userId}`) }
        );
      } catch (jobErr) {
        console.error('[Queue Error] MEMBER_ADDED bulk:', jobErr.message);
      }
    }

    await workspace.save();

    return res.json({
      message: `Approved ${approved} requests`,
      data:    { approved, total: pendingRequests.length },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

// ---------DELETE /api/workspaces/:id/invite/:token ------------------------
async function revokeInviteLink(req, res) {
  try {
    const adminId     = req.user.userId;
    const workspaceId = req.params.id;
    const { token }   = req.params;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
        return res.status(404).json({ message: 'Workspace not found' });
    }
    const member = workspace.members.find((m) => m.userId.toString() === adminId);
    if (!member || member.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only Admin can revoke invite links' });
    }

    const invite = await WorkspaceInvite.findOneAndUpdate(
        { token, workspaceId },
        {$set: {isRevoked: true}},
        {new: true}
    );
    if (!invite) return res.status(404).json({ message: 'Invite link not found' });

    invite.isRevoked = true;

    return res.json({ message: 'Invite link revoked' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

// ----- GET /api/workspaces/:id/invites ------------------------
async function getInviteLinks(req, res) {
  try {
    const adminId     = req.user.userId;
    const workspaceId = req.params.id;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

    const member = workspace.members.find(
      (m) => m.userId.toString() === adminId
    );
    if (!member || member.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Only Admin can view invite links' });
    }

    const invites = await WorkspaceInvite.find({ workspaceId })
      .sort({ createdAt: -1 });

    return res.json({ data: invites });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

//----- GET /api/workspaces/:id/requests/my ------------------------
async function getMyJoinRequest(req, res) {
  try {
    const userId      = req.user.userId;
    const workspaceId = req.params.id;

    const request = await JoinRequest.findOne({ workspaceId, userId })
      .sort({ createdAt: -1 });

    if (!request) {
      return res.status(404).json({ message: 'No request found' });
    }

    return res.json({ data: request });
  } catch (err) {
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