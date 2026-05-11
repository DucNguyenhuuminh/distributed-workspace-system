// ── 1. Mock External Services ─────────────────────────────────
jest.mock('axios');
jest.mock('shared', () => {
  let sharedMock = {};
  try {
    // Import mock cũ nếu đang chạy ở Unit Test
    sharedMock = require('./mocks/shared.mock');
  } catch (e) {
    // Bỏ qua nếu không có file này (Thường là khi chạy Integration Test)
  }

  return {
    ...sharedMock,
    
    // ── Mock Queue & BullMQ ──
    addJob: jest.fn().mockResolvedValue({ id: 'job-mock' }),
    queueForEvent: jest.fn((e) => `queue:${e}`),
    jobIdFor: jest.fn((e, id) => `${e}:${id}`),
    EVENTS: {
      FILE_RENAMED: 'file.renamed',
      FILE_TRASHED: 'file.trashed',
      FILE_RESTORED: 'file.restored',
      FILE_MOVED: 'file.moved',
    },
    DEFAULT_JOB_OPTIONS: { attempts: 3 },

    // ── Mock Middlewares (Bắt buộc để đi qua Router thật) ──
    verifyToken: (req, res, next) => {
      // Ưu tiên req.user đã được set ở createApp(), nếu chưa có thì gán mặc định
      if (!req.user) {
        req.user = { userId: 'user-001' }; 
      }
      next();
    },
    validateRequest: (req, res, next) => next(),
    getFilesValidator: (req, res, next) => next(), // Giả lập luôn validator nếu có
  };
});

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { addJob } = require('shared');

const filesController = require('../../src/controllers/file.controller'); // Cập nhật đúng đường dẫn
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

// ── 2. Định nghĩa hằng số & Cài đặt App ───────────────────────
const USER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_USER = new mongoose.Types.ObjectId().toString();
const fileRoutes = require('../../src/routes/file.routes');

function createApp() {
  const app = express();
  app.use(express.json());

  // Giả lập Auth Middleware
  app.use((req, res, next) => {
    req.user = { userId: USER_ID };
    req.headers.authorization = 'Bearer test-token';
    next();
  });

  app.use('/api/files', fileRoutes);
  return app;
}

// ── 3. Seed Data Helper ───────────────────────────────────────
async function seedPhysicalFile() {
  return PhysicalFile.create({
    hashString: `hash-${Date.now()}-${Math.random()}`,
    minioObjectPath: 'file/mock-path.pdf',
    sizeBytes: 2048,
    mimeType: 'application/pdf'
  });
}

async function seedDocument(overrides = {}) {
  const physFile = await seedPhysicalFile();
  return Document.create({
    originalName: 'test-document.pdf',
    uploadedBy: USER_ID,
    physicalFileId: physFile._id,
    workspaceId: null,
    folderId: null,
    ...overrides
  });
}

// ── 4. Lifecycle Hooks ────────────────────────────────────────
beforeAll(async () => {
  await connectTestDB();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeTestDB();
  console.error.mockRestore();
  console.log.mockRestore();
});

