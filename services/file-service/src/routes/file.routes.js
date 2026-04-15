const router = require('express').Router();
const {getFiles, getFileById, renameFile, deleteFile, restoreFile,
    getFileLink, moveFile} = require('../controllers/file.controller');

router.get('/', getFiles);
router.get('/:id', getFileById);
router.put('/:id/rename', renameFile);
router.delete('/:id', deleteFile);
router.put('/:id/restore', restoreFile);
router.get('/:id/link', getFileLink);
router.put('/:id/move/:targetFolderId', moveFile);

module.exports = router;