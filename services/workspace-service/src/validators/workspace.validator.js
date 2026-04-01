const Joi = require('joi');

const create_workspace_valid = Joi.object({
    name: Joi.string().min(2).max(100).required().messages({
        'string.min': "Workspace's name has at least 2 characters",
        'any.required': "Workspace's name is needed",
    }),
});

const add_member_valid = Joi.object({
    userId: Joi.string().email().required().messages({
        'string.email': "Email not valid",
        'any.required': "User's email is needed",
    }),
    permissions: Joi.string().valid('preview', 'download','upload').default('preview'),
});

function validate(schema) {
    return (req,res,next) => {
        const {error, value} = schema.validate(req.body, {abortEarly: false});
        if (error) {
            const errors = error.details.map((d) => d.messsage);
            return res.status(400).json({message: "Validation error ", errors});
        }
        req.body = value;
        next();
    };
}

module.exports = {create_workspace_valid, add_member_valid, validate};