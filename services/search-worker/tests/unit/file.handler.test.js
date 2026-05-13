const { fileProcessor } = require('../../src/handlers/file.handler');
const chromaService = require('../../src/config/chroma.config');
const extractService = require('../../src/services/extract.service');
const embedService = require('../../src/services/embed.service');
const { EVENTS } = require('shared');

// 🟢 FIX LỖI CRASH JEST: Mock hoàn toàn embedService để ngăn Jest load @xenova/transformers
jest.mock('../../src/services/embed.service', () => ({
  embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) // Giả lập vector AI
}));

// CHỈ mock các service chức năng bên ngoài
jest.mock('../../src/config/chroma.config', () => ({
  upsert: jest.fn(), 
  deleteById: jest.fn()
}));

jest.mock('../../src/services/extract.service', () => ({
  isSupportedMime: jest.fn(),
  downloadFile: jest.fn(),
  extract: jest.fn() 
}));

describe('File Handler Processor', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Cập nhật lại baseJobData cho khớp với logic mới (dùng fileId thay vì documentId)
  const baseJobData = {
    fileId: 'file-1',
    minioObjectPath: 'uploads/file.pdf',
    mimeType: 'application/pdf',
    originalName: 'report.pdf',
    workspaceId: 'ws-1',
    uploadedBy: 'user-1'
  };

  test('✅ FILE_MERGED - Bỏ qua nếu thiếu fileId hoặc minioObjectPath', async () => {
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, fileId: null } });
    
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid FILE_MERGED data'), expect.any(Object));
    expect(extractService.isSupportedMime).not.toHaveBeenCalled();
  });

  test('✅ FILE_MERGED - Bỏ qua nếu mimeType không hỗ trợ', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(false);
    
    await fileProcessor({ name: EVENTS.FILE_MERGED, data: { ...baseJobData, mimeType: 'image/png' } });
    
    expect(extractService.downloadFile).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skipping unsupported MIME type: image/png'));
  });

  test('✅ FILE_MERGED - Bỏ qua nếu extract ra text rỗng', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce(null);

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    expect(chromaService.upsert).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No text extracted'));
  });

  test('✅ FILE_MERGED - Upsert thành công (cắt 512 char cho embedding, 5000 cho text)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    
    // Giả lập text siêu dài (6000 ký tự)
    const longText = 'a'.repeat(6000);
    extractService.extract.mockResolvedValueOnce(longText);

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    // Kiểm tra đã truyền originalName vào hàm downloadFile
    expect(extractService.downloadFile).toHaveBeenCalledWith('uploads/file.pdf', 'report.pdf');

    // Kiểm tra đúng logic: cắt 512 ký tự cho embedService
    expect(embedService.embed).toHaveBeenCalledWith('a'.repeat(512));

    // Kiểm tra đúng logic: cắt 5000 ký tự đưa vào ChromaDB và map chuẩn metadata
    expect(chromaService.upsert).toHaveBeenCalledWith({
      id: 'file-1',
      embedding: [0.1, 0.2, 0.3],
      document: 'a'.repeat(5000), 
      metadata: { fileId: 'file-1', workspaceId: 'ws-1', uploadedBy: 'user-1', mimeType: 'application/pdf' }
    });
  });

  test('✅ FILE_RESTORED - Index lại document thành công (Xử lý originalName fallback)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Restored Text');

    // Giả lập không có originalName để test fallback ' '
    const { originalName, ...dataWithoutOriginalName } = baseJobData;
    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: dataWithoutOriginalName });

    expect(extractService.downloadFile).toHaveBeenCalledWith('uploads/file.pdf', ' ');
    expect(chromaService.upsert).toHaveBeenCalled();
  });

  test('✅ FILE_RENAMED - Chỉ log, không làm gì thêm', async () => {
    await fileProcessor({ name: EVENTS.FILE_RENAMED, data: baseJobData });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FILE_RENAMED'));
    expect(chromaService.upsert).not.toHaveBeenCalled();
  });

  test('✅ FILE_TRASHED - Xóa document khỏi DB (Hỗ trợ mảng fileIds)', async () => {
    await fileProcessor({ 
      name: EVENTS.FILE_TRASHED, 
      data: { fileIds: ['file-1', 'file-2'] } 
    });
    
    expect(chromaService.deleteById).toHaveBeenCalledWith('file-1');
    expect(chromaService.deleteById).toHaveBeenCalledWith('file-2');
  });

  test('✅ FILE_MOVED - Xóa bản ghi cũ và index lại bản ghi mới', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Valid Text');

    await fileProcessor({ 
      name: EVENTS.FILE_MOVED, 
      data: { ...baseJobData, newWorkspaceId: 'ws-new' } 
    });

    // 1. Kiểm tra đã xóa file cũ thành công bằng fileId chưa
    expect(chromaService.deleteById).toHaveBeenCalledWith('file-1');
    
    // 2. Kiểm tra đã gọi hàm index mới trỏ về workspace mới chưa
    expect(chromaService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ workspaceId: 'ws-new' }) 
    }));
  })
});