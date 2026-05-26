const router = require('express').Router();
const {getFiles, getFileById, renameFile, deleteFile, restoreFile,
    getFileLink, moveFile, getTrashedFiles, emptyTrash, forceDeleteFile} = require('../controllers/file.controller');
const {verifyToken} = require('../../../../shared/middlewares/auth.middleware')
const {validateRequest} = require('../../../../shared/middlewares/validate.middleware');
const {
    fileIdParamValidator,
    getFilesValidator,
    renameFileValidator,
    getFileLinkValidator,
    moveFileValidator
} = require('../validators/file.validator');

router.use(verifyToken);

router.get('/',                             getFilesValidator, validateRequest, getFiles);
router.get('/trash',                        getTrashedFiles);
router.delete('/trash/empty',               emptyTrash);
router.get('/:id',                          fileIdParamValidator, validateRequest, getFileById);
router.get('/:id/link',                     getFileLinkValidator, validateRequest, getFileLink);
router.put('/:id/rename',                   renameFileValidator, validateRequest, renameFile);
router.delete('/:id',                       fileIdParamValidator, validateRequest, deleteFile);
router.put('/:id/restore',                  fileIdParamValidator, validateRequest, restoreFile);
router.put('/:id/move/:targetFolderId',     moveFileValidator, validateRequest, moveFile);
router.delete('/:id/force',                 fileIdParamValidator,forceDeleteFile);

module.exports = router;