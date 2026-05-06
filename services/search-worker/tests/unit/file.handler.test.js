const { fileProcessor } = require('../../src/handlers/file.handler');
const chromaService = require('../../src/config/chroma.config');
const extractService = require('../../src/services/extract.service');
const { EVENTS } = require('shared');

// CHỈ mock các service chức năng bên ngoài
jest.mock('../../src/config/chroma.config', () => ({
  upsertDocuments: jest.fn(),
  deleteById: jest.fn()
}));

jest.mock('../../src/services/extract.service', () => ({
  isSupportedMime: jest.fn(),
  downloadFile: jest.fn(),
  extractText: jest.fn()
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
    extractService.extractText.mockResolvedValueOnce(null);

    await fileProcessor({ name: EVENTS.FILE_UPLOAD, data: baseJobData });

    expect(chromaService.upsertDocuments).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No text extracted'));
  });

  test('✅ FILE_UPLOAD - Upsert thành công (cắt gọn text 5000 ký tự)', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    
    // Giả lập text siêu dài
    const longText = 'a'.repeat(6000);
    extractService.extractText.mockResolvedValueOnce(longText);

    await fileProcessor({ name: EVENTS.FILE_UPLOAD, data: baseJobData });

    expect(chromaService.upsertDocuments).toHaveBeenCalledWith({
      id: 'doc-1',
      document: 'a'.repeat(5000), // Đảm bảo đã cắt đúng 5000 ký tự
      metadata: { documentId: 'doc-1', workspaceId: 'ws-1', uploadedBy: 'user-1', mimeType: 'application/pdf' }
    });
  });

  test('✅ FILE_TRASHED - Xóa document khỏi DB', async () => {
    await fileProcessor({ name: EVENTS.FILE_TRASHED, data: { documentId: 'doc-1' } });
    expect(chromaService.deleteById).toHaveBeenCalledWith('doc-1');
  });

  test('✅ FILE_MOVED - Xóa bản ghi cũ và index lại bản ghi mới', async () => {
    extractService.isSupportedMime.mockReturnValueOnce(true);
    extractService.downloadFile.mockResolvedValueOnce(Buffer.from(''));
    extractService.extractText.mockResolvedValueOnce('Valid Text');

    await fileProcessor({ 
      name: EVENTS.FILE_MOVED, 
      data: { ...baseJobData, newWorkspaceId: 'ws-new' } 
    });

    expect(chromaService.deleteById).toHaveBeenCalledWith('doc-1');
    expect(chromaService.upsertDocuments).toHaveBeenCalledWith(expect.objectContaining({
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