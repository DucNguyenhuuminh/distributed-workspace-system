const { body } = require('express-validator');

// 1. Validator cho API Check Hash (Deduplication)
const checkHashValidator = [
    body('objectName')
        .notEmpty().withMessage('Object name is required')
        .isString().withMessage('Object name must be a string')
        .trim(),
    body('hashString')
        .notEmpty().withMessage('Hash string is required')
        .isString().withMessage('Hash string must be a string'),
    body('workspaceId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Workspace ID format'),
    body('folderId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Folder ID format')
];

// 2. Validator cho API Init Upload
const initUploadValidator = [
    body('objectName')
        .notEmpty().withMessage('Object name is required')
        .isString().withMessage('Object name must be a string')
        .trim(),
    body('totalChunks')
        .notEmpty().withMessage('Total chunks is required')
        .isInt({ min: 1 }).withMessage('Total chunks must be an integer >= 1'),
    body('mimeType')
        .notEmpty().withMessage('MIME type is required')
        .isString().withMessage('MIME type must be a string'),
    body('sizeBytes')
        .notEmpty().withMessage('Size in bytes is required')
        .isNumeric().withMessage('Size must be a number'),
    body('workspaceId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Workspace ID format'),
    body('folderId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Folder ID format')
];

// 3. Validator cho API Merge Upload
const mergeUploadValidator = [
    body('uploadId')
        .notEmpty().withMessage('Upload ID is required')
        .isString().withMessage('Upload ID must be a string'),
    body('minioObjectPath')
        .notEmpty().withMessage('Object path is required')
        .isString().withMessage('Object path must be a string'),
    body('objectName')
        .notEmpty().withMessage('Object name is required')
        .isString().withMessage('Object name must be a string'),
    
    // Validate mảng etags cực kỳ chặt chẽ
    body('etags')
        .isArray({ min: 1 }).withMessage('ETags must be a non-empty array'),
    body('etags.*.partNumber')
        .notEmpty().withMessage('Part number is required for each etag')
        .isInt({ min: 1 }).withMessage('Part number must be an integer >= 1'),
    body('etags.*.etag')
        .notEmpty().withMessage('ETag string is required')
        .isString().withMessage('ETag must be a string'),

    // Các thông tin Metadata để lưu Database
    body('hashString')
        .notEmpty().withMessage('Hash string is required')
        .isString().withMessage('Hash string must be a string'),
    body('mimeType')
        .notEmpty().withMessage('MIME type is required')
        .isString().withMessage('MIME type must be a string'),
    body('sizeBytes')
        .notEmpty().withMessage('Size in bytes is required')
        .isNumeric().withMessage('Size must be a number'),
    body('workspaceId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Workspace ID format'),
    body('folderId')
        .optional({ nullable: true })
        .isMongoId().withMessage('Invalid Folder ID format')
];

module.exports = {
    checkHashValidator,
    initUploadValidator,
    mergeUploadValidator
};