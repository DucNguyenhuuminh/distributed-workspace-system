const router = require('express').Router();
const {createFolder,renameFolder,deleteFolder,
    moveFolder,getFolders,getFolderById, restoreFolder, getTrashedFolders, emptyTrashFolder, forceDeleteFolder} = require('../controllers/folder.controller');
const {create_folder_valid,rename_folder_valid,move_folder_valid,validate} = require('../validators/folder.validator');
const {authMiddleware} = require('shared/middlewares/auth.middleware');

router.use(authMiddleware);

router.post('/',                        validate(create_folder_valid), createFolder);
router.get('/',                         getFolders);
router.get('/trash',                    getTrashedFolders);
router.delete('/trash/empty',           emptyTrashFolder);
router.delete('/trash/:id/force',       forceDeleteFolder);
router.get('/:id',                      getFolderById);
router.put('/:id/rename',               validate(rename_folder_valid), renameFolder);
router.delete('/:id',                   deleteFolder);
router.put('/:id/restore',              restoreFolder);
router.put('/:id/move',                 validate(move_folder_valid), moveFolder);

module.exports = router;
