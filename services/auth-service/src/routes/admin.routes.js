const router = require('express').Router();
const {getAllUsers,
    getFileByIdAdmin,
    getUserById,
    getFiles,
    getWorkspaceByIdAdmin,
    getWorkspaces,
    getSystemStats,
    banUser
} = require('../controllers/admin.controller');
const {authMiddleware, requireRole} = require('shared/middlewares/auth.middleware');

router.use(authMiddleware);
router.use(requireRole);

router.get('/users',                getAllUsers);
router.get('/workspaces',           getWorkspaces);
router.get('/files',                getFiles);
router.get('/stats',                getSystemStats);
router.get('/users/:id',            getUserById);
router.get('/workspaces/:id',       getWorkspaceByIdAdmin);
router.get('/files/:id',            getFileByIdAdmin);
router.patch('/users/:id/ban',      banUser);

module.exports = router;