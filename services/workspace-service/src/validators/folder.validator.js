const Joi = require('joi');

const objectIdSchema = Joi.string().hex().length(24).allow(null, '').default(null).messages({
    'string.hex': "ID must be a valid hex string",
    'string.length': "ID must be exactly 24 characters long"
});

const create_folder_valid = Joi.object({
    name: Joi.string().min(1).max(100).required().messages({
        'any.required': "Folder's name is needed",
    }),
    parentId: Joi.string().allow(null, '').default(null),
    workspaceId: Joi.string().allow(null,'').default(null),
});

const rename_folder_valid = Joi.object({
    name: Joi.string().min(1).max(100).required().messages({
        'any.required': "Folder's name is needed",
    }),
});

const move_folder_valid = Joi.object({
    newParentId: objectIdSchema,
    targetWorkspaceId: objectIdSchema
});

function validate(schema) {
    return (req,res,next) => {
        const {error, value} = schema.validate(req.body, {abortEarly: false});
        
        if (error) {
            const errors = error.details.map((d) => d.message);
            return res.status(400).json({message: "Validation error",errors});
        }
        req.body = value;
        next();
    };
}

module.exports = {create_folder_valid, rename_folder_valid, validate};