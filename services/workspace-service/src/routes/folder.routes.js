const router = require('express').Router();
const {createFolder,renameFolder,deleteFolder,
    moveFolder,getFolders,getFolderById} = require('../controllers/folder.controller');
const {create_folder_valid,rename_folder_valid,move_folder_valid,validate} = require('../validators/folder.validator');
const {checkFolderExists,checkFolderPermission,verifyWorkspaceAccess,requireFolderEditPermission} = require('../middlewares/folder.middleware');
const {authMiddleware} = require('shared');

router.use(authMiddleware);

router.post('/',                validate(create_folder_valid), verifyWorkspaceAccess,createFolder);
router.get('/',                 verifyWorkspaceAccess, getFolders);
router.get('/:id',              checkFolderExists, checkFolderPermission, getFolderById);
router.put('/:id/rename',       validate(rename_folder_valid), checkFolderExists, requireFolderEditPermission, renameFolder);
router.delete('/:id',           checkFolderExists, requireFolderEditPermission, deleteFolder);
router.put('/:id/move',         checkFolderExists, requireFolderEditPermission, moveFolder);

module.exports = router;
