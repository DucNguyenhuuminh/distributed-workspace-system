const {body, query, validationResult} = require('express-validator');

const init_multipart_valid = [body('filename').notEmpty().withMessage("Filename is required")
                                            .isString().withMessage("Filename must be string").trim(),
                            body('mimeType').notEmpty().withMessage("MIME type is required")
                                            .isString().withMessage("MIME type must be string"),
                            body('totalChunks').notEmpty().withMessage("Total chunks is required")
                                            .isInt({min:1}).withMessage("Total chunks must be integer greater than 1")
];

const complete_multipart_valid = [body('uploadId').notEmpty().withMessage('Upload ID is required')
                                                    .isString().withMessage('Upload ID must be a string'),
                                    body('objectName').notEmpty().withMessage('Object name is required')
                                                    .isString().withMessage('Object name must be a string'),
                                    body('etags').isArray({ min: 1 }).withMessage('ETags must be a non-empty array'),
                                    body('etags.*.partNumber').notEmpty().withMessage('Part number is required for each etag')
                                                            .isInt({ min: 1 }).withMessage('Part number must be an integer >= 1'),
                                    body('etags.*.etag').notEmpty().withMessage('ETag string is required')
                                                        .isString().withMessage('ETag must be a string')
];

const get_downloadURL_valid= [query('objectName').notEmpty().withMessage('Object name is required')
                                                .isString().withMessage('Object name must be a string'),
                            query('originalName').optional().isString().withMessage('Original name must be a string'),
                            query('action').optional().isIn(['download', 'preview', 'inline']).withMessage('Action must be download, preview, or inline')
];

const delete_file_valid = [body('objectName').notEmpty().withMessage('Object name is required')
                                            .isString().withMessage('Object name must be a string')
];

function validateRequest(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const extractedErrors = [];
        errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

        return res.status(400).json({
            message: "Validation failed",
            errors: extractedErrors,
        });
    }
    next();
}

module.exports = {init_multipart_valid, complete_multipart_valid, get_downloadURL_valid, delete_file_valid, validateRequest};