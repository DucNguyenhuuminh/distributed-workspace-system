const jwt = require('jsonwebtoken');

function authMiddleware (req,res,next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer')) {
        return res.status(401).json({message: "Missing token"});
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    }catch {
        return res.status(401).json({message: "Invalid token"});
    }
}

function verifyToken(req,res,next) {
    const token  = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({message: "No token provided"});
    }

    try {
        const decoded = jwt.verify(token,process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch(err) {
        return res.status(401).json({message: "Invalid or expired token"});
    }
}

module.exports = {authMiddleware, verifyToken};