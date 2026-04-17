const router = require('express').Router();
const {getFiles, getFileById, renameFile, deleteFile, restoreFile,
    getFileLink, moveFile} = require('../controllers/file.controller');
const {verifyToken, validateRequest} = require('shared')
const {
    fileIdParamValidator,
    getFilesValidator,
    renameFileValidator,
    getFileLinkValidator,
    moveFileValidator
} = require('../validators/file.validator');

router.use(verifyToken);

router.get('/',                             getFilesValidator, validateRequest, getFiles);
router.get('/:id',                          fileIdParamValidator, validateRequest, getFileById);
router.put('/:id/rename',                   renameFileValidator, validateRequest, renameFile);
router.delete('/:id',                       fileIdParamValidator, validateRequest, deleteFile);
router.put('/:id/restore',                  fileIdParamValidator, validateRequest, restoreFile);
router.get('/:id/link',                     getFileLinkValidator, validateRequest, getFileLink);
router.put('/:id/move/:targetFolderId',     moveFileValidator, validateRequest, moveFile);

module.exports = router;