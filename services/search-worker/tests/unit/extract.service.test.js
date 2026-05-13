const axios = require('axios');
const extractService = require('../../src/services/extract.service');

// Chỉ cần mock axios vì logic mới dùng Apache Tika qua API
jest.mock('axios');

describe('Extract Service', () => {
  
  beforeAll(() => {
    // Ẩn console.error để tránh rác terminal khi test nhánh catch lỗi
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST isSupportedMime
  // ═══════════════════════════════════════════════════════════
  describe('isSupportedMime', () => {
    test('✅ Trả về true cho các định dạng được hỗ trợ (PDF, Word, Ảnh)', () => {
      expect(extractService.isSupportedMime('application/pdf')).toBe(true);
      expect(extractService.isSupportedMime('text/plain')).toBe(true);
      expect(extractService.isSupportedMime('image/png')).toBe(true);
    });

    test('❌ Trả về false cho định dạng lạ không có trong mảng hỗ trợ', () => {
      expect(extractService.isSupportedMime('video/mp4')).toBe(false);
      expect(extractService.isSupportedMime('application/zip')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST downloadFile
  // ═══════════════════════════════════════════════════════════
  describe('downloadFile', () => {
    test('✅ Tải file thành công dạng Buffer qua 2 bước gọi Axios', async () => {
      // Mock call 1: Get presigned URL từ storage-service
      axios.get.mockResolvedValueOnce({ data: { data: { url: 'http://minio/file-url' } } });
      
      // Mock call 2: Download actual file từ presigned URL
      axios.get.mockResolvedValueOnce({ data: Buffer.from('mock-data') });

      const buffer = await extractService.downloadFile('my-object.pdf');
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(axios.get).toHaveBeenCalledTimes(2);
      
      // Đảm bảo call đầu tiên lấy link đúng cách
      expect(axios.get).toHaveBeenNthCalledWith(1, 
        expect.stringContaining('/api/storage/file/url'), 
        expect.objectContaining({ params: { objectName: 'my-object.pdf', action: 'view' } })
      );
      
      // Đảm bảo call thứ 2 download trả về arraybuffer
      expect(axios.get).toHaveBeenNthCalledWith(2, 'http://minio/file-url', { responseType: 'arraybuffer' });
    });

    test('❌ Ném lỗi nếu thiếu tham số objectName', async () => {
      await expect(extractService.downloadFile(null))
        .rejects.toThrow('downloadFile: objectName is required, got: null');
      
      await expect(extractService.downloadFile(''))
        .rejects.toThrow('downloadFile: objectName is required, got: ');

      // Đảm bảo không có API nào được gọi
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('❌ Ném lỗi nếu gọi API lấy presigned URL thất bại', async () => {
      // Giả lập lỗi từ Storage Service (VD: sập server hoặc file không tồn tại)
      axios.get.mockRejectedValueOnce(new Error('Storage Service Down'));

      await expect(extractService.downloadFile('my-object.pdf'))
        .rejects.toThrow('Storage Service Down');

      // Đảm bảo chỉ gọi API 1 lần rồi dừng
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('❌ Ném lỗi nếu API không trả về URL hợp lệ', async () => {
      // Giả lập API trả về data nhưng thiếu trường `url`
      axios.get.mockResolvedValueOnce({ data: { data: { url: null } } });

      await expect(extractService.downloadFile('my-object.pdf'))
        .rejects.toThrow('No download URL returned from storage service');

      // Đảm bảo chỉ gọi API 1 lần rồi dừng (không gọi bước download file)
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('❌ Ném lỗi nếu tải file thực tế từ presigned URL bị lỗi', async () => {
      // Mock call 1: Lấy URL thành công
      axios.get.mockResolvedValueOnce({ data: { data: { url: 'http://minio/file-url' } } });
      
      // Mock call 2: Tải file thất bại (VD: Link hết hạn, Network error)
      axios.get.mockRejectedValueOnce(new Error('Network Timeout'));

      await expect(extractService.downloadFile('my-object.pdf'))
        .rejects.toThrow('Network Timeout');

      // Đảm bảo API đã được gọi đủ 2 lần trước khi throw error
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST extract
  // ═══════════════════════════════════════════════════════════
  describe('extract', () => {
    const mockBuffer = Buffer.from('mock-file-content');

    test('✅ Extract thành công qua Apache Tika API và tự động trim()', async () => {
      // Giả lập Tika trả về text có khoảng trắng dư thừa
      axios.put.mockResolvedValueOnce({ data: '  Hello from Tika API  \n' });
      
      const text = await extractService.extract(mockBuffer, 'application/pdf');
      
      expect(text).toBe('Hello from Tika API'); 
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining('/tika'),
        mockBuffer,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/pdf', 'Accept': 'text/plain' }
        })
      );
    });

    test('❌ Trả về null nếu Tika trả về text trống (chỉ chứa khoảng trắng)', async () => {
      axios.put.mockResolvedValueOnce({ data: '   \n  ' });
      
      const text = await extractService.extract(mockBuffer, 'application/pdf');
      
      expect(text).toBeNull();
    });

    test('❌ Trả về null nếu API không có field data', async () => {
      axios.put.mockResolvedValueOnce({});
      
      const text = await extractService.extract(mockBuffer, 'application/pdf');
      
      expect(text).toBeNull();
    });

    test('❌ Trả về null và log lỗi nếu Axios gọi Tika bị sập (Timeout, Network Error)', async () => {
      axios.put.mockRejectedValueOnce(new Error('Tika Timeout'));
      
      const text = await extractService.extract(mockBuffer, 'application/pdf');
      
      expect(text).toBeNull();
      // Đảm bảo nhánh catch log lỗi đúng định dạng
      expect(console.error).toHaveBeenCalledWith(
        '[ExtractionService] Tika error for application/pdf:', 
        'Tika Timeout'
      );
    });
  });
});