const router = require('express').Router();
const {
    createWorkspace,getWorkspaces,getWorkspaceById,
    addMember,removeMember,deleteWorkspace, setUserPermission} = require('../controllers/workspace.controller');
const {create_workspace_valid, add_member_valid, validate} = require('../validators/workspace.validator');
const {authMiddleware} = require('../../../../shared/middlewares/auth.middleware');

router.use(authMiddleware);

router.post('/',                                    validate(create_workspace_valid), createWorkspace);
router.get('/',                                     getWorkspaces);
router.get('/:id',                                  getWorkspaceById);
router.post('/:id/members',                         validate(add_member_valid), addMember);
router.delete('/:id/members/:targetUserId',         removeMember);
router.delete('/:id',                               deleteWorkspace);
router.patch('/:id/members/:targetUserId/permission', setUserPermission);

module.exports = router;