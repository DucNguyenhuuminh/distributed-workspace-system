const router = require('express').Router();
const {deletedByWorkspace, deletedByFolders, restoreByFolders, getListFiles, getFileIds,forceDeleteFilesByFolders,
    getFileByIdAdmin, getStats, getFilesAdmin, updateEmbedding
} = require('../controllers/internal.controller');

router.get('/by-folders/getFiles',  getListFiles);
router.get('/by-searching',         getFileIds);
router.get('/by-admin',             getFilesAdmin);
router.get('/stats',                getStats);
router.delete('/by-folders',        deletedByFolders);
router.put('/by-folders/restore',   restoreByFolders);
router.delete('by-folders/force',   forceDeleteFilesByFolders)
router.delete('/by-workspace/:id',  deletedByWorkspace);
router.get('/by-admin/:id',         getFileByIdAdmin);
router.patch('/:id/embedding',      updateEmbedding);
module.exports = router;
