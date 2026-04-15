const router = require('express').Router();
const {checkHash, initUpload, mergeUpload} = require('../controllers/file.worker.controller');

router.post('/hash', checkHash);
router.post('/init', initUpload);
router.post('/merge', mergeUpload);

module.exports = router;