// ── 1. Mock External Services ─────────────────────────────
jest.mock('axios');

jest.mock('shared', () => ({
  addJob:              jest.fn().mockResolvedValue({ id: 'job-mock' }),
  queueForEvent:       jest.fn((e) => `queue:${e}`),
  jobIdFor:            jest.fn((e, id) => `${e}_${id}`), // ← dùng _ thay vì :
  // ← EVENTS phải có đầy đủ giá trị
  EVENTS: {
    FILE_UPLOAD:  'file.upload',
    FILE_MERGED:  'file.merged',
    FILE_TRASHED: 'file.trashed',
    FILE_RESTORED:'file.restored',
    FILE_MOVED:   'file.moved',
    FILE_RENAMED: 'file.renamed',
  },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  verifyToken: (req, res, next) => {
    req.user = { userId: 'user-001' };
    next();
  },
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

// ← Dùng ObjectId hợp lệ cho workspaceId trong test
const VALID_WORKSPACE_ID = new mongoose.Types.ObjectId().toString();
const VALID_FOLDER_ID    = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  jest.spyOn(console, 'error').mockImplementation(() => {});
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
  console.error.mockRestore?.();
});

// Import models thật
const Document     = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');

// Import router thật SAU KHI mock
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

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/hash
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/hash', () => {
  const app          = createApp();
  const validPayload = { filename: 'report.pdf', hashString: 'abc-123-hash' };

  // ── Validator cases ───────────────────────────────────
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

  // ── My Drive cases ────────────────────────────────────
  test('✅ File mới (chưa có hash trong DB) → 404', async () => {
    const res = await request(app)
      .post('/api/files-worker/hash')
      .send(validPayload);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('File is new. Proceed to multipart upload');
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
    expect(res.body.message).toContain('Deduplication successful');
    expect(res.body.data.isDuplicate).toBe(true);

    // Kiểm tra Document được tạo
    const newDoc = await Document.findOne({ physicalFileId: physFile._id });
    expect(newDoc).not.toBeNull();
    expect(newDoc.originalName).toBe('report.pdf');
    expect(newDoc.uploadedBy.toString()).toBe(USER_ID);

    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Trùng hash My Drive + folderId → Document lưu đúng folderId', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/test.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, folderId: VALID_FOLDER_ID });

    expect(res.status).toBe(200);

    const newDoc = await Document.findOne({ folderId: VALID_FOLDER_ID });
    expect(newDoc).not.toBeNull();
  });

  // ── Workspace cases ───────────────────────────────────
  test('✅ Trùng hash Workspace (có quyền editor) → 200', async () => {
    const physFile = await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    // ← dùng VALID_WORKSPACE_ID (ObjectId hợp lệ)
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{
            userId:      USER_ID,
            role:        'MEMBER',
            permissions: ['editor'],
          }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.isDuplicate).toBe(true);

    const newDoc = await Document.findOne({ workspaceId: VALID_WORKSPACE_ID });
    expect(newDoc).not.toBeNull();
  });

  test('✅ Trùng hash Workspace (role ADMIN) → 200', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{
            userId:      USER_ID,
            role:        'ADMIN',
            permissions: [],
          }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(200);
  });

  test('❌ Trùng hash Workspace (chỉ viewer) → 403', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, role: 'MEMBER', permissions: ['viewer'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No permission');
  });

  test('❌ Trùng hash Workspace (không phải member) → 403', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: 'other-user', role: 'ADMIN', permissions: ['editor'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(403);
  });

  test('❌ Workspace API trả 403 → 403', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/ws.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const err    = new Error('Forbidden');
    err.response = { status: 403 };
    axios.get.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

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
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(500);
  });

  test('✅ BullMQ lỗi khi dedup → vẫn trả 200', async () => {
    await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/test.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    addJob.mockRejectedValueOnce(new Error('Queue down'));

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send(validPayload);

    expect(res.status).toBe(200); // BullMQ lỗi không ảnh hưởng response
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

  const storageResponse = {
    data: {
      data: {
        uploadId:     'up-minio-123',
        objectName:   'file/test.mp4',
        presignedURLs: ['url1', 'url2', 'url3'],
      },
    },
  };

  // ── Validator cases ───────────────────────────────────
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

  test('❌ totalChunks = 0 → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, totalChunks: 0 });

    expect(res.status).toBe(400);
  });

  // ── My Drive cases ────────────────────────────────────
  test('✅ Init upload My Drive thành công → 201', async () => {
    axios.post.mockResolvedValue(storageResponse);

    const res = await request(app)
      .post('/api/files-worker/init')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.uploadId).toBe('up-minio-123');
    expect(res.body.data.objectName).toBe('file/test.mp4');
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      'file.upload',
      expect.objectContaining({
        filename:   'test.mp4',
        uploadedBy: USER_ID,
      }),
      expect.any(Object)
    );
  });

  test('✅ Init upload My Drive + folderId → 201', async () => {
    axios.post.mockResolvedValue(storageResponse);

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, folderId: VALID_FOLDER_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.meta.folderId).toBe(VALID_FOLDER_ID);
  });

  // ── Workspace cases ───────────────────────────────────
  test('✅ Init upload Workspace thành công (editor) → 201', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, role: 'MEMBER', permissions: ['editor'] }],
        },
      },
    });
    axios.post.mockResolvedValue(storageResponse);

    const res = await request(app)
      .post('/api/files-worker/init')
      // ← dùng VALID_WORKSPACE_ID
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(201);
  });

  test('✅ Init upload Workspace thành công (ADMIN) → 201', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, role: 'ADMIN', permissions: [] }],
        },
      },
    });
    axios.post.mockResolvedValue(storageResponse);

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(201);
  });

  test('❌ Init upload Workspace (không phải member) → 403', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: 'other-user', role: 'ADMIN', permissions: ['editor'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled(); // không gọi storage
  });

  test('❌ Init upload Workspace (chỉ viewer) → 403', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: {
          members: [{ userId: USER_ID, role: 'MEMBER', permissions: ['viewer'] }],
        },
      },
    });

    const res = await request(app)
      .post('/api/files-worker/init')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

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

  test('✅ BullMQ lỗi → vẫn trả 201', async () => {
    axios.post.mockResolvedValue(storageResponse);
    addJob.mockRejectedValueOnce(new Error('Queue down'));

    const res = await request(app)
      .post('/api/files-worker/init')
      .send(validPayload);

    expect(res.status).toBe(201);
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

  // ── Validator cases ───────────────────────────────────
  test('❌ Thiếu uploadId → 400', async () => {
    const { uploadId, ...noUploadId } = validPayload;
    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(noUploadId);

    expect(res.status).toBe(400);
  });

  test('❌ Thiếu objectName → 400', async () => {
    const { objectName, ...noObjectName } = validPayload;
    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(noObjectName);

    expect(res.status).toBe(400);
  });

  test('❌ etags rỗng → 400', async () => {
    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, etags: [] });

    expect(res.status).toBe(400);
  });

  // ── Success cases ─────────────────────────────────────
  test('✅ Merge thành công (PhysicalFile mới) → Lưu DB + 200', async () => {
    axios.post.mockResolvedValue({});

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('merged');

    // Kiểm tra PhysicalFile được tạo
    const physFile = await PhysicalFile.findOne({ hashString: 'unique-hash-999' });
    expect(physFile).not.toBeNull();
    expect(physFile.sizeBytes).toBe(2048);
    expect(physFile.minioObjectPath).toBe('file/final.pdf');

    // Kiểm tra Document được tạo
    const doc = await Document.findOne({ physicalFileId: physFile._id });
    expect(doc).not.toBeNull();
    expect(doc.originalName).toBe('final.pdf');
    expect(doc.uploadedBy.toString()).toBe(USER_ID);

    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      'file.merged',
      expect.objectContaining({ filename: 'final.pdf' }),
      expect.any(Object)
    );
  });

  test('✅ Merge khi PhysicalFile đã có sẵn (dedup) → Không tạo thêm → 200', async () => {
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

    // Không tạo thêm PhysicalFile
    const count = await PhysicalFile.countDocuments({ hashString: 'duplicate-hash-888' });
    expect(count).toBe(1);

    // Document trỏ tới file cũ
    const doc = await Document.findOne({ physicalFileId: existingPhys._id });
    expect(doc).not.toBeNull();
    expect(doc.originalName).toBe('final.pdf');
  });

  test('✅ Merge vào Workspace → Document lưu đúng workspaceId', async () => {
    axios.post.mockResolvedValue({});

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, workspaceId: VALID_WORKSPACE_ID });

    expect(res.status).toBe(200);

    const doc = await Document.findOne({ workspaceId: VALID_WORKSPACE_ID });
    expect(doc).not.toBeNull();
  });

  // ── Failure cases ─────────────────────────────────────
  test('❌ Storage Service merge lỗi → 500 + DB không có dữ liệu rác', async () => {
    axios.post.mockRejectedValue(new Error('Storage Merge Error'));

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send(validPayload);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to merge chunks in storage-service');

    // DB không có dữ liệu rác
    const docCount  = await Document.countDocuments({});
    const physCount = await PhysicalFile.countDocuments({});
    expect(docCount).toBe(0);
    expect(physCount).toBe(0);
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

  test('✅ BullMQ lỗi → vẫn trả 200', async () => {
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