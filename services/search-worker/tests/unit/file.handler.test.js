const { fileProcessor } = require('../../src/handlers/file.handler');
const chromaService = require('../../src/config/chroma.config');
const extractService = require('../../src/services/extract.service');
const embedService = require('../../src/services/embed.service'); // Bổ sung để mock
const { EVENTS } = require('shared');

// 🟢 FIX LỖI CRASH JEST: Mock hoàn toàn embedService để ngăn Jest load @xenova/transformers
jest.mock('../../src/services/embed.service', () => ({
  embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) // Giả lập vector AI
}));

// CHỈ mock các service chức năng bên ngoài
jest.mock('../../src/config/chroma.config', () => ({
  upsert: jest.fn(), // Đổi thành upsert theo handler mới
  deleteById: jest.fn()
}));

jest.mock('../../src/services/extract.service', () => ({
  isSupportedMime: jest.fn(),
  downloadFile: jest.fn(),
  extract: jest.fn() // Đổi thành extract theo handler mới
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

  const baseJobData = {
    documentId: 'doc-1',
    objectName: 'file.pdf',
    mimeType: 'application/pdf',
    workspaceId: 'ws-1',
    uploadedBy: 'user-1'
  };

  test('✅ FILE_UPLOAD - Bỏ qua nếu mimeType không hỗ trợ', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(false);
    
    await fileProcessor({ name: EVENTS.FILE_UPLOAD, data: { ...baseJobData, mimeType: 'image/png' } });
    
    expect(extractService.downloadFile).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Skipping unsupported MIME type'));
  });

  test('✅ FILE_UPLOAD - Bỏ qua nếu extract ra text rỗng', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce(null);

    await fileProcessor({ name: EVENTS.FILE_UPLOAD, data: baseJobData });

    expect(chromaService.upsert).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No text extracted'));
  });

  test('✅ FILE_UPLOAD - Upsert thành công (cắt 512 char cho embedding, 5000 cho text)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    
    // Giả lập text siêu dài (6000 ký tự)
    const longText = 'a'.repeat(6000);
    extractService.extract.mockResolvedValueOnce(longText);

    await fileProcessor({ name: EVENTS.FILE_UPLOAD, data: baseJobData });

    // Kiểm tra đúng logic: cắt 512 ký tự cho embedService
    expect(embedService.embed).toHaveBeenCalledWith('a'.repeat(512));

    // Kiểm tra đúng logic: cắt 5000 ký tự đưa vào ChromaDB
    expect(chromaService.upsert).toHaveBeenCalledWith({
      id: 'doc-1',
      embedding: [0.1, 0.2, 0.3],
      document: 'a'.repeat(5000), 
      metadata: { documentId: 'doc-1', workspaceId: 'ws-1', uploadedBy: 'user-1', mimeType: 'application/pdf' }
    });
  });

  test('✅ FILE_MERGED - Tương tự UPLOAD (Index document)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Merged Text');

    await fileProcessor({ name: EVENTS.FILE_MERGED, data: baseJobData });

    expect(chromaService.upsert).toHaveBeenCalled();
  });

  test('✅ FILE_RESTORED - Tương tự UPLOAD (Index document)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Restored Text');

    await fileProcessor({ name: EVENTS.FILE_RESTORED, data: baseJobData });

    expect(chromaService.upsert).toHaveBeenCalled();
  });

  test('✅ FILE_RENAMED - Chỉ log, không làm gì thêm', async () => {
    await fileProcessor({ name: EVENTS.FILE_RENAMED, data: baseJobData });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FILE_RENAMED'));
    expect(chromaService.upsert).not.toHaveBeenCalled();
  });

  test('✅ FILE_TRASHED - Xóa document khỏi DB', async () => {
    await fileProcessor({ name: EVENTS.FILE_TRASHED, data: { documentId: 'doc-1' } });
    expect(chromaService.deleteById).toHaveBeenCalledWith('doc-1');
  });

  test('✅ FILE_MOVED - Xóa bản ghi cũ và index lại bản ghi mới', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extract.mockResolvedValueOnce('Valid Text');

    await fileProcessor({ 
      name: EVENTS.FILE_MOVED, 
      data: { ...baseJobData, newWorkspaceId: 'ws-new' } 
    });

    expect(chromaService.deleteById).toHaveBeenCalledWith('doc-1');
    expect(chromaService.upsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ workspaceId: 'ws-new' }) // Đã trỏ qua workspace mới
    }));
  });

  test('❌ Bỏ qua event không xác định', async () => {
    await fileProcessor({ name: 'unknown.event', data: {} });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown event: unknown.event'));
  });

  test('❌ Ném lỗi nếu handler crash', async () => {
    extractService.isSupportedMime.mockImplementation(() => { throw new Error('Crash!'); });
    
    await expect(fileProcessor({ name: EVENTS.FILE_UPLOAD, data: baseJobData })).rejects.toThrow('Crash!');
    expect(console.error).toHaveBeenCalled();
  });
});