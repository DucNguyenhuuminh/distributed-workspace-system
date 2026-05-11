// ── 1. Import Mocks trước khi require Controller ──────────────
jest.mock('axios', () => require('./mocks/axios.mock'));
jest.mock('shared', () => {
  let sharedMock = {};
  try {
    sharedMock = require('./mocks/shared.mock');
  } catch (e) {}

  return {
    ...sharedMock,
    addJob: jest.fn().mockResolvedValue({ id: 'job-mock' }),
    queueForEvent: jest.fn((e) => `queue:${e}`),
    jobIdFor: jest.fn((e, id) => `${e}:${id}`),
    EVENTS: {},
    DEFAULT_JOB_OPTIONS: { attempts: 3 },
    // Middleware giả lập cho Express
    verifyToken: (req, res, next) => {
      if (!req.user) req.user = { userId: 'user-001' };
      next();
    },
    validateRequest: (req, res, next) => next(),
  };
});

jest.mock('../../src/models/documents.model', () => require('./mocks/models.mock').DocumentMock);
jest.mock('../../src/models/physical-file.model', () => require('./mocks/models.mock').PhysicalFileMock);

jest.mock('../../src/validators/file.validator', () => {
  const mockMiddleware = (req, res, next) => next();
  
  return {
    getFilesValidator: mockMiddleware,
    fileIdParamValidator: mockMiddleware,
    getFileLinkValidator: mockMiddleware,
    renameFileValidator: mockMiddleware,
    moveFileValidator: mockMiddleware,
    restoreFileValidator: mockMiddleware
  };
})

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { addJob } = require('shared');

const { DocumentMock: Document, PhysicalFileMock: PhysicalFile, getFreshDocument, getFreshPhysicalFile } = require('./mocks/models.mock');
const workerController = require('../../src/controllers/file-worker.controller');

