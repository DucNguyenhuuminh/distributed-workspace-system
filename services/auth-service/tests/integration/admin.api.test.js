// ── 1. Cấu hình Biến Môi Trường (Luôn để trên cùng) ────────
process.env.WORKSPACE_SERVICE_URL = 'http://localhost:3003';
process.env.STORAGE_SERVICE_URL = 'http://localhost:3005';
process.env.FILE_SERVICE_URL = 'http://localhost:3002';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');

// Mock Axios cho các external microservices
jest.mock('axios');

// Import Model và Controller của bạn
const User = require('../../src/models/auth.model');
const {
  getAllUsers, getUserById, banUser, 
  getWorkspaces, getWorkspaceByIdAdmin, 
  getFiles, getFileByIdAdmin, getSystemStats
} = require('../../src/controllers/admin.controller');

let mongod;

// ── 2. Cài đặt App giả lập (Setup Express) ─────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Middleware giả lập Authentication
  app.use((req, res, next) => {
    // Cho phép tuỳ biến userId thông qua header để test case "Tự ban chính mình"
    req.user = { userId: req.headers['x-admin-id'] || new mongoose.Types.ObjectId().toString() };
    req.headers.authorization = 'Bearer test-admin-token';
    next();
  });

  // Gắn các routes
  app.get('/api/admin/users', getAllUsers);
  app.get('/api/admin/users/:id', getUserById);
  app.patch('/api/admin/users/:id/ban', banUser);
  app.get('/api/admin/workspaces', getWorkspaces);
  app.get('/api/admin/workspaces/:id', getWorkspaceByIdAdmin);
  app.get('/api/admin/files', getFiles);
  app.get('/api/admin/files/:id', getFileByIdAdmin);
  app.get('/api/admin/stats', getSystemStats);

  return app;
}

// ── 3. Lifecycle Mongoose & Memory Server ──────────────────
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {}); // Ẩn log lỗi
  await User.deleteMany({}); // Dọn sạch DB trước mỗi test case
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
  console.error.mockRestore();
});

