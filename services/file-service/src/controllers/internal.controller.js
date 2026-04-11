const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');

//-------DELETE /api/files/internal/by-workspace/:id-----------
async function deletedByWorkspace(req,res) {
    try {
        const workspaceId = req.params.id;
        await Document.updateMany(
            {workspaceId},
            {deletedAt: new Date()}
        );
        return res.json({message: "Deleted documents by workspace", workspaceId});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/files/internal/by-folders-----------
async function deletedByFolders(req,res) {
    try {
        const { folderIds } = req.body;
        if (!Array.isArray(folderIds) || folderIds.length === 0) {
            return res.status(400).json({message: "folderIds is required"});
        }

        await Document.updateMany(
            {folderId: {$in: folderIds}},
            {deletedAt: new Date()}
        );
        return res.json({message: "Deleted documents by folders", folderIds});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {deletedByWorkspace, deletedByFolders};