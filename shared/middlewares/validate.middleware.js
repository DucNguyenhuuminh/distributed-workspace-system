const {validationResult} = require('express-validator');

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

module.exports = {validateRequest};