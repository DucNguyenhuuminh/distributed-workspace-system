const { param, query, body } = require('express-validator');

// 1. Validator chung cho các API chỉ cần truyền File ID qua params
const fileIdParamValidator = [
    param('id')
        .notEmpty().withMessage('File ID is required')
        .isMongoId().withMessage('Invalid File ID format')
];

// 2. Validator cho API Get Files (Lọc theo query)
const getFilesValidator = [
    query('workspaceId')
        .optional()
        .isMongoId().withMessage('Invalid Workspace ID format'),
    query('folderId')
        .optional()
        .isMongoId().withMessage('Invalid Folder ID format')
];

// 3. Validator cho API Rename File
const renameFileValidator = [
    param('id')
        .notEmpty().withMessage('File ID is required')
        .isMongoId().withMessage('Invalid File ID format'),
    body('name')
        .notEmpty().withMessage('New file name is required')
        .isString().withMessage('File name must be a string')
        .trim()
];

// 4. Validator cho API Get File Link
const getFileLinkValidator = [
    param('id')
        .notEmpty().withMessage('File ID is required')
        .isMongoId().withMessage('Invalid File ID format'),
    query('action')
        .optional()
        .isIn(['download', 'preview']).withMessage('Action must be either download or preview')
];

// 5. Validator cho API Move File
const moveFileValidator = [
    param('id')
        .notEmpty().withMessage('File ID is required')
        .isMongoId().withMessage('Invalid File ID format'),
    param('targetFolderId')
        .notEmpty().withMessage('Target Folder ID is required')
        .custom((value) => {
            // Cho phép chuỗi 'null' (khi muốn đưa file ra thư mục gốc) 
            // Hoặc phải là một MongoID hợp lệ
            if (value === 'null') return true;
            if (value.match(/^[0-9a-fA-F]{24}$/)) return true;
            throw new Error('Invalid Target Folder ID format');
        })
];

module.exports = {
    fileIdParamValidator,
    getFilesValidator,
    renameFileValidator,
    getFileLinkValidator,
    moveFileValidator
};