const router = require('express').Router();
const{initMultipartUpload,completeMultipartUpload} = require('../controllers/storage.controller');

router.post('/multipart/init', initMultipartUpload);
router.post('/multipart/complete', completeMultipartUpload);

module.exports = router;