// ── 1. Mock Các Thư Viện Bên Ngoài ──────────────────────────
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

jest.mock('../../src/models/auth.model', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  // 🟢 ĐÃ FIX: Thêm sự kiện PASSWORD_RESET vào mock
  EVENTS: { 
    USER_REGISTERED: 'user.registered',
    PASSWORD_RESET: 'password.reset'
  },
  DEFAULT_JOB_OPTIONS: { attempts: 3 }
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { addJob } = require('shared');

const User = require('../../src/models/auth.model');
const authController = require('../../src/controllers/auth.controller');

// Thiết lập App và Route giả lập để test trực tiếp Controller
function createApp() {
  const app = express();
  app.use(express.json());

  // 🟢 ĐÃ FIX: Tách Auth Middleware giả lập ra để tái sử dụng
  const mockAuthMiddleware = (req, res, next) => {
    req.user = { userId: 'user-001' };
    next();
  };

  app.put('/api/auth/register', authController.register);
  app.post('/api/auth/login', authController.login);
  app.get('/api/auth/internal/find-by-email', authController.findByEmail);
  
  app.get('/api/auth/profile', mockAuthMiddleware, authController.getProfile);
  app.put('/api/auth/change-password', mockAuthMiddleware, authController.changePassword);
  app.post('/api/auth/forgot-password', authController.forgotPassword);
  app.post('/api/auth/reset-password/:token', authController.resetPassword);

  return app;
}

// ── Hàm tạo mới Mock Object để tránh State Mutation ────────
const getFreshUser = (overrides = {}) => ({
  _id: { toString: () => 'user-001' }, 
  email: 'test@gmail.com',
  username: 'testuser',
  globalRole: 'USER',
  isActive: true,
  comparePassword: jest.fn().mockResolvedValue(true),
  save: jest.fn().mockResolvedValue(true), // 🟢 ĐÃ FIX: Thêm mock hàm save()
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'my-super-secret-test-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  console.error.mockRestore();
  console.warn.mockRestore();
  console.log.mockRestore();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// PUT /api/auth/register
// ═══════════════════════════════════════════════════════════
describe('PUT /api/auth/register', () => {
  const app = createApp();

  const reqBody = {
    email: 'newuser@gmail.com',
    password: 'password123',
    username: 'newuser',
    globalRole: 'USER'
  };

  test('✅ Đăng ký thành công — trả về 201 và gọi Queue', async () => {
    User.findOne.mockResolvedValue(null); 
    User.create.mockResolvedValue(getFreshUser(reqBody));

    const res = await request(app).put('/api/auth/register').send(reqBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Register successfully');
    expect(res.body.user.email).toBe(reqBody.email);
    expect(User.create).toHaveBeenCalledWith(reqBody);
    expect(addJob).toHaveBeenCalled(); 
  });

  test('❌ Email đã tồn tại → 409', async () => {
    User.findOne.mockResolvedValue(getFreshUser());
    const res = await request(app).put('/api/auth/register').send(reqBody);
    expect(res.status).toBe(409);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Timeout'));
    const res = await request(app).put('/api/auth/register').send(reqBody);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  const app = createApp();
  const reqBody = { email: 'test@gmail.com', password: 'password123' };

  test('✅ Đăng nhập thành công — trả về 200 + token', async () => {
    const user = getFreshUser();
    User.findOne.mockResolvedValue(user);

    const res = await request(app).post('/api/auth/login').send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Login successfully');
    expect(res.body.token).toBe('mock-jwt-token');
    
    expect(user.comparePassword).toHaveBeenCalledWith('password123');
    expect(jwt.sign).toHaveBeenCalled();
  });

  test('❌ Email không tồn tại → 401', async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/login').send(reqBody);
    expect(res.status).toBe(401);
  });

  test('❌ Tài khoản bị khóa (isActive = false) → 403', async () => {
    const user = getFreshUser({ isActive: false });
    User.findOne.mockResolvedValue(user);
    const res = await request(app).post('/api/auth/login').send(reqBody);
    expect(res.status).toBe(403);
  });

  test('❌ Sai mật khẩu → 401', async () => {
    const user = getFreshUser();
    user.comparePassword.mockResolvedValue(false);
    User.findOne.mockResolvedValue(user);
    const res = await request(app).post('/api/auth/login').send(reqBody);
    expect(res.status).toBe(401);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).post('/api/auth/login').send(reqBody);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/auth/profile
// ═══════════════════════════════════════════════════════════
describe('GET /api/auth/profile', () => {
  const app = createApp();

  test('✅ Lấy profile thành công — trả về 200', async () => {
    const user = getFreshUser();
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(user)
    });

    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(200);
    expect(User.findById).toHaveBeenCalledWith('user-001'); 
  });

  test('❌ Không tìm thấy User → 404', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null)
    });

    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(404);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('DB Query Failed'))
    });

    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/auth/internal/find-by-email
// ═══════════════════════════════════════════════════════════
describe('GET /api/auth/internal/find-by-email', () => {
  const app = createApp();

  test('✅ Tìm thấy user bằng email — trả về 200', async () => {
    const user = getFreshUser({ email: 'target@gmail.com' });
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user)
    });

    const res = await request(app).get('/api/auth/internal/find-by-email').query({ email: 'target@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('target@gmail.com');
  });

  test('❌ Không truyền email → 400', async () => {
    const res = await request(app).get('/api/auth/internal/find-by-email').query({});
    expect(res.status).toBe(400);
  });

  test('❌ Email không tồn tại trong hệ thống → 404', async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null)
    });

    const res = await request(app).get('/api/auth/internal/find-by-email').query({ email: 'notfound@gmail.com' });
    expect(res.status).toBe(404);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('DB Error'))
    });

    const res = await request(app).get('/api/auth/internal/find-by-email').query({ email: 'test@gmail.com' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/auth/change-password
// ═══════════════════════════════════════════════════════════
describe('PUT /api/auth/change-password', () => {
  const app = createApp();
  const reqBody = { currentPassword: 'OldPassword123', newPassword: 'NewPassword456' };

  test('✅ Đổi mật khẩu thành công → 200', async () => {
    const user = getFreshUser();
    User.findById.mockResolvedValue(user);

    const res = await request(app).put('/api/auth/change-password').send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password updated successfully');
    expect(user.comparePassword).toHaveBeenCalledWith('OldPassword123');
    expect(user.save).toHaveBeenCalled();
  });

  test('❌ Thiếu dữ liệu đầu vào → 403', async () => {
    const res = await request(app).put('/api/auth/change-password').send({ currentPassword: '123' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Current and new password are required');
  });

  test('❌ Không tìm thấy user → 404', async () => {
    User.findById.mockResolvedValue(null);
    const res = await request(app).put('/api/auth/change-password').send(reqBody);
    expect(res.status).toBe(404);
  });

  test('❌ Nhập sai mật khẩu cũ → 400', async () => {
    const user = getFreshUser();
    user.comparePassword.mockResolvedValue(false); // Mật khẩu sai
    User.findById.mockResolvedValue(user);

    const res = await request(app).put('/api/auth/change-password').send(reqBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Incorrect current password');
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findById.mockRejectedValue(new Error('Crash DB'));
    const res = await request(app).put('/api/auth/change-password').send(reqBody);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ═══════════════════════════════════════════════════════════
describe('POST /api/auth/forgot-password', () => {
  const app = createApp();

  test('✅ Yêu cầu gửi email reset thành công → 200', async () => {
    const user = getFreshUser();
    User.findOne.mockResolvedValue(user);
    addJob.mockResolvedValue(true);

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'test@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If that email is registered, a reset link has been sent.');
    expect(user.save).toHaveBeenCalled();
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ Email không tồn tại vẫn trả về 200 (Chống rà quét email)', async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@gmail.com' });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If that email is registered, a reset link has been sent.');
    expect(addJob).not.toHaveBeenCalled(); // Không chạy job gửi mail
  });

  test('❌ Add Job gửi email lỗi → Bắt catch, Rollback User data và trả về 500', async () => {
    const user = getFreshUser();
    User.findOne.mockResolvedValue(user);
    addJob.mockRejectedValue(new Error('Queue Error')); // Giả lập đẩy queue lỗi

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'test@gmail.com' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Could not send reset email. Try again.');
    
    // Đảm bảo Rollback diễn ra
    expect(user.resetPasswordToken).toBeUndefined();
    expect(user.resetPasswordExpires).toBeUndefined();
    expect(user.save).toHaveBeenCalledTimes(2); // Lần 1 lưu token, lần 2 rollback
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Offline'));
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'test@gmail.com' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/reset-password/:token
// ═══════════════════════════════════════════════════════════
describe('POST /api/auth/reset-password/:token', () => {
  const app = createApp();

  test('✅ Đặt lại mật khẩu thành công → 200', async () => {
    const user = getFreshUser();
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/reset-password/sample-reset-token')
      .send({ newPassword: 'NewPassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password has been reset successfully. You can now login.');
    expect(user.password).toBe('NewPassword123'); // Đã gán mật khẩu mới
    expect(user.resetPasswordToken).toBeUndefined(); // Đã xóa token cũ
    expect(user.save).toHaveBeenCalled();
  });

  test('❌ Sai Token hoặc Token đã hết hạn → 400', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/reset-password/invalid-token')
      .send({ newPassword: 'NewPassword123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Token is invalid or has expired');
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Timeout'));
    
    const res = await request(app)
      .post('/api/auth/reset-password/sample-token')
      .send({ newPassword: 'NewPassword123' });

    expect(res.status).toBe(500);
  });
});