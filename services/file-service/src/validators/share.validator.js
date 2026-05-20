const {body, param, query} = require('express-validator');

const createShareLinkValidator = [
    body('permissions').optional()
                        .isArray()
                        .withMessage('permission must be an array')
                        .custom((arr) => {
                            const valid = ['view', 'download', 'save'];
                            if (!arr.every((p) => valid.includes(p))) {
                                throw new Error('permission must contain: view, download, save');
                            }
                            return true;
                        }),
    body('expiresInHours').optional({nullable: true})
                            .isInt({min: 1, max: 168})
                            .withMessage('expiresInHours must be in 7 days'),
    
    body('password').optional({nullable: true})
                    .isString()
                    .isLength({min: 6, max: 12})
                    .withMessage('password must be 6-12 characters'),

    body('settings.allowedDownload').optional()
                                    .isBoolean()
                                    .withMessage('settings.allowedDownload must be boolean'),

    body('settings.allowedSave').optional()
                                .isBoolean()
                                .withMessage('settings.allowedSave must be boolean'),

    body('settings.notifyOnAccess').optional()
                                    .isBoolean()
                                    .withMessage('settings.notifyOnAccess must be boolean'),
];

const accessShareLinkValidator = [
    query('action').optional().isIn(['view', 'download']).withMessage('action must be view or download'),
];

const verifyPasswordValidator = [
    body('password').notEmpty().withMessage('Password is required'),
];

module.exports = {
    createShareLinkValidator, 
    accessShareLinkValidator, 
    verifyPasswordValidator
};