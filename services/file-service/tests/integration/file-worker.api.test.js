// ── 1. Mock External Services ─────────────────────────────────
jest.mock('axios');
jest.mock('shared', () => ({
  addJob: jest.fn().mockResolvedValue({ id: 'job-mock' }),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  EVENTS: {
    FILE_UPLOAD: 'file.upload',
    FILE_MERGED: 'file.merged',
  },
  DEFAULT_JOB_OPTIONS: { attempts: 3 }
}));

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { addJob } = require('shared');

const workerController = require('../../src/controllers/file-worker.controller');
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

// Định nghĩa ID chuẩn của MongoDB để không bị lỗi Cast to ObjectId
const USER_ID = new mongoose.Types.ObjectId().toString();

// ── 2. Cài đặt App giả lập ────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Giả lập Auth Middleware
  app.use((req, res, next) => {
    req.user = { userId: USER_ID };
    req.headers.authorization = 'Bearer test-token';
    next();
  });

  app.post('/api/files-worker/hash', workerController.checkHash);
  app.post('/api/files-worker/init', workerController.initUpload);
  app.post('/api/files-worker/merge', workerController.mergeUpload);

  return app;
}

beforeAll(async () => {
  await connectTestDB();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeTestDB();
  console.error.mockRestore();
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/hash (checkHash)
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/hash', () => {
  const app = createApp();
  const validPayload = { filename: 'report.pdf', hashString: 'abc-123-hash' };

  test('❌ Thiếu hashString → 400', async () => {
    const res = await request(app).post('/api/files-worker/hash').send({ filename: 'test.pdf' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Hash string is required');
  });

  test('✅ File mới tinh (DB chưa có hash) → 404 để tiếp tục Upload Multipart', async () => {
    const res = await request(app).post('/api/files-worker/hash').send(validPayload);
    
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('File is new. Proceed to multipart upload');
    expect(res.body.data.isDuplicate).toBe(false);
  });

  test('✅ Trùng hash (My Drive) → Copy tức thì (Tạo Document mới) → 200', async () => {
    // 1. Gieo dữ liệu: Đã có 1 physical file mang hash này
    const physFile = await PhysicalFile.create({
      hashString: 'abc-123-hash',
      minioObjectPath: 'file/test.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf'
    });

    // 2. Bắn API
    const res = await request(app).post('/api/files-worker/hash').send(validPayload);

    // 3. Kiểm tra response
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Deduplication successful');
    expect(res.body.data.isDuplicate).toBe(true);

    // 4. Kiểm tra Database: Chắc chắn Document đã được tạo trỏ tới physicalFile này
    const newDoc = await Document.findOne({ physicalFileId: physFile._id });
    expect(newDoc).not.toBeNull();
    expect(newDoc.originalName).toBe('report.pdf');
    expect(newDoc.uploadedBy.toString()).toBe(USER_ID);
    
    // 5. Kiểm tra BullMQ đã được enqueue
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Trùng hash trong Workspace (Có quyền upload) → 200', async () => {
    await PhysicalFile.create({ hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'application/pdf' });
    const wsId = new mongoose.Types.ObjectId().toString();

    // Giả lập Axios gọi Workspace Service trả về User có quyền 'upload'
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: USER_ID, permissions: ['upload'] }] } }
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: wsId });

    expect(res.status).toBe(200);
    
    // Kiểm tra DB xem Document có lưu đúng workspaceId không
    const newDoc = await Document.findOne({ workspaceId: wsId });
    expect(newDoc).not.toBeNull();
  });

  test('❌ Trùng hash trong Workspace (Không có quyền upload) → 403', async () => {
    await PhysicalFile.create({ hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'application/pdf' });
    
    // Giả lập User chỉ có quyền 'viewer'
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: USER_ID, permissions: ['viewer'] }] } }
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: 'ws-999' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No permission');
  });

  test('❌ Gọi API Workspace lỗi 403 → 403', async () => {
    await PhysicalFile.create({ hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'application/pdf' });
    
    const err = new Error('Forbidden');
    err.response = { status: 403 };
    axios.get.mockRejectedValue(err);

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: 'ws-999' });
    expect(res.status).toBe(403);
  });

  test('❌ API Workspace bị sập → 500', async () => {
    await PhysicalFile.create({ hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'application/pdf' });
    axios.get.mockRejectedValue(new Error('Network Error'));

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: 'ws-999' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/init (initUpload)
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/init', () => {
  const app = createApp();
  const validPayload = { filename: 'test.mp4', totalChunks: 3, mimeType: 'video/mp4', sizeBytes: 5000 };

  test('✅ Khởi tạo upload My Drive thành công → 201', async () => {
    // Giả lập Storage Service init thành công
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-minio-123', objectName: 'file/test.mp4', presignedUrls: ['url1', 'url2'] } }
    });

    const res = await request(app).post('/api/files-worker/init').send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.uploadId).toBe('up-minio-123');
    // Kiểm tra đã đẩy job vào queue
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      'file.upload',
      expect.objectContaining({ filename: 'test.mp4', uploadedBy: USER_ID }),
      expect.any(Object)
    );
  });

  test('✅ Khởi tạo upload Workspace thành công (Có quyền) → 201', async () => {
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['upload'] }] } } });
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-minio-456', objectName: 'file/ws.mp4', presignedUrls: [] } }
    });

    const res = await request(app).post('/api/files-worker/init').send({ ...validPayload, workspaceId: 'ws-1' });
    expect(res.status).toBe(201);
  });

  test('❌ Init upload Workspace thất bại (Không có quyền) → 403', async () => {
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['viewer'] }] } } });

    const res = await request(app).post('/api/files-worker/init').send({ ...validPayload, workspaceId: 'ws-1' });
    expect(res.status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled(); // Không gọi sang Storage Service
  });

  test('❌ Storage Service bị sập khi Init → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Service Down'));

    const res = await request(app).post('/api/files-worker/init').send(validPayload);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to storage-service');
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/merge (mergeUpload)
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/merge', () => {
  const app = createApp();
  const validPayload = {
    uploadId: 'up-123', etags: [], objectName: 'file/final.pdf', filename: 'final.pdf',
    totalChunks: 2, mimeType: 'application/pdf', hashString: 'unique-hash-999', sizeBytes: 2048
  };

  test('✅ Merge thành công (Physical File mới tinh) → Lưu DB + Trả 200', async () => {
    // 1. Giả lập Storage merge thành công
    axios.post.mockResolvedValue({}); 

    // 2. Bắn API
    const res = await request(app).post('/api/files-worker/merge').send(validPayload);
    expect(res.status).toBe(200);

    // 3. Kiểm tra DB xem PhysicalFile có được tạo mới chưa
    const physFile = await PhysicalFile.findOne({ hashString: 'unique-hash-999' });
    expect(physFile).not.toBeNull();
    expect(physFile.sizeBytes).toBe(2048);

    // 4. Kiểm tra DB xem Document có được tạo và liên kết tới PhysicalFile chưa
    const doc = await Document.findOne({ physicalFileId: physFile._id });
    expect(doc).not.toBeNull();
    expect(doc.originalName).toBe('final.pdf');
    expect(doc.uploadedBy.toString()).toBe(USER_ID);

    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Merge thành công (Đã có sẵn Physical File do lúc upload bị gián đoạn) → 200', async () => {
    // Tạo sẵn physical file dưới DB
    const existingPhys = await PhysicalFile.create({
      hashString: 'duplicate-hash-888',
      minioObjectPath: 'file/old.pdf',
      sizeBytes: 2048,
      mimeType: 'application/pdf'
    });
    
    axios.post.mockResolvedValue({}); 

    const res = await request(app).post('/api/files-worker/merge').send({
      ...validPayload, hashString: 'duplicate-hash-888'
    });

    expect(res.status).toBe(200);

    // Đảm bảo không tạo thêm PhysicalFile rác nào khác
    const count = await PhysicalFile.countDocuments({ hashString: 'duplicate-hash-888' });
    expect(count).toBe(1);

    // Document vẫn phải được tạo và trỏ tới file cũ
    const doc = await Document.findOne({ physicalFileId: existingPhys._id });
    expect(doc).not.toBeNull();
  });

  test('❌ Storage Service ghép chunk thất bại → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Merge Error'));

    const res = await request(app).post('/api/files-worker/merge').send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to merge chunks in storage-service');
    
    // Đảm bảo DB không bị lưu dữ liệu rác nếu storage lỗi
    const count = await Document.countDocuments({});
    expect(count).toBe(0);
  });

  test('❌ Database bị sập giữa chừng khi lưu Document → 500', async () => {
    axios.post.mockResolvedValue({}); 
    // Giả lập Mongoose lỗi
    jest.spyOn(Document, 'create').mockRejectedValueOnce(new Error('DB Timeout'));

    const res = await request(app).post('/api/files-worker/merge').send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Timeout');
  });

  test('✅ Merge và lưu DB thành công dù BullMQ bị lỗi → Vẫn trả 200', async () => {
    axios.post.mockResolvedValue({}); 
    addJob.mockRejectedValueOnce(new Error('Queue Error')); // Giả lập redis sập

    const payload = { ...validPayload, hashString: 'bullmq-test-hash' };
    const res = await request(app).post('/api/files-worker/merge').send(payload);

    // Vì lỗi queue nằm trong khối try-catch riêng biệt, nó chỉ log ra console và vẫn trả về 200 cho client
    expect(res.status).toBe(200);
    const count = await Document.countDocuments({ originalName: 'final.pdf' });
    expect(count).toBe(1);
  });
});