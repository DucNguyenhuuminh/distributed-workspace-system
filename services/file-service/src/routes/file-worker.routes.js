const router = require('express').Router();
const {checkHash, initUpload, mergeUpload} = require('../controllers/file-worker.controller');
const {
    checkHashValidator,
    initUploadValidator,
    mergeUploadValidator
} = require('../validators/file-worker.validator');
const {verifyToken} = require('shared/middlewares/auth.middleware')
const {validateRequest} = require('shared/middlewares/validate.middleware');

router.use(verifyToken);

router.post('/hash', checkHashValidator, validateRequest, checkHash);
router.post('/init', initUploadValidator, validateRequest, initUpload);
router.post('/merge', mergeUploadValidator, validateRequest, mergeUpload);

module.exports = router;