// ═══════════════════════════════════════════════════════════
// GET /api/files
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files', () => {
  const app = createApp();

  test('✅ Lấy files My Drive (Không truyền folderId, workspaceId) → 200', async () => {
    await seedDocument({ originalName: 'my-drive-file.pdf' });
    await seedDocument({ uploadedBy: OTHER_USER }); // File người khác
    await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString() }); // File workspace

    const res = await request(app).get('/api/files');
    
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].originalName).toBe('my-drive-file.pdf');
    expect(res.body.data[0].physicalFileId).toHaveProperty('minioObjectPath'); // Đảm bảo populate hoạt động
  });

  test('✅ Lấy files theo workspaceId → 200', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    await seedDocument({ workspaceId: wsId, originalName: 'ws-file.pdf' });

    const res = await request(app).get('/api/files').query({ workspaceId: wsId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].workspaceId.toString()).toBe(wsId);
  });

  test('✅ Lấy files theo folderId → 200', async () => {
    const folderId = new mongoose.Types.ObjectId().toString();
    await seedDocument({ folderId: folderId });

    const res = await request(app).get('/api/files').query({ folderId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].folderId.toString()).toBe(folderId);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(Document, 'find').mockImplementationOnce(() => { throw new Error('DB Crash'); });
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/:id', () => {
  const app = createApp();

  test('✅ Xem chi tiết My Drive file của chính mình → 200', async () => {
    const doc = await seedDocument();
    const res = await request(app).get(`/api/files/${doc._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(doc._id.toString());
  });

  test('❌ File không tồn tại → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/api/files/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('❌ Truy cập My Drive file của người khác → 403', async () => {
    const doc = await seedDocument({ uploadedBy: OTHER_USER });
    const res = await request(app).get(`/api/files/${doc._id}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/rename
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/files/:id/rename', () => {
  const app = createApp();

  test('✅ Đổi tên My Drive file thành công → 200', async () => {
    const doc = await seedDocument();

    const res = await request(app).put(`/api/files/${doc._id}/rename`).send({ name: 'Renamed.pdf' });
    
    expect(res.status).toBe(200);
    
    // Check DB thực tế
    const updated = await Document.findById(doc._id);
    expect(updated.originalName).toBe('Renamed.pdf');
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Đổi tên Workspace file (Là thành viên hợp lệ) → 200', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    const doc = await seedDocument({ workspaceId: wsId });
    
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID }] } } });

    const res = await request(app).put(`/api/files/${doc._id}/rename`).send({ name: 'WS-Renamed.pdf' });
    expect(res.status).toBe(200);
  });

  test('❌ Đổi tên Workspace file (Không phải thành viên) → 403', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    const doc = await seedDocument({ workspaceId: wsId });
    
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: OTHER_USER }] } } });

    const res = await request(app).put(`/api/files/${doc._id}/rename`).send({ name: 'WS-Renamed.pdf' });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/:id', () => {
  const app = createApp();

  test('✅ Xóa My Drive file thành công (Set deletedAt) → 200', async () => {
    const doc = await seedDocument();

    const res = await request(app).delete(`/api/files/${doc._id}`);
    expect(res.status).toBe(200);

    const checkDoc = await Document.findById(doc._id).setOptions({ includeDeleted: true });
    expect(checkDoc.deletedAt).not.toBeNull();
    expect(addJob).toHaveBeenCalled();
  });

  test('❌ Xóa Workspace file (Chỉ là MEMBER) → 403', async () => {
    const doc = await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString() });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, role: 'MEMBER' }] } } });

    const res = await request(app).delete(`/api/files/${doc._id}`);
    expect(res.status).toBe(403);
  });

  test('✅ Xóa Workspace file (Là ADMIN) → 200', async () => {
    const doc = await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString() });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, role: 'ADMIN' }] } } });

    const res = await request(app).delete(`/api/files/${doc._id}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/restore
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/files/:id/restore', () => {
  const app = createApp();

  test('✅ Khôi phục My Drive file thành công → 200', async () => {
    const doc = await seedDocument({ deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }); // Xóa 2 ngày trước

    const res = await request(app).put(`/api/files/${doc._id}/restore`);
    expect(res.status).toBe(200);

    // Dùng collection.findOne để bỏ qua filter của Mongoose
    const checkDoc = await Document.collection.findOne({ _id: doc._id });
    expect(checkDoc.deletedAt).toBeNull();
  });

  test('❌ File không nằm trong thùng rác (deletedAt = null) → 400', async () => {
    const doc = await seedDocument({ deletedAt: null });
    const res = await request(app).put(`/api/files/${doc._id}/restore`);
    expect(res.status).toBe(400);
  });

  test('❌ File bị xóa quá 10 ngày → 400', async () => {
    const doc = await seedDocument({ deletedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000) });
    const res = await request(app).put(`/api/files/${doc._id}/restore`);
    expect(res.status).toBe(400);
  });

  test('❌ Khôi phục Workspace file (Chỉ là MEMBER) → 403', async () => {
    const doc = await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString(), deletedAt: new Date() });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, role: 'MEMBER' }] } } });

    const res = await request(app).put(`/api/files/${doc._id}/restore`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/:id/link
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/:id/link', () => {
  const app = createApp();

  test('✅ Lấy link file Workspace thành công → 200', async () => {
    const doc = await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString() });
    
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: USER_ID, permissions: ['preview'] }] } } }); // Quyền WS
    axios.get.mockResolvedValueOnce({ data: { data: { url: 'https://minio/test.pdf' } } }); // Get URL

    const res = await request(app).get(`/api/files/${doc._id}/link`).query({ action: 'preview' });
    
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://minio/test.pdf');
  });

  test('❌ Storage Service lỗi → Trả về đúng status của lỗi', async () => {
    const doc = await seedDocument(); // My Drive file (không gọi Workspace)
    
    const mockError = new Error('Storage Exception');
    // 🟢 SỬA LẠI DÒNG NÀY: Đổi tên biến thành response cho khớp với code Controller bạn đã fix
    mockError.response = { status: 418, data: { msg: 'I am a teapot' } };
    axios.get.mockRejectedValueOnce(mockError);

    const res = await request(app).get(`/api/files/${doc._id}/link`);
    expect(res.status).toBe(418);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/:id/move/:targetFolderId
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/files/:id/move/:targetFolderId', () => {
  const app = createApp();

  test('✅ Move My Drive file vào Folder mới thành công → 200', async () => {
    const doc = await seedDocument();
    const targetFolder = new mongoose.Types.ObjectId().toString();

    const res = await request(app).put(`/api/files/${doc._id}/move/${targetFolder}`);
    
    expect(res.status).toBe(200);
    
    const updated = await Document.findById(doc._id);
    expect(updated.folderId.toString()).toBe(targetFolder);
  });

  test('✅ Move file ra My Drive root (target = null) → 200', async () => {
    const doc = await seedDocument({ folderId: new mongoose.Types.ObjectId().toString() });

    const res = await request(app).put(`/api/files/${doc._id}/move/null`); // chữ 'null'
    
    expect(res.status).toBe(200);
    const updated = await Document.findById(doc._id);
    expect(updated.folderId).toBeNull();
  });

  test('❌ Workspace file move bởi MEMBER → 403', async () => {
    const doc = await seedDocument({ workspaceId: new mongoose.Types.ObjectId().toString() });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, role: 'MEMBER' }] } } });

    const res = await request(app).put(`/api/files/${doc._id}/move/folder-123`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/files/trash
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/trash', () => {
  const app = createApp();

  test('✅ Lấy danh sách thùng rác My Drive cá nhân → 200', async () => {
    await seedDocument({ originalName: 'Active.pdf' }); // Sống
    await seedDocument({ originalName: 'Trashed.pdf', deletedAt: new Date() }); // Đã xóa

    // 🟢 Lưu ý: Nếu Controller của bạn dùng plugin soft-delete, nhớ thêm .setOptions({ includeDeleted: true }) vào hàm getTrashedFiles nhé!
    const res = await request(app).get('/api/files/trash');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Phải chỉ lấy ra file đã xóa
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].originalName).toBe('Trashed.pdf');
  });

  test('✅ Lấy danh sách thùng rác Workspace → 200', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    await seedDocument({ workspaceId: wsId, originalName: 'WS-Trashed.pdf', deletedAt: new Date() });
    
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: USER_ID }] } } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: wsId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].workspaceId.toString()).toBe(wsId);
  });

  test('❌ Workspace không tồn tại (Service trả 404) → 404', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    axios.get.mockResolvedValueOnce({ data: { data: null } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: wsId });
    expect(res.status).toBe(404);
  });

  test('❌ User không phải thành viên Workspace → 403', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: OTHER_USER }] } } });

    const res = await request(app).get('/api/files/trash').query({ workspaceId: wsId });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/trash/empty
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/trash/empty', () => {
  const app = createApp();

  test('✅ Thùng rác rỗng → 200 (Báo Empty)', async () => {
    const res = await request(app).delete('/api/files/trash/empty');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Trash is empty');
  });

  test('✅ Dọn thùng rác: Xóa file nhưng Physical File vẫn đang được file khác dùng → KHÔNG xóa Storage', async () => {
    // Tạo 1 Physical File chung
    const pf = await seedPhysicalFile();
    
    // File 1: Đã xóa (nằm trong thùng rác)
    const docTrashed = await Document.create({
      originalName: 'Trashed.pdf', uploadedBy: USER_ID, physicalFileId: pf._id, workspaceId: null, deletedAt: new Date()
    });
    
    // File 2: Còn sống (đang dùng chung Physical File với File 1)
    await Document.create({
      originalName: 'Clone.pdf', uploadedBy: USER_ID, physicalFileId: pf._id, workspaceId: null
    });

    const res = await request(app).delete('/api/files/trash/empty');
    
    expect(res.status).toBe(200);
    
    // Document bị xóa thật sự khỏi DB
    const checkDoc = await Document.findById(docTrashed._id).setOptions({ includeDeleted: true });
    expect(checkDoc).toBeNull();

    // Axios DELETE storage KHÔNG được gọi vì usageCount > 0
    expect(axios.delete).not.toHaveBeenCalled();

    // Physical File vẫn phải tồn tại trong DB
    const checkPf = await PhysicalFile.findById(pf._id);
    expect(checkPf).not.toBeNull();
  });

  test('✅ Dọn thùng rác: Xóa triệt để (usageCount = 0) → GỌI Storage & Xóa Physical DB', async () => {
    const pf = await seedPhysicalFile();
    const docTrashed = await Document.create({
      originalName: 'Trashed.pdf', uploadedBy: USER_ID, physicalFileId: pf._id, workspaceId: null, deletedAt: new Date()
    });

    axios.delete.mockResolvedValueOnce({}); // Mock Storage Service

    const res = await request(app).delete('/api/files/trash/empty');
    
    expect(res.status).toBe(200);
    
    // Axios DELETE storage PHẢI ĐƯỢC GỌI
    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/file'),
      expect.any(Object)
    );

    // Physical File phải bay màu khỏi DB
    const checkPf = await PhysicalFile.findById(pf._id);
    expect(checkPf).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/:id/force
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/:id/force', () => {
  const app = createApp();

  test('✅ Xóa vĩnh viễn My Drive file (usageCount = 0) → 200', async () => {
    const pf = await seedPhysicalFile();
    const doc = await Document.create({
      originalName: 'Kill-Me.pdf', uploadedBy: USER_ID, physicalFileId: pf._id, workspaceId: null, deletedAt: new Date()
    });

    axios.delete.mockResolvedValueOnce({}); 

    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(200);
    
    // DB sạch sẽ
    const checkDoc = await Document.findById(doc._id).setOptions({ includeDeleted: true });
    expect(checkDoc).toBeNull();
    const checkPf = await PhysicalFile.findById(pf._id);
    expect(checkPf).toBeNull();
  });

  test('✅ Xóa vĩnh viễn Workspace file (Bởi ADMIN) → 200', async () => {
    const pf = await seedPhysicalFile();
    const wsId = new mongoose.Types.ObjectId().toString();
    const doc = await Document.create({
      originalName: 'WS-Kill.pdf', uploadedBy: OTHER_USER, physicalFileId: pf._id, workspaceId: wsId, deletedAt: new Date()
    });

    // Trả về quyền ADMIN cho USER_ID đang gửi request
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: USER_ID, role: 'ADMIN' }] } } });
    axios.delete.mockResolvedValueOnce({});

    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(200);
  });

  test('❌ File không tồn tại → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).delete(`/api/files/${fakeId}/force`);
    expect(res.status).toBe(404);
  });

  test('❌ File chưa đưa vào thùng rác (deletedAt = null) → 400', async () => {
    const doc = await seedDocument({ deletedAt: null }); // Vẫn đang hoạt động
    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Move to trash first');
  });

  test('❌ My Drive file: Người thao tác không phải chủ sở hữu → 403', async () => {
    const doc = await seedDocument({ uploadedBy: OTHER_USER, deletedAt: new Date() });
    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(403);
  });

  test('❌ Workspace file: User chỉ là MEMBER (Không phải ADMIN) → 403', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    const doc = await seedDocument({ workspaceId: wsId, deletedAt: new Date() });
    
    axios.get.mockResolvedValueOnce({ data: { data: { members: [{ userId: USER_ID, role: 'MEMBER' }] } } });

    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(403);
  });

  test('❌ Workspace file: Workspace service sập → 500', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    const doc = await seedDocument({ workspaceId: wsId, deletedAt: new Date() });
    
    axios.get.mockRejectedValueOnce(new Error('Network Crash'));

    const res = await request(app).delete(`/api/files/${doc._id}/force`);
    expect(res.status).toBe(500);
  });
});