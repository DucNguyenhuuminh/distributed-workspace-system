// ── 1. Import Mocks trước khi require Controller ──────────────
jest.mock('axios');
jest.mock('shared', () => ({
  addJob: jest.fn().mockResolvedValue({ id: 'job-mock' }),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  EVENTS: { FILE_MERGED: 'file.merged' },  // ✅ Khớp controller
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  verifyToken: (req, res, next) => next(),
  validateRequest: (req, res, next) => next(),
}));

jest.mock('../../src/models/documents.model', () => require('./mocks/models.mock').DocumentMock);
jest.mock('../../src/models/physical-file.model', () => require('./mocks/models.mock').PhysicalFileMock);

const axios = require('axios');
const { addJob, queueForEvent, jobIdFor, EVENTS } = require('shared');
const { DocumentMock: Document, PhysicalFileMock: PhysicalFile, getFreshDocument, getFreshPhysicalFile } = require('./mocks/models.mock');

// ── Import Controllers SAU khi mock ────────────────────────
const { checkHash, initUpload, mergeUpload } = require('../../src/controllers/file-worker.controller');

const request = require('supertest');
const express = require('express');

// ── 2. Helper functions ────────────────────────────────────
function createReqRes(userId = 'user-001') {
  const req = {
    user: { userId },
    headers: { authorization: 'Bearer test-token' },
    body: {}
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    locals: {}
  };
  return { req, res };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { userId: 'user-001' };
    req.headers.authorization = 'Bearer test-token';
    next();
  });
  return app;
}

// ── Setup/Teardown ─────────────────────────────────────────
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => console.error.mockRestore());
afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════
// checkHash
// ═══════════════════════════════════════════════════════════
describe('checkHash', () => {
  const { req, res } = createReqRes();

  beforeEach(() => {
    req.body = {};
    jest.clearAllMocks();
  });

  test('❌ Thiếu hashString → 400', async () => {
    req.body = { filename: 'test.pdf' };
    await checkHash(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Hash string is required' });
  });

  test('✅ File mới → 200 {isDuplicate: false}', async () => {
    req.body = { filename: 'test.pdf', hashString: 'new-hash' };
    PhysicalFile.findOne.mockResolvedValue(null);
    
    await checkHash(req, res);
    
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenLastCalledWith({
      message: 'File is new. Proceed to multipart upload',
      data: { isDuplicate: false }
    });
    expect(PhysicalFile.findOne).toHaveBeenCalledWith({ hashString: 'new-hash' });
  });

  test('✅ Trùng hash My Drive → Tạo Document + addJob → 200', async () => {
    const physFile = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    
    req.body = { filename: 'test.pdf', hashString: 'dup-hash' };
    PhysicalFile.findOne.mockResolvedValue(physFile);
    Document.create.mockResolvedValue(docFile);

    await checkHash(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenLastCalledWith({
      message: 'Deduplication successful. File copy instantly',
      data: { document: docFile, isDuplicate: true }
    });
    
    // ✅ Kiểm tra Document.create
    expect(Document.create).toHaveBeenCalledWith({
      originalName: 'test.pdf',
      workspaceId: null,
      folderId: null,
      physicalFileId: physFile._id,
      uploadedBy: 'user-001'
    });

    // ✅ Kiểm tra addJob với đúng params
    expect(addJob).toHaveBeenCalledWith(
      `queue:${EVENTS.FILE_MERGED}`,  // queueForEvent
      EVENTS.FILE_MERGED,             // 'file.merged'
      expect.objectContaining({
        fileId: docFile._id.toString(),
        isDuplicate: true,
        originalName: 'test.pdf',
        hashString: 'dup-hash'
      }),
      expect.objectContaining({
        jobId: `${EVENTS.FILE_MERGED}:${docFile._id.toString()}`
      })
    );
  });

  test('✅ Trùng hash Workspace (có quyền) → 200', async () => {
    const physFile = getFreshPhysicalFile();
    req.body = { filename: 'ws.pdf', hashString: 'ws-hash', workspaceId: 'ws-123' };
    PhysicalFile.findOne.mockResolvedValue(physFile);
    Document.create.mockResolvedValue(getFreshDocument());
    
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['editor'] }] } }
    });

    await checkHash(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Workspace không có quyền → 403', async () => {
    req.body = { filename: 'test.pdf', hashString: 'hash', workspaceId: 'ws-123' };
    PhysicalFile.findOne.mockResolvedValue(getFreshPhysicalFile());
    
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['viewer'] }] } }
    });

    await checkHash(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('✅ addJob lỗi → Vẫn 200 (Document đã tạo)', async () => {
    const physFile = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    
    req.body = { filename: 'test.pdf', hashString: 'hash' };
    PhysicalFile.findOne.mockResolvedValue(physFile);
    Document.create.mockResolvedValue(docFile);
    addJob.mockRejectedValueOnce(new Error('Redis down'));

    await checkHash(req, res);
    
    expect(res.status).toHaveBeenCalledWith(200);  // ✅ Vẫn success
    expect(console.error).toHaveBeenCalled();      // ✅ Log lỗi job
  });
});

