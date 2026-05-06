const router = require('express').Router();
const {deletedByWorkspace, deletedByFolders, restoreByFolders, getListFiles, getFileIds} = require('../controllers/internal.controller');

router.get('/by-folders/getFiles',  getListFiles);
router.get('/by-searching',         getFileIds);
router.delete('/by-workspace/:id',  deletedByWorkspace);
router.delete('/by-folders',        deletedByFolders);
router.put('/by-folders/restore',   restoreByFolders);

module.exports = router;
