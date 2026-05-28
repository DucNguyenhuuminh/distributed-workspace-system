const { body } = require('express-validator');

const checkHashValidator = [
    body('filename')
        .notEmpty().withMessage('File name is required')
        .isString().withMessage('File name must be a string')
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

const initUploadValidator = [
    body('filename')
        .notEmpty().withMessage('File name is required')
        .isString().withMessage('File name must be a string')
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