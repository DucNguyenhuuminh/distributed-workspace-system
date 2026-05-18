// ── 1. Mock External Services ─────────────────────────────
jest.mock('axios');

jest.mock('shared', () => {
  const { validationResult } = require('express-validator');

  return {
    addJob:              jest.fn().mockResolvedValue({ id: 'job-mock' }),
    queueForEvent:       jest.fn((e) => `queue:${e}`),
    jobIdFor:            jest.fn((e, id) => `${e}_${id}`),
    EVENTS: {
      FILE_UPLOAD:   'file.upload',
      FILE_MERGED:   'file.merged',
      FILE_TRASHED:  'file.trashed',
    },
    DEFAULT_JOB_OPTIONS: { attempts: 3 },
    verifyToken: (req, res, next) => next(), 
    validateRequest: (req, res, next) => {
      const errors = validationResult(req);
      if (!errors?.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
      }
      next();
    },
  };
});

const request    = require('supertest');
const express    = require('express');
const mongoose   = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios      = require('axios');
const { addJob } = require('shared');

// ── 2. Setup MongoDB in-memory ────────────────────────────
let mongod;

const USER_ID = new mongoose.Types.ObjectId().toString();
const VALID_WS_ID = new mongoose.Types.ObjectId().toString();
const ERROR_WS_ID = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

