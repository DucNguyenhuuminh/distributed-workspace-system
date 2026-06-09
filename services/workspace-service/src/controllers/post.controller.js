const axios       = require('axios');
const Post        = require('../models/post.model');
const PostComment = require('../models/post-comment.model');
const Workspace   = require('../models/workspace.model');

async function checkMembership(workspaceId, userId) {
  console.log(`[PostController] Checking membership for user ${userId} in workspace ${workspaceId}`);
  const workspace = await Workspace.findById(workspaceId);
  
  if (!workspace) {
    console.warn(`[PostController] Workspace ${workspaceId} not found during membership check`);
    return { workspace: null, member: null };
  }
  
  const member = workspace.members.find((m) => m.userId.toString() === userId);
  
  if (!member) {
    console.warn(`[PostController] User ${userId} is not a member of workspace ${workspaceId}`);
  } else {
    console.log(`[PostController] Membership verified for user ${userId}`);
  }
  
  return { workspace, member };
}

// ── GET /api/workspaces/:id/posts ────────────────────────
async function getPosts(req, res) {
  try {
    const userId      = req.user.userId;
    const workspaceId = req.params.id;
    const { page = 1, limit = 20 } = req.query;
    console.log(`[PostController] User ${userId} is fetching posts for workspace ${workspaceId} (Page: ${page}, Limit: ${limit})`);

    const { member } = await checkMembership(workspaceId, userId);
    if (!member) {
      console.warn(`[PostController] Fetch posts denied: User ${userId} is not a workspace member`);
      return res.status(403).json({ message: 'Not a workspace member' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Post.countDocuments({ workspaceId });
    const posts = await Post.find({ workspaceId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log(`[PostController] Found posts. Aggregating comment counts.`);

    const postIds = posts.map((p) => p._id);
    const commentCounts = await PostComment.aggregate([
      { $match: { postId: { $in: postIds }, deletedAt: null } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    commentCounts.forEach((c) => {
      countMap[c._id.toString()] = c.count;
    });

    const result = posts.map((p) => ({
      _id:          p._id,
      content:      p.content,
      createdBy:    p.createdBy,
      commentCount: countMap[p._id.toString()] || 0,
      createdAt:    p.createdAt,
      updatedAt:    p.updatedAt,
    }));

    console.log(`[PostController] Successfully fetched posts for workspace ${workspaceId}`);
    return res.json({
      data: {
        posts: result,
        pagination: {
          page:       parseInt(page),
          limit:      parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error(`[PostController] System error in getPosts:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── POST /api/workspaces/:id/posts ───────────────────────
async function createPost(req, res) {
  try {
    const userId      = req.user.userId;
    const workspaceId = req.params.id;
    const { content } = req.body;

    console.log(`[PostController] User ${userId} attempting to create a post in workspace ${workspaceId}`);

    if (!content || content.trim().length === 0) {
      console.warn(`[PostController] Create post failed: Content is missing or empty`);
      return res.status(400).json({ message: 'Content is required' });
    }

    const { member } = await checkMembership(workspaceId, userId);
    if (!member) {
      console.warn(`[PostController] Create post denied: User ${userId} is not a workspace member`);
      return res.status(403).json({ message: 'Not a workspace member' });
    }

    const post = await Post.create({
      workspaceId,
      content: content.trim(),
      createdBy: userId,
    });

    console.log(`[PostController] Successfully created post ${post._id} in workspace ${workspaceId}`);
    return res.status(201).json({ message: 'Post created', data: post });
  } catch (err) {
    console.error(`[PostController] System error in createPost:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── PUT /api/workspaces/:id/posts/:postId ────────────────
async function updatePost(req, res) {
  try {
    const userId  = req.user.userId;
    const { id: workspaceId, postId } = req.params;
    const { content } = req.body;

    console.log(`[PostController] User ${userId} attempting to update post ${postId} in workspace ${workspaceId}`);

    if (!content || content.trim().length === 0) {
      console.warn(`[PostController] Update post failed: Content is missing or empty`);
      return res.status(400).json({ message: 'Content is required' });
    }

    const post = await Post.findOne({ _id: postId, workspaceId });
    if (!post) {
      console.warn(`[PostController] Update post failed: Post ${postId} not found`);
      return res.status(404).json({ message: 'Post not found' });
    }

    if (post.createdBy.toString() !== userId) {
      console.warn(`[PostController] Update post denied: User ${userId} is not the owner of post ${postId}`);
      return res.status(403).json({ message: 'Only post owner can edit' });
    }

    post.content = content.trim();
    await post.save();

    console.log(`[PostController] Successfully updated post ${postId}`);
    return res.json({ message: 'Post updated', data: post });
  } catch (err) {
    console.error(`[PostController] System error in updatePost:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── DELETE /api/workspaces/:id/posts/:postId ─────────────
async function deletePost(req, res) {
  try {
    const userId  = req.user.userId;
    const { id: workspaceId, postId } = req.params;

    console.log(`[PostController] User ${userId} attempting to delete post ${postId} in workspace ${workspaceId}`);

    const post = await Post.findOne({ _id: postId, workspaceId });
    if (!post) {
      console.warn(`[PostController] Delete post failed: Post ${postId} not found`);
      return res.status(404).json({ message: 'Post not found' });
    }

    const { member } = await checkMembership(workspaceId, userId);

    const isOwner = post.createdBy.toString() === userId;
    const isAdmin = member?.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      console.warn(`[PostController] Delete post denied: User ${userId} is neither the owner nor an Admin`);
      return res.status(403).json({ message: 'No permission to delete this post' });
    }

    post.deletedAt = new Date();
    await post.save();

    const commentUpdateResult = await PostComment.updateMany(
      { postId },
      { deletedAt: new Date() }
    );

    console.log(`[PostController] Successfully soft-deleted post ${postId} and ${commentUpdateResult.modifiedCount} associated comments`);
    return res.json({ message: 'Post deleted' });
  } catch (err) {
    console.error(`[PostController] System error in deletePost:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── POST /api/workspaces/:id/posts/:postId/like ──────────
//async function toggleLike(req, res) {
//   try {
//     const userId  = req.user.userId;
//     const { id: workspaceId, postId } = req.params;

//     const { member } = await checkMembership(workspaceId, userId);
//     if (!member) {
//       return res.status(403).json({ message: 'Not a workspace member' });
//     }

//     const post = await Post.findOne({ _id: postId, workspaceId });
//     if (!post) return res.status(404).json({ message: 'Post not found' });

//     const likedIndex = post.likes
//       .map((l) => l.toString())
//       .indexOf(userId);

//     let action;
//     if (likedIndex === -1) {
//       post.likes.push(userId); // Like
//       action = 'liked';
//     } else {
//       post.likes.splice(likedIndex, 1); // Unlike
//       action = 'unliked';
//     }

//     await post.save();

//     return res.json({
//       message:   `Post ${action}`,
//       data: {
//         likeCount: post.likes.length,
//         isLiked:   action === 'liked',
//       },
//     });
//   } catch (err) {
//     return res.status(500).json({ message: err.message });
//   }
// }

// ── GET /api/workspaces/:id/posts/:postId/comments ───────
async function getPostComments(req, res) {
  try {
    const userId  = req.user.userId;
    const { id: workspaceId, postId } = req.params;

    console.log(`[PostController] User ${userId} fetching comments for post ${postId}`);

    const { member } = await checkMembership(workspaceId, userId);
    if (!member) {
      console.warn(`[PostController] Fetch comments denied: User ${userId} is not a workspace member`);
      return res.status(403).json({ message: 'Not a workspace member' });
    }

    const comments = await PostComment.find({ postId }).sort({ createdAt: 1 });
    console.log(`[PostController] Found ${comments.length} raw comments for post ${postId}. Structuring tree.`);

    const userIds = [...new Set(comments.map((c) => c.createdBy.toString()))];
    const userMap = {};

    if (userIds.length > 0) {
        console.log(`[PostController] Fetching user details for ${userIds.length} unique authors`);
        try {
            for (const uid of userIds) {
                const userRes = await axios.get(`${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-id`, { params: { id: uid } });
                const u = userRes.data.data;
                userMap[uid] = { _id: u._id, username: u.username, email: u.email };
            }
        } catch (err) {
            console.error(`[PostController] Failed to fetch user info from Auth Service: ${err.message}`);
        }
    }

    const roots    = [];
    const replyMap = {};

    comments.forEach((c) => {
      replyMap[c._id.toString()] = {
          _id: c._id,
          content: c.content,
          createdBy: userMap[c.createdBy.toString()] || { _id: c.createdBy },
          parentId: c.parentId,
          createdAt: c.createdAt,
          replies: [],
      };
    });

    comments.forEach((c) => {
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

    console.log(`[PostController] Successfully structured ${roots.length} root comments for post ${postId}`);
    return res.json({ data: { total: roots.length, comments: roots } });
  } catch (err) {
    console.error(`[PostController] System error in getPostComments:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── POST /api/workspaces/:id/posts/:postId/comments ──────
async function createPostComment(req, res) {
  try {
    const userId   = req.user.userId;
    const { id: workspaceId, postId } = req.params;
    const { content, parentId } = req.body;

    console.log(`[PostController] User ${userId} attempting to create a comment on post ${postId}`);

    if (!content || content.trim().length === 0) {
      console.warn(`[PostController] Create comment failed: Content is missing or empty`);
      return res.status(400).json({ message: 'Content is required' });
    }
    const { member } = await checkMembership(workspaceId, userId);
    if (!member) {
      console.warn(`[PostController] Create comment denied: User ${userId} is not a workspace member`);
      return res.status(403).json({ message: 'Not a workspace member' });
    }
    const post = await Post.findOne({ _id: postId, workspaceId });
    if (!post) {
      console.warn(`[PostController] Create comment failed: Post ${postId} not found`);
      return res.status(404).json({ message: 'Post not found' });
    }

    if (parentId) {
      console.log(`[PostController] Validating parent comment ${parentId}`);
      const parent = await PostComment.findOne({ _id: parentId, postId });
      if (!parent) {
        console.warn(`[PostController] Create comment failed: Parent comment ${parentId} not found`);
        return res.status(404).json({ message: 'Parent comment not found' });
      }
    }

    const comment = await PostComment.create({
      postId,
      content:   content.trim(),
      createdBy: userId,
      parentId:  parentId || null,
    });

    console.log(`[PostController] Successfully created comment ${comment._id} on post ${postId}`);
    return res.status(201).json({ message: 'Comment created', data: comment });
  } catch (err) {
    console.error(`[PostController] System error in createPostComment:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── DELETE /api/workspaces/:id/posts/:postId/comments/:commentId
async function deletePostComment(req, res) {
  try {
    const userId  = req.user.userId;
    const { postId, commentId } = req.params;

    console.log(`[PostController] User ${userId} attempting to delete comment ${commentId} from post ${postId}`);

    const comment = await PostComment.findOne({ _id: commentId, postId });
    if (!comment) {
      console.warn(`[PostController] Delete comment failed: Comment ${commentId} not found`);
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.createdBy.toString() !== userId) {
      console.warn(`[PostController] Delete comment denied: User ${userId} is not the owner of comment ${commentId}`);
      return res.status(403).json({ message: 'Only comment owner can delete' });
    }

    comment.deletedAt = new Date();
    await comment.save();

    const childUpdateResult = await PostComment.updateMany(
      { parentId: commentId },
      { deletedAt: new Date() }
    );

    console.log(`[PostController] Successfully soft-deleted comment ${commentId} and ${childUpdateResult.modifiedCount} child replies`);
    return res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(`[PostController] System error in deletePostComment:`, err.message);
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getPosts, 
  createPost, 
  updatePost, 
  deletePost,
  // toggleLike,
  getPostComments, 
  createPostComment, 
  deletePostComment,
};