// ── 1. Mock chromadb triệt để, tránh hoàn toàn lỗi Hoisting ──
jest.mock('chromadb', () => {
  // Tạo mock functions cho các thao tác của Collection
  const mockCollection = {
    upsert: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };
  
  // Tạo mock function cho thao tác khởi tạo
  const mockGetOrCreateCollection = jest.fn().mockResolvedValue(mockCollection);

  return {
    ChromaClient: jest.fn().mockImplementation(() => ({
      getOrCreateCollection: mockGetOrCreateCollection,
    })),
    DefaultEmbeddingFunction: jest.fn(),
    
    // Export ngầm các mock này ra ngoài để bài test có thể kiểm tra (expect)
    __mockCollection: mockCollection, 
    __mockGetOrCreateCollection: mockGetOrCreateCollection
  };
});

const chromadb = require('chromadb');
// Chú ý: Đổi đường dẫn này cho đúng với cấu trúc dự án của bạn
const chromaConfig = require('../../src/config/chroma.config'); 

describe('ChromaDB Configuration & Operations', () => {
  let mockCollection;
  let mockGetOrCreate;

  beforeAll(() => {
    // Ẩn log/error console để Terminal không bị rác khi test chạy
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Lấy các instance mock đã được tạo bên trong jest.mock()
    mockCollection = chromadb.__mockCollection;
    mockGetOrCreate = chromadb.__mockGetOrCreateCollection;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST KHỞI TẠO COLLECTION
  // ═══════════════════════════════════════════════════════════
  describe('initCollection()', () => {
    test('✅ Khởi tạo collection thành công', async () => {
      mockGetOrCreate.mockResolvedValueOnce(mockCollection);
      
      const collection = await chromaConfig.initCollection();
      
      expect(collection).toBeDefined();
      expect(mockGetOrCreate).toHaveBeenCalledWith({
        name: 'documents',
        embeddingFunction: expect.any(Object),
        metadata: { 'hnsw:space': 'cosine' },
      });
      expect(console.log).toHaveBeenCalledWith('[ChromaDB] Collection "documents" ready');
    });

    test('❌ Khởi tạo thất bại ném ra lỗi và log error', async () => {
      const error = new Error('ChromaDB Connection Refused');
      mockGetOrCreate.mockRejectedValueOnce(error);

      // Phải dùng rejects.toThrow() vì hàm này có ném lỗi (throw err) ra ngoài
      await expect(chromaConfig.initCollection()).rejects.toThrow('ChromaDB Connection Refused');
      expect(console.error).toHaveBeenCalledWith('[ChromaDB] Error to init collection: ChromaDB Connection Refused');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST CÁC THAO TÁC CRUD TRÊN COLLECTION
  // ═══════════════════════════════════════════════════════════
  describe('CRUD Operations (upsert, delete, query)', () => {
    
    beforeAll(async () => {
      // QUAN TRỌNG: Phải gọi initCollection() một lần để biến `collection`
      // trong file config không bị undefined trước khi chạy các test CRUD.
      mockGetOrCreate.mockResolvedValueOnce(mockCollection);
      await chromaConfig.initCollection();
    });

    test('✅ upsertDocuments: Gửi đúng định dạng mảng', async () => {
      const payload = { id: 'doc-123', document: 'Hello AI', metadata: { source: 'pdf' } };
      await chromaConfig.upsertDocuments(payload);

      expect(mockCollection.upsert).toHaveBeenCalledWith({
        ids: ['doc-123'],
        documents: ['Hello AI'],
        metadatas: [{ source: 'pdf' }],
      });
    });

    test('✅ deleteById: Gửi đúng query chứa ids', async () => {
      await chromaConfig.deleteById('doc-999');
      expect(mockCollection.delete).toHaveBeenCalledWith({ ids: ['doc-999'] });
    });

    test('✅ deleteByWorkspace: Gửi đúng query chứa where', async () => {
      await chromaConfig.deleteByWorkspace('ws-001');
      expect(mockCollection.delete).toHaveBeenCalledWith({ where: { workspaceId: 'ws-001' } });
    });

    test('✅ query: Xử lý đúng khi CÓ truyền điều kiện "where"', async () => {
      // Giả lập kết quả trả về từ ChromaDB
      mockCollection.query.mockResolvedValueOnce({ ids: [['doc-result']] });
      
      const result = await chromaConfig.query({ 
        text: 'Tìm kiếm', 
        nResults: 5, 
        where: { workspaceId: 'ws-abc' } 
      });
      
      expect(mockCollection.query).toHaveBeenCalledWith({
        queryTexts: ['Tìm kiếm'],
        nResults: 5,
        where: { workspaceId: 'ws-abc' },
      });
      expect(result.ids[0][0]).toBe('doc-result');
    });

    test('✅ query: Xử lý an toàn tham số mặc định (KHÔNG truyền where, nResults)', async () => {
      await chromaConfig.query({ text: 'Tìm kiếm mặc định' }); 
      
      expect(mockCollection.query).toHaveBeenCalledWith({
        queryTexts: ['Tìm kiếm mặc định'],
        nResults: 10, // nResults phải nhận giá trị mặc định là 10
        where: undefined, // where tự động fallback về undefined
      });
    });
  });
});