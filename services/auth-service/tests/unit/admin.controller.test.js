// ── 1. Setup Biến Môi Trường (PHẢI ĐẶT TRƯỚC KHI REQUIRE CONTROLLER) ──
process.env.WORKSPACE_SERVICE_URL = 'http://localhost:3003';
process.env.STORAGE_SERVICE_URL = 'http://localhost:3005';
process.env.FILE_SERVICE_URL = 'http://localhost:3002'; // Phải khai báo biến này

// ── 2. Mock Dependencies ────────────────────────────────────
jest.mock('axios');
jest.mock('../../src/models/auth.model');

const axios = require('axios');
const User = require('../../src/models/auth.model');
const {
  getAllUsers, getUserById, banUser, 
  getWorkspaces, getWorkspaceByIdAdmin, 
  getFiles, getFileByIdAdmin, getSystemStats
} = require('../../src/controllers/admin.controller');

// ── 3. Helpers ──────────────────────────────────────────────
const mockRequest = (query = {}, params = {}, body = {}, userId = 'admin-1') => ({
  query,
  params,
  body,
  user: { userId },
  headers: { authorization: 'Bearer admin-token' }
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Hàm giả lập Mongoose Query Chaining (.select.sort.skip.limit)
const mockMongooseQuery = (data) => {
  const query = Promise.resolve(data);
  query.select = jest.fn().mockReturnValue(query);
  query.sort = jest.fn().mockReturnValue(query);
  query.skip = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  return query;
};

// ── 4. Test Suites ──────────────────────────────────────────
describe('Admin Controller - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {}); // Ẩn console.error khi test ngoại lệ
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  // ══════════════════════════════════════════════════════════
  // TEST: getAllUsers
  // ══════════════════════════════════════════════════════════
  describe('getAllUsers', () => {
    test('✅ Lấy danh sách users mặc định (Không có query) → 200', async () => {
      const req = mockRequest();
      const res = mockResponse();

      User.countDocuments.mockResolvedValue(50);
      User.find.mockReturnValue(mockMongooseQuery([{ id: 'u1', email: 'test@g.c' }]));

      await getAllUsers(req, res);

      expect(User.countDocuments).toHaveBeenCalled();
      expect(User.find).toHaveBeenCalledWith({});
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          users: expect.any(Array),
          pagination: expect.objectContaining({ total: 50, totalPages: 3, page: 1, limit: 20 }),
          summary: expect.any(Object)
        })
      }));
    });

    test('✅ Lấy danh sách có Query (search, role, isActive) → 200', async () => {
      const req = mockRequest({ search: 'john', role: 'MEMBER', isActive: 'true', page: '2', limit: '10' });
      const res = mockResponse();

      User.countDocuments.mockResolvedValue(5);
      User.find.mockReturnValue(mockMongooseQuery([]));

      await getAllUsers(req, res);

      const expectedQuery = {
        $or: [
          { email: { $regex: 'john', $options: 'i' } },
          { username: { $regex: 'john', $options: 'i' } }
        ],
        globalRole: 'MEMBER',
        isActive: true
      };

      expect(User.find).toHaveBeenCalledWith(expectedQuery);
      expect(res.json).toHaveBeenCalled();
    });

    test('❌ Lỗi Database → 500', async () => {
      const req = mockRequest();
      const res = mockResponse();
      User.countDocuments.mockRejectedValue(new Error('DB Crash'));

      await getAllUsers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'DB Crash' });
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: getUserById
  // ══════════════════════════════════════════════════════════
  describe('getUserById', () => {
    test('✅ Tìm thấy user → 200', async () => {
      const req = mockRequest({}, { id: 'u1' });
      const res = mockResponse();

      User.findById.mockReturnValue(mockMongooseQuery({ id: 'u1', username: 'Test' }));

      await getUserById(req, res);

      expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'u1' }) });
    });

    test('❌ Không tìm thấy user → 404', async () => {
      const req = mockRequest({}, { id: 'u99' });
      const res = mockResponse();

      User.findById.mockReturnValue(mockMongooseQuery(null));

      await getUserById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: banUser
  // ══════════════════════════════════════════════════════════
  describe('banUser', () => {
    test('❌ Admin tự khóa chính mình → 400', async () => {
      const req = mockRequest({}, { id: 'admin-1' }, {}, 'admin-1');
      const res = mockResponse();

      await banUser(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Cannot ban yourself' });
    });

    test('❌ User không tồn tại → 404', async () => {
      const req = mockRequest({}, { id: 'u99' }, {}, 'admin-1');
      const res = mockResponse();
      User.findById.mockResolvedValue(null);

      await banUser(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('❌ Cấm khóa admin hệ thống khác → 403', async () => {
      const req = mockRequest({}, { id: 'admin-2' }, {}, 'admin-1');
      const res = mockResponse();
      User.findById.mockResolvedValue({ globalRole: 'SYSTEM_ADMIN' });

      await banUser(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Cannot ban another System Admin' });
    });

    test('✅ Khóa User thành công (Đang active -> Banned) → 200', async () => {
      const req = mockRequest({}, { id: 'u1' }, {}, 'admin-1');
      const res = mockResponse();
      
      const mockUser = { id: 'u1', isActive: true, save: jest.fn() };
      User.findById.mockResolvedValue(mockUser);

      await banUser(req, res);

      expect(mockUser.isActive).toBe(false); // Trạng thái đã bị đảo ngược
      expect(mockUser.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: 'User banned successfully'
      }));
    });

    test('✅ Mở khóa User thành công (Đang banned -> Active) → 200', async () => {
      const req = mockRequest({}, { id: 'u1' }, {}, 'admin-1');
      const res = mockResponse();
      
      const mockUser = { id: 'u1', isActive: false, save: jest.fn() };
      User.findById.mockResolvedValue(mockUser);

      await banUser(req, res);

      expect(mockUser.isActive).toBe(true);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: 'User unbanned successfully'
      }));
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: External Services (Workspaces & Files)
  // ══════════════════════════════════════════════════════════
  describe('External Service Integrations', () => {
    const endpoints = [
      { name: 'getWorkspaces', method: getWorkspaces },
      { name: 'getWorkspaceByIdAdmin', method: getWorkspaceByIdAdmin, params: { id: '1' } },
      { name: 'getFiles', method: getFiles },
      { name: 'getFileByIdAdmin', method: getFileByIdAdmin, params: { id: '1' } }
    ];

    endpoints.forEach(({ name, method, params = {} }) => {
      describe(name, () => {
        test('✅ Request thành công → 200', async () => {
          const req = mockRequest({}, params);
          const res = mockResponse();
          axios.get.mockResolvedValue({ data: { success: true } });

          await method(req, res);

          expect(axios.get).toHaveBeenCalled();
          expect(res.json).toHaveBeenCalledWith({ success: true });
        });

        test('❌ Request lỗi từ microservice (Có response) → Trả về đúng HTTP Status Code', async () => {
          const req = mockRequest({}, params);
          const res = mockResponse();
          const err = new Error();
          err.response = { status: 403, data: { message: 'Forbidden access' } };
          axios.get.mockRejectedValue(err);

          await method(req, res);

          expect(res.status).toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden access' });
        });

        test('❌ Lỗi Network / Sập server → 500', async () => {
          const req = mockRequest({}, params);
          const res = mockResponse();
          axios.get.mockRejectedValue(new Error('Network down'));

          await method(req, res);

          expect(res.status).toHaveBeenCalledWith(500);
          expect(res.json).toHaveBeenCalledWith({ message: 'Network down' });
        });
      });
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: getSystemStats
  // ══════════════════════════════════════════════════════════
  describe('getSystemStats', () => {
    test('✅ Lấy System Stats thành công → 200', async () => {
      const req = mockRequest();
      const res = mockResponse();

      User.countDocuments
        .mockResolvedValueOnce(100) // Total Users
        .mockResolvedValueOnce(90)  // Active
        .mockResolvedValueOnce(10); // Banned

      // Mock Workspace Axios
      axios.get.mockResolvedValueOnce({ data: { data: { total: 50 } } });
      
      // Mock File Axios
      const mockFileSize = Math.pow(1024, 3) * 5; // 5 GB
      axios.get.mockResolvedValueOnce({
        data: { data: { totalDocuments: 200, totalPhysicalFiles: 150, totalSizeBytes: mockFileSize, savedSizeBytes: 0, savedPercentage: 0 } }
      });

      await getSystemStats(req, res);

      expect(res.json).toHaveBeenCalledWith({
        data: {
          users: { total: 100, active: 90, banned: 10 },
          workspaces: { total: 50 },
          files: expect.objectContaining({
            totalDocuments: 200,
            totalSizeGB: "5.00" 
          })
        }
      });
    });

    test('✅ Fallback dữ liệu an toàn nếu 1 trong các Service bị sập → 200', async () => {
      const req = mockRequest();
      const res = mockResponse();

      User.countDocuments.mockResolvedValue(10);

      // Giả lập Axios sập (Khối catch nội bộ cho axios sẽ hoạt động)
      axios.get.mockRejectedValue(new Error('Service Offline'));

      await getSystemStats(req, res);

      expect(console.error).toHaveBeenCalledTimes(2); // In log lỗi cho 2 axios request
      
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaces: { total: 0 }, // Dữ liệu Fallback
          files: expect.objectContaining({ totalDocuments: 0 }) // Dữ liệu Fallback
        })
      });
    });

    test('❌ Lỗi Database khi đếm User → 500', async () => {
      const req = mockRequest();
      const res = mockResponse();

      User.countDocuments.mockRejectedValue(new Error('DB Crash'));

      await getSystemStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'DB Crash' });
    });
  });
});