// ── 1. Mock Các Thư Viện Bên Ngoài ──────────────────────────
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

jest.mock('../../src/models/auth.model', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
}));

// 🟢 BỔ SUNG MOCK CHO SHARED (BULLMQ) ĐỂ KHÔNG BỊ CRASH KHI REGISTER
jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}:${id}`),
  EVENTS: { USER_REGISTERED: 'user.registered' },
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

  app.put('/api/auth/register', authController.register);
  app.post('/api/auth/login', authController.login);
  app.get('/api/auth/internal/find-by-email', authController.findByEmail);
  
  // Giả lập auth middleware truyền req.user cho route profile
  app.get('/api/auth/profile', (req, res, next) => {
    req.user = { userId: 'user-001' };
    next();
  }, authController.getProfile);

  return app;
}

// ── Hàm tạo mới Mock Object để tránh State Mutation ────────
const getFreshUser = (overrides = {}) => ({
  _id: { toString: () => 'user-001' }, // 🟢 Đảm bảo có toString() cho Controller gọi
  email: 'test@gmail.com',
  username: 'testuser',
  globalRole: 'USER',
  isActive: true,
  comparePassword: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'my-super-secret-test-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  console.error.mockRestore();
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

    const res = await request(app)
      .put('/api/auth/register')
      .send(reqBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Register successfully');
    expect(res.body.user.email).toBe(reqBody.email);
    expect(User.create).toHaveBeenCalledWith(reqBody);
    expect(addJob).toHaveBeenCalled(); // 🟢 Kiểm tra xem đã bắn event vào queue chưa
  });

  test('❌ Email đã tồn tại → 409', async () => {
    User.findOne.mockResolvedValue(getFreshUser());

    const res = await request(app)
      .put('/api/auth/register')
      .send(reqBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email has been registed');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Timeout'));

    const res = await request(app)
      .put('/api/auth/register')
      .send(reqBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Timeout');
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

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Login successfully');
    expect(res.body.token).toBe('mock-jwt-token');
    
    expect(user.comparePassword).toHaveBeenCalledWith('password123');
    expect(jwt.sign).toHaveBeenCalled();
  });

  test('❌ Email không tồn tại → 401', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(401);
  });

  test('❌ Tài khoản bị khóa (isActive = false) → 403', async () => {
    const user = getFreshUser({ isActive: false });
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(403);
  });

  test('❌ Sai mật khẩu → 401', async () => {
    const user = getFreshUser();
    user.comparePassword.mockResolvedValue(false);
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(401);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

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
    User.findById.mockResolvedValue(user);

    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(200);
    expect(User.findById).toHaveBeenCalledWith('user-001'); 
  });

  test('❌ Không tìm thấy User → 404', async () => {
    User.findById.mockResolvedValue(null);

    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(404);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findById.mockRejectedValue(new Error('DB Query Failed'));

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
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'target@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('target@gmail.com');
  });

  test('❌ Không truyền email → 400', async () => {
    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({});

    expect(res.status).toBe(400);
  });

  test('❌ Email không tồn tại trong hệ thống → 404', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'notfound@gmail.com' });

    expect(res.status).toBe(404);
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Error'));

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'test@gmail.com' });

    expect(res.status).toBe(500);
  });
});