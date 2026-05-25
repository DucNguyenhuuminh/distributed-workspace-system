const router = require('express').Router();
const {
  createInviteLink,
  getInviteInfo,
  joinWorkspace,
  getJoinRequests,
  reviewJoinRequest,
  approveAllRequests,
  revokeInviteLink,
  getInviteLinks,
  getMyJoinRequest,
} = require('../controllers/invite-workspace.controller');
const { authMiddleware } = require('shared');

router.get('/invite/:token', getInviteInfo);

router.use(authMiddleware);
router.post('/invite/:token/join',          joinWorkspace);
router.get('/:id/requests/my',              getMyJoinRequest);
router.post('/:id/invite',                  createInviteLink);
router.get('/:id/invites',                  getInviteLinks);
router.delete('/:id/invite/:token',         revokeInviteLink);
router.get('/:id/requests',                 getJoinRequests);
router.patch('/:id/requests/approve-all',   approveAllRequests);
router.patch('/:id/requests/:requestId',    reviewJoinRequest);

module.exports = router;