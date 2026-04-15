const router = require('express').Router();
const{initMultipartUpload,completeMultipartUpload,getDownloadURL,deleteDupFile} = require('../controllers/storage.controller');
const{init_multipart_valid,complete_multipart_valid,get_downloadURL_valid, delete_file_valid,validateRequest} = require('../validators/storage.validator');

router.post('/multipart/init',      init_multipart_valid, validateRequest, initMultipartUpload);
router.post('/multipart/complete',  complete_multipart_valid, validateRequest, completeMultipartUpload);
router.get('/file/url',             get_downloadURL_valid, validateRequest, getDownloadURL);
router.delete('/file',              delete_file_valid, validateRequest, deleteDupFile);

module.exports = router;