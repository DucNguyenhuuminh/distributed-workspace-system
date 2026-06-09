const router = require('express').Router();
const {
  getPosts, createPost, updatePost, deletePost,
//   toggleLike,
  getPostComments, createPostComment, deletePostComment,
} = require('../controllers/post.controller');
const { authMiddleware } = require('shared');

router.use(authMiddleware);

router.get('/:id/posts',                                getPosts);
router.post('/:id/posts',                               createPost);
router.put('/:id/posts/:postId',                        updatePost);
router.delete('/:id/posts/:postId',                     deletePost);
// router.post('/:id/posts/:postId/like',               toggleLike);
router.get('/:id/posts/:postId/comments',               getPostComments);
router.post('/:id/posts/:postId/comments',              createPostComment);
router.delete('/:id/posts/:postId/comments/:commentId', deletePostComment);

module.exports = router;