// ═══════════════════════════════════════════════════════════
// initUpload  
// ═══════════════════════════════════════════════════════════
describe('initUpload', () => {
  const { req, res } = createReqRes();

  beforeEach(() => {
    req.body = {};
    jest.clearAllMocks();
  });

  test('✅ My Drive → Gọi Storage Service → 201', async () => {
    req.body = {
      filename: 'test.pdf',
      totalChunks: 3,
      mimeType: 'application/pdf',
      sizeBytes: 1024
    };
    
    const storageResponse = {
      data: {
        data: {
          uploadId: 'up-123',
          objectName: 'file/test.pdf',
          presignedURLs: ['url1', 'url2']
        }
      }
    };
    axios.post.mockResolvedValue(storageResponse);

    await initUpload(req, res);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/storage/multipart/init'),
      { filename: 'test.pdf', mimeType: 'application/pdf', totalChunks: 3 }
    );
    
    expect(res.status).toHaveBeenCalledWith(201);
    
    // 🟢 FIX CHUẨN XÁC: Ghi rõ object meta mong đợi
    expect(res.json).toHaveBeenCalledWith({
      message: 'Init upload successfully',
      data: {
        uploadId: 'up-123',
        objectName: 'file/test.pdf',
        presignedUrls: ['url1', 'url2'],
        meta: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          workspaceId: undefined,
          folderId: undefined
        }
      }
    });
  });

  test('✅ Workspace có quyền → 201', async () => {
    req.body = { ...req.body, workspaceId: 'ws-123' };
    axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-001', role: 'ADMIN' }] } } });
    axios.post.mockResolvedValue({ data: { data: { uploadId: 'up-ws', objectName: 'ws/test.pdf', presignedURLs: [] } } });

    await initUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('❌ Workspace không có quyền → 403', async () => {
    req.body = { filename: 'test.pdf', workspaceId: 'ws-123' };
    axios.get.mockResolvedValue({
      data: { data: { members: [{ userId: 'user-001', permissions: ['viewer'] }] } }
    });

    await initUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('❌ Storage Service lỗi → 500', async () => {
    req.body = { filename: 'test.pdf', totalChunks: 1, mimeType: 'app/pdf' };
    axios.post.mockRejectedValue(new Error('Storage down'));

    await initUpload(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot connect to storage-service' });
  });
});

// ═══════════════════════════════════════════════════════════
// mergeUpload
// ═══════════════════════════════════════════════════════════
describe('mergeUpload', () => {
  const { req, res } = createReqRes();

  beforeEach(() => {
    req.body = {};
    jest.clearAllMocks();
  });

  test('✅ PhysicalFile mới → Tạo PhysicalFile + Document + addJob → 200', async () => {
    req.body = {
      uploadId: 'up-123',
      etags: [{ partNumber: 1, eTag: 'etag1' }],
      objectName: 'final.pdf',
      minioObjectPath: 'file/final.pdf',
      totalChunks: 3,
      mimeType: 'application/pdf',
      hashString: 'new-hash',
      sizeBytes: 2048
    };

    const physFile = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    
    axios.post.mockResolvedValue({});                    // Storage merge OK
    PhysicalFile.findOne.mockResolvedValue(null);        // Chưa có
    PhysicalFile.create.mockResolvedValue(physFile);     // Tạo mới
    Document.create.mockResolvedValue(docFile);          // Tạo Document

    await mergeUpload(req, res);

    // ✅ Storage merge
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/storage/multipart/complete'),
      { uploadId: 'up-123', objectName: 'final.pdf', etags: req.body.etags }
    );

    // ✅ PhysicalFile mới
    expect(PhysicalFile.create).toHaveBeenCalledWith({
      hashString: 'new-hash',
      minioObjectPath: 'file/final.pdf',
      sizeBytes: 2048,
      mimeType: 'application/pdf'
    });

    // ✅ Thêm đầy đủ các trường mà controller truyền vào khi tạo Document
    expect(Document.create).toHaveBeenCalledWith({
      originalName: 'final.pdf',
      physicalFileId: physFile._id,
      workspaceId: null,
      folderId: null,
      uploadedBy: 'user-001'
    });

    // 🟢 ĐÃ FIX: Dùng expect.toHaveBeenCalledWith() để test xem tham số payload của addJob đã nhận đúng các biến vừa sửa chưa
    expect(addJob).toHaveBeenCalledWith(
      `queue:${EVENTS.FILE_MERGED}`,
      EVENTS.FILE_MERGED,
      expect.objectContaining({
        fileId: docFile._id.toString(),
        minioObjectPath: 'file/final.pdf',
        originalName: 'final.pdf', // ← Từ objectName
        totalChunks: 3,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        hashString: 'new-hash',
        uploadedBy: 'user-001',
        actorId: 'user-001',
        isDuplicate: false
      }),
      expect.objectContaining({
        jobId: `${EVENTS.FILE_MERGED}:${docFile._id.toString()}`
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('✅ PhysicalFile đã có → Chỉ tạo Document → 200', async () => {
    req.body = { ...req.body, hashString: 'existing-hash' };
    const existingPhys = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    
    axios.post.mockResolvedValue({});
    PhysicalFile.findOne.mockResolvedValue(existingPhys);
    Document.create.mockResolvedValue(docFile);

    await mergeUpload(req, res);

    expect(PhysicalFile.create).not.toHaveBeenCalled();  // ✅ Không tạo mới
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('❌ Storage merge lỗi → 500', async () => {
    req.body = { uploadId: 'up-123', etags: [], objectName: 'test.pdf' };
    axios.post.mockRejectedValue(new Error('Merge failed'));

    await mergeUpload(req, res);
    
    expect(res.status).toHaveBeenCalledWith(500);
    expect(PhysicalFile.findOne).not.toHaveBeenCalled();  // ✅ Không chạm DB
  });

  test('✅ addJob lỗi → Vẫn 200', async () => {
    req.body = { ...req.body, hashString: 'hash' };
    const physFile = getFreshPhysicalFile();
    const docFile = getFreshDocument();
    
    axios.post.mockResolvedValue({});
    PhysicalFile.findOne.mockResolvedValue(physFile);
    Document.create.mockResolvedValue(docFile);
    addJob.mockRejectedValueOnce(new Error('Queue error'));

    await mergeUpload(req, res);
    
    expect(res.status).toHaveBeenCalledWith(200);
    expect(console.error).toHaveBeenCalled();
  });
});