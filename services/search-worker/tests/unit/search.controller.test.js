// ── 1. Mock External Services ─────────────────────────────────
const axios = require('axios');
const chromaService = require('../../src/config/chroma.config');

jest.mock('axios');
jest.mock('../../src/config/chroma.config', () => ({
  query: jest.fn()
}));
jest.mock('../../src/services/embed.service', () => ({
  embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) 
}));


const { search } = require('../../src/controllers/search.controller');

// ── 2. Cài đặt biến môi trường giả lập ─────────────────────────
describe('Search Controller', () => {
  let req, res;

  beforeAll(() => {
    // Ẩn log lỗi để terminal test sạch sẽ
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    req = {
      query: {},
      user: { userId: 'user-001' },
      headers: { authorization: 'Bearer test-token' }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC CASE THẤT BẠI TRONG VALIDATION & WORKSPACE AUTH
  // ═══════════════════════════════════════════════════════════
  test('❌ Thiếu câu hỏi tìm kiếm (q là undefined) → 400', async () => {
    await search(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Message search is required' });
  });

  test('❌ Câu hỏi tìm kiếm chỉ chứa khoảng trắng → 400', async () => {
    req.query.q = '      ';
    await search(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ Workspace không tồn tại (Axios 404) → 404', async () => {
    req.query = { q: 'Test', workspaceId: 'ws-999' };
    axios.get.mockRejectedValueOnce({ response: { status: 404 } });

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Workspace not exists' });
  });

  test('❌ Workspace Service bị sập (Axios 500) → 500', async () => {
    req.query = { q: 'Test', workspaceId: 'ws-123' };
    axios.get.mockRejectedValueOnce(new Error('Network timeout'));

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot connect to workspace-service' });
  });

  test('❌ Người dùng không phải thành viên Workspace → 403', async () => {
    req.query = { q: 'Test', workspaceId: 'ws-123' };
    // Mock user-001 không có trong danh sách
    axios.get.mockResolvedValueOnce({
      data: { data: { members: [{ userId: 'user-999' }] } }
    });

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'You have no permission to look up in this workspace' });
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC CASE LIÊN QUAN ĐẾN CHROMADB & FILE SERVICE (SUCCESS)
  // ═══════════════════════════════════════════════════════════
  test('✅ ChromaDB không tìm thấy kết quả → 200 & mảng rỗng (Bỏ qua gọi File Service)', async () => {
    req.query.q = 'Tìm không ra';
    chromaService.query.mockResolvedValueOnce({
      ids: [[]], distances: [[]], documents: [[]], metadatas: [[]]
    });

    await search(req, res);

    expect(chromaService.query).toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled(); // Không gọi File Service nếu không có ID
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: { query: 'Tìm không ra', total: 0, results: [] }
    }));
  });

  test('✅ Tìm kiếm My Drive thành công & Gộp (Enrich) data MongoDB thành công → 200', async () => {
    req.query.q = 'AI';

    // 1. Mock ChromaDB trả về hit
    const longText = 'Nội dung dài... '.repeat(15);
    chromaService.query.mockResolvedValueOnce({
      ids: [['doc-1']],
      distances: [[0.15]], // Score = 1 - 0.15 = 0.85
      documents: [[longText]],
      metadatas: [[{ mimeType: 'pdf' }]]
    });

    // 2. Mock File Service trả về file info
    axios.get.mockResolvedValueOnce({
      data: { data: [{ _id: 'doc-1', name: 'AI_Report.pdf' }] }
    });

    await search(req, res);

    // Kiểm tra gọi File Service đúng param
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/internal/by-searching'),
      expect.objectContaining({ params: { ids: 'doc-1' } })
    );

    const responseData = res.json.mock.calls[0][0];
    const hit = responseData.data.results[0];

    expect(responseData.data.total).toBe(1);
    expect(hit.score).toBe(0.85);
    expect(hit.preview.length).toBe(200);
    // Kiểm tra data đã được merge thành công
    expect(hit.document.name).toBe('AI_Report.pdf'); 
  });

  test('✅ Tìm kiếm Workspace thành công & Graceful Degradation khi File Service sập → 200', async () => {
    req.query = { q: 'Báo cáo', workspaceId: 'ws-123' };

    // 1. Mock Router Axios: Cho phép Workspace thành công, nhưng File Service thất bại
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/workspaces/')) {
        return Promise.resolve({ data: { data: { members: [{ userId: 'user-001' }] } } });
      }
      if (url.includes('/api/files/')) {
        return Promise.reject(new Error('File Service is down')); // Đánh sập File Service
      }
    });

    // 2. Mock ChromaDB trả về hit
    chromaService.query.mockResolvedValueOnce({
      ids: [['doc-1']],
      distances: [[0.2]],
      documents: [['Ngắn gọn']],
      metadatas: [[{ mimeType: 'txt' }]]
    });

    await search(req, res);

    const responseData = res.json.mock.calls[0][0];
    
    // Vẫn trả về 200 thành công dù File Service sập
    expect(responseData.message).toBe('Search successfully');
    expect(responseData.data.total).toBe(1);
    
    // Kết quả trả về sẽ là hit thô (không có thuộc tính document được merge vào)
    const hit = responseData.data.results[0];
    expect(hit.documentId).toBe('doc-1');
    expect(hit.document).toBeUndefined(); // Thuộc tính này không được thêm do catch block trả về hits gốc
  });

  test('❌ Lỗi hệ thống bất ngờ ở scope ngoài (ChromaDB sập) → 500', async () => {
    req.query.q = 'Lỗi';
    chromaService.query.mockRejectedValueOnce(new Error('Chroma Crash'));

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Chroma Crash' });
  });
});