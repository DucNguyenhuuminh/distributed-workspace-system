const Workspace = require('../models/workspace.model');

//-------GET /api/workspaces/internal-----------
async function getWorkspacesInternal(req,res) {
    try {
        const userId = req.user.userId;
        const { isAdminContext, page = 1, limit = 20, search = '' } = req.query;

        let query = {};

        if (isAdminContext === 'true') {
            if (search) {
                query.name = { $regex: search, $options: 'i' };
            }
            
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const total = await Workspace.countDocuments(query);
            const workspaces = await Workspace.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
            
            return res.json({
                data: {
                    workspaces,
                    pagination: {
                        page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit)
                    }
                }
            });
        } 
        
        else {
            query = { 'members.userId': userId };
            const workspaces = await Workspace.find(query);
            return res.json({ data: workspaces });
        }
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces/internal/:id-----------
async function getWorkspaceByIdInternal(req,res) {
    try {
        const workspaceId = req.params.id;
        const userId = req.user.userId;
        const { isAdminContext } = req.query;

        const workspace = await Workspace.findById(workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not exist" });
        }
        if (isAdminContext !== 'true') {
            const member = workspace.members.some((m) => m.userId.toString() === userId);
            if (!member) {
                return res.status(403).json({message: "You do not have permission to access" });
            }
        }

        return res.json({data: workspace});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/workspaces/internal/stats-----------
async function getWorkspaceStats(req,res) {
    try {
        const total = await Workspace.countDocuments();
        return res.json({data: {total}});
    } catch(err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports = {
    getWorkspacesInternal, 
    getWorkspaceByIdInternal,
    getWorkspaceStats
};