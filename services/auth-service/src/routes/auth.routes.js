const router= require('express').Router();
const {register, login, getProfile,findByEmail,forgotPassword, changePassword, resetPassword} = require('../controllers/auth.controller');
const {register_valid,login_valid,validate} = require('../validators/auth.validator');
const {authMiddleware} = require('shared');

router.post('/register',                    validate(register_valid), register);
router.post('/login',                       validate(login_valid), login);
router.get('/profile',                      authMiddleware ,getProfile);
router.get('/internal/find-by-email',       findByEmail);
router.put('/change-password',              changePassword);
router.post('/forgot-password',             forgotPassword);
router.post('/reset-password/:token',       resetPassword);

module.exports = router;