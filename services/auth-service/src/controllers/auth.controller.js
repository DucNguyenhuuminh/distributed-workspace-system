const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/auth.model');
const { addJob, queueForEvent, jobIdFor, DEFAULT_JOB_OPTIONS, EVENTS } = require('shared');

//-------POST /api/auth/register-----------
async function register (req,res) {
    try {
        const {email,password,username,globalRole} = req.body;

        const existed = await User.findOne({email});
        if (existed) {
            console.warn(`[AuthController] Register failed - Email already exists: ${email}`);
            return res.status(409).json({message: "Email has been registed"});
        }

        const user = await User.create({email,password,username,globalRole});
        console.log(`[AuthController] Create user successfully in DB: ${user._id}`);

        await addJob(
            queueForEvent(EVENTS.USER_REGISTERED),
            EVENTS.USER_REGISTERED,
            { userId: user._id.toString(), email: user.email },
            { ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.USER_REGISTERED, user._id.toString()) }
        );

        return res.status(201).json({
            message: "Register successfully",
            user: {_id: user._id, email: user.email, username: user.username, globalRole: user.globalRole}
        });
    }catch(err) {
        console.error(`[AuthController] System error while register:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/auth/login-----------
async function login (req,res) {
    try {
        const {email,password} = req.body;

        const user = await User.findOne({email});
        if (!user) {
            console.warn(`[AuthController] Login failed - Not found email: ${email}`);
            return res.status(401).json({message: "Email or password not true"});
        }

        if (!user.isActive) {
            console.warn(`[AuthController] Login failed - Account is banned: ${email}`);
            return res.status(403).json({message: "User has been baned"});
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.warn(`[AuthController] Login failed - Wrong password: ${email}`);
            return res.status(401).json({message: "Email or password not true"});
        }

        const token = jwt.sign(
            {
                userId: user._id,
                email: user.email,
                username: user.username,
                globalRole: user.globalRole,
            },
            process.env.JWT_SECRET,
            {expiresIn: process.env.JWT_EXPIRES_IN || '7d'}
        );

        console.log(`[AuthController] Login successfully, access token for: ${email}`);
        return res.json({
            message: "Login successfully",
            token,
            user: {_id: user._id, email: user.email, username: user.username, globalRole: user.globalRole}
        });
    }catch (err) {
        console.error(`[AuthController] System error while login:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/auth/profile-----------
async function getProfile (req,res) {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId).select('-password');
        if (!user) {
            console.warn(`[AuthController] Not found profile for userId: ${userId}`);
            return res.status(404).json({message: "User not found"});
        }
        return res.json({user});
    }catch (err) {
        console.error(`[AuthController] System error while take profile:`, err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------PUT /api/auth/change-password-----------
async function changePassword(req,res) {
    try {
        const userId = req.user.userId;
        const {currentPassword, newPassword} = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(403).json({message: "Current and new password are required"});
        }
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            console.warn(`[AuthController] Change password failed - Old password wrong (userId: ${userId})`);
            return res.status(400).json({ message: "Incorrect current password" });
        }

        user.password = newPassword;
        await user.save();

        console.log(`[AuthController] Change password successfully for userId: ${userId}`);
        return res.json({ message: "Password updated successfully" });
    } catch(err) {
        console.error(`[AuthController] System error while change password:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------POST /api/auth/forgot-password-----------
async function forgotPassword(req,res) {
    try {
        const {email} = req.body;

        const user = await User.findOne({email});
        if (!user) {
            console.warn(`[AuthController] Forgot password - Email not exists: ${email}`);
            return res.json({ message: "If that email is registered, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.resetPasswordExpires = Date.now()+ 15*60*1000;
        await user.save();

        try {
            await addJob(
                queueForEvent(EVENTS.PASSWORD_RESET),
                EVENTS.PASSWORD_RESET,
                {userId: user._id.toString(), email: user.email, resetToken: resetToken},
                {...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.PASSWORD_RESET, user._id.toString())}
            );
        } catch(jobErr) {
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save();
            return res.status(500).json({ message: "Could not send reset email. Try again." });
        }

        return res.json({ message: "If that email is registered, a reset link has been sent." });
    } catch(err) {
        console.error(`[AuthController] System error while request forget password:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------POST /api/auth/reset-password/:token-----------
async function resetPassword(req, res) {
    try {
        const { token } = req.params;
        const { newPassword } = req.body;

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            console.warn(`[AuthController] Reset password failed - Token  invalid or expired`);
            return res.status(400).json({ message: "Token is invalid or has expired" });
        }

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        console.log(`[AuthController] Set password successfull for email: ${user.email}`);
        return res.json({ message: "Password has been reset successfully. You can now login." });
    } catch (err) {
        console.error(`[AuthController] System error while handle reset password:`, err.message);
        return res.status(500).json({ message: err.message });
    }
}

//-------GET /api/auth/internal/find-by-email-----------
async function findByEmail(req,res) {
    try {
        const {email} = req.query;
        if (!email) {
            return res.status(400).json({message: "Email is required"});
        }

        const user = await User.findOne({email}).select('-password');
        if (!user) {
            console.warn(`[AuthController] Internal Request - Not found user: ${email}`);
            return res.status(404).json({message: "User not exist"});
        }
        return res.json({data: user});
    } catch(err) {
        console.error(`[AuthController] Internal error findByEmail:`, err.message);
        return res.status(500).json({message: err.message});
    }
}


module.exports = {
    register,
    login,
    getProfile,
    findByEmail,
    changePassword,
    forgotPassword,
    resetPassword
};