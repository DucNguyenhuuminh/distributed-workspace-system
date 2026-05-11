// ── 1. Mock External Services ─────────────────────────────
jest.mock('axios');

jest.mock('shared', () => ({
  addJob:              jest.fn().mockResolvedValue({ id: 'job-mock' }),
  queueForEvent:       jest.fn((e) => `queue:${e}`),
  jobIdFor:            jest.fn((e, id) => `${e}_${id}`),
  EVENTS: {
    FILE_UPLOAD:   'file.upload',
    FILE_MERGED:   'file.merged',
    FILE_TRASHED:  'file.trashed',
  },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  verifyToken: (req, res, next) => {
    req.user = { userId: 'user-001' };
    next();
  },
  // ← validateRequest phải có để routes không bị undefined
  validateRequest: (req, res, next) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: errors.array()[0].msg,
        errors:  errors.array(),
      });
    }
    next();
  },
}));

const request    = require('supertest');
const express    = require('express');
const mongoose   = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios      = require('axios');
const { addJob } = require('shared');

// ── 2. Setup MongoDB in-memory ────────────────────────────
let mongod;
const USER_ID = 'user-001';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

// Import models thật — dùng MongoDB in-memory
const Document     = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');

// Import router thật SAU KHI mock shared
const fileWorkerRoutes = require('../../src/routes/file-worker.routes');

