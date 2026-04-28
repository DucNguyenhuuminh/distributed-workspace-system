require('../../src/models/auth.model')
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

jest.mock('../../src/models/auth.model', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

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
  _id: 'user-001',
  email: 'test@gmail.com',
  username: 'testuser',
  globalRole: 'USER',
  isActive: true,
  // Mock instance method của mongoose document
  comparePassword: jest.fn().mockResolvedValue(true),
  ...overrides,
});

beforeAll(() => {
  process.env.JWT_SECRET = 'my-super-secret-test-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  console.error.mockRestore()
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

  test('✅ Đăng ký thành công — trả về 201', async () => {
    User.findOne.mockResolvedValue(null); // Chưa tồn tại
    User.create.mockResolvedValue(getFreshUser(reqBody));

    const res = await request(app)
      .put('/api/auth/register')
      .send(reqBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Register successfully');
    expect(res.body.user.email).toBe(reqBody.email);
    expect(User.create).toHaveBeenCalledWith(reqBody);
  });

  test('❌ Email đã tồn tại → 409', async () => {
    User.findOne.mockResolvedValue(getFreshUser()); // Đã tồn tại

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
    expect(res.body.user.email).toBe(user.email);
    
    expect(user.comparePassword).toHaveBeenCalledWith('password123');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id, email: user.email }),
      expect.any(String), // process.env.JWT_SECRET
      expect.objectContaining({ expiresIn: expect.any(String) })
    );
  });

  test('❌ Email không tồn tại → 401', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Email or password not true');
  });

  test('❌ Tài khoản bị khóa (isActive = false) → 403', async () => {
    const user = getFreshUser({ isActive: false });
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('User has been baned');
  });

  test('❌ Sai mật khẩu → 401', async () => {
    const user = getFreshUser();
    user.comparePassword.mockResolvedValue(false); // Trả về false khi check pass
    User.findOne.mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Email or password not true');
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/login')
      .send(reqBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB connection lost');
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
    expect(res.body.user._id).toBe('user-001');
    expect(User.findById).toHaveBeenCalledWith('user-001'); // Lấy từ auth middleware giả lập
  });

  test('❌ Không tìm thấy User → 404', async () => {
    User.findById.mockResolvedValue(null);

    const res = await request(app).get('/api/auth/profile');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('User not found');
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
    expect(User.findOne).toHaveBeenCalledWith({ email: 'target@gmail.com' });
  });

  test('❌ Không truyền email → 400', async () => {
    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Email is required');
  });

  test('❌ Email không tồn tại trong hệ thống → 404', async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'notfound@gmail.com' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('User not exist');
  });

  test('❌ Lỗi database (DB Crash) → 500', async () => {
    User.findOne.mockRejectedValue(new Error('DB Error'));

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'test@gmail.com' });

    expect(res.status).toBe(500);
  });
});