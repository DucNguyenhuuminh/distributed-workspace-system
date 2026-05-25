const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');

// Import Model và Controller
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
const ShareLink = require('../../src/models/share.model');
const shareController = require('../../src/controllers/share.controller');

// ── 1. Mock Axios ─────────────────────────────────────────────
jest.mock('axios', () => ({
    get: jest.fn(),
    post: jest.fn(),
}));

// ── 2. Mock Environment Variables ─────────────────────────
process.env.WORKSPACE_SERVICE_URL = 'http://localhost:3003';
process.env.STORAGE_SERVICE_URL = 'http://localhost:3005';
process.env.FRONTEND_URL = 'http://localhost:3000';

let mongod;
let app;

// ── 3. Setup App ──────────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());
  
  // Middleware giả lập Auth
  app.use((req, res, next) => {
    req.user = { userId: req.headers['x-user-id'] || 'user-1' };
    req.headers.authorization = 'Bearer mock-token';
    req.headers.authentication = 'Bearer mock-token';
    next();
  });

  app.post('/api/files/:id/share', shareController.createShareLink);
  app.get('/api/files/share/:token', shareController.getSharedFile);
  app.post('/api/files/share/:token/verify', shareController.verifySharePassword);
  app.post('/api/files/share/:token/access', shareController.accessSharedFile);
  app.post('/api/files/share/:token/save', shareController.saveShareFile);
  app.delete('/api/files/:id/share/:token', shareController.revokeShareLink);
  app.get('/api/files/:id/share', shareController.getShareLinks);

  return app;
}

