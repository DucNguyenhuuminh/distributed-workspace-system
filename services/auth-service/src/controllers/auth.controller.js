const jwt = require('jsonwebtoken');
const User = require('../models/auth.model');

//-------PUT /api/auth/register-----------
async function register (req,res) {
    try {
        const {email,password,username,globalRole} = req.body;

        const existed = await User.findOne({email});
        if (existed) {
            return res.status(409).json({message: "Email has been registed"});
        }

        const user = await User.create({email,password,username,globalRole});

        return res.status(201).json({
            message: "Register successfully",
            user,
        });
    }catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------POST /api/auth/login-----------
async function login (req,res) {
    try {
        const {email,password} = req.body;

        const user = await User.findOne({email});
        if (!user) {
            return res.status(401).json({message: "Email or password not true"});
        }

        if (!user.isActive) {
            return res.status(403).json({message: "User has been baned"});
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
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

        return res.json({
            message: "Login successfully",
            token,
            user,
        });
    }catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------get /api/auth/profile-----------
async function getProfile (req,res) {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({message: "User not found"});
        }
        return res.json({user});
    }catch (err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/auth/internal/find-by-email-----------
async function findByEmail(req,res) {
    try {
        const {email} = req.query;
        if (!email) {
            return res.status(400).json({message: "Email is required"});
        }

        const user = await User.findOne({email});
        if (!user) {
            return res.status(404).json({message: "User not exist"});
        }
        return res.json({data: user});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {register,login,getProfile,findByEmail};