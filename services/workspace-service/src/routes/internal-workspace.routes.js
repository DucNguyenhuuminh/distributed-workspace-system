const router = require('express').Router();
const {getWorkspaceByIdInternal, getWorkspaceStats, getWorkspacesInternal} = require('../controllers/internal-workspace.controller');

router.get('/',         getWorkspacesInternal);
router.get('/stats',    getWorkspaceStats);
router.get('/:id',      getWorkspaceByIdInternal);

module.exports = router;