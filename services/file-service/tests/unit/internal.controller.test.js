// ── 1. Mock Database Models ────────────────────────────
jest.mock('axios');
jest.mock('shared', () => ({
  addJob: jest.fn().mockResolvedValue({ id: 'job-mock' }),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  EVENTS: { FILE_TRASHED: 'file.trashed' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 }
}));

// Mock Document model
jest.mock('../../src/models/documents.model', () => {
  return {
    find: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
    findByIdAndDelete: jest.fn(),
    aggregate: jest.fn() // 🟢 Dùng cho stats
  };
});

// Mock PhysicalFile model
jest.mock('../../src/models/physical-file.model', () => ({
  findByIdAndDelete: jest.fn(),
  countDocuments: jest.fn(), // 🟢 Dùng cho stats
  aggregate: jest.fn()       // 🟢 Dùng cho stats
}));

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const Document = require('../../src/models/documents.model'); 
const PhysicalFile = require('../../src/models/physical-file.model');
const internalController = require('../../src/controllers/internal.controller');

// 🟢 Bảo bối smartQuery nâng cấp (Hỗ trợ skip, limit cho admin api)
const smartQuery = (data) => {
  const query = Promise.resolve(data);
  query.populate = jest.fn().mockReturnValue(query);
  query.sort = jest.fn().mockReturnValue(query);
  query.skip = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  query.setOptions = jest.fn().mockReturnValue(query);
  return query;
};

