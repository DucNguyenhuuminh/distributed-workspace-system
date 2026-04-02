const router = require('express').Router();
const {createFolder,renameFolder,deleteFolder,
    moveFolder,getFolders,getFolderById} = require('../controllers/folder.controller');
const {create_folder_valid,rename_folder_valid,validate} = require('../validators/folder.validator');
const {authMiddleware} = require('shared');

router.use(authMiddleware);
router.post('/',validate(create_folder_valid),createFolder);
router.get('/',getFolders);
router.get('/:id',getFolderById);
router.put('/:id/rename',validate(rename_folder_valid),renameFolder);
router.delete('/:id',deleteFolder);
router.put('/:id/move',moveFolder);

module.exports = router;
