jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn(),
  jobIdFor: jest.fn(),
  EVENTS: { 
    USER_REGISTERED: 'user.registered',
    PASSWORD_RESET: 'password.reset' 
  },
  DEFAULT_JOB_OPTIONS: {}
}));

const request  = require('supertest');
const express  = require('express');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');

const authController = require('../../src/controllers/auth.controller');
const User           = require('../../src/models/auth.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');
const { addJob }     = require('shared'); 

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
  app.put('/api/auth/change-password', authMiddleware, authController.changePassword);
  app.post('/api/auth/forgot-password', authController.forgotPassword);
  app.post('/api/auth/reset-password/:token', authController.resetPassword);

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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeTestDB();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  console.error.mockRestore();
  console.warn.mockRestore();
  console.log.mockRestore();
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

  test('✅ Đăng ký thành công — Lưu user vào Database, đẩy Job và trả về 201', async () => {
    addJob.mockResolvedValueOnce(true);

    const res = await request(app)
      .put('/api/auth/register')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Register successfully');
    
    const savedUser = await User.findOne({ email: validPayload.email });
    expect(savedUser).not.toBeNull();
    expect(savedUser.username).toBe('newuser_usth');
    
    expect(addJob).toHaveBeenCalled();
  });

  test('❌ Đăng ký thất bại — Email đã tồn tại (409)', async () => {
    await seedUser({ email: validPayload.email });

    const res = await request(app)
      .put('/api/auth/register')
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email has been registed');
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('DB Timeout'));
    const res = await request(app).put('/api/auth/register').send(validPayload);
    expect(res.status).toBe(500);
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

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('DB Timeout'));
    const res = await request(app).post('/api/auth/login').send({ email: 'test@gmail.com', password: '123' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/auth/profile
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/auth/profile', () => {
  const app = createApp();

  test('✅ Lấy thông tin profile thành công', async () => {
    const user = await seedUser({ email: 'profile@gmail.com' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

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

  test('❌ Lỗi Database (Crash) → 500', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ userId: fakeId }, process.env.JWT_SECRET);
    
    // 🟢 ĐÃ FIX: Giả lập method .select() cho Mongoose
    jest.spyOn(User, 'findById').mockImplementationOnce(() => ({
      select: jest.fn().mockRejectedValue(new Error('DB Crash'))
    }));

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/auth/change-password
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/auth/change-password', () => {
  const app = createApp();

  test('✅ Đổi mật khẩu thành công → 200', async () => {
    const user = await seedUser({ password: 'OldPassword123' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword123', newPassword: 'NewPassword456' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password updated successfully');

    const updatedUser = await User.findById(user._id);
    const isMatch = await updatedUser.comparePassword('NewPassword456');
    expect(isMatch).toBe(true);
  });

  test('❌ Thiếu trường currentPassword hoặc newPassword → 403', async () => {
    const token = jwt.sign({ userId: new mongoose.Types.ObjectId() }, process.env.JWT_SECRET);
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword123' });

    expect(res.status).toBe(403);
  });

  test('❌ Nhập sai mật khẩu hiện tại → 400', async () => {
    const user = await seedUser({ password: 'OldPassword123' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword', newPassword: 'NewPassword456' });

    expect(res.status).toBe(400);
  });

  test('❌ User không tồn tại (đã bị xóa) → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ userId: fakeId }, process.env.JWT_SECRET);

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword123', newPassword: 'NewPassword456' });

    expect(res.status).toBe(404);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ userId: fakeId }, process.env.JWT_SECRET);
    jest.spyOn(User, 'findById').mockRejectedValueOnce(new Error('Crash'));

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: '123', newPassword: '456' });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/auth/forgot-password', () => {
  const app = createApp();

  test('✅ Yêu cầu reset pass thành công (Email tồn tại) → 200', async () => {
    addJob.mockResolvedValueOnce(true);
    await seedUser({ email: 'forgot@gmail.com' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'forgot@gmail.com' });

    expect(res.status).toBe(200);
    expect(addJob).toHaveBeenCalled();

    const user = await User.findOne({ email: 'forgot@gmail.com' });
    expect(user.resetPasswordToken).toBeDefined();
  });

  test('✅ Email không tồn tại vẫn trả về 200 (Bảo mật chống dò quét email)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'notexist@gmail.com' });

    expect(res.status).toBe(200);
    expect(addJob).not.toHaveBeenCalled();
  });

  test('❌ Lỗi BullMQ Queue (Job Error) → Rollback DB và trả về 500', async () => {
    addJob.mockRejectedValueOnce(new Error('Queue Timeout'));
    await seedUser({ email: 'jobfail@gmail.com' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'jobfail@gmail.com' });

    expect(res.status).toBe(500);

    const user = await User.findOne({ email: 'jobfail@gmail.com' });
    expect(user.resetPasswordToken).toBeUndefined();
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('DB Query Failed'));
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'test@gmail.com' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/auth/reset-password/:token
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/auth/reset-password/:token', () => {
  const app = createApp();

  test('✅ Đặt lại mật khẩu thành công (Token hợp lệ) → 200', async () => {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
    
    const user = await seedUser({ 
      email: 'reset@gmail.com',
      resetPasswordToken: hashedToken,
      resetPasswordExpires: Date.now() + 10000
    });

    const res = await request(app)
      .post(`/api/auth/reset-password/${plainToken}`)
      .send({ newPassword: 'NewResetPassword123' });

    expect(res.status).toBe(200);

    const updatedUser = await User.findById(user._id);
    expect(updatedUser.resetPasswordToken).toBeUndefined();
    const isMatch = await updatedUser.comparePassword('NewResetPassword123');
    expect(isMatch).toBe(true);
  });

  test('❌ Sai Token hoặc Token đã hết hạn → 400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/invalid-fake-token')
      .send({ newPassword: 'NewPassword123' });

    expect(res.status).toBe(400);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('Crash'));
    const res = await request(app)
      .post('/api/auth/reset-password/some-token')
      .send({ newPassword: '123' });

    expect(res.status).toBe(500);
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
    const res = await request(app).get('/api/auth/internal/find-by-email').query({});
    expect(res.status).toBe(400);
  });

  test('❌ Truyền email không tồn tại trong hệ thống → 404', async () => {
    const res = await request(app).get('/api/auth/internal/find-by-email').query({ email: 'nobody@gmail.com' });
    expect(res.status).toBe(404);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    // 🟢 ĐÃ FIX: Giả lập method .select() cho Mongoose
    jest.spyOn(User, 'findOne').mockImplementationOnce(() => ({
      select: jest.fn().mockRejectedValue(new Error('Crash'))
    }));
    
    const res = await request(app).get('/api/auth/internal/find-by-email').query({ email: 'test@gmail.com' });
    expect(res.status).toBe(500);
  });
});