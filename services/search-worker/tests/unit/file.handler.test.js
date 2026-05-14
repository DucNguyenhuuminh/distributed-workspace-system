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

// Mock hoàn toàn embedService để ngăn Jest load @xenova/transformers
jest.mock('../../src/services/embed.service', () => ({
  embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3])
}));

jest.mock('../../src/config/chroma.config', () => ({
  upsert: jest.fn(), 
  deleteById: jest.fn()
}));

jest.mock('../../src/services/extract.service', () => ({
  isSupportedMime: jest.fn(),
  downloadFile: jest.fn(),
  extract: jest.fn() 
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

  const baseJobData = {
    fileId: 'file-1',
    minioObjectPath: 'uploads/file.pdf',
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
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown event: UNKNOWN_EVENT'));
  });

  test('❌ Ném lỗi (Throw Error) nếu indexDocument bị lỗi (ví dụ: Tải file thất bại)', async () => {
    extractService.isSupportedMime.mockReturnValue(true);
    extractService.downloadFile.mockRejectedValueOnce(new Error('S3 Connection Timeout'));

    await expect(fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData }))
      .rejects.toThrow('S3 Connection Timeout');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to index file-1'), 
      'S3 Connection Timeout'
    );
  });

  // ═══════════════════════════════════════════════════════════
  // SỰ KIỆN: FILE_MERGED & SỰ KIỆN LẬP CHỈ MỤC (INDEXING)
  // ═══════════════════════════════════════════════════════════
  test('✅ FILE_MERGED - Bỏ qua nếu thiếu fileId hoặc minioObjectPath (tại Handler)', async () => {
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, fileId: null } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid FILE_MERGED data'), expect.any(Object));
  });

  test('✅ INDEXING - Bỏ qua nếu thiếu fileId (tại indexDocument)', async () => {
    // Gọi thông qua FILE_RESTORED để lọt qua bước check của FILE_MERGED
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: { ...baseJobData, fileId: null } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Missing fileId'), expect.any(Object));
  });

  test('✅ INDEXING - Cảnh báo nếu thiếu minioObjectPath', async () => {
    // Vẫn gọi nhưng sẽ báo log thiếu minioObjectPath
    extractService.isSupportedMime.mockReturnValueOnce(false); // Dừng sớm để tránh lỗi logic dưới
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: { ...baseJobData, minioObjectPath: null } });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Missing minioObjectPath'), expect.any(Object));
  });

  test('✅ INDEXING - Bỏ qua nếu mimeType không hỗ trợ', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(false);
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, mimeType: 'image/png' } });
    
    expect(extractService.downloadFile).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skipping unsupported MIME type: image/png'));
  });

  test('✅ INDEXING - Bỏ qua nếu extract ra text rỗng', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce(null);

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });
    expect(chromaService.upsert).not.toHaveBeenCalled();
  });

  test('✅ FILE_MERGED - Upsert thành công và Forward sang Notification Queue', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('a'.repeat(6000)); // Text siêu dài

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    // Cắt 512 char cho embedding, 5000 cho document
    expect(embedService.embed).toHaveBeenCalledWith('a'.repeat(512));
    expect(chromaService.upsert).toHaveBeenCalledWith({
      id: 'file-1',
      embedding: [0.1, 0.2, 0.3],
      document: 'a'.repeat(5000), 
      metadata: { fileId: 'file-1', workspaceId: 'ws-1', uploadedBy: 'user-1', mimeType: 'application/pdf' }
    });

    // Bắt buộc gọi qua Queue của Notification
    expect(addJob).toHaveBeenCalledWith(
      QUEUES.NOTIFICATION,
      EVENTS.FILE_MERGED,
      baseJobData,
      expect.objectContaining({ jobId: `${EVENTS.FILE_MERGED}_noti:file-1` }) // Vì mock jobIdFor sinh ra dấu ':'
    );
  });

  test('✅ FORWARD NOTIFICATION - An toàn, không văng lỗi nếu addJob thất bại', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Valid Text');
    
    // Giả lập Redis sập khi đẩy vào Notification
    addJob.mockRejectedValueOnce(new Error('Redis Timeout'));

    // Không dùng rejects.toThrow() vì hàm forwardToNotification tự bắt lỗi an toàn (try/catch)
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error redirecting file.merged to notification-queue'), 
      'Redis Timeout'
    );
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC SỰ KIỆN KHÁC (RESTORE, TRASH, MOVE)
  // ═══════════════════════════════════════════════════════════
  test('✅ FILE_RESTORED - Index lại document thành công (Xử lý originalName fallback " ")', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Restored Text');

    const { originalName, ...dataWithoutOriginalName } = baseJobData;
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: dataWithoutOriginalName });

    expect(extractService.downloadFile).toHaveBeenCalledWith('uploads/file.pdf', ' ');
    expect(chromaService.upsert).toHaveBeenCalled();
  });

  test('✅ FILE_TRASHED - Xóa an toàn nhiều file và xử lý nếu ChromaDB văng lỗi', async () => {
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
    
    // Đảm bảo bắt lỗi từng item nhưng tiến trình xóa KHÔNG BỊ CRASH
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to delete err-file'), 'Chroma Down');
  });

  test('✅ FILE_MOVED - Xóa bản ghi cũ và index lại bản ghi mới (Cập nhật newWorkspaceId)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Valid Text');

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