// ── 1. Import Mocks ───────────────────────────────────────────
jest.mock('axios', () => require('./mocks/axios.mock'));
jest.mock('shared', () => {
  const sharedMock = require('./mocks/shared.mock');
  return {
    ...sharedMock,
    verifyToken: (req, res, next) => {
      req.user = { userId: 'user-001' }; // Giả lập user luôn đăng nhập thành công
      next();
    },
    validateRequest: (req, res, next) => next(),
  };
});
jest.mock('../../src/models/documents.model', () => require('./mocks/models.mock').DocumentMock);
jest.mock('../../src/models/physical-file.model', () => ({
  findById: jest.fn(),
  findByIdAndDelete: jest.fn() 
}));

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const { addJob } = require('shared');

const { DocumentMock: Document, getFreshDocument } = require('./mocks/models.mock');
const PhysicalFile = require('../../src/models/physical-file.model');

const fileRoutes = require('../../src/routes/file.routes');

Document.deleteMany = jest.fn();
Document.countDocuments = jest.fn();
Document.findByIdAndDelete = jest.fn();

// ── 2. Cài đặt App giả lập ────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Middleware giả lập Auth
  app.use((req, res, next) => {
    req.user = { userId: 'user-001' };
    req.headers.authorization = 'Bearer test-token';
    next();
  });

  app.use('/api/files', fileRoutes);

  return app;
}

// ── Helper cho Smart Query chuỗi ──
const smartQuery = (data) => {
  const query = Promise.resolve(data);
  query.populate = jest.fn().mockReturnValue(query);
  query.sort = jest.fn().mockReturnValue(query);
  query.setOptions = jest.fn().mockReturnValue(query);
  return query;
};

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => console.error.mockRestore());
afterEach(() => jest.clearAllMocks());

const VALID_ID = '60d5ec49f1b2c8a1b4e1d3a1';