// ── 2. Cài đặt App giả lập để test ──────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Mount các routes trỏ thẳng vào controller
  app.delete('/api/files/internal/by-workspace/:id', internalController.deletedByWorkspace);
  app.delete('/api/files/internal/by-folders', internalController.deletedByFolders);
  app.put('/api/files/internal/by-folders/restore', internalController.restoreByFolders);
  app.delete('/api/files/internal/by-folders/force', internalController.forceDeleteFilesByFolders);
  app.get('/api/files/internal/by-folders/getFiles', internalController.getListFiles);
  app.get('/api/files/internal/by-searching', internalController.getFileIds);
  app.get('/api/files/internal/by-admin', internalController.getFilesAdmin);
  app.get('/api/files/internal/by-admin/:id', internalController.getFileByIdAdmin);
  app.get('/api/files/internal/stats', internalController.getStats);

  return app;
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-workspace/:id
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/internal/by-workspace/:id', () => {
  const app = createApp();
  const workspaceId = 'workspace-123';

  test('✅ Xóa documents theo workspaceId thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 5 });

    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${workspaceId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by workspace');
    expect(res.body.workspaceId).toBe(workspaceId);

    // Kiểm tra DB được gọi đúng tham số (set deletedAt = Date hiện tại)
    expect(Document.updateMany).toHaveBeenCalledWith(
      { workspaceId },
      { deletedAt: expect.any(Date) }
    );
  });

  test('❌ Lỗi Database khi xóa theo workspace (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('DB Connection Lost'));

    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${workspaceId}`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Connection Lost');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-folders
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/internal/by-folders', () => {
  const app = createApp();

  test('✅ Xóa documents theo mảng folderIds thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 3 });
    const folderIds = ['folder-1', 'folder-2'];

    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by folders');
    expect(res.body.folderIds).toEqual(folderIds);

    expect(Document.updateMany).toHaveBeenCalledWith(
      { folderId: { $in: folderIds } },
      { deletedAt: expect.any(Date) }
    );
  });

  test('❌ Không truyền folderIds (undefined) → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({}); // Payload rỗng

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ folderIds không phải là Array (truyền String) → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: 'folder-1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Mảng folderIds rỗng [] → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Lỗi Database khi xóa theo folders (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('DB Timeout'));

    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Timeout');
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/internal/by-folders/restore
// ═══════════════════════════════════════════════════════════
describe('PUT /api/files/internal/by-folders/restore', () => {
  const app = createApp();

  test('✅ Restore documents theo mảng folderIds thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 2 });
    const folderIds = ['folder-3', 'folder-4'];

    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds });

    expect(res.status).toBe(200);
    // Code hiện tại đang trả về chuỗi JSON trực tiếp thay vì object
    expect(res.body.message).toBe('Restore files in folderId');

    // Lưu ý: Đoạn expect này viết theo bug "flderId" trong code hiện tại của bạn.
    // Nếu bạn đã sửa thành "folderId" trong controller, hãy sửa lại cả dòng dưới đây.
    expect(Document.updateMany).toHaveBeenCalledWith(
      { folderId: { $in: folderIds } }, 
      { deletedAt: null }
    );
  });

  test('❌ Không truyền folderIds → 400', async () => {
    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({});

    expect(res.status).toBe(400);
    // Code hiện tại trả về string trực tiếp
    expect(res.body.message).toBe('Folder Id is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Mảng folderIds rỗng [] → 400', async () => {
    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Folder Id is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Lỗi Database khi restore (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('Mongoose Error'));

    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Mongoose Error');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-folders/force
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/internal/by-folders/force', () => {
  const app = createApp();

  test('✅ Xóa vĩnh viễn (usageCount = 0) → Cập nhật Storage & DB → 200', async () => {
    const mockFile = { 
      _id: 'doc-1', 
      physicalFileId: { _id: 'pf-1', minioObjectPath: 'test.pdf' } 
    };
    
    // Hàm find có .populate() nên phải dùng smartQuery
    Document.find.mockReturnValue(smartQuery([mockFile]));
    Document.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Document.countDocuments.mockResolvedValue(0); 
    axios.delete.mockResolvedValue({});
    PhysicalFile.findByIdAndDelete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Force deleted 1 files');
    expect(Document.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['doc-1'] } });
    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/file'),
      expect.any(Object)
    );
    expect(PhysicalFile.findByIdAndDelete).toHaveBeenCalledWith('pf-1');
  });

  test('✅ Xóa file nhưng Physical File đang được dùng (usageCount > 0) → KHÔNG xóa Storage', async () => {
    const mockFile = { 
      _id: 'doc-1', 
      physicalFileId: { _id: 'pf-1', minioObjectPath: 'test.pdf' } 
    };
    
    Document.find.mockReturnValue(smartQuery([mockFile]));
    Document.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Document.countDocuments.mockResolvedValue(1); // Có file khác đang dùng

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(200);
    expect(Document.deleteMany).toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled(); // Storage an toàn
    expect(PhysicalFile.findByIdAndDelete).not.toHaveBeenCalled();
  });

  test('✅ Thư mục không có file nào để xóa → 200', async () => {
    Document.find.mockReturnValue(smartQuery([])); // DB trả về mảng rỗng

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No files to clean in these folders');
    expect(Document.deleteMany).not.toHaveBeenCalled();
  });

  test('✅ Storage lỗi nhưng vẫn nuốt lỗi và tiếp tục → 200', async () => {
    const mockFile = { 
      _id: 'doc-1', 
      physicalFileId: { _id: 'pf-1', minioObjectPath: 'test.pdf' } 
    };
    
    Document.find.mockReturnValue(smartQuery([mockFile]));
    Document.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Document.countDocuments.mockResolvedValue(0);
    // Giả lập Axios sập
    axios.delete.mockRejectedValue(new Error('Storage Timeout')); 

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(200);
    expect(PhysicalFile.findByIdAndDelete).toHaveBeenCalledWith('pf-1'); // Vẫn xóa record ở bảng PhysicalFile
  });

  test('❌ Không truyền folderIds → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({}); // Rỗng

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Require list of folder ids');
  });

  test('❌ folderIds là mảng rỗng → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Require list of folder ids');
  });

  test('❌ Lỗi DB (Crash) → 500', async () => {
    Document.find.mockImplementation(() => { throw new Error('DB Crash'); });

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(500);
  });
});

describe('GET /api/files/internal/by-folders/getFiles', () => {
  const app = createApp();

  test('✅ Lấy danh sách file thư mục gốc (folderId = "null") → 200', async () => {
    Document.find.mockReturnValue(smartQuery([{ _id: 'doc1' }]));
    const res = await request(app).get('/api/files/internal/by-folders/getFiles').query({ folderId: 'null', deletedAt: 'null' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(Document.find).toHaveBeenCalledWith({ folderId: null, deletedAt: null });
  });

  test('✅ Lấy danh sách file theo id thư mục cụ thể → 200', async () => {
    Document.find.mockReturnValue(smartQuery([{ _id: 'doc2' }]));
    const res = await request(app).get('/api/files/internal/by-folders/getFiles').query({ folderId: 'f-123', deletedAt: '2023-01-01' });

    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ folderId: 'f-123', deletedAt: '2023-01-01' });
  });

  test('❌ DB lỗi → 500', async () => {
    Document.find.mockImplementation(() => { throw new Error('Query failed'); });
    const res = await request(app).get('/api/files/internal/by-folders/getFiles');
    
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Query failed');
  });
});

describe('GET /api/files/internal/by-searching', () => {
  const app = createApp();

  test('✅ Lấy file qua mảng IDs → 200', async () => {
    Document.find.mockReturnValue(smartQuery([{ _id: 'f1' }, { _id: 'f2' }]));
    const res = await request(app).get('/api/files/internal/by-searching').query({ ids: 'f1,f2' });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(Document.find).toHaveBeenCalledWith({ _id: { $in: ['f1', 'f2'] } });
  });

  test('❌ Không truyền ids hoặc rỗng → 400', async () => {
    const res = await request(app).get('/api/files/internal/by-searching').query({ ids: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('File id is required');
  });

  test('❌ DB lỗi → 500', async () => {
    Document.find.mockImplementation(() => { throw new Error('Search failed'); });
    const res = await request(app).get('/api/files/internal/by-searching').query({ ids: 'f1' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/files/internal/by-admin', () => {
  const app = createApp();

  test('✅ Lấy files kèm phân trang → 200', async () => {
    Document.countDocuments.mockResolvedValue(50);
    Document.find.mockReturnValue(smartQuery([{ _id: 'doc1' }]));

    const res = await request(app).get('/api/files/internal/by-admin').query({ page: 2, limit: 10, search: 'Báo cáo', workspaceId: 'ws-1' });

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toEqual({
      page: 2, limit: 10, total: 50, totalPages: 5
    });
    expect(Document.find).toHaveBeenCalledWith({
      originalName: { $regex: 'Báo cáo', $options: 'i' },
      workspaceId: 'ws-1'
    });
  });

  test('❌ Lỗi tra cứu Admin → 500', async () => {
    Document.countDocuments.mockRejectedValue(new Error('Count Error'));
    const res = await request(app).get('/api/files/internal/by-admin');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/files/internal/by-admin/:id', () => {
  const app = createApp();

  test('✅ Tìm thấy File → 200', async () => {
    Document.findById.mockReturnValue(smartQuery({ _id: 'doc-123' }));
    const res = await request(app).get('/api/files/internal/by-admin/doc-123');

    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe('doc-123');
  });

  test('❌ Không tìm thấy File → 404', async () => {
    Document.findById.mockReturnValue(smartQuery(null));
    const res = await request(app).get('/api/files/internal/by-admin/doc-null');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('File not found');
  });

  test('❌ Lỗi Server → 500', async () => {
    Document.findById.mockImplementation(() => { throw new Error('ID Cast Error'); });
    const res = await request(app).get('/api/files/internal/by-admin/doc-err');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/files/internal/stats', () => {
  const app = createApp();

  test('✅ Lấy thống kê hệ thống (Logic tính % và size tiết kiệm đúng) → 200', async () => {
    Document.countDocuments.mockResolvedValue(100);
    PhysicalFile.countDocuments.mockResolvedValue(40);
    
    // Tổng size thực tế lưu trong ổ cứng: 1,000 bytes
    PhysicalFile.aggregate.mockResolvedValue([{ totalSizeBytes: 1000 }]);
    
    // Tổng size nếu không dùng cơ chế dedup: 1,500 bytes
    Document.aggregate.mockResolvedValue([{ totalSizeBytesNoDedup: 1500 }]);

    const res = await request(app).get('/api/files/internal/stats');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      totalDocuments: 100,
      totalPhysicalFiles: 40,
      totalSizeBytes: 1000,
      savedSizeBytes: 500, // 1500 - 1000 = 500
      savedPercentage: 33.33 // (500 / 1500) * 100
    });
  });

  test('✅ Hệ thống trắng, không có file nào → Trả về 0 an toàn → 200', async () => {
    Document.countDocuments.mockResolvedValue(0);
    PhysicalFile.countDocuments.mockResolvedValue(0);
    PhysicalFile.aggregate.mockResolvedValue([]); // Rỗng
    Document.aggregate.mockResolvedValue([]);     // Rỗng

    const res = await request(app).get('/api/files/internal/stats');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      totalDocuments: 0,
      totalPhysicalFiles: 0,
      totalSizeBytes: 0,
      savedSizeBytes: 0,
      savedPercentage: 0
    });
  });

  test('❌ Lỗi Database Aggregate → 500', async () => {
    Document.countDocuments.mockRejectedValue(new Error('Agg failed'));
    const res = await request(app).get('/api/files/internal/stats');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Agg failed');
  });
});