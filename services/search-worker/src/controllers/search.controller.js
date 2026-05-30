const axios    = require('axios');
const mongoose = require('mongoose');
const embedService = require('../services/embed.service');
const Document = require('../models/documents.model');

//----
async function search(req, res) {
  try {
    const { q, workspaceId, type } = req.query;
    const userId = req.user.userId;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Query is required' });
    }

    // check permission workspace
    if (workspaceId) {
      try {
        const wsRes = await axios.get(
          `${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
          { headers: { Authorization: req.headers.authorization } }
        );
        const isMember = wsRes.data.data.members.some(
          (m) => m.userId.toString() === userId
        );
        if (!isMember) {
          return res.status(403).json({ message: 'No permission in this workspace' });
        }
      } catch (err) {
        if (err.response?.status === 404) {
          return res.status(404).json({ message: 'Workspace not found' });
        }
        return res.status(500).json({ message: 'Cannot connect to workspace-service' });
      }
    }

    const queryVector = await embedService.embedText(q);

    const matchFilter = workspaceId
      ? { workspaceId: new mongoose.Types.ObjectId(workspaceId), deletedAt: null }
      : { uploadedBy:  new mongoose.Types.ObjectId(userId),      deletedAt: null };

    const embeddingField = type === 'image' ? 'imageEmbedding' : 'textEmbedding';

    // MongoDB Atlas Vector Search
    const results = await Document.aggregate([
      {
        $vectorSearch: {
          index:        'vector_index',
          path:         embeddingField,
          queryVector,
          numCandidates: 50,
          limit:         10,
          filter:        matchFilter,
        },
      },
      {
        $project: {
          _id:          1,
          originalName: 1,
          workspaceId:  1,
          folderId:     1,
          uploadedBy:   1,
          mimeType:     1,
          createdAt:    1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]);

    return res.json({
      message: 'Search successfully',
      data: {
        query:   q,
        total:   results.length,
        results: results.map((r) => ({
          documentId:   r._id,
          originalName: r.originalName,
          score:        parseFloat(r.score.toFixed(4)),
          workspaceId:  r.workspaceId,
          mimeType:     r.mimeType,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = { search };