// ═══════════════════════════════════════════════════════════
// GET /api/files
// ═══════════════════════════════════════════════════════════
describe('GET /api/files', () => {
  const app = createApp();

  test('✅ Lấy files My Drive cá nhân (Không có folder, Không workspace) → 200', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(200);
    // Nhánh: folderId = null, workspaceId = null
    expect(Document.find).toHaveBeenCalledWith({ 
      folderId: null, 
      workspaceId: null, 
      uploadedBy: 'user-001' 
    });
  });

  test('✅ Lấy files trong My Drive nhưng nằm trong một Folder cụ thể → 200', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files').query({ folderId: 'folder-1' });
    expect(res.status).toBe(200);
    // Nhánh: folderId có giá trị, workspaceId = null
    expect(Document.find).toHaveBeenCalledWith({ 
      folderId: 'folder-1', 
      uploadedBy: 'user-001', 
      workspaceId: null 
    });
  });

  test('✅ Lấy files ở thư mục gốc của Workspace (Có workspace, Không có folder) → 200', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files').query({ workspaceId: 'ws-1' });
    expect(res.status).toBe(200);
    // Nhánh: folderId = null, workspaceId có giá trị
    expect(Document.find).toHaveBeenCalledWith({ 
      folderId: null, 
      workspaceId: 'ws-1' 
    });
  });

  test('✅ Lấy files trong một Folder cụ thể của Workspace → 200', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files').query({ folderId: 'folder-1', workspaceId: 'ws-1' });
    expect(res.status).toBe(200);
    // Nhánh: Cả folderId và workspaceId đều có giá trị
    expect(Document.find).toHaveBeenCalledWith({ 
      folderId: 'folder-1', 
      workspaceId: 'ws-1' 
    });
  });

  test('❌ Lỗi Database (500)', async () => {
    Document.find.mockImplementation(() => { throw new Error('DB Error'); });
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/:id
// ═══════════════════════════════════════════════════════════
describe('GET /api/files/:id', () => {
  const app = createApp();

  test('✅ Xem chi tiết file My Drive thành công (Owner) → 200', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument()));
    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(200);
  });

  test('❌ Xem My Drive của người khác → 403', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ uploadedBy: 'user-999' })));
    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(403);
  });

  test('✅ Xem chi tiết file Workspace (Có trong member) → 200', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-123' })));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001' }] } } });

    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(200);
  });

  test('❌ Xem file Workspace (Không phải member) → 403', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-123' })));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-999' }] } } });

    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(403);
  });

  test('❌ API Workspace bị sập → 500', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-123' })));
    axios.get.mockRejectedValueOnce(new Error('Network Down'));

    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to workspace-service');
  });

  test('❌ File không tồn tại → 404', async () => {
    Document.findById.mockReturnValue(smartQuery(null));
    const res = await request(app).get(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/rename
// ═══════════════════════════════════════════════════════════
describe('PUT /api/files/:id/rename', () => {
  const app = createApp();

  test('✅ Đổi tên My Drive file thành công → 200', async () => {
    const file = getFreshDocument();
    Document.findById.mockResolvedValue(file);

    const res = await request(app).put(`/api/files/${VALID_ID}/rename`).send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(file.save).toHaveBeenCalled();
    expect(addJob).toHaveBeenCalled(); 
  });

  test('✅ Đổi tên workspace file (Có quyền) → 200', async () => {
    const file = getFreshDocument({ workspaceId: 'ws-123' });
    Document.findById.mockResolvedValue(file);
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001' }] } } });

    const res = await request(app).put(`/api/files/${VALID_ID}/rename`).send({ name: 'New Name' });
    expect(res.status).toBe(200);
  });

  test('❌ Workspace file (Không phải thành viên) → 403', async () => {
    const file = getFreshDocument({ workspaceId: 'ws-123' });
    Document.findById.mockResolvedValue(file);
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-999' }] } } }); 

    const res = await request(app).put(`/api/files/${VALID_ID}/rename`).send({ name: 'New Name' });
    expect(res.status).toBe(403);
  });

  test('❌ Workspace Service bị sập → 500', async () => {
    const file = getFreshDocument({ workspaceId: 'ws-123' });
    Document.findById.mockResolvedValue(file);
    axios.get.mockRejectedValue(new Error('Network Error'));

    const res = await request(app).put(`/api/files/${VALID_ID}/rename`).send({ name: 'New Name' });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to workspace-service');
  });

  test('✅ Đổi tên thành công dù BullMQ lỗi → 200', async () => {
    const file = getFreshDocument();
    Document.findById.mockResolvedValue(file);
    addJob.mockRejectedValueOnce(new Error('Redis Timeout'));

    const res = await request(app).put(`/api/files/${VALID_ID}/rename`).send({ name: 'New Name' });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/:id
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/:id', () => {
  const app = createApp();

  test('✅ Xóa My Drive file thành công → 200', async () => {
    Document.findById.mockResolvedValue(getFreshDocument());
    Document.updateOne.mockResolvedValue({});

    const res = await request(app).delete(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(200);
    expect(Document.updateOne).toHaveBeenCalledWith({ _id: VALID_ID }, { deletedAt: expect.any(Date) });
  });

  test('❌ Workspace file (Member ROLE, không phải ADMIN) → 403', async () => {
    Document.findById.mockResolvedValue(getFreshDocument({ workspaceId: 'ws-1' }));
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001', role: 'MEMBER' }] } } });

    const res = await request(app).delete(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('You not have permission in this workspace');
  });

  test('✅ Workspace file (ADMIN) → 200', async () => {
    Document.findById.mockResolvedValue(getFreshDocument({ workspaceId: 'ws-1' }));
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001', role: 'ADMIN' }] } } });
    Document.updateOne.mockResolvedValue({});

    const res = await request(app).delete(`/api/files/${VALID_ID}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/restore
// ═══════════════════════════════════════════════════════════
describe('PUT /api/files/:id/restore', () => {
  const app = createApp();

  test('✅ Khôi phục My Drive file thành công → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }); 
    Document.collection.findOne.mockResolvedValue(file);
    Document.updateOne.mockResolvedValue({});

    const res = await request(app).put(`/api/files/${VALID_ID}/restore`);
    expect(res.status).toBe(200);
    expect(Document.updateOne).toHaveBeenCalledWith({ _id: expect.any(Object) }, { $set: { deletedAt: null } });
  });

  test('❌ File không nằm trong thùng rác → 400', async () => {
    Document.collection.findOne.mockResolvedValue(getFreshDocument({ deletedAt: null }));
    const res = await request(app).put(`/api/files/${VALID_ID}/restore`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('File not in the trash');
  });

  test('❌ File đã bị xóa quá 10 ngày → 400', async () => {
    const file = getFreshDocument({ deletedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000) }); 
    Document.collection.findOne.mockResolvedValue(file);

    const res = await request(app).put(`/api/files/${VALID_ID}/restore`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('over 10 days');
  });

  test('❌ Khôi phục Workspace file nhưng không phải ADMIN → 403', async () => {
    const file = getFreshDocument({ workspaceId: 'ws-1', deletedAt: new Date() });
    Document.collection.findOne.mockResolvedValue(file);
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001', role: 'MEMBER' }] } } });

    const res = await request(app).put(`/api/files/${VALID_ID}/restore`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/:id/link
// ═══════════════════════════════════════════════════════════
describe('GET /api/files/:id/link', () => {
  const app = createApp();

  test('✅ Lấy link Download Workspace file thành công → 200', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-1' })));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', permissions: ['download'] }] } } }); 
    axios.get.mockResolvedValueOnce({ data: { data: { url: 'https://minio/signed-url' } } }); 

    const res = await request(app).get(`/api/files/${VALID_ID}/link`).query({ action: 'download' });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://minio/signed-url');
  });

  test('❌ Lấy link Workspace file nhưng thiếu quyền preview → 403', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-1' })));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', permissions: ['upload'] }] } } }); 

    const res = await request(app).get(`/api/files/${VALID_ID}/link`).query({ action: 'preview' });
    expect(res.status).toBe(403);
  });

  test('❌ Lỗi kết nối Storage Service → 500', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument())); 
    axios.get.mockRejectedValueOnce(new Error('Storage Timeout'));

    const res = await request(app).get(`/api/files/${VALID_ID}/link`);
    expect(res.status).toBe(500); 
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/move/:targetFolderId
// ═══════════════════════════════════════════════════════════
describe('PUT /api/files/:id/move/:targetFolderId', () => {
  const app = createApp();

  test('✅ Move file vào folder mới thành công → 200', async () => {
    const file = getFreshDocument();
    Document.findById.mockResolvedValue(file);
    
    PhysicalFile.findById.mockResolvedValue({ minioObjectPath: 'file.pdf', mimeType: 'pdf' });

    const res = await request(app).put(`/api/files/${VALID_ID}/move/folder-2`);
    expect(res.status).toBe(200);
    expect(file.folderId).toBe('folder-2');
    expect(file.save).toHaveBeenCalled();
  });

  test('✅ Move file ra thư mục gốc (targetFolderId = null) → 200', async () => {
    const file = getFreshDocument();
    Document.findById.mockResolvedValue(file);
    
    PhysicalFile.findById.mockResolvedValue({ minioObjectPath: 'file.pdf', mimeType: 'pdf' });

    const res = await request(app).put(`/api/files/${VALID_ID}/move/null`); 
    expect(res.status).toBe(200);
    expect(file.folderId).toBeNull();
  });

  test('❌ Workspace file (Không phải ADMIN move) → 403', async () => {
    Document.findById.mockResolvedValue(getFreshDocument({ workspaceId: 'ws-1' }));
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001', role: 'MEMBER' }] } } });

    const res = await request(app).put(`/api/files/${VALID_ID}/move/folder-2`);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain("Only Workspace's Admin can move this file");
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/trash — getTrashedFiles
// ═══════════════════════════════════════════════════════════
describe('GET /api/files/trash', () => {
  const app = createApp();

  test('✅ Lấy thùng rác My Drive thành công', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument({ deletedAt: new Date() })]));

    const res = await request(app).get('/api/files/trash');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(Document.find).toHaveBeenCalledWith({ deletedAt: { $ne: null }, uploadedBy: 'user-001', workspaceId: null });
  });

  test('✅ Lấy thùng rác Workspace thành công', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument({ deletedAt: new Date(), workspaceId: 'ws-123' })]));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001' }] } } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: 'ws-123' });
    expect(res.status).toBe(200);
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: null } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: 'ws-123' });
    expect(res.status).toBe(404);
  });

  test('❌ User không phải thành viên Workspace → 403', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-999' }] } } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: 'ws-123' });
    expect(res.status).toBe(403);
  });

  test('❌ Lỗi hệ thống → 500', async () => {
    Document.find.mockImplementation(() => { throw new Error('DB Crash'); });
    const res = await request(app).get('/api/files/trash');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/trash/empty — emptyTrash
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/trash/empty', () => {
  const app = createApp();

  test('✅ Thùng rác rỗng → 200', async () => {
    Document.find.mockReturnValue(smartQuery([]));

    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Trash is empty');
  });

  test('✅ Xóa file nhưng usageCount > 0 (KHÔNG xóa Storage) → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date() });
    file.physicalFileId = { _id: 'pf-1', minioObjectPath: 'test.pdf' };
    
    Document.find.mockReturnValue(smartQuery([file]));
    Document.deleteMany.mockResolvedValue(smartQuery({}));
    Document.countDocuments.mockResolvedValue(smartQuery(1)); 

    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(200);
    expect(Document.deleteMany).toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled(); 
    expect(PhysicalFile.findByIdAndDelete).not.toHaveBeenCalled();
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Xóa triệt để file (usageCount = 0) → Cập nhật Storage & DB → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date() });
    file.physicalFileId = { _id: 'pf-1', minioObjectPath: 'test.pdf' };
    
    Document.find.mockReturnValue(smartQuery([file]));
    Document.deleteMany.mockResolvedValue(smartQuery({}));
    Document.countDocuments.mockResolvedValue(smartQuery(0)); 
    axios.delete.mockResolvedValue(smartQuery({}));

    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(200);
    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/file'),
      expect.any(Object)
    );
    expect(PhysicalFile.findByIdAndDelete).toHaveBeenCalledWith('pf-1');
  });

  test('✅ Axios Storage lỗi vẫn nuốt lỗi và tiếp tục xóa DB → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date() });
    file.physicalFileId = { _id: 'pf-1', minioObjectPath: 'test.pdf' };
    
    Document.find.mockReturnValue(smartQuery([file]));
    Document.countDocuments.mockResolvedValue(smartQuery(0));
    axios.delete.mockRejectedValue(new Error('Storage Service Down'));

    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(200); 
    expect(PhysicalFile.findByIdAndDelete).toHaveBeenCalled();
  });

  test('❌ Lỗi DB → 500', async () => {
    Document.find.mockImplementation(() => { throw new Error('DB Crash'); });
    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/trash/:id/force — forceDeleteFile
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/:id/force', () => {
  const app = createApp();

  test('✅ Xóa vĩnh viễn My Drive file (usageCount = 0) → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date() });
    file.physicalFileId = { _id: 'pf-1', minioObjectPath: 'test.pdf' };
    
    Document.findById.mockReturnValue(smartQuery(file));
    Document.findByIdAndDelete.mockResolvedValue(smartQuery({}));
    Document.countDocuments.mockResolvedValue(smartQuery(0)); 
    axios.delete.mockResolvedValue(smartQuery({}));

    // 🟢 SỬA 3: Cập nhật đường dẫn test thành /trash/:id/force cho đúng file Router
    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(200);
    expect(Document.findByIdAndDelete).toHaveBeenCalledWith(VALID_ID);
    expect(axios.delete).toHaveBeenCalled();
    expect(PhysicalFile.findByIdAndDelete).toHaveBeenCalledWith('pf-1');
  });

  test('✅ Xóa vĩnh viễn Workspace file (Bởi ADMIN) → 200', async () => {
    const file = getFreshDocument({ deletedAt: new Date(), workspaceId: 'ws-123' });
    file.physicalFileId = { _id: 'pf-1' };
    
    Document.findById.mockReturnValue(smartQuery(file));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', role: 'ADMIN' }] } } });
    Document.countDocuments.mockResolvedValue(smartQuery(1)); 

    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(200);
    expect(axios.delete).not.toHaveBeenCalled(); 
  });

  test('❌ File không tồn tại → 404', async () => {
    Document.findById.mockReturnValue(smartQuery(null));
    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(404);
  });

  test('❌ File chưa bị xóa (Không ở thùng rác) → 400', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ deletedAt: null })));
    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Move to trash first');
  });

  test('❌ My Drive file: Không phải chủ sở hữu → 403', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ deletedAt: new Date(), uploadedBy: 'user-999' })));
    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(403);
  });

  test('❌ Workspace file: User chỉ là MEMBER → 403', async () => {
    const file = getFreshDocument({ deletedAt: new Date(), workspaceId: 'ws-123' });
    Document.findById.mockReturnValue(smartQuery(file));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', role: 'MEMBER' }] } } });

    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Only Admin');
  });

  test('❌ Workspace file: Workspace bị xóa (404 từ Service) → 404', async () => {
    const file = getFreshDocument({ deletedAt: new Date(), workspaceId: 'ws-123' });
    Document.findById.mockReturnValue(smartQuery(file));
    axios.get.mockRejectedValueOnce({ response: { status: 404 } });

    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(404);
  });

  test('❌ Lỗi DB → 500', async () => {
    Document.findById.mockImplementation(() => { throw new Error('Crash'); });
    const res = await request(app).delete(`/api/files/${VALID_ID}/force`);
    expect(res.status).toBe(500);
  });
});