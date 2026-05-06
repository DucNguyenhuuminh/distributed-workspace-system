// ── 1. Import Mocks ───────────────────────────────────────────
jest.mock('axios', () => require('./mocks/axios.mock'));
jest.mock('shared', () => require('./mocks/shared.mock'));
jest.mock('../../src/models/documents.model', () => require('./mocks/models.mock').DocumentMock);
jest.mock('../../src/models/physical-file.model', () => ({
  findById: jest.fn() 
}));

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const { addJob } = require('shared');

const { DocumentMock: Document, getFreshDocument } = require('./mocks/models.mock');
const filesController = require('../../src/controllers/file.controller');
const PhysicalFile = require('../../src/models/physical-file.model');

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

  app.get('/api/files', filesController.getFiles);
  app.get('/api/files/:id', filesController.getFileById);
  app.get('/api/files/:id/link', filesController.getFileLink);
  app.put('/api/files/:id/rename', filesController.renameFile);
  app.delete('/api/files/:id', filesController.deleteFile);
  app.put('/api/files/:id/restore', filesController.restoreFile);
  app.put('/api/files/:id/move/:targetFolderId', filesController.moveFile);

  return app;
}

// ── Helper cho Smart Query chuỗi ──
const smartQuery = (data) => {
  const query = Promise.resolve(data);
  query.populate = jest.fn().mockReturnValue(query);
  query.sort = jest.fn().mockReturnValue(query);
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

  test('✅ Lấy files theo folderId (200)', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files').query({ folderId: 'folder-1' });
    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ folderId: 'folder-1' });
  });

  test('✅ Lấy files theo workspaceId (200)', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files').query({ workspaceId: 'ws-1' });
    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ folderId: null, workspaceId: 'ws-1' });
  });

  test('✅ Lấy files My Drive cá nhân (200)', async () => {
    Document.find.mockReturnValue(smartQuery([getFreshDocument()]));
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(200);
    expect(Document.find).toHaveBeenCalledWith({ folderId: null, workspaceId: null, uploadedBy: 'user-001' });
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
    expect(addJob).toHaveBeenCalled(); // Kiểm tra gọi BullMQ
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
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-999' }] } } }); // Không có user-001

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
    const file = getFreshDocument({ deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }); // Xóa 2 ngày trước
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
    const file = getFreshDocument({ deletedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000) }); // Xóa 12 ngày trước
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
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', permissions: ['download'] }] } } }); // Workspace Call
    axios.get.mockResolvedValueOnce({ data: { data: { url: 'https://minio/signed-url' } } }); // Storage Call

    const res = await request(app).get(`/api/files/${VALID_ID}/link`).query({ action: 'download' });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://minio/signed-url');
  });

  test('❌ Lấy link Workspace file nhưng thiếu quyền preview → 403', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument({ workspaceId: 'ws-1' })));
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: 'user-001', permissions: ['upload'] }] } } }); // Ko có preview

    const res = await request(app).get(`/api/files/${VALID_ID}/link`).query({ action: 'preview' });
    expect(res.status).toBe(403);
  });

  test('❌ Lỗi kết nối Storage Service → 500', async () => {
    Document.findById.mockReturnValue(smartQuery(getFreshDocument())); // My Drive File
    axios.get.mockRejectedValueOnce(new Error('Storage Timeout'));

    const res = await request(app).get(`/api/files/${VALID_ID}/link`);
    expect(res.status).toBe(500); // Rơi vào catch tổng
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
    
    // Mock PhysicalFile để code trong Controller không bị lỗi TypeError
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