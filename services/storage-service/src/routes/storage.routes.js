const router = require('express').Router();
const{initMultipartUpload,completeMultipartUpload,getDownloadURL,deleteDupFile} = require('../controllers/storage.controller');

router.post('/multipart/init',      initMultipartUpload);
router.post('/multipart/complete',  completeMultipartUpload);
router.get('/file/url',             getDownloadURL);
router.delete('/file',              deleteDupFile);

module.exports = router;