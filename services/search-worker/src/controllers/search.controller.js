const axios         = require('axios');
const chromaService = require('../config/chroma.config');
const embedService = require('../services/embed.service');

//-------- GET /api/search/---------------
async function search(req, res) {
  try {
    const { q, workspaceId } = req.query;
    const userId             = req.user.userId;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Message search is required' });
    }

    if (workspaceId) {
      try {
        const wsRes   = await axios.get(`${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`, { 
          headers: { Authorization: req.headers.authorization } }
        );
        const isMember = wsRes.data.data.members.some(
          (m) => m.userId.toString() === userId
        );
        if (!isMember) {
          return res.status(403).json({ message: 'You have no permission to look up in this workspace' });
        }
      } catch (err) {
        if (err.response?.status === 404) {
          return res.status(404).json({ message: 'Workspace not exists' });
        }
        return res.status(500).json({ message: 'Cannot connect to workspace-service' });
      }
    }

    const embedding = await embedService.embed(q);

    const where = workspaceId
      ? { workspaceId }
      : { uploadedBy: userId };

    const results = await chromaService.query({
      embedding ,  
      nResults: 10,
      where,
    });

    if (!results.ids[0]?.length) {
      return res.json({
        message: 'Search successfully',
        data:    { query: q, total: 0, results: [] },
      });
    }

    const hits = results.ids[0].map((id, i) => ({
      documentId: id,
      score: results.distances?.[0]?.[i] !== undefined ? parseFloat((1 - results.distances[0][i]).toFixed(4)) : 0,
      preview:    results.documents[0][i]?.slice(0, 200),
      metadata:   results.metadatas[0][i],
    }));

    try {
      const ids     = hits.map((h) => h.documentId).join(',');
      const fileRes = await axios.get(`${process.env.FILE_SERVICE_URL}/api/files/internal/by-searching`, { params: { ids } }
      );

      const docMap = {};
      fileRes.data.data.forEach((doc) => {
        docMap[doc._id.toString()] = doc;
      });

      const enrichedHits = hits.map((hit) => ({
        ...hit,
        document: docMap[hit.documentId] || null,
      }));

      return res.json({
        message: 'Search successfully',
        data:    { query: q, total: enrichedHits.length, results: enrichedHits },
      });
    } catch (err) {
      console.error('[Search] Cannot enrich with file-service:', err.message);
      return res.json({
        message: 'Search successfully',
        data:    { query: q, total: hits.length, results: hits },
      });
    }
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = { search };