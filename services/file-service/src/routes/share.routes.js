const router = require('express').Router();
const {
  createShareLink,
  getSharedFile,
  verifySharePassword,
  accessSharedFile,
  saveShareFile,
  revokeShareLink,
  getShareLinks,
} = require('../controllers/share.controller');
const {
  createShareLinkValidator,
  accessShareLinkValidator,
  verifyPasswordValidator,
} = require('../validators/share.validator');
const {authMiddleware} = require('../../../../shared/middlewares/auth.middleware')
const {validateRequest} = require('../../../../shared/middlewares/validate.middleware');

router.use(authMiddleware);
router.get('/share/:token',         getSharedFile);
router.post('/share/:token/verify', verifyPasswordValidator, validateRequest, verifySharePassword);
router.post('/share/:token/access',  accessShareLinkValidator, validateRequest, accessSharedFile);
router.post('/share/:token/save',   saveShareFile);
router.post('/:id/share',           createShareLinkValidator, validateRequest, createShareLink);
router.get('/:id/share',            getShareLinks);
router.delete('/:id/share/:token',  revokeShareLink);

module.exports = router;