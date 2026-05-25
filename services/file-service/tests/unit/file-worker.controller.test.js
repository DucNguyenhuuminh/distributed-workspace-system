const axios = require('axios');
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
const { addJob, queueForEvent, jobIdFor, EVENTS } = require('shared');
const { checkHash, initUpload, mergeUpload } = require('../../src/controllers/file-worker.controller');

// ── 1. Mock Các Dependencies ──────────────────────────────
jest.mock('axios');
jest.mock('../../src/models/documents.model');
jest.mock('../../src/models/physical-file.model');
jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}_${id}`),
  EVENTS: { FILE_MERGED: 'file.merged' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
}));

// ── 2. Helpers tạo Request & Response ──────────────────────
const mockRequest = (body = {}, userId = 'user-1') => ({
  body,
  user: { userId },
  headers: { authorization: 'Bearer test-token' },
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ── 3. Test Suites ─────────────────────────────────────────
describe('File Worker Controller - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {}); 
    jest.spyOn(console, 'warn').mockImplementation(() => {}); 
    jest.spyOn(console, 'log').mockImplementation(() => {}); 
  });

  afterAll(() => {
    console.error.mockRestore();
    console.warn.mockRestore();
    console.log.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: checkHash
  // ═══════════════════════════════════════════════════════════
  describe('checkHash', () => {
    test('❌ Thiếu hashString → 400', async () => {
      const req = mockRequest({ filename: 'test.pdf' });
      const res = mockResponse();

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Hash string is required" });
    });

    test('✅ File hoàn toàn mới → 200 (isDuplicate: false)', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'new-hash' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue(null); 

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "File is new. Proceed to multipart upload",
        data: { isDuplicate: false }
      });
    });

    test('✅ Trùng hash (My Drive) → Dedup ngay lập tức → 200', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      Document.create.mockResolvedValue({ _id: 'doc-1', originalName: 'test.pdf' });

      await checkHash(req, res);

      expect(Document.create).toHaveBeenCalledWith({
        originalName: 'test.pdf',
        workspaceId: null,
        folderId: null,
        physicalFileId: 'phys-1',
        uploadedBy: 'user-1'
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // --- Bổ sung coverage cho Workspace trong checkHash ---
    test('❌ Trùng hash (Workspace) - Không phải Member → 403', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash', workspaceId: 'ws-1' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-other' }] } } });

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "You are not a member of this workspace" });
    });

    test('❌ Trùng hash (Workspace) - Là Member nhưng thiếu quyền Editor → 403', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash', workspaceId: 'ws-1' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-1', role: 'MEMBER', permissions: ['viewer'] }] } } });

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "No permission to upload in this workspace" });
    });

    test('✅ Trùng hash (Workspace) - Là Member có quyền Editor → 200', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash', workspaceId: 'ws-1' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      Document.create.mockResolvedValue({ _id: 'doc-1' });
      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-1', role: 'MEMBER', permissions: ['editor'] }] } } });

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('❌ Trùng hash (Workspace) - API Workspace trả lỗi 403 → 403', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash', workspaceId: 'ws-1' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      const err = new Error('Forbidden');
      err.response = { status: 403 };
      axios.get.mockRejectedValue(err);

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "No permission in this workspace" });
    });

    test('❌ Trùng hash (Workspace) - Mất kết nối Workspace Service → 500', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash', workspaceId: 'ws-1' });
      const res = mockResponse();

      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      axios.get.mockRejectedValue(new Error('Network Error'));

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Cannot connect to workspace-service" });
    });

    test('❌ Lỗi Database (Catch tổng checkHash) → 500', async () => {
      const req = mockRequest({ filename: 'test.pdf', hashString: 'exist-hash' });
      const res = mockResponse();

      PhysicalFile.findOne.mockRejectedValue(new Error('DB Down'));

      await checkHash(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "DB Down" });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: initUpload
  // ═══════════════════════════════════════════════════════════
  describe('initUpload', () => {
    const validBody = { filename: 'vid.mp4', totalChunks: 3, mimeType: 'video/mp4', sizeBytes: 5000 };

    test('✅ Upload (My Drive) → Storage trả về 201', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      const storageData = { uploadId: 'up-1', objectName: 'file/vid.mp4', minioObjectPath: 'file/vid.mp4', presignedURLs: ['url1'] };
      axios.post.mockResolvedValue({ data: { data: storageData } });

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: "Init upload successfully",
        data: expect.objectContaining({ uploadId: 'up-1' })
      }));
    });

    test('✅ Upload (Workspace) - Là Admin → 201', async () => {
      const req = mockRequest({ ...validBody, workspaceId: 'ws-1' });
      const res = mockResponse();

      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-1', role: 'ADMIN', permissions: [] }] } } });
      axios.post.mockResolvedValue({ data: { data: {} } });

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('❌ Upload (Workspace) - Không phải Member → 403', async () => {
      const req = mockRequest({ ...validBody, workspaceId: 'ws-1' });
      const res = mockResponse();

      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-other' }] } } });

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "You are not a member of this workspace" });
    });

    // --- Bổ sung coverage cho Workspace trong initUpload ---
    test('❌ Upload (Workspace) - Là Member nhưng thiếu quyền Editor → 403', async () => {
      const req = mockRequest({ ...validBody, workspaceId: 'ws-1' });
      const res = mockResponse();

      axios.get.mockResolvedValue({ data: { data: { members: [{ userId: 'user-1', role: 'MEMBER', permissions: ['viewer'] }] } } });

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "No permission to upload in this workspace" });
    });

    test('❌ Upload (Workspace) - Workspace Service trả 403 → 403', async () => {
      const req = mockRequest({ ...validBody, workspaceId: 'ws-1' });
      const res = mockResponse();

      const err = new Error('Forbidden');
      err.response = { status: 403 };
      axios.get.mockRejectedValue(err);

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: "No permission in this workspace" });
    });

    test('❌ Upload (Workspace) - Mất kết nối Workspace Service → 500', async () => {
      const req = mockRequest({ ...validBody, workspaceId: 'ws-1' });
      const res = mockResponse();

      axios.get.mockRejectedValue(new Error('Network Error'));

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Cannot connect to workspace-service" });
    });

    test('❌ Lỗi kết nối Storage Service → 500', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockRejectedValue(new Error('Storage Down'));

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Cannot connect to storage-service" });
    });

    test('❌ Lỗi hệ thống (Catch tổng initUpload) → 500', async () => {
      const req = { body: validBody }; // Không có req.user.userId để gây lỗi TypeError
      const res = mockResponse();

      await initUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: mergeUpload
  // ═══════════════════════════════════════════════════════════
  describe('mergeUpload', () => {
    const validBody = {
      uploadId: 'up-1', etags: [], minioObjectPath: 'path/file.pdf',
      objectName: 'file.pdf', filename: 'file.pdf', totalChunks: 2,
      mimeType: 'application/pdf', hashString: 'hash-1', sizeBytes: 1024
    };

    test('❌ Lỗi gọi Storage Service complete → 500', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockRejectedValue(new Error('Storage Error'));

      await mergeUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Failed to merge chunks in storage-service" });
      expect(PhysicalFile.findOne).not.toHaveBeenCalled(); 
    });

    test('✅ PhysicalFile chưa tồn tại → Tạo mới cả PhysicalFile và Document → 200', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockResolvedValue({});
      PhysicalFile.findOne.mockResolvedValue(null);
      PhysicalFile.create.mockResolvedValue({ _id: 'phys-new' });
      Document.create.mockResolvedValue({ _id: 'doc-new', originalName: 'file.pdf' });
      addJob.mockResolvedValue(true);

      await mergeUpload(req, res);

      expect(PhysicalFile.create).toHaveBeenCalledWith(expect.objectContaining({
        hashString: 'hash-1', minioObjectPath: 'path/file.pdf'
      }));
      expect(Document.create).toHaveBeenCalledWith(expect.objectContaining({
        originalName: 'file.pdf', physicalFileId: 'phys-new'
      }));
      expect(addJob).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('✅ PhysicalFile đã tồn tại (Fallback an toàn) → Chỉ tạo Document → 200', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockResolvedValue({});
      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-exist' }); 
      Document.create.mockResolvedValue({ _id: 'doc-1' });

      await mergeUpload(req, res);

      expect(PhysicalFile.create).not.toHaveBeenCalled(); 
      expect(Document.create).toHaveBeenCalledWith(expect.objectContaining({ physicalFileId: 'phys-exist' }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('✅ BullMQ bị sập (addJob throw error) → Bắt lỗi an toàn, API vẫn trả 200', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockResolvedValue({});
      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      Document.create.mockResolvedValue({ _id: 'doc-1', originalName: 'file.pdf' });
      
      // Giả lập Queue sập
      addJob.mockRejectedValue(new Error('Redis Timeout'));

      await mergeUpload(req, res);

      // 🟢 ĐÃ FIX: Chuyển tham số sang dạng chuỗi (String) khớp với Controller
      expect(console.error).toHaveBeenCalledWith('[Queue Error] Failed to enqueue FILE_MERGED job', 'Redis Timeout');
      
      // Nhưng API cuối cùng vẫn trả cho client 200
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('❌ DB sập giữa chừng khi lưu Document → Catch tổng xử lý → 500', async () => {
      const req = mockRequest(validBody);
      const res = mockResponse();

      axios.post.mockResolvedValue({});
      PhysicalFile.findOne.mockResolvedValue({ _id: 'phys-1' });
      Document.create.mockRejectedValue(new Error('DB Timeout'));

      await mergeUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "DB Timeout" });
    });
  });
});