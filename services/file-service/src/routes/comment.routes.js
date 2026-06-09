const router = require('express').Router();
const {getComments, addComment, deleteComment, createComment, updateComment} = require('../controllers/comment.controller');
const {authMiddleware} = require('shared/middlewares/auth.middleware');

router.use(authMiddleware);
router.post('/:id/comments',                 createComment);
router.get('/:id/comments',                 getComments);
router.put('/:id/comments/:commentId',      updateComment);
router.delete('/:id/comments/:commentId',   deleteComment);

module.exports = router;