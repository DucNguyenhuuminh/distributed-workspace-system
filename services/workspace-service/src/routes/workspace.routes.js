const router = require('express').Router();
const {
    createWorkspace,getWorkspaces,getWorkspaceById,
    addMember,removeMember,deleteWorkspace,} = require('../controllers/workspace.controller');
const {create_workspace_valid, add_member_valid, validate} = require('../validators/workspace.validator');
const {checkWorkspaceExists, requireAdminRole, requireMemberRole} = require('../middlewares/workspace.middleware');
const {authMiddleware} = require('shared');

router.use(authMiddleware);
router.post('/', validate(create_workspace_valid), createWorkspace);
router.get('/', getWorkspaces);
router.get('/:id', checkWorkspaceExists,requireMemberRole,getWorkspaceById);
router.post('/:id/members', validate(add_member_valid), checkWorkspaceExists, requireAdminRole,addMember);
router.delete('/:id/members/:targetUserId', checkWorkspaceExists, requireAdminRole,removeMember);
router.delete('/:id',checkWorkspaceExists, requireAdminRole,deleteWorkspace);

module.exports = router;