const Document     = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
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
  const app = createApp();
  // Khớp với controller: dùng filename
  const validPayload = { filename: 'report.pdf', hashString: 'abc-123-hash' };

  test('❌ Thiếu hashString → 400', async () => {
    const res = await request(app).post('/api/files-worker/hash').send({ filename: 'test.pdf' });
    expect(res.status).toBe(400);
  });

  test('✅ File mới (Chưa có hash trong DB) → 200 (isDuplicate: false)', async () => {
    const res = await request(app).post('/api/files-worker/hash').send(validPayload);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('File is new. Proceed to multipart upload');
    expect(res.body.data.isDuplicate).toBe(false);
  });

  test('✅ Trùng hash My Drive → Dedup thành công → 200 (isDuplicate: true)', async () => {
    const physFile = await PhysicalFile.create({
      hashString:      'abc-123-hash',
      minioObjectPath: 'file/test.pdf',
      sizeBytes:       1024,
      mimeType:        'application/pdf',
    });

    const res = await request(app).post('/api/files-worker/hash').send(validPayload);
    
    expect(res.status).toBe(200);
    expect(res.body.data.isDuplicate).toBe(true);

    const newDoc = await Document.findOne({ physicalFileId: physFile._id });
    expect(newDoc).not.toBeNull();
    expect(newDoc.uploadedBy.toString()).toBe(USER_ID);
    expect(newDoc.originalName).toBe('report.pdf');
  });

  test('✅ Trùng hash trong Workspace (Có quyền EDITOR) → 200', async () => {
    await PhysicalFile.create({
      hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'pdf'
    });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['editor'] }] } } });

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: VALID_WS_ID });
    expect(res.status).toBe(200);
  });

  test('❌ Trùng hash trong Workspace (Chỉ là VIEWER) → 403', async () => {
    await PhysicalFile.create({
      hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'pdf'
    });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['viewer'] }] } } });

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: ERROR_WS_ID });
    expect(res.status).toBe(403);
  });

  test('❌ Trùng hash nhưng User không thuộc Workspace → 403', async () => {
    await PhysicalFile.create({
      hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'pdf'
    });
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-other', permissions: ['editor'] }] } } });

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: ERROR_WS_ID });
    expect(res.status).toBe(403);
  });

  test('❌ Workspace Service API bị sập → 500', async () => {
    await PhysicalFile.create({
      hashString: 'abc-123-hash', minioObjectPath: 'file/ws.pdf', sizeBytes: 1024, mimeType: 'pdf'
    });
    axios.get.mockRejectedValue(new Error('Network Error'));

    const res = await request(app).post('/api/files-worker/hash').send({ ...validPayload, workspaceId: ERROR_WS_ID });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/init
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/init', () => {
  const app = createApp();
  // Khớp với controller: dùng filename
  const validPayload = { filename: 'test.mp4', totalChunks: 3, mimeType: 'video/mp4', sizeBytes: 5000 };

  test('✅ Init upload My Drive thành công → 201', async () => {
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-123', objectName: 'file/test.mp4', minioObjectPath: 'file/test.mp4', presignedURLs: ['url1'] } }
    });

    const res = await request(app).post('/api/files-worker/init').send(validPayload);
    
    expect(res.status).toBe(201);
    expect(res.body.data.uploadId).toBe('up-123');
    expect(res.body.data.originalName).toBe('test.mp4');
    expect(res.body.data.presignedUrls).toEqual(['url1']);
  });

  test('✅ Init upload Workspace (Có quyền EDITOR) → 201', async () => {
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['editor'] }] } } });
    axios.post.mockResolvedValue({ data: { data: { uploadId: 'up-456', objectName: 'ws.mp4', presignedURLs: [] } } });

    const res = await request(app).post('/api/files-worker/init').send({ ...validPayload, workspaceId: VALID_WS_ID });
    expect(res.status).toBe(201);
  });

  test('❌ Init upload Workspace (Chỉ có quyền VIEWER) → 403', async () => {
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: USER_ID, permissions: ['viewer'] }] } } });

    const res = await request(app).post('/api/files-worker/init').send({ ...validPayload, workspaceId: VALID_WS_ID });
    expect(res.status).toBe(403);
  });

  test('❌ Storage Service bị sập khi Init → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Service Down'));
    const res = await request(app).post('/api/files-worker/init').send(validPayload);
    
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to storage-service');
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/merge
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/files-worker/merge', () => {
  const app = createApp();
  const validPayload = {
    uploadId:        'up-123',
    etags:           [{ partNumber: 1, etag: 'etag-1' }],
    objectName:      'file/final.pdf', 
    filename:        'final.pdf',
    minioObjectPath: 'file/final.pdf', 
    totalChunks:     2,
    mimeType:        'application/pdf',
    hashString:      'unique-hash-999',
    sizeBytes:       2048,
  };

  test('✅ Merge thành công (PhysicalFile mới) → Lưu DB, đẩy Job + 200', async () => {
    axios.post.mockResolvedValue({});

    // KHÔNG CẦN MOCK Document.create nữa, test tự insert thật vào DB luôn
    const res = await request(app).post('/api/files-worker/merge').send(validPayload);

    expect(res.status).toBe(200);
    
    const physFile = await PhysicalFile.findOne({ hashString: 'unique-hash-999' });
    expect(physFile).not.toBeNull();

    const doc = await Document.findOne({ physicalFileId: physFile._id });
    expect(doc).not.toBeNull();
    expect(doc.uploadedBy.toString()).toBe(USER_ID);
    expect(doc.originalName).toBe('final.pdf');

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/storage/multipart/complete'),
      { uploadId: 'up-123', objectName: 'file/final.pdf', etags: validPayload.etags }
    );

    // 🟢 Kiểm chứng xem data đẩy vào BullMQ đã đầy đủ và lấy minioObjectPath chuẩn chưa
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      'file.merged',
      expect.objectContaining({
        originalName: 'final.pdf',
        minioObjectPath: 'file/final.pdf',
        fileId: doc._id.toString(),
        isDuplicate: false,
      }),
      expect.any(Object)
    );
  });

  test('✅ Merge khi PhysicalFile đã có sẵn (Dedup) → Không tạo trùng lặp → 200', async () => {
    await PhysicalFile.create({
      hashString:      'duplicate-hash-888',
      minioObjectPath: 'file/old.pdf',
      sizeBytes:       2048,
      mimeType:        'application/pdf',
    });

    axios.post.mockResolvedValue({});
    const res = await request(app).post('/api/files-worker/merge').send({ ...validPayload, hashString: 'duplicate-hash-888' });

    expect(res.status).toBe(200);
    const count = await PhysicalFile.countDocuments({ hashString: 'duplicate-hash-888' });
    expect(count).toBe(1); 
  });

  test('❌ Storage Service báo lỗi Merge → 500 + DB không bị rác', async () => {
    axios.post.mockRejectedValue(new Error('Storage Merge Error'));
    const res = await request(app).post('/api/files-worker/merge').send(validPayload);

    expect(res.status).toBe(500);
    const count = await Document.countDocuments({});
    expect(count).toBe(0);
  });

  test('❌ DB lỗi khi lưu Document → 500', async () => {
    axios.post.mockResolvedValue({});
    
    const createSpy = jest.spyOn(Document, 'create').mockRejectedValueOnce(new Error('DB Timeout'));

    try {
      const res = await request(app).post('/api/files-worker/merge').send(validPayload);
      expect(res.status).toBe(500);
    } finally {
      createSpy.mockRestore();
    }
  });

  test('✅ BullMQ lỗi đẩy Queue → Vẫn trả về 200 (Vì user đã upload xong file)', async () => {
    axios.post.mockResolvedValue({});
    addJob.mockRejectedValueOnce(new Error('Queue Error'));

    const res = await request(app)
      .post('/api/files-worker/merge')
      .send({ ...validPayload, hashString: 'bullmq-test-hash', filename: 'bullmq.pdf' });

    expect(res.status).toBe(200);
    const count = await Document.countDocuments({ originalName: 'bullmq.pdf' });
    expect(count).toBe(1);
  });
});