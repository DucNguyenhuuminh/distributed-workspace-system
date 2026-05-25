// ── 1. Mock thư viện Xenova và Global Blob ──────────────────────────
const mockTextModelFn = jest.fn();

const mockClipProcessor = jest.fn();
const mockClipModelGetImageFeatures = jest.fn();
const mockClipModelFn = {
  processor: mockClipProcessor,
  model: { get_image_features: mockClipModelGetImageFeatures }
};

const mockRawImageFromBlob = jest.fn();

jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn((task) => {
    // Phân luồng mock dựa trên task được gọi
    if (task === 'feature-extraction') {
      return Promise.resolve(mockTextModelFn);
    }
    if (task === 'zero-shot-image-classification') {
      return Promise.resolve(mockClipModelFn);
    }
    return Promise.resolve(jest.fn());
  }),
  RawImage: {
    fromBlob: mockRawImageFromBlob
  }
}));

// Fallback cho môi trường Node cũ nếu chưa có class Blob global
if (typeof Blob === 'undefined') {
  global.Blob = class Blob {
    constructor(content, options) {
      this.content = content;
      this.options = options;
    }
  };
}

describe('Embed Service', () => {
  let embedService;
  let pipelineMock;

  beforeEach(() => {
    // 🟢 QUAN TRỌNG: Reset cache module để các biến singleton (textExtractor, clipExtractor) reset về null
    jest.resetModules();
    jest.clearAllMocks();
    
    // Tắt log để Terminal sạch sẽ khi chạy test
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Lấy lại reference của mock sau khi reset modules
    pipelineMock = require('@xenova/transformers').pipeline;
    embedService = require('../../src/services/embed.service'); // Đổi đường dẫn cho khớp dự án của bạn
  });

  afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST loadModels() & Cơ chế Caching
  // ═══════════════════════════════════════════════════════════
  describe('loadModels & Caching', () => {
    test('✅ Tải trước cả 2 mô hình thành công và có lưu cache (Singleton)', async () => {
      // Gọi lần 1: Sẽ khởi tạo cả 2 pipeline
      await embedService.loadModels();
      
      expect(pipelineMock).toHaveBeenCalledTimes(2);
      expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', embedService.TEXT_MODEL);
      expect(pipelineMock).toHaveBeenCalledWith('zero-shot-image-classification', embedService.CLIP_MODEL);
      
      // Kiểm tra Log
      expect(console.log).toHaveBeenCalledWith('[EmbedService] Loading model......');
      expect(console.log).toHaveBeenCalledWith('[EmbedService] Loading CLIP model...');

      // Gọi lần 2: Phải sử dụng cache, không gọi lại pipeline()
      await embedService.loadModels();
      
      // Số lần gọi pipeline vẫn phải là 2 (từ lần gọi đầu tiên)
      expect(pipelineMock).toHaveBeenCalledTimes(2);
    });

    test('❌ Ném lỗi nếu pipeline khởi tạo thất bại', async () => {
      pipelineMock.mockRejectedValueOnce(new Error('HuggingFace down'));

      await expect(embedService.loadModels()).rejects.toThrow('HuggingFace down');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST embed() - Single Text
  // ═══════════════════════════════════════════════════════════
  describe('embed()', () => {
    test('✅ Chuyển đổi một đoạn text thành mảng Vector (Array) thành công', async () => {
      const text = "AI is awesome";
      
      // Mô phỏng kết quả trả về của pipeline mô hình Text (Float32Array)
      const mockOutput = { data: new Float32Array([0.15, 0.25, 0.35]) };
      mockTextModelFn.mockResolvedValueOnce(mockOutput);

      const result = await embedService.embed(text);

      expect(mockTextModelFn).toHaveBeenCalledWith(text, {
        pooling: 'mean',
        normalize: true,
      });

      expect(Array.isArray(result)).toBe(true);
      
      // 🟢 ĐÃ FIX LỖI SAI SỐ BẰNG CÁCH SO SÁNH CÙNG KIỂU FLOAT32
      const expectedArray = Array.from(new Float32Array([0.15, 0.25, 0.35]));
      expect(result).toEqual(expectedArray); 
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST embedImage() - Xử lý ảnh
  // ═══════════════════════════════════════════════════════════
  describe('embedImage()', () => {
    test('✅ Trích xuất feature từ buffer ảnh thành mảng Vector thành công', async () => {
      const fakeImageBuffer = Buffer.from('fake-image-data');
      const mimeType = 'image/jpeg';
      const fakeRawImage = { width: 800, height: 600 }; // Object giả lập ảnh
      
      // Bước 1: Mock đọc ảnh từ Blob
      mockRawImageFromBlob.mockResolvedValueOnce(fakeRawImage);
      // Bước 2: Mock processor xử lý RawImage
      mockClipProcessor.mockResolvedValueOnce('processed-tensor');
      // Bước 3: Mock trích xuất features
      mockClipModelGetImageFeatures.mockResolvedValueOnce({ data: new Float32Array([0.9, 0.8, 0.7]) });

      const result = await embedService.embedImage(fakeImageBuffer, mimeType);

      // Kiểm tra quá trình tạo ảnh có được gọi
      expect(mockRawImageFromBlob).toHaveBeenCalled();
      
      // Kiểm tra việc truyền đúng object ảnh vào processor
      expect(mockClipProcessor).toHaveBeenCalledWith(fakeRawImage);
      
      // Kiểm tra việc lấy features từ output của processor
      expect(mockClipModelGetImageFeatures).toHaveBeenCalledWith('processed-tensor');

      expect(Array.isArray(result)).toBe(true);
      
      // 🟢 ĐÃ FIX LỖI SAI SỐ:
      const expectedImageArray = Array.from(new Float32Array([0.9, 0.8, 0.7]));
      expect(result).toEqual(expectedImageArray);
    });

    test('❌ Ném lỗi nếu ảnh bị lỗi (Hỏng file, định dạng sai)', async () => {
      const fakeImageBuffer = Buffer.from('corrupted-data');
      
      mockRawImageFromBlob.mockRejectedValueOnce(new Error('Invalid image format'));

      await expect(embedService.embedImage(fakeImageBuffer, 'image/png'))
        .rejects.toThrow('Invalid image format');
      
      expect(mockClipProcessor).not.toHaveBeenCalled();
    });
  });
});