// ── 3. Tạo app ────────────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.user                  = { userId: USER_ID };
    req.headers.authorization = 'Bearer test-token';
    next();
  });

  app.use('/api/files-worker', fileWorkerRoutes);
  return app;
}

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => console.error.mockRestore?.());

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/hash
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/hash', () => {
  const app          = createApp();
  const validPayload = { filename: 'report.pdf', hashString: 'abc-123-hash' };

  test('❌ Thiếu hashString → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  test('❌ Thiếu filename → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ hashString: 'abc-123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  test('✅ File mới (chưa có hash trong DB) → 404', async () => {
    const res = await request(app)
      .post('/api/files-worker/hash')
      .send(validPayload);

    expect(res.status).toBe(404);
    expect(res.body.data.isDuplicate).toBe(false);
  });

  test('✅ Trùng hash My Drive → Dedup thành công → 200', async () => {
    const physFile = await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/test.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.data.isDuplicate).toBe(true);

    // Kiểm tra Document được tạo trỏ tới physicalFile
    const newDoc = await Document.findOne({ physicalFileId: physFile._id });
    expect(newDoc).not.toBeNull();
    expect(newDoc.originalName).toBe('report.pdf');
    expect(newDoc.uploadedBy.toString()).toBe(USER_ID);

    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Trùng hash trong Workspace (có quyền editor) → 200', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const wsId = new mongoose.Types.ObjectId().toString();

    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{
            userId:      USER_ID,
            permissions: ['editor'],
          }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: wsId });

    expect(res.status).toBe(200);

    const newDoc = await Document.findOne({ workspaceId: wsId });
    expect(newDoc).not.toBeNull();
  });

  test('❌ Trùng hash trong Workspace (chỉ viewer) → 403', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, permissions: ['viewer'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: 'ws-999' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No permission');
  });

  test('❌ Workspace API trả 403 → 403', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const err      = new Error('Forbidden');
    err.response   = { status: 403 };
    axios.get.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: 'ws-999' });

    expect(res.status).toBe(403);
  });

  test('❌ Workspace API bị sập → 500', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    axios.get.mockRejectedValue(new Error('Network Error'));

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: 'ws-999' });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/init
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/init', () => {
  const app          = createApp();
  const validPayload = {
    filename:    'test.mp4',
    totalChunks: 3,
    mimeType:    'video/mp4',
    sizeBytes:   5000,
  };

  test('❌ Thiếu filename → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ totalChunks: 3, mimeType: 'video/mp4', sizeBytes: 5000 });

    expect(res.status).toBe(400);
  });

  test('❌ Thiếu totalChunks → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ filename: 'test.mp4', mimeType: 'video/mp4', sizeBytes: 5000 });

    expect(res.status).toBe(400);
  });

  test('✅ Init upload My Drive thành công → 201', async () => {
    axios.post.mockResolvedValue({
      data: {
        data: {
          uploadId:      'up-minio-123',
          objectName:    'file/test.mp4',
          presignedUrls: ['url1', 'url2', 'url3'],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/init')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.uploadId).toBe('up-minio-123');
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ filename: 'test.mp4' }),
      expect.any(Object)
    );
  });

  test('✅ Init upload Workspace thành công (có quyền editor) → 201', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, permissions: ['editor'] }],
        },
      },
    });

    axios.post.mockResolvedValue({
      data: {
        data: {
          uploadId:      'up-minio-456',
          objectName:    'file/ws.mp4',
          presignedUrls: [],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, workspaceId: 'ws-1' });

    expect(res.status).toBe(201);
  });

  test('❌ Init upload Workspace (không có quyền) → 403', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, permissions: ['viewer'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, workspaceId: 'ws-1' });

    expect(res.status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('❌ Storage Service bị sập → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Service Down'));

    const res = await request(app)
      .post('/api/files-worker/init')
      .send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to storage-service');
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/merge
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/merge', () => {
  const app          = createApp();
  const validPayload = {
    uploadId:    'up-123',
    etags:       [{ partNumber: 1, etag: 'etag-1' }, { partNumber: 2, etag: 'etag-2' }],
    objectName:  'file/final.pdf',
    filename:    'final.pdf',
    totalChunks: 2,
    mimeType:    'application/pdf',
    hashString:  'unique-hash-999',
    sizeBytes:   2048,
  };

  test('❌ Thiếu uploadId → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, uploadId: undefined });

    expect(res.status).toBe(400);
  });

  test('✅ Merge thành công (PhysicalFile mới) → Lưu DB + 200', async () => {
    axios.post.mockResolvedValue({});

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(validPayload);

    expect(res.status).toBe(200);

    // Kiểm tra PhysicalFile được tạo
    const physFile = await PhysicalFile.findOne({ hashString: 'unique-hash-999' });
    expect(physFile).not.toBeNull();
    expect(physFile.sizeBytes).toBe(2048);

    // Kiểm tra Document được tạo và liên kết
    const doc = await Document.findOne({ physicalFileId: physFile._id });
    expect(doc).not.toBeNull();
    expect(doc.originalName).toBe('final.pdf');
    expect(doc.uploadedBy.toString()).toBe(USER_ID);

    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Merge khi PhysicalFile đã có sẵn (dedup) → Không tạo thêm PhysicalFile → 200', async () => {
    const existingPhys = await PhysicalFile.create({
      hashString:      'duplicate-hash-888',
      minioObjectPath: 'file/old.pdf',
      sizeBytes:       2048,
      mimeType:        'application/pdf',
    });

    axios.post.mockResolvedValue({});

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, hashString: 'duplicate-hash-888' });

    expect(res.status).toBe(200);

    // Đảm bảo không tạo thêm PhysicalFile
    const count = await PhysicalFile.countDocuments({ hashString: 'duplicate-hash-888' });
    expect(count).toBe(1);

    // Document vẫn được tạo trỏ tới file cũ
    const doc = await Document.findOne({ physicalFileId: existingPhys._id });
    expect(doc).not.toBeNull();
  });

  test('❌ Storage Service merge lỗi → 500 + DB không có dữ liệu rác', async () => {
    axios.post.mockRejectedValue(new Error('Storage Merge Error'));

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to merge chunks in storage-service');

    // DB không có dữ liệu rác
    const count = await Document.countDocuments({});
    expect(count).toBe(0);
  });

  test('❌ DB lỗi khi lưu Document → 500', async () => {
    axios.post.mockResolvedValue({});
    jest.spyOn(Document, 'create').mockRejectedValueOnce(new Error('DB Timeout'));

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Timeout');
  });

  test('✅ BullMQ lỗi → vẫn trả 200 (không ảnh hưởng response)', async () => {
    axios.post.mockResolvedValue({});
    addJob.mockRejectedValueOnce(new Error('Queue Error'));

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, hashString: 'bullmq-test-hash' });

    expect(res.status).toBe(200);

    const count = await Document.countDocuments({ originalName: 'final.pdf' });
    expect(count).toBe(1);
  });
});