const router = require('express').Router();
const { deletedByWorkspace, deletedByFolders } = require('../controllers/internal.controller');

router.delete('/by-workspace/:id', deletedByWorkspace);
router.delete('/by-folders', deletedByFolders);

module.exports = router;
