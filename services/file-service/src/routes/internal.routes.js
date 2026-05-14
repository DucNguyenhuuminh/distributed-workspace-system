const router = require('express').Router();
const {deletedByWorkspace, deletedByFolders, restoreByFolders, getListFiles, getFileIds,forceDeleteFilesByFolders, getWorkspaceTrashedFile} = require('../controllers/internal.controller');

router.get('/by-folders/getFiles',  getListFiles);
router.get('/by-searching',         getFileIds);
router.delete('/by-folders',        deletedByFolders);
router.put('/by-folders/restore',   restoreByFolders);
router.delete('by-folders/force',   forceDeleteFilesByFolders)
router.delete('/by-workspace/:id',  deletedByWorkspace);
router.get('/by-workspace/:id',     getWorkspaceTrashedFile);

module.exports = router;