// ── 4. Helper: Mock workspace lookup ─────────────────────────
function mockWorkspaceService() {
  axios.get.mockImplementation((url) => {
    if (url.includes('/api/workspaces/internal/')) {
      return Promise.resolve({
        data: {
          data: {
            _id: 'workspace-id',
            members: [
              { userId: 'user-1', role: 'ADMIN' }
            ]
          }
        }
      });
    }
    if (url.includes('/api/storage/file/url')) {
      return Promise.resolve({
        data: { data: { url: 'https://minio.url/file' } }
      });
    }
    return Promise.reject(new Error('Unknown URL'));
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

afterEach(async () => {
  await Document.deleteMany({});
  await ShareLink.deleteMany({});
  await PhysicalFile.deleteMany({});
  jest.clearAllMocks();
  axios.get.mockReset();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

// ═══════════════════════════════════════════════════════════
// CÁC TEST CASES - ĐÃ SỬA
// ═══════════════════════════════════════════════════════════

describe('[Integration] ShareLink API', () => {

  // ===== FIX 1: Thêm hashString vào PhysicalFile =====
  test('✅ POST /api/files/:id/share: Tạo link thành công', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    
    // ✅ THÊM: hashString bắt buộc
    const physicalFile = await PhysicalFile.create({
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      minioObjectPath: 'test/test.pdf',
      uploadedBy: ownerId,
      hashString: 'abc123def456' // ✅ THÊM TRƯỜNG BẮT BUỘC
    });

    const doc = await Document.create({ 
      originalName: 'test.pdf', 
      uploadedBy: ownerId,
      physicalFileId: physicalFile._id // ✅ Dùng _id thực
    });

    const res = await request(app)
      .post(`/api/files/${doc._id}/share`)
      .set('x-user-id', ownerId.toString())
      .send({ permissions: ['view'] });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeDefined();
  });

  test('✅ GET /api/files/share/:token: Validate link thành công', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    
    // ✅ THÊM: hashString
    const physicalFile = await PhysicalFile.create({
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      minioObjectPath: 'test/test.pdf',
      hashString: 'hash123'
    });

    const doc = await Document.create({ 
      originalName: 'test.pdf', 
      uploadedBy: ownerId,
      physicalFileId: physicalFile._id
    });

    // ✅ FIX 2: Dùng ObjectId cho createdBy thay vì String
    const share = await ShareLink.create({ 
      fileId: doc._id, 
      createdBy: new mongoose.Types.ObjectId(), // ✅ ObjectId thay vì String
      permissions: ['view'],
      fileName: 'test.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf'
    });

    const res = await request(app).get(`/api/files/share/${share.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toContain('view');
  });

  test('❌ GET /api/files/share/:token: Link hết hạn → 403', async () => {
    const pastDate = new Date(Date.now() - 3600000);
    const share = await ShareLink.create({ 
      fileId: new mongoose.Types.ObjectId(), 
      createdBy: new mongoose.Types.ObjectId(), // ✅ ObjectId
      expiredAt: pastDate,
      fileName: 'test.pdf'
    });

    const res = await request(app).get(`/api/files/share/${share.token}`);
    expect(res.status).toBe(403);
  });

  // ✅ FIX 3: Dùng ObjectId cho createdBy và hashString
  test('✅ POST /api/files/share/:token/verify: Xác thực mật khẩu đúng → 200', async () => {
    const share = await ShareLink.create({ 
      fileId: new mongoose.Types.ObjectId(), 
      createdBy: new mongoose.Types.ObjectId(), // ✅ ObjectId
      password: 'myPassword123',
      fileName: 'test.pdf'
    });

    const res = await request(app)
      .post(`/api/files/share/${share.token}/verify`)
      .send({ password: 'myPassword123' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  test('✅ POST /api/files/share/:token/access: Lấy presigned URL thành công', async () => {
    mockWorkspaceService();

    const ownerId = new mongoose.Types.ObjectId();
    
    // ✅ THÊM: hashString
    const physicalFile = await PhysicalFile.create({
      sizeBytes: 2048,
      mimeType: 'application/pdf',
      minioObjectPath: 'test/data.pdf',
      uploadedBy: ownerId,
      hashString: 'hash456abc'
    });

    const doc = await Document.create({ 
      originalName: 'data.pdf', 
      uploadedBy: ownerId,
      physicalFileId: physicalFile._id
    });

    const share = await ShareLink.create({ 
      fileId: doc._id, 
      createdBy: ownerId, // ✅ ObjectId
      permissions: ['view', 'download'],
      fileName: 'data.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf'
    });

    const res = await request(app)
      .post(`/api/files/share/${share.token}/access`)
      .set('x-user-id', 'guest-user')
      .send({ action: 'view' });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://minio.url/file');
  });

  test('✅ POST /api/files/share/:token/save: Lưu file vào không gian cá nhân → 201', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    
    // ✅ THÊM: hashString
    const physicalFile = await PhysicalFile.create({
      sizeBytes: 3000,
      mimeType: 'application/pdf',
      minioObjectPath: 'owner/shared.pdf',
      hashString: 'hash789xyz'
    });

    const doc = await Document.create({ 
      originalName: 'shared.pdf', 
      uploadedBy: ownerId,
      physicalFileId: physicalFile._id
    });

    const share = await ShareLink.create({ 
      fileId: doc._id, 
      createdBy: ownerId, // ✅ ObjectId
      permissions: ['save', 'view'],
      fileName: 'shared.pdf',
      fileSize: 3000,
      mimeType: 'application/pdf'
    });

    const newUser = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post(`/api/files/share/${share.token}/save`)
      .set('x-user-id', newUser)
      .send({ folderId: null });

    expect(res.status).toBe(201);
    
    const savedDoc = await Document.findOne({ uploadedBy: newUser });
    expect(savedDoc).not.toBeNull();
  });

  test('✅ DELETE /api/files/:id/share/:token: Revoke link thành công → 200', async () => {
    const creatorId = new mongoose.Types.ObjectId();
    const share = await ShareLink.create({ 
      fileId: new mongoose.Types.ObjectId(), 
      createdBy: creatorId, // ✅ ObjectId
      fileName: 'test.pdf'
    });

    const res = await request(app)
      .delete(`/api/files/${share.fileId}/share/${share.token}`)
      .set('x-user-id', creatorId.toString());

    expect(res.status).toBe(200);
    const updatedShare = await ShareLink.findById(share._id);
    expect(updatedShare.isRevoked).toBe(true);
  });

  test('❌ DELETE /api/files/:id/share/:token: Người lạ revoke → 403', async () => {
    const creatorId = new mongoose.Types.ObjectId();
    const share = await ShareLink.create({ 
      fileId: new mongoose.Types.ObjectId(), 
      createdBy: creatorId, // ✅ ObjectId
      fileName: 'test.pdf'
    });

    const res = await request(app)
      .delete(`/api/files/${share.fileId}/share/${share.token}`)
      .set('x-user-id', 'wrong-user-id');

    expect(res.status).toBe(403);
  });
});