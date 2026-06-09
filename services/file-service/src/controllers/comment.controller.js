const axios = require('axios');
const Comment = require('../models/comment.model');
const Document = require('../models/documents.model');

async function checkFileAccess(userId, file, req) {
    console.log(`[CommentController] Checking file access for user ${userId} on file ${file._id}`);
    
    if (!file.workspaceId) {
        const isOwner = file.uploadedBy.toString() === userId;
        console.log(`[CommentController] File is personal. Access granted: ${isOwner}`);
        return isOwner;
    }
    
    try {
        console.log(`[CommentController] File belongs to workspace ${file.workspaceId}. Verifying via Workspace Service.`);
        const wsRes = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal/${file.workspaceId}`,
            { headers: { Authorization: req.headers.authorization } }
        );
        const hasAccess = wsRes.data.data.members.some((m) => m.userId.toString() === userId);
        
        console.log(`[CommentController] Workspace access check result for user ${userId}: ${hasAccess}`);
        return hasAccess;
    } catch (err) {
        console.error(`[CommentController] Error checking workspace access: ${err.message}`);
        return false;
    }
}

//-----------------GET /api/files/:id/comments-----------------
async function getComments(req, res) {
    try {
        const userId = req.user.userId; 
        const fileId = req.params.id;

        console.log(`[CommentController] Fetching comments for file ${fileId} requested by user ${userId}`);

        const file = await Document.findById(fileId);
        if (!file) {
            console.warn(`[CommentController] Fetch failed: File ${fileId} not found`);
            return res.status(404).json({ message: 'File not found' });
        }
        
        const hasAccess = await checkFileAccess(userId, file, req);
        if (!hasAccess) {
            console.warn(`[CommentController] Fetch denied: User ${userId} has no permission to view comments on file ${fileId}`);
            return res.status(403).json({ message: 'No permission to view comments' });
        }

        const allComments = await Comment.find({ fileId }).sort({ createdAt: 1 });
        console.log(`[CommentController] Found ${allComments.length} comments for file ${fileId}`);

        const userIds = [...new Set(allComments.map((c) => c.createdBy.toString()))];
        const userMap = {};
        
        if (userIds.length > 0) {
            console.log(`[CommentController] Fetching user details for ${userIds.length} unique authors from Auth Service`);
            try {
                for (const uid of userIds) {
                    const userRes = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-id`, { params: { id: uid } });
                    const u = userRes.data.data;
                    userMap[uid] = { _id: u._id, username: u.username, email: u.email };
                }
            } catch (err) {
                console.error(`[CommentController] Failed to fetch user info from Auth Service: ${err.message}`);
            }
        }

        console.log(`[CommentController] Building comment tree structure for file ${fileId}`);
        const roots = [];
        const replyMap = {};
        
        allComments.forEach((c) => {
            replyMap[c._id.toString()] = {
                _id: c._id,
                content: c.content,
                createdBy: userMap[c.createdBy.toString()] || { _id: c.createdBy },
                parentId: c.parentId,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
                deletedAt: c.deletedAt,
                replies: [],
            };
        });
        
        allComments.forEach((c) => {
            const mappedComment = replyMap[c._id.toString()];
            if (c.parentId) {
                const parent = replyMap[c.parentId.toString()];
                if (parent) {
                    parent.replies.push(mappedComment);
                }else {
                    roots.push(mappedComment);
                }
            }else {
                roots.push(mappedComment);
            }
        });
        
        console.log(`[CommentController] Successfully retrieved ${roots.length} root comments for file ${fileId}`);
        return res.json({ data: { total: roots.length, comments: roots } });
    } catch (err) {
        console.error(`[CommentController] System error in getComments:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-----------------POST /api/files/:id/comments-----------------
async function createComment(req, res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const { content, parentId } = req.body;

        console.log(`[CommentController] User ${userId} attempting to create a comment on file ${fileId}`);

        if (!content || content.trim().length === 0) {
            console.warn(`[CommentController] Creation failed: Content is missing or empty`);
            return res.status(400).json({ message: 'Content is required' });
        }
        
        const file = await Document.findById(fileId);
        if (!file) {
            console.warn(`[CommentController] Creation failed: File ${fileId} not found`);
            return res.status(404).json({ message: 'File not found' });
        }
        
        const hasAccess = await checkFileAccess(userId, file, req);
        if (!hasAccess) {
            console.warn(`[CommentController] Creation denied: User ${userId} has no permission on file ${fileId}`);
            return res.status(403).json({ message: 'No permission to comment' });
        }

        if (parentId) {
            console.log(`[CommentController] Verifying parent comment ${parentId}`);
            const parent = await Comment.findOne({ _id: parentId, fileId });
            if (!parent) {
                console.warn(`[CommentController] Creation failed: Parent comment ${parentId} not found in file ${fileId}`);
                return res.status(404).json({ message: 'Parent comment not found' });
            }
        }
        
        const comment = await Comment.create({
            fileId,
            content: content.trim(),
            createdBy: userId,
            parentId: parentId || null
        });

        console.log(`[CommentController] Successfully created comment ${comment._id} on file ${fileId}`);
        return res.status(201).json({
            message: 'Comment created successfully',
            data: comment,
        });
    } catch (err) {
        console.error(`[CommentController] System error in createComment:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-----------------PUT /api/files/:id/comments/:commentId-----------------
async function updateComment(req, res) {
    try {
        const userId = req.user.userId;
        const { id: fileId, commentId } = req.params;
        const { content } = req.body;

        console.log(`[CommentController] User ${userId} attempting to update comment ${commentId} on file ${fileId}`);

        if (!content || content.trim().length === 0) {
            console.warn(`[CommentController] Update failed: Content is missing or empty`);
            return res.status(400).json({ message: 'Content is required' });
        }
        
        const comment = await Comment.findOne({ _id: commentId, fileId });
        if (!comment) {
            console.warn(`[CommentController] Update failed: Comment ${commentId} not found`);
            return res.status(404).json({ message: 'Comment not found' });
        }
        
        if (comment.createdBy.toString() !== userId) {
            console.warn(`[CommentController] Update denied: User ${userId} is not the owner of comment ${commentId}`);
            return res.status(403).json({ message: 'No permission to edit this comment' });
        }

        comment.content = content.trim();
        await comment.save();

        console.log(`[CommentController] Successfully updated comment ${commentId}`);
        return res.json({ message: 'Comment updated successfully', data: comment });
    } catch (err) {
        console.error(`[CommentController] System error in updateComment:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-----------------DELETE /api/files/:id/comments/:commentId-----------------
async function deleteComment(req, res) {
    try {
        const userId = req.user.userId;
        const { id: fileId, commentId } = req.params;

        console.log(`[CommentController] User ${userId} attempting to delete comment ${commentId} on file ${fileId}`);

        const comment = await Comment.findOne({ _id: commentId, fileId });
        if (!comment) {
            console.warn(`[CommentController] Deletion failed: Comment ${commentId} not found`);
            return res.status(404).json({ message: 'Comment not found' });
        }
        
        const isAdmin = req.user.role === 'ADMIN'; 
        if (comment.createdBy.toString() !== userId && !isAdmin) { 
            console.warn(`[CommentController] Deletion denied: User ${userId} is neither the owner nor an Admin`);
            return res.status(403).json({ message: 'No permission to delete this comment' });
        }

        comment.deletedAt = new Date();
        await comment.save();
        console.log(`[CommentController] Comment ${commentId} marked as deleted`);

        const childUpdateResult = await Comment.updateMany({ parentId: comment._id }, { deletedAt: new Date() });
        console.log(`[CommentController] Soft deleted ${childUpdateResult.modifiedCount} child comments of parent ${commentId}`);

        return res.json({ message: 'Comment deleted successfully' });
    } catch (err) {
        console.error(`[CommentController] System error in deleteComment:`, err.message);
        return res.status(500).json({ message: err.message });
    } 
}

module.exports = {
    getComments,
    createComment,
    updateComment,
    deleteComment,
};