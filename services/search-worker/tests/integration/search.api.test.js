// ── 1. Mock External Boundaries ───────────────────────────────
const axios = require('axios');
const chromaService = require('../../src/config/chroma.config');

jest.mock('axios');
jest.mock('../../src/config/chroma.config', () => ({
  query: jest.fn()
}));

const request = require('supertest');
const express = require('express');
const { search } = require('../../src/controllers/search.controller'); 

// ── 2. Cài đặt App giả lập (Express + Auth Middleware) ────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Giả lập Auth Middleware luôn cho pass và gắn user info
  app.use((req, res, next) => {
    req.user = { userId: 'user-001' };
    req.headers.authorization = 'Bearer test-token';
    next();
  });

  // Gắn route
  app.get('/api/search', search);
  return app;
}

describe('[Integration] GET /api/search', () => {
  const app = createApp();

  beforeAll(() => {
    // Ẩn log để console không bị rác khi chạy test
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC CASE LỖI ĐẦU VÀO & QUYỀN (VALIDATION & AUTH FAILURES)
  // ═══════════════════════════════════════════════════════════
  test('❌ Không truyền tham số "q" → 400', async () => {
    const res = await request(app).get('/api/search');
    
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Câu hỏi tìm kiếm là bắt buộc');
    expect(chromaService.query).not.toHaveBeenCalled();
  });

  test('❌ Workspace không tồn tại (Workspace Service trả 404) → 404', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 404 } });

    const res = await request(app).get('/api/search?q=AI&workspaceId=ws-999');
    
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace không tồn tại');
  });

  test('❌ Workspace Service bị sập (Lỗi mạng/500) → 500', async () => {
    axios.get.mockRejectedValueOnce(new Error('Connection Timeout'));

    const res = await request(app).get('/api/search?q=AI&workspaceId=ws-123');
    
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to workspace-service');
  });

  test('❌ User không có trong danh sách member của Workspace → 403', async () => {
    // Giả lập WS chỉ có user-999, không có user-001 (user đang test)
    axios.get.mockResolvedValueOnce({
      data: { data: { members: [{ userId: 'user-999' }] } }
    });

    const res = await request(app).get('/api/search?q=AI&workspaceId=ws-123');
    
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Không có quyền tìm kiếm trong workspace này');
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC CASE THÀNH CÔNG (SUCCESS INTEGRATION)
  // ═══════════════════════════════════════════════════════════
  test('✅ ChromaDB không có dữ liệu khớp → 200 (Trả về mảng rỗng, bỏ qua File Service)', async () => {
    chromaService.query.mockResolvedValueOnce({
      ids: [[]], distances: [[]], documents: [[]], metadatas: [[]]
    });

    const res = await request(app).get('/api/search?q=NoResult');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.results).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled(); // Đảm bảo File Service không bị gọi thừa
  });

  test('✅ Tìm kiếm My Drive: Lấy kết quả từ ChromaDB và Map với File Service thành công → 200', async () => {
    // 1. Mock ChromaDB trả về 2 kết quả
    chromaService.query.mockResolvedValueOnce({
      ids: [['doc-1', 'doc-2']],
      distances: [[0.1, 0.2]], // Score sẽ là 0.9 và 0.8
      documents: [['Preview 1', 'Preview 2']],
      metadatas: [[{ type: 'pdf' }, { type: 'doc' }]]
    });

    // 2. Mock File Service trả về chi tiết của 2 file đó
    axios.get.mockResolvedValueOnce({
      data: { 
        data: [
          { _id: 'doc-1', name: 'File1.pdf' },
          { _id: 'doc-2', name: 'File2.doc' }
        ] 
      }
    });

    const res = await request(app).get('/api/search?q=Test');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    
    // Kiểm tra cấu trúc Data gộp (Enrich)
    const hits = res.body.data.results;
    expect(hits[0].documentId).toBe('doc-1');
    expect(hits[0].score).toBe(0.9);
    expect(hits[0].document.name).toBe('File1.pdf'); // Đã map thành công
    
    expect(hits[1].score).toBe(0.8);
    expect(hits[1].document.name).toBe('File2.doc');
  });

  test('✅ Tìm kiếm Workspace: Pass quyền WS + Graceful Degradation khi File Service sập → 200', async () => {
    // Xây dựng Smart Mock cho Axios để phản hồi theo URL
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/api/workspaces/')) {
        // Pass quyền Workspace
        return { data: { data: { members: [{ userId: 'user-001' }] } } };
      }
      if (url.includes('/api/files/')) {
        // Đánh sập File Service để test nhánh catch
        throw new Error('File Service is dead');
      }
    });

    // Mock ChromaDB trả về 1 kết quả
    chromaService.query.mockResolvedValueOnce({
      ids: [['doc-1']], distances: [[0.1]], documents: [['Preview 1']], metadatas: [[{}]]
    });

    const res = await request(app).get('/api/search?q=Graceful&workspaceId=ws-123');

    // 🟢 API vẫn phải trả về 200 dù File Service sập (Fallback data thô từ ChromaDB)
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.results[0].documentId).toBe('doc-1');
    expect(res.body.data.results[0].document).toBeUndefined(); // Không có data từ file service
    expect(console.error).toHaveBeenCalledWith('[Search] Cannot enrich with file-service:', 'File Service is dead');
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC CASE LỖI HỆ THỐNG SÂU (INTERNAL ERRORS)
  // ═══════════════════════════════════════════════════════════
  test('❌ ChromaDB bị Crash → 500', async () => {
    chromaService.query.mockRejectedValueOnce(new Error('Vector DB Down'));

    const res = await request(app).get('/api/search?q=Crash');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Vector DB Down');
  });
});