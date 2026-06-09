const axios    = require('axios');
const mongoose = require('mongoose');
const embedService = require('../services/embed.service');
const Document = require('../models/documents.model');

//----GET /api/search?q=xxx&workspaceId=yyy&type=zzz------------
// async function search(req, res) {
//   try {
//     const { q, workspaceId, type } = req.query;
//     const userId = req.user.userId;

//     if (!q || q.trim().length === 0) {
//       return res.status(400).json({ message: 'Query is required' });
//     }

//     // check permission workspace
//     if (workspaceId) {
//       try {
//         const wsRes = await axios.get(
//           `${process.env.WORKSPACE_SERVICE_URL}/api/workspaces/${workspaceId}`,
//           { headers: { Authorization: req.headers.authorization } }
//         );
//         const isMember = wsRes.data.data.members.some(
//           (m) => m.userId.toString() === userId
//         );
//         if (!isMember) {
//           return res.status(403).json({ message: 'No permission in this workspace' });
//         }
//       } catch (err) {
//         if (err.response?.status === 404) {
//           return res.status(404).json({ message: 'Workspace not found' });
//         }
//         return res.status(500).json({ message: 'Cannot connect to workspace-service' });
//       }
//     }

//     const queryVector = await embedService.embedText(q);

//     const matchFilter = workspaceId
//       ? { workspaceId: new mongoose.Types.ObjectId(workspaceId), deletedAt: null }
//       : { uploadedBy:  new mongoose.Types.ObjectId(userId),      deletedAt: null };

//     const embeddingField = type === 'image' ? 'imageEmbedding' : 'textEmbedding';

//     const results = await Document.aggregate([
//       {
//         $vectorSearch: {
//           index:        'vector_index',
//           path:         embeddingField,
//           queryVector,
//           numCandidates: 50,
//           limit:         10,
//           filter:        matchFilter,
//         },
//       },
//       {
//         $project: {
//           _id:          1,
//           originalName: 1,
//           workspaceId:  1,
//           folderId:     1,
//           uploadedBy:   1,
//           mimeType:     1,
//           createdAt:    1,
//           score: { $meta: 'vectorSearchScore' },
//         },
//       },
//     ]);

//     return res.json({
//       message: 'Search successfully',
//       data: {
//         query:   q,
//         total:   results.length,
//         results: results.map((r) => ({
//           documentId:   r._id,
//           originalName: r.originalName,
//           score:        parseFloat(r.score.toFixed(4)),
//           workspaceId:  r.workspaceId,
//           mimeType:     r.mimeType,
//         })),
//       },
//     });
//   } catch (err) {
//     return res.status(500).json({ message: err.message });
//   }
// }

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return normA === 0 || normB === 0
    ? 0
    : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// GET /api/search?q=xxx&workspaceId=yyy&type=zzz
async function search(req, res) {
  try {
    const { q, workspaceId, type } = req.query;
    const userId = req.user.userId;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Query is required' });
    }

    // Kiểm tra quyền workspace
    if (workspaceId) {
      try {
        const wsRes    = await axios.get(
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

    // Tạo query vector
    const queryVector = await embedService.embedText(q);
    if (!queryVector) {
      return res.status(500).json({ message: 'Failed to embed query' });
    }

    const embeddingField = type === 'image' ? 'imageEmbedding' : 'textEmbedding';

    // ── Chọn mode search ──────────────────────────────────
    const useAtlasSearch = process.env.USE_ATLAS_VECTOR_SEARCH === 'true';

    if (useAtlasSearch) {
      return await searchWithAtlas({
        res, q, workspaceId, userId,
        queryVector, embeddingField,
      });
    } else {
      return await searchWithCosine({
        res, q, workspaceId, userId,
        queryVector, embeddingField,
      });
    }
  } catch (err) {
    console.error('[SearchController] Error:', err.message);
    return res.status(500).json({ message: err.message });
  }
}

// ── Mode 1: MongoDB Atlas $vectorSearch ───────────────────
// Cần: Atlas cluster + vector index tên "vector_index"
async function searchWithAtlas({ res, q, workspaceId, userId, queryVector, embeddingField }) {
  const matchFilter = workspaceId
    ? { workspaceId: new mongoose.Types.ObjectId(workspaceId), deletedAt: null }
    : { uploadedBy:  new mongoose.Types.ObjectId(userId),      deletedAt: null };

  const results = await Document.aggregate([
    {
      $vectorSearch: {
        index:         'vector_index',
        path:          embeddingField,
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
    message: 'Search successfully (Atlas)',
    data: {
      query:   q,
      total:   results.length,
      results: results.map((r) => ({
        documentId:   r._id,
        originalName: r.originalName,
        score:        parseFloat(r.score?.toFixed(4) || 0),
        workspaceId:  r.workspaceId,
        mimeType:     r.mimeType,
      })),
    },
  });
}

async function searchWithCosine({ res, q, workspaceId, userId, queryVector, embeddingField }) {
  const matchFilter = {
    deletedAt:       null,
    [embeddingField]: { $ne: null },
  };

  if (workspaceId) {
    matchFilter.workspaceId = new mongoose.Types.ObjectId(workspaceId);
  } else {
    matchFilter.uploadedBy = new mongoose.Types.ObjectId(userId);
  }

  const docs = await Document.find(matchFilter)
    .select(`originalName workspaceId folderId uploadedBy mimeType createdAt ${embeddingField}`)
    .lean();

  if (docs.length === 0) {
    return res.json({
      message: 'Search successfully',
      data:    { query: q, total: 0, results: [] },
    });
  }

  const THRESHOLD = 0.2;

  const results = docs
    .map((doc) => ({
      documentId:   doc._id,
      originalName: doc.originalName,
      workspaceId:  doc.workspaceId ? doc.workspaceId.toString() : null,
      folderId:     doc.folderId ? doc.folderId.toString() : null,
      mimeType:     doc.mimeType,
      createdAt:    doc.createdAt,
      score:        cosineSimilarity(queryVector, doc[embeddingField]),
    }))
    .filter((doc) => doc.score > THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => ({
      ...r,
      score: parseFloat(r.score.toFixed(4)),
    }));

  return res.json({
    message: 'Search successfully (Node.js cosine)',
    data:    { query: q, total: results.length, results },
  });
}

module.exports = { search };