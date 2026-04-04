const router = require('express').Router();
const {createFolder,renameFolder,deleteFolder,
    moveFolder,getFolders,getFolderById} = require('../controllers/folder.controller');
const {create_folder_valid,rename_folder_valid,validate} = require('../validators/folder.validator');
const {checkFolderExists,checkFolderPermission,verifyWorkspaceAccess} = require('../middlewares/folder.middleware');
const {authMiddleware} = require('shared');

router.use(authMiddleware);
router.post('/',validate(create_folder_valid),verifyWorkspaceAccess,createFolder);
router.get('/',verifyWorkspaceAccess,getFolders);
router.get('/:id',checkFolderExists,checkFolderPermission,getFolderById);
router.put('/:id/rename',validate(rename_folder_valid),checkFolderExists,checkFolderPermission,renameFolder);
router.delete('/:id',checkFolderExists,checkFolderPermission,deleteFolder);
router.put('/:id/move',checkFolderExists,checkFolderPermission,moveFolder);

module.exports = router;
