const { fileProcessor } = require('../../src/handlers/file.handler');
const chromaService = require('../../src/config/chroma.config');
const extractService = require('../../src/services/extract.service');
const embedService = require('../../src/services/embed.service');
const { EVENTS, addJob, jobIdFor, QUEUES } = require('shared');

// ── 1. MOCK TẤT CẢ MODULES BÊN NGOÀI ─────────────────────────────
jest.mock('shared', () => ({
  EVENTS: {
    FILE_MERGED: 'file.merged',
    FILE_TRASHED: 'file.trashed',
    FILE_RESTORED: 'file.restored',
    FILE_MOVED: 'file.moved'
  },
  QUEUES: { NOTIFICATION: 'notification_queue' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  jobIdFor: jest.fn((prefix, id) => `${prefix}:${id}`),
  addJob: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/services/embed.service', () => ({
  embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  embedImage: jest.fn().mockResolvedValue([0.4, 0.5, 0.6]) // 🟢 Mock thêm embedImage
}));

jest.mock('../../src/config/chroma.config', () => ({
  upsert: jest.fn(), 
  deleteById: jest.fn()
}));

jest.mock('../../src/services/extract.service', () => ({
  getMimeCategory: jest.fn(), // 🟢 Dùng getMimeCategory thay thế isSupportedMime
  downloadFile: jest.fn(),
  extractText: jest.fn(),     // 🟢 Đổi tên extract -> extractText
  extractMetadata: jest.fn()  // 🟢 Mock thêm extractMetadata
}));

// ── 2. SETUP DATA VÀ TEST SUITE ──────────────────────────────────
describe('File Handler Processor', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 🟢 Cập nhật baseJobData dùng objectName thay cho minioObjectPath
  const baseJobData = {
    fileId: 'file-1',
    objectName: 'uploads/file.pdf', 
    mimeType: 'application/pdf',
    originalName: 'report.pdf',
    workspaceId: 'ws-1',
    uploadedBy: 'user-1'
  };

  // ═══════════════════════════════════════════════════════════
  // LUỒNG CHÍNH (FILE PROCESSOR & BẮT LỖI)
  // ═══════════════════════════════════════════════════════════
  test('❌ Bỏ qua và cảnh báo nếu event không được hỗ trợ', async () => {
    await fileProcessor({ name: 'UNKNOWN_EVENT', data: {} });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown event: UNKNOWN_EVENT - skipping'));
  });

  test('❌ Ném lỗi (Throw Error) nếu indexDocument bị lỗi (VD: S3 Timeout)', async () => {
    extractService.getMimeCategory.mockReturnValue('text');
    extractService.downloadFile.mockRejectedValueOnce(new Error('S3 Connection Timeout'));

    await expect(fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData }))
      .rejects.toThrow('S3 Connection Timeout');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to index file-1:'), 
      'S3 Connection Timeout'
    );
  });

  // ═══════════════════════════════════════════════════════════
  // SỰ KIỆN: FILE_MERGED & SỰ KIỆN LẬP CHỈ MỤC (INDEXING)
  // ═══════════════════════════════════════════════════════════
  test('✅ FILE_MERGED - Bỏ qua nếu thiếu fileId hoặc objectName (tại Handler)', async () => {
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, fileId: null } });
    expect(console.error).toHaveBeenCalledWith('[FileHandler] Invalid FILE_MERGED data:', expect.any(Object));
  });

  test('✅ INDEXING - Bỏ qua nếu thiếu fileId hoặc objectName (tại indexDocument qua Restored)', async () => {
    // Gọi thông qua FILE_RESTORED để lọt qua bước check của FILE_MERGED
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: { ...baseJobData, objectName: null } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Missing fileId or objectName:'), expect.any(Object));
  });

  test('✅ INDEXING - Bỏ qua nếu getMimeCategory trả về null (Unsupported MIME)', async () => {
    extractService.getMimeCategory.mockReturnValueOnce(null);
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, mimeType: 'video/mp4' } });
    
    expect(extractService.downloadFile).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skip — unsupported MIME: video/mp4'));
  });

  test('✅ INDEXING (Text) - Bỏ qua nếu extractText trả về null/rỗng', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('text');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce(null); // Text trống

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skip — no text: file-1'));
    expect(chromaService.upsert).not.toHaveBeenCalled();
  });

  test('✅ FILE_MERGED (Text) - Upsert Text và Metadata thành công, cắt 512 embedding', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('text');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce('Nội dung báo cáo.');
    // 🟢 Trả về metadata đầy đủ để test buildEnrichedText
    extractService.extractMetadata.mockResolvedValueOnce({
      'dc:title': 'Báo cáo năm',
      'dc:subject': 'Tài chính',
      'dc:description': 'Báo cáo 2024',
      'dc:creator': 'Nguyen Van A',
      'meta:keyword': 'Báo cáo, Thu chi'
    });

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    const expectedEnrichedText = `Title: Báo cáo năm\nNội dung báo cáo.\nSubject: Tài chính\nDescription: Báo cáo 2024\nAuthor: Nguyen Van A\nKeywords: Báo cáo, Thu chi`;

    expect(embedService.embed).toHaveBeenCalledWith(expectedEnrichedText.slice(0, 512));
    expect(chromaService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-1',
      embedding: [0.1, 0.2, 0.3],
      document: expectedEnrichedText.slice(0, 5000), 
      metadata: expect.objectContaining({ 
        mimeType: 'application/pdf',
        contentType: 'text',
        originalName: 'report.pdf' 
      })
    }));

    // Đẩy sang Notification Queue
    expect(addJob).toHaveBeenCalledWith(
      QUEUES.NOTIFICATION,
      EVENTS.FILE_MERGED,
      baseJobData,
      expect.objectContaining({ jobId: `${EVENTS.FILE_MERGED}_noti:file-1` })
    );
  });

  test('✅ FILE_MERGED (Image) - Gọi embedImage và Upsert thành công', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('image');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from('img-data'));

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, mimeType: 'image/png', originalName: 'pic.png' } });

    expect(embedService.embedImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/png');
    expect(chromaService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-1',
      embedding: [0.4, 0.5, 0.6],
      document: '[Image] pic.png', 
      metadata: expect.objectContaining({ contentType: 'image' })
    }));
  });

  test('✅ FORWARD NOTIFICATION - Bắt lỗi an toàn nếu addJob thất bại', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('text');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce('Valid Text');
    extractService.extractMetadata.mockResolvedValueOnce({});
    
    // Giả lập Redis sập khi đẩy vào Notification
    addJob.mockRejectedValueOnce(new Error('Redis Timeout'));

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error redirecting file.merged to notification-queue:'), 
      'Redis Timeout'
    );
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC SỰ KIỆN KHÁC (RESTORE, TRASH, MOVE)
  // ═══════════════════════════════════════════════════════════
  test('✅ FILE_RESTORED - Index lại document thành công (Xử lý originalName fallback " ")', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('text');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce('Restored Text');
    extractService.extractMetadata.mockResolvedValueOnce({});

    const { originalName, ...dataWithoutOriginalName } = baseJobData;
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: dataWithoutOriginalName });

    expect(extractService.downloadFile).toHaveBeenCalledWith('uploads/file.pdf', ' ');
    expect(chromaService.upsert).toHaveBeenCalled();
  });

  test('✅ FILE_TRASHED - Xóa an toàn nhiều file và xử lý nếu ChromaDB văng lỗi (Bắt mảng ids rỗng)', async () => {
    // Test case bỏ qua nhanh nếu fileIds trống
    await fileProcessor({ name: EVENTS.FILE_TRASHED, data: { fileIds: [] } });
    expect(chromaService.deleteById).not.toHaveBeenCalled();

    // Giả lập file đầu bị lỗi, file sau xóa bình thường
    chromaService.deleteById
      .mockRejectedValueOnce(new Error('Chroma Down'))
      .mockResolvedValueOnce(true);

    await fileProcessor({ 
      name: EVENTS.FILE_TRASHED, 
      data: { fileIds: ['err-file', null, 'ok-file'] } // Bỏ qua an toàn phần tử null
    });
    
    expect(chromaService.deleteById).toHaveBeenCalledTimes(2);
    expect(chromaService.deleteById).toHaveBeenCalledWith('err-file');
    expect(chromaService.deleteById).toHaveBeenCalledWith('ok-file');
    
    // Bắt lỗi an toàn
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to delete err-file from ChromaDB:'), 'Chroma Down');
  });

  test('✅ FILE_MOVED - Xóa bản ghi cũ và index lại bản ghi mới (Cập nhật newWorkspaceId)', async () => {
    extractService.getMimeCategory.mockReturnValueOnce('text');
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce('Valid Text');
    extractService.extractMetadata.mockResolvedValueOnce({});

    await fileProcessor({ 
      name: EVENTS.FILE_MOVED, 
      data: { ...baseJobData, newWorkspaceId: 'ws-new' } 
    });

    // 1. Kiểm tra xóa DB
    expect(chromaService.deleteById).toHaveBeenCalledWith('file-1');
    // 2. Kiểm tra index mới gắn metadata của ws-new
    expect(chromaService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ workspaceId: 'ws-new' }) 
    }));
  });
}); 