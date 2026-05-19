const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../models/auth.model');

//=============HELPER=================
const getAdminConfig = (req, extraParams = {}) => ({
    headers: { Authorization: req.headers.authorization },
    params: { isAdminContext: 'true', ...extraParams }
});

//-------GET /api/admin/users-----------
async function getAllUsers(req,res) {
    try {
        const {page = 1,
            limit = 20,
            search = '',
            role = '',
            isActive = '',
        } = req.query;
        
        const query = {};
        if (search) {
            query.$or = [
                {email: {$regex: search, $options: 'i'}},
                {username: {$regex: search, $options: 'i'}},
            ];
        }

        if (role) {
            query.globalRole = role;
        }
        if (isActive !== '') {
            query.isActive = isActive === 'true';
        }

        const skip = ((parseInt(page)-1) * parseInt(limit));
        const total = await User.countDocuments(query);

        const users = await User.find(query).select('-password').sort({createdAt: -1}).skip(skip).limit(parseInt(limit));

        return res.json({data: {
                            users,
                            pagination: {
                                page: parseInt(page),
                                limit: parseInt(limit),
                                total,
                                totalPages: Math.ceil(total/limit),
                            },
                            summary: {
                                total, 
                                active: await User.countDocuments({isActive: true}),
                                banned: await User.countDocuments({isActive: false}),
                                admins: await User.countDocuments({globalRole: 'SYSTEM_ADMIN'})
                            }
        }});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/admin/users/:id-----------
async function getUserById(req,res) {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({message: 'User not found'});
        }
        return res.json({data: user});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------PATCH /api/admin/users/:id/ban-----------
async function banUser(req,res) {
    try {
        const adminId = req.user.userId;
        const {id} = req.params;

        if (id === adminId) {
            return res.status(400).json({message: 'Cannot ban yourself'});
        }
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({message: 'User not found'});
        }
        if (user.globalRole === 'SYSTEM_ADMIN') {
            return res.status(403).json({ message: 'Cannot ban another System Admin' });
        }

        user.isActive = !user.isActive;
        await user.save();

        const action = user?.isActive ? 'unbanned' : 'banned';
        return res.json({
            message: `User ${action} successfully`,
            data: {
                userId: user.id,
                email: user.email,
                isActive: user.isActive
            },
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/admin/workspaces-----------
async function getWorkspaces(req,res) {
    try {
        const response = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal`, getAdminConfig(req, req.query));
        return res.json(response.data);
    } catch(err) {
        return res.status(err.response?.status || 500).json({message: err.response?.data?.message || err.message});
    }
}

//-------GET /api/admin/workspaces/:id-----------
async function getWorkspaceByIdAdmin(req,res) {
    try {
        const response = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal/${req.params.id}`, getAdminConfig(req));
        return res.json(response.data);
    } catch(err) {
        return res.status(err.response?.status || 500).json({message: err.response?.data?.message || err.message});
    }
}

//-------GET /api/admin/files-----------
async function getFiles(req,res) {
    try {
        const response = await axios.get(`${process.env.FILE_SERVICE_URL}/api/files/internal/by-admin`, getAdminConfig(req, req.query));
        return res.json(response.data);
    } catch(err) {
        return res.status(err.response?.status || 500).json({message: err.response?.data?.message || err.message});
    }
}

//-------GET /api/admin/files/:id-----------
async function getFileByIdAdmin(req,res) {
    try {
        const response = await axios.get(`${process.env.FILE_SERVICE_URL}/api/files/internal/by-admin/${req.params.id}`, getAdminConfig(req));
        return res.json(response.data);
    } catch(err) {
        return res.status(err.response?.status || 500).json({message: err.response?.data?.message || err.message});
    }
}

//-------GET /api/admin/stats-----------
async function getSystemStats(req, res) {
  try {
    const [
      totalUsers, 
      activeUsers, 
      bannedUsers,
      workspaceRes,
      fileRes
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: false }),
      
      axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/internal/stats`, {
          headers: { Authorization: req.headers.authorization },
          params: { isAdminContext: 'true' }
      }).catch(err => {
          console.error('[AdminController] Cannot fetch workspace stats:', err.message);
          return { data: { data: { total: 0 } } };
      }),

      axios.get(`${process.env.FILE_SERVICE_URL}/api/files/internal/stats`, {
          headers: { Authorization: req.headers.authorization },
          params: { isAdminContext: 'true' }
      }).catch(err => {
          console.error('[AdminController] Cannot fetch file stats:', err.message);
          return { data: { data: { totalDocuments: 0, totalPhysicalFiles: 0, totalSizeBytes: 0, savedSizeBytes: 0, savedPercentage: 0 } } };
      })
    ]);

    const workspaceStats = workspaceRes.data.data;
    const fileStats = fileRes.data.data;

    return res.json({
      data: {
        users: {
          total:   totalUsers,
          active:  activeUsers,
          banned:  bannedUsers,
        },
        workspaces: {
          total: workspaceStats.total,
        },
        files: {
          totalDocuments:     fileStats.totalDocuments,
          totalPhysicalFiles: fileStats.totalPhysicalFiles,
          
          totalSizeBytes:     fileStats.totalSizeBytes,
          totalSizeGB:        (fileStats.totalSizeBytes / 1024 ** 3).toFixed(2),
        
          savedSizeBytes:     fileStats.savedSizeBytes,
          savedSizeGB:        (fileStats.savedSizeBytes / 1024 ** 3).toFixed(2),
          savedPercentage:    fileStats.savedPercentage,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
    getAllUsers,
    getFileByIdAdmin,
    getUserById,
    getFiles,
    getWorkspaceByIdAdmin,
    getWorkspaces,
    getSystemStats,
    banUser
}