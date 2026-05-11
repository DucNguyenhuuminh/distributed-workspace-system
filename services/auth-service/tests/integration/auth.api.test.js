// 🟢 BỔ SUNG MOCK CHO SHARED ĐỂ NGĂN REDIS CONNECTION
jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn(),
  jobIdFor: jest.fn(),
  EVENTS: { USER_REGISTERED: 'user.registered' },
  DEFAULT_JOB_OPTIONS: {}
}));

const request  = require('supertest');
const express  = require('express');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');

const authController = require('../../src/controllers/auth.controller');
const User           = require('../../src/models/auth.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

// ── Cài đặt App và Middleware giả lập ─────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };

  app.put('/api/auth/register', authController.register);
  app.post('/api/auth/login', authController.login);
  app.get('/api/auth/profile', authMiddleware, authController.getProfile);
  app.get('/api/auth/internal/find-by-email', authController.findByEmail);

  return app;
}

async function seedUser(overrides = {}) {
  return User.create({
    email: 'test@gmail.com',
    password: 'password123',
    username: 'testuser',
    globalRole: 'USER',
    isActive: true,
    ...overrides,
  });
}

beforeAll(async () => {
  await connectTestDB();
  process.env.JWT_SECRET = 'super-secret-integration-key';
  process.env.JWT_EXPIRES_IN = '1h';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await closeTestDB();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  console.error.mockRestore();
});

// ═══════════════════════════════════════════════════════════
// PUT /api/auth/register
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/auth/register', () => {
  const app = createApp();

  const validPayload = {
    email: 'newuser@usth.edu.vn',
    password: 'StrongPassword123!',
    username: 'newuser_usth',
    globalRole: 'USER'
  };

  test('✅ Đăng ký thành công — Lưu user vào Database và trả về 201', async () => {
    const res = await request(app)
      .put('/api/auth/register')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Register successfully');
    
    const savedUser = await User.findOne({ email: validPayload.email });
    expect(savedUser).not.toBeNull();
    expect(savedUser.username).toBe('newuser_usth');
  });

  test('❌ Đăng ký thất bại — Email đã tồn tại (409)', async () => {
    await seedUser({ email: validPayload.email });

    const res = await request(app)
      .put('/api/auth/register')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email has been registed');

    const count = await User.countDocuments({ email: validPayload.email });
    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/auth/login', () => {
  const app = createApp();

  test('✅ Đăng nhập thành công — Trả về JWT Token hợp lệ', async () => {
    await seedUser({ email: 'login@gmail.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@gmail.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Login successfully');
    expect(res.body.token).toBeDefined();

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.email).toBe('login@gmail.com');
  });

  test('❌ Đăng nhập thất bại — Sai mật khẩu (401)', async () => {
    await seedUser({ email: 'login@gmail.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@gmail.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  test('❌ Đăng nhập thất bại — Email không tồn tại (401)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notexist@gmail.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  test('❌ Đăng nhập thất bại — User đã bị khóa (403)', async () => {
    await seedUser({ email: 'banned@gmail.com', password: 'password123', isActive: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'banned@gmail.com', password: 'password123' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/auth/profile
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/auth/profile', () => {
  const app = createApp();

  test('✅ Lấy thông tin profile thành công', async () => {
    const user = await seedUser({ email: 'profile@gmail.com', password: 'password123' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'profile@gmail.com', password: 'password123' });
    
    const token = loginRes.body.token;

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user._id).toBe(user._id.toString());
  });

  test('❌ Gọi Profile với Token của User đã bị xóa khỏi DB → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ userId: fakeId }, process.env.JWT_SECRET);

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('❌ Không truyền Token → 401', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/auth/internal/find-by-email
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/auth/internal/find-by-email', () => {
  const app = createApp();

  test('✅ Lấy thông tin user thành công bằng Email', async () => {
    await seedUser({ email: 'internal@gmail.com' });

    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'internal@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('internal@gmail.com');
  });

  test('❌ Không truyền email parameter → 400', async () => {
    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({});

    expect(res.status).toBe(400);
  });

  test('❌ Truyền email không tồn tại trong hệ thống → 404', async () => {
    const res = await request(app)
      .get('/api/auth/internal/find-by-email')
      .query({ email: 'nobody@gmail.com' });

    expect(res.status).toBe(404);
  });
});