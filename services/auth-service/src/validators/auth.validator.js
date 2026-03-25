const Joi = require('joi');

const register_valid = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': "Email not valid",
        'any.required': "Email is needed"
    }),
    password: Joi.string().min(6).required().messages({
        'string.min': "Password has at least 6 characters",
        'any.required': "Password is needed"
    }),
    fullname: Joi.string().min(4).required().messages({
        'string.min': "Username has at least 4 characters",
        'any.required': "Username is needed"
    }),
    globalRole: Joi.string().valid('USER','SYSTEM_ADMIN').default('USER'),
});

const login_valid = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': "Email not valid",
        'any.required': "Email is needed"
    }),
    password: Joi.string().min(6).required().messages({
        'string.min': "Password has at least 6 characters",
        'any.required': "Password is needed"
    }),
});

function validate (schema) {
    return (req, res, next) => {
        const {error, value} = schema.validate(req.body, {abortEarly: false});
        if (error) {
            const errors = error.details.map((d) => d.message);
            return res.status(400).json({message: "Validation error"}, errors);
        }
        req.body = value;
        next();
    };
}

module.exports = {register_valid, login_valid, validate};