const fileRoutes = require('../../src/routes/file-worker.routes');

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
  app.use('/api/files-worker', fileRoutes);

  return app;
}

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => console.error.mockRestore());
afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/hash — checkHash
// ═══════════════════════════════════════════════════════════
describe('POST /api/files-worker/hash', () => {
  const app = createApp();

  test('❌ Thiếu hashString → 400', async () => {
    const res = await request(app).post('/api/files-worker/hash').send({ filename: 'test.pdf' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Hash string is required');
  });

  test('✅ File mới tinh (không tìm thấy physicalFile) → 404 để tiếp tục Upload', async () => {
    PhysicalFile.findOne.mockResolvedValue(null);
    const res = await request(app).post('/api/files-worker/hash').send({ hashString: 'new-hash' });
    
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('File is new. Proceed to multipart upload');
    expect(res.body.data.isDuplicate).toBe(false);
  });

  test('✅ Trùng hash (My Drive / Không có workspace) → Copy tức thì (200)', async () => {
    const physFile = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    PhysicalFile.findOne.mockResolvedValue(physFile);
    Document.create.mockResolvedValue(docFile);

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Deduplication successful');
    expect(Document.create).toHaveBeenCalled();
    expect(addJob).toHaveBeenCalled(); // Kiểm tra BullMQ được gọi
  });

  test('✅ Trùng hash trong Workspace (User có quyền upload) → 200', async () => {
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    Document.create.mockResolvedValue(getFreshDocument());
    
    // Mock Axios trả về đúng user có quyền
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['editor'] }] } }
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash', workspaceId: 'ws-123' });

    expect(res.status).toBe(200);
  });

  test('❌ Trùng hash trong Workspace (User KHÔNG có quyền upload) → 403', async () => {
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['viewer'] }] } } // Thiếu upload
    });

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash', workspaceId: 'ws-123' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No permission');
  });

  test('❌ Gọi API Workspace lỗi 403 → 403', async () => {
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    const err = new Error('Forbidden');
    err.response = { status: 403 };
    axios.get.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash', workspaceId: 'ws-123' });

    expect(res.status).toBe(403);
  });

  test('❌ Gọi API Workspace sập (500) → 500', async () => {
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    axios.get.mockRejectedValue(new Error('Network Error'));

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash', workspaceId: 'ws-123' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to workspace-service');
  });

  test('✅ Deduplicate thành công nhưng BullMQ sập → Vẫn trả về 200', async () => {
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    Document.create.mockResolvedValue(getFreshDocument());
    addJob.mockRejectedValueOnce(new Error('Redis Timeout'));

    const res = await request(app)
      .post('/api/files-worker/hash')
      .send({ filename: 'test.pdf', hashString: 'mock-hash' });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/init — initUpload
// ═══════════════════════════════════════════════════════════
describe('POST /api/files-worker/init', () => {
  const app = createApp();
  const reqBody = { filename: 'test.pdf', totalChunks: 3, mimeType: 'application/pdf', sizeBytes: 1024 };

  test('✅ Init thành công (My Drive) → 201', async () => {
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-123', objectName: 'file/test.pdf', presignedUrls: [] } }
    });

    const res = await request(app).post('/api/files-worker/init').send(reqBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Init upload successfully');
    expect(res.body.data.uploadId).toBe('up-123');
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Init thành công trong Workspace → 201', async () => {
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['editor'] }] } }
    });
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-123', objectName: 'file/test.pdf', presignedUrls: [] } }
    });

    const res = await request(app).post('/api/files-worker/init').send({ ...reqBody, workspaceId: 'ws-123' });
    expect(res.status).toBe(201);
  });

  test('❌ Workspace member không có quyền upload → 403', async () => {
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['viewer'] }] } }
    });

    const res = await request(app).post('/api/files-worker/init').send({ ...reqBody, workspaceId: 'ws-123' });
    expect(res.status).toBe(403);
  });

  test('❌ Storage Service bị sập khi Init → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Down'));

    const res = await request(app).post('/api/files-worker/init').send(reqBody);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to storage-service');
  });

  test('✅ Init thành công nhưng BullMQ sập → Vẫn 201', async () => {
    axios.post.mockResolvedValue({
      data: { data: { uploadId: 'up-123', objectName: 'file/test.pdf', presignedUrls: [] } }
    });
    addJob.mockRejectedValueOnce(new Error('Queue Error'));

    const res = await request(app).post('/api/files-worker/init').send(reqBody);
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/files-worker/merge — mergeUpload
// ═══════════════════════════════════════════════════════════
describe('POST /api/files-worker/merge', () => {
  const app = createApp();
  const reqBody = {
    uploadId: 'up-123', etags: [], objectName: 'file/test.pdf', filename: 'test.pdf',
    totalChunks: 3, mimeType: 'application/pdf', hashString: 'hash-123', sizeBytes: 1024
  };

  test('✅ Merge thành công (Đã có PhysicalFile) → 200', async () => {
    axios.post.mockResolvedValue({}); // Storage merge success
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile()); // Đã có trên DB
    Document.create.mockResolvedValue(getFreshDocument());

    const res = await request(app).post('/api/files-worker/merge').send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('File merged and saved successful');
    expect(PhysicalFile.create).not.toHaveBeenCalled(); // Không tạo mới vì đã có
    expect(Document.create).toHaveBeenCalled();
  });

  test('✅ Merge thành công (PhysicalFile mới tinh) → 200', async () => {
    axios.post.mockResolvedValue({}); 
    PhysicalFile.findOne.mockResolvedValue(null); // Chưa có trên DB
    PhysicalFile.create.mockResolvedValue(getFreshPhysicalFile()); // Tạo mới
    Document.create.mockResolvedValue(getFreshDocument());

    const res = await request(app).post('/api/files-worker/merge').send(reqBody);

    expect(res.status).toBe(200);
    expect(PhysicalFile.create).toHaveBeenCalled(); // Cần tạo mới physical file
    expect(Document.create).toHaveBeenCalled();
  });

  test('❌ Storage Service merge thất bại → 500', async () => {
    axios.post.mockRejectedValue(new Error('Storage Down'));

    const res = await request(app).post('/api/files-worker/merge').send(reqBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to merge chunks in storage-service');
  });

  test('❌ DB crash khi tạo Document → 500', async () => {
    axios.post.mockResolvedValue({}); 
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    Document.create.mockRejectedValue(new Error('Mongoose Error'));

    const res = await request(app).post('/api/files-worker/merge').send(reqBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Mongoose Error');
  });

  test('✅ Merge thành công nhưng BullMQ sập → Vẫn trả 200', async () => {
    axios.post.mockResolvedValue({}); 
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    Document.create.mockResolvedValue(getFreshDocument());
    addJob.mockRejectedValueOnce(new Error('Redis Exception'));

    const res = await request(app).post('/api/files-worker/merge').send(reqBody);

    expect(res.status).toBe(200);
  });
});