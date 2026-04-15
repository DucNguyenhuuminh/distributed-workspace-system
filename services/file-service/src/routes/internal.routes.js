const router = require('express').Router();
const {deletedByWorkspace, deletedByFolders, restoreByFolders} = require('../controllers/internal.controller');

router.delete('/by-workspace/:id',  deletedByWorkspace);
router.delete('/by-folders',        deletedByFolders);
router.put('/by-folders/restore',   restoreByFolders);

module.exports = router;