// ── 4. BẮT ĐẦU CÁC TEST SUITES ─────────────────────────────
describe('[Integration] Admin Controller', () => {
  const app = createApp();

  // ══════════════════════════════════════════════════════════
  // TEST: GET /api/admin/users
  // ══════════════════════════════════════════════════════════
  describe('[Integration] GET /api/admin/users', () => {
    beforeEach(async () => {
      // 🟢 ĐÃ FIX: Thêm trường password và username, đổi globalRole thành USER (hoặc giá trị hợp lệ trong Schema của bạn)
      await User.insertMany([
        { email: 'admin@test.com', username: 'admin', password: 'hashedpassword', globalRole: 'SYSTEM_ADMIN', isActive: true },
        { email: 'john@test.com', username: 'john_doe', password: 'hashedpassword', globalRole: 'USER', isActive: true },
        { email: 'banned@test.com', username: 'bad_user', password: 'hashedpassword', globalRole: 'USER', isActive: false }
      ]);
    });

    test('✅ Lấy danh sách users (Không query) → 200, phân trang đúng', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBe(3);
      expect(res.body.data.summary).toEqual(expect.objectContaining({
        total: 3, active: 2, banned: 1, admins: 1
      }));
    });

    test('✅ Lấy danh sách có search query (Tìm bằng username/email) → 200', async () => {
      const res = await request(app).get('/api/admin/users').query({ search: 'john' });
      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].username).toBe('john_doe');
    });

    test('✅ Lấy danh sách lọc theo role và isActive → 200', async () => {
      const res = await request(app).get('/api/admin/users').query({ role: 'USER', isActive: 'false' });
      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].email).toBe('banned@test.com');
    });

    test('❌ Lỗi Database (Giả lập lỗi Mongoose) → 500', async () => {
      jest.spyOn(User, 'find').mockImplementationOnce(() => { throw new Error('DB Crash'); });
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: GET /api/admin/users/:id
  // ══════════════════════════════════════════════════════════
  describe('[Integration] GET /api/admin/users/:id', () => {
    test('✅ Tìm thấy user → 200', async () => {
      // 🟢 ĐÃ FIX: Thêm password
      const user = await User.create({ email: 'test@abc.com', username: 'test', password: 'hashedpassword', globalRole: 'USER' });
      const res = await request(app).get(`/api/admin/users/${user._id}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(user._id.toString());
      expect(res.body.data.password).toBeUndefined(); // Đảm bảo không lộ password
    });

    test('❌ Không tìm thấy user → 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).get(`/api/admin/users/${fakeId}`);
      expect(res.status).toBe(404);
    });

    test('❌ Truyền ID không hợp lệ (Lỗi CastError của Mongoose) → 500', async () => {
      const res = await request(app).get(`/api/admin/users/invalid-id`);
      expect(res.status).toBe(500);
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: PATCH /api/admin/users/:id/ban
  // ══════════════════════════════════════════════════════════
  describe('[Integration] PATCH /api/admin/users/:id/ban', () => {
    test('❌ Admin tự khóa tài khoản của chính mình → 400', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .patch(`/api/admin/users/${adminId}/ban`)
        .set('x-admin-id', adminId); 

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot ban yourself');
    });

    test('❌ Khóa User không tồn tại → 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).patch(`/api/admin/users/${fakeId}/ban`);
      expect(res.status).toBe(404);
    });

    test('❌ Khóa một Admin hệ thống khác → 403', async () => {
      // 🟢 ĐÃ FIX: Thêm password
      const targetAdmin = await User.create({ email: 'admin2@test.com', username: 'ad2', password: 'hashedpassword', globalRole: 'SYSTEM_ADMIN' });
      const res = await request(app).patch(`/api/admin/users/${targetAdmin._id}/ban`);
      
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Cannot ban another System Admin');
    });

    test('✅ Đổi trạng thái từ Active sang Banned → 200', async () => {
      // 🟢 ĐÃ FIX: Thêm password
      const user = await User.create({ email: 'u1@test.com', username: 'u1', password: 'hashedpassword', isActive: true });
      const res = await request(app).patch(`/api/admin/users/${user._id}/ban`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('User banned successfully');
      expect(res.body.data.isActive).toBe(false);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.isActive).toBe(false);
    });

    test('✅ Đổi trạng thái từ Banned sang Active (Mở khóa) → 200', async () => {
      // 🟢 ĐÃ FIX: Thêm password
      const user = await User.create({ email: 'u2@test.com', username: 'u2', password: 'hashedpassword', isActive: false });
      const res = await request(app).patch(`/api/admin/users/${user._id}/ban`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('User unbanned successfully');
      expect(res.body.data.isActive).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: External Services (Axios)
  // ══════════════════════════════════════════════════════════
  describe('[Integration] External Service Integrations', () => {
    const endpoints = [
      { url: '/api/admin/workspaces', method: 'get' },
      { url: '/api/admin/workspaces/ws-123', method: 'get' },
      { url: '/api/admin/files', method: 'get' },
      { url: '/api/admin/files/file-123', method: 'get' }
    ];

    endpoints.forEach(({ url, method }) => {
      describe(`[Integration] ${method.toUpperCase()} ${url}`, () => {
        test('✅ Forward data thành công từ Microservice → 200', async () => {
          axios.get.mockResolvedValueOnce({ data: { success: true, fakeData: '123' } });
          const res = await request(app)[method](url);
          
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ success: true, fakeData: '123' });
        });

        test('❌ Microservice trả về HTTP Error (VD: 403 Forbidden) → 403', async () => {
          const err = new Error();
          err.response = { status: 403, data: { message: 'Service Denied' } };
          axios.get.mockRejectedValueOnce(err);

          const res = await request(app)[method](url);
          expect(res.status).toBe(403);
          expect(res.body.message).toBe('Service Denied');
        });

        test('❌ Microservice sập hoàn toàn (Không có response) → 500', async () => {
          axios.get.mockRejectedValueOnce(new Error('Network Error Timeout'));
          const res = await request(app)[method](url);

          expect(res.status).toBe(500);
          expect(res.body.message).toBe('Network Error Timeout');
        });
      });
    });
  });

  // ══════════════════════════════════════════════════════════
  // TEST: GET /api/admin/stats
  // ══════════════════════════════════════════════════════════
  describe('[Integration] GET /api/admin/stats', () => {
    test('✅ Lấy thống kê hệ thống thành công → 200', async () => {
      // 🟢 ĐÃ FIX: Thêm username và password
      await User.insertMany([
        { email: 'a@g.c', username: 'a', password: 'pwd', isActive: true },
        { email: 'b@g.c', username: 'b', password: 'pwd', isActive: true },
        { email: 'c@g.c', username: 'c', password: 'pwd', isActive: false }
      ]); // 3 total, 2 active, 1 banned

      // Mock Workspace Service Response
      axios.get.mockResolvedValueOnce({ data: { data: { total: 50 } } });
      
      // Mock File Service Response (Giả lập 5 GB)
      const mockFileSize = Math.pow(1024, 3) * 5; 
      axios.get.mockResolvedValueOnce({
        data: { data: { totalDocuments: 200, totalPhysicalFiles: 150, totalSizeBytes: mockFileSize, savedSizeBytes: 0, savedPercentage: 0 } }
      });

      const res = await request(app).get('/api/admin/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.users).toEqual({ total: 3, active: 2, banned: 1 });
      expect(res.body.data.workspaces.total).toBe(50);
      expect(res.body.data.files).toEqual(expect.objectContaining({
        totalDocuments: 200,
        totalSizeGB: "5.00" 
      }));
    });

    test('✅ Giữ vững API nếu 1 trong các Service bên ngoài bị sập (Fallback data) → 200', async () => {
      // Giả lập Service bị Offline
      axios.get.mockRejectedValue(new Error('Service Offline'));

      const res = await request(app).get('/api/admin/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.workspaces.total).toBe(0); // Fallback an toàn = 0
      expect(res.body.data.files.totalDocuments).toBe(0); // Fallback an toàn = 0
      expect(console.error).toHaveBeenCalled(); // Ghi nhận log catch
    });
  });
});