const axios = require('axios');
const {addJob} = require('shared/queue/queueProducer');
const {queueForEvent, jobIdFor, EVENTS, DEFAULT_JOB_OPTIONS} = require('shared/queue/queue.config');
const Document = require('../models/documents.model');
const PhysicalFile = require('../models/physical-file.model');

//-------GET /api/files/internal/by-folders/getFiles-----------
async function getListFiles(req,res) {
    try {
        const {folderId, deletedAt, workspaceId, uploadedBy} = req.query;
        let query = {};
        if (folderId) {
            query.folderId = folderId === "null" ? null : folderId;
        }

        if (deletedAt === null || deletedAt === "null") {
            query.deletedAt = null;
        }else {
            query.deletedAt = deletedAt;
        }

        const files = await Document.find(query)
                        .populate('physicalFileId', 'sizeBytes mimeType, minioObjectPath')
                        .sort({createdAt: -1});

        return res.json({success: true, data: files});
    } catch(err) {
        console.error("[file-service] Error get list files (internal): ", err.message);
        return res.status(500).json({message: err.message});
    }
}

//-------GET /api/files/internal/by-searching/-----------
async function getFileIds(req,res) {
    try {
        const ids = req.query.ids?.split(',').filter(Boolean) || [];
        if (!ids.length) {
            return res.status(400).json({message: "File id is required"});
        }

        const files = await Document.find({_id: {$in: ids}}).populate('physicalFileId', 'sizeBytes mimeType minioObjectPath');

        return res.json({data: files});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

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

//-------PUT /api/files/internal/by-folders/restore-----------
async function restoreByFolders(req,res) {
    try {
        const {folderIds} = req.body;
        if (!Array.isArray(folderIds) || folderIds.length === 0) {
            return res.status(400).json({message: "Folder Id is required"})
        }

        await Document.updateMany(
            {folderId: {$in: folderIds}},
            {deletedAt: null}
        );

        return res.status(200).json({message: "Restore files in folderId"})
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------DELETE /api/files/internal/by-folders/force-----------
async function forceDeleteFilesByFolders(req, res) {
  try {
    const { folderIds } = req.body;

    if (!folderIds || folderIds.length === 0) {
      return res.status(400).json({ message: 'Require list of folder ids' });
    }

    const filesToDelete = await Document.find({
      folderId: { $in: folderIds },
    }).populate('physicalFileId');

    if (filesToDelete.length === 0) {
      return res.json({ message: 'No files to clean in these folders' });
    }

    const fileIds      = filesToDelete.map((f) => f._id.toString());
    const physicalFiles = filesToDelete.map((f) => f.physicalFileId).filter(Boolean);

    await Document.deleteMany({ _id: { $in: fileIds } });
    const uniquePhysicalFiles = [
      ...new Map(physicalFiles.map((pf) => [pf._id.toString(), pf])).values(),
    ];

    const deletePromises = uniquePhysicalFiles.map(async (pf) => {
      const usageCount = await Document.countDocuments({ physicalFileId: pf._id });
      if (usageCount === 0) {
        await axios.delete(
          `${process.env.STORAGE_SERVICE_URL}/api/storage/file`,
          {
            data:    { objectName: pf.minioObjectPath },
            headers: { Authorization: req.headers.authorization },
          }
        ).catch((e) => console.error(`[Storage] Error deleting ${pf.minioObjectPath}:`, e.message));

        await PhysicalFile.findByIdAndDelete(pf._id);
      }
    });

    await Promise.all(deletePromises);

    try {
      await addJob(
        queueForEvent(EVENTS.FILE_TRASHED),
        EVENTS.FILE_TRASHED,
        { fileIds },
        {
          ...DEFAULT_JOB_OPTIONS, jobId: jobIdFor(EVENTS.FILE_TRASHED, `bulk-${Date.now()}`),
        }
      );
    } catch (jobErr) {
      console.error('[Queue Error] forceDeleteFilesByFolders:', jobErr.message);
    }

    return res.json({ message: `Force deleted ${fileIds.length} files` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

//-------GET /api/files/internal/by-admin-----------
async function getFilesAdmin(req, res) {
    try {
        const { 
            page = 1, 
            limit = 20, 
            search = '',
            workspaceId = ''
        } = req.query;
        
        const query = {};
        if (search) {
            query.originalName = { $regex: search, $options: 'i' };
        }
        if (workspaceId) {
            query.workspaceId = workspaceId;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Document.countDocuments(query);

        const files = await Document.find(query)
            .populate('physicalFileId') 
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return res.json({
            data: {
                files,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit),
                }
            }
        });
    } catch (err) {
        console.error('[File Service] getFilesAdmin error:', err);
        return res.status(500).json({ message: err.message });
    }
}

//-------GET /api/files/internal/by-admin/:id-----------
async function getFileByIdAdmin(req, res) {
    try {
        const fileId = req.params.id;
        const file = await Document.findById(fileId).populate('physicalFileId'); 
            
        if (!file) {
            return res.status(404).json({ message: "File not found" });
        }
        return res.json({ data: file });
    } catch (err) {
        console.error('[File Service] getFileByIdAdmin error:', err);
        return res.status(500).json({ message: err.message });
    }
}

//-----------GET /api/files/internal/stats-----------
async function getStats(req, res) {
  try {
    const [
      totalDocuments, 
      totalPhysicalFiles, 
      physicalAgg, 
      docAgg
    ] = await Promise.all([
      
      Document.countDocuments({}),
      PhysicalFile.countDocuments({}),
      
      PhysicalFile.aggregate([
        {
          $group: {
            _id: null,
            totalSizeBytes: { $sum: '$sizeBytes' },
          },
        },
      ]),

      Document.aggregate([
        {
          // Bước 1: Gom nhóm Document theo physicalFileId để đếm tần suất sử dụng
          $group: {
            _id: '$physicalFileId',
            useCount: { $sum: 1 }
          }
        },
        {
          // Bước 2: Lúc này số lượng bản ghi truyền xuống chỉ còn bằng số lượng PhysicalFile
          // Phép $lookup nhẹ đi hàng chục, hàng trăm lần!
          $lookup: {
            from: 'physicalfiles', // LƯU Ý: Đảm bảo tên collection trong MongoDB của bạn đúng là 'physicalfiles' (thường thêm chữ 's')
            localField: '_id',
            foreignField: '_id',
            as: 'physicalFile',
          },
        },
        { $unwind: '$physicalFile' },
        {
          // Bước 3: Nhân dung lượng file với số lần được nhân bản
          $group: {
            _id: null,
            totalSizeBytesNoDedup: { 
              $sum: { $multiply: ['$physicalFile.sizeBytes', '$useCount'] } 
            },
          },
        },
      ])
    ]);

    const totalSizeBytes        = physicalAgg[0]?.totalSizeBytes || 0;
    const totalSizeBytesNoDedup = docAgg[0]?.totalSizeBytesNoDedup || 0;

    // Dung lượng tiết kiệm = tổng nếu không dedup - tổng thực tế
    const savedSizeBytes  = Math.max(0, totalSizeBytesNoDedup - totalSizeBytes);
    const savedPercentage = totalSizeBytesNoDedup > 0
      ? parseFloat(((savedSizeBytes / totalSizeBytesNoDedup) * 100).toFixed(2))
      : 0;

    return res.json({
      data: {
        totalDocuments,
        totalPhysicalFiles,
        totalSizeBytes,
        savedSizeBytes,
        savedPercentage,
      },
    });
  } catch (err) {
    console.error("[Stats Error]", err);
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
    deletedByWorkspace, 
    deletedByFolders, 
    restoreByFolders,
    getListFiles, 
    getFileIds,
    forceDeleteFilesByFolders,
    getFileByIdAdmin,
    getFilesAdmin,
    getStats
};