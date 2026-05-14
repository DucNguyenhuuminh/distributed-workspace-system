// ── 1. Mock thư viện Xenova để tránh lỗi cú pháp ES Modules ──────────────
const mockModelFn = jest.fn();

jest.mock('@xenova/transformers', () => ({
  // pipeline sẽ trả về một Promise chứa hàm mockModelFn
  pipeline: jest.fn().mockImplementation(() => Promise.resolve(mockModelFn))
}));

describe('Embed Service', () => {
  let embedService;
  let pipelineMock;

  beforeEach(() => {
    // 🟢 QUAN TRỌNG: Xóa cache module của Jest trước mỗi test.
    // Việc này ép Node.js phải require lại file embed.service.js,
    // nhờ đó biến `let extractor = null;` sẽ được reset về trạng thái ban đầu.
    jest.resetModules();
    jest.clearAllMocks();
    
    // Tắt log để Terminal sạch sẽ khi chạy test
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Require module SAU KHI reset
    pipelineMock = require('@xenova/transformers').pipeline;
    embedService = require('../../src/services/embed.service'); // Thay đổi đường dẫn cho phù hợp
  });

  afterAll(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST loadModel()
  // ═══════════════════════════════════════════════════════════
  describe('loadModel()', () => {
    test('✅ Lần gọi đầu tiên: Khởi tạo model và lưu cache', async () => {
      const extractor = await embedService.loadModel();
      
      // Kiểm tra pipeline được gọi đúng tham số
      expect(pipelineMock).toHaveBeenCalledTimes(1);
      expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', embedService.MODEL_NAME);
      
      // Kiểm tra log hoạt động
      expect(console.log).toHaveBeenCalledWith('[EmbedService] Loading model......');
      expect(console.log).toHaveBeenCalledWith('[EmbedService] Model loaded');
      
      // Trả về đúng hàm model
      expect(extractor).toBe(mockModelFn);
    });

    test('✅ Các lần gọi tiếp theo: Sử dụng cache, không gọi lại pipeline', async () => {
      // Gọi lần 1
      await embedService.loadModel();
      // Gọi lần 2
      const extractor2 = await embedService.loadModel();
      
      // Pipeline vẫn chỉ được gọi 1 lần duy nhất từ lần thứ 1
      expect(pipelineMock).toHaveBeenCalledTimes(1);
      expect(extractor2).toBe(mockModelFn);
    });

    test('❌ Ném lỗi nếu pipeline khởi tạo thất bại', async () => {
      pipelineMock.mockRejectedValueOnce(new Error('Cannot download model'));

      await expect(embedService.loadModel()).rejects.toThrow('Cannot download model');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST embed() - Single Text
  // ═══════════════════════════════════════════════════════════
  describe('embed()', () => {
    test('✅ Chuyển đổi một đoạn text thành Array chứa các vector', async () => {
      const text = "Hello AI";
      const mockOutput = { data: new Float32Array([0.1, 0.2, 0.3]) };
      mockModelFn.mockResolvedValueOnce(mockOutput);

      const result = await embedService.embed(text);

      expect(mockModelFn).toHaveBeenCalledWith(text, {
        pooling: 'mean',
        normalize: true,
      });

      expect(Array.isArray(result)).toBe(true);
      // 🟢 FIX: Tạo expected array ép kiểu y hệt như logic thực tế để triệt tiêu sai số
      const expected = Array.from(new Float32Array([0.1, 0.2, 0.3]));
      expect(result).toEqual(expected);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST embedBatch() - Array of Texts
  // ═══════════════════════════════════════════════════════════
  describe('embedBatch()', () => {
    test('✅ Chuyển đổi mảng text thành Array chứa các vector', async () => {
      const texts = ["Hello", "World"];
      const mockOutput = { data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) };
      mockModelFn.mockResolvedValueOnce(mockOutput);

      const result = await embedService.embedBatch(texts);

      expect(mockModelFn).toHaveBeenCalledWith(texts, {
        pooling: 'mean',
        normalize: true,
      });

      expect(Array.isArray(result)).toBe(true);
      // 🟢 FIX: Tương tự, dùng Array.from để đồng bộ sai số
      const expected = Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
      expect(result).toEqual(expected);
    });
  });
});