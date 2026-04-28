// Mock external services — không mock DB
jest.mock('axios');
jest.mock('shared', () => ({
  authMiddleware: (req, res, next) => {
    // Lấy token từ header để giả lập nhiều user khác nhau
    const token = req.headers['authorization']?.split(' ')[1];
    if (token === 'token-admin') {
      req.user = { userId: '000000000000000000000001' };
    } else if (token === 'token-member') {
      req.user = { userId: '000000000000000000000002' };
    } else if (token === 'token-outsider') {
      req.user = { userId: '000000000000000000000003' };
    } else {
      req.user = { userId: '000000000000000000000001' };
    }
    next();
  },
  addJob:              jest.fn().mockResolvedValue({ id: 'job-001' }),
  queueForEvent:       jest.fn((e) => `queue:${e}`),
  jobIdFor:            jest.fn((e, id) => `${e}:${id}`),
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  EVENTS: {
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
    MEMBER_ADDED:      'member.added',
    MEMBER_REMOVED:    'member.removed',
  },
}));

const request  = require('supertest');
const express  = require('express');
const mongoose = require('mongoose');
const axios    = require('axios');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

// Import model thật — dùng MongoDB in-memory
const Workspace = require('../../src/models/workspace.model');
const Folder    = require('../../src/models/folder.model');
const workspaceRoutes = require('../../src/routes/workspace.routes');

const ADMIN_ID    = '000000000000000000000001';
const MEMBER_ID   = '000000000000000000000002';
const OUTSIDER_ID = '000000000000000000000003';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', workspaceRoutes);
  return app;
}

// Seed workspace có sẵn để test
async function seedWorkspace(overrides = {}) {
  return Workspace.create({
    name:      'Integration Workspace',
    createdBy: new mongoose.Types.ObjectId(ADMIN_ID),
    members: [
      {
        userId:      new mongoose.Types.ObjectId(ADMIN_ID),
        role:        'ADMIN',
        permissions: 'editor',
      },
      {
        userId:      new mongoose.Types.ObjectId(MEMBER_ID),
        role:        'MEMBER',
        permissions: 'viewer',
      },
    ],
    ...overrides,
  });
}

beforeAll(async () => connectTestDB());
afterEach(async () => clearTestDB());
afterAll(async () => closeTestDB());

// ═══════════════════════════════════════════════════════════
// POST /api/workspaces
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/workspaces', () => {
  const app = createApp();

  test('✅ Tạo workspace — lưu đúng vào MongoDB', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'My New Workspace' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('My New Workspace');

    // Kiểm tra thực sự trong DB
    const saved = await Workspace.findById(res.body.data._id);
    expect(saved).not.toBeNull();
    expect(saved.name).toBe('My New Workspace');
    expect(saved.members[0].role).toBe('ADMIN');
    expect(saved.members[0].userId.toString()).toBe(ADMIN_ID);
  });

  test('✅ Người tạo tự động là ADMIN trong DB', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'Admin Check Workspace' });

    const saved = await Workspace.findById(res.body.data._id);
    const adminMember = saved.members.find((m) => m.userId.toString() === ADMIN_ID);

    expect(adminMember).toBeDefined();
    expect(adminMember.role).toBe('ADMIN');
    expect(adminMember.permissions).toBe('editor');
  });

  test('✅ Tạo nhiều workspace — độc lập nhau trong DB', async () => {
    await request(app)
      .post('/api/workspaces')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'Workspace A' });

    await request(app)
      .post('/api/workspaces')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'Workspace B' });

    const count = await Workspace.countDocuments();
    expect(count).toBe(2);
  });

  test('❌ Thiếu name → không lưu vào DB', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', 'Bearer token-admin')
      .send({});

    expect(res.status).toBe(400);
    const count = await Workspace.countDocuments();
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/workspaces
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/workspaces', () => {
  const app = createApp();

  test('✅ Lấy đúng workspace của user từ DB', async () => {
    await seedWorkspace({ name: 'Workspace Admin' });
    // Workspace mà outsider không thuộc
    await Workspace.create({
      name:      'Other Workspace',
      createdBy: new mongoose.Types.ObjectId(OUTSIDER_ID),
      members:   [{ userId: new mongoose.Types.ObjectId(OUTSIDER_ID), role: 'ADMIN', permissions: 'editor' }],
    });

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    // Admin chỉ thấy workspace của mình
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Workspace Admin');
  });

  test('✅ Trả mảng rỗng khi user không có workspace', async () => {
    // Seed workspace không có outsider
    await seedWorkspace();

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', 'Bearer token-outsider');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('✅ Soft deleted workspace không xuất hiện trong list', async () => {
    await seedWorkspace({ deletedAt: new Date() }); // đã xóa

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0); // pre-hook lọc ra
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/workspaces/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/workspaces/:id', () => {
  const app = createApp();

  test('✅ Lấy workspace theo ID từ DB thành công', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(ws._id.toString());
    expect(res.body.data.name).toBe('Integration Workspace');
  });

  test('❌ ID không tồn tại trong DB → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/workspaces/${fakeId}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(404);
  });

  test('❌ Outsider không phải thành viên → 403', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-outsider');

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/workspaces/:id/members
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/workspaces/:id/members', () => {
  const app = createApp();

  test('✅ Thêm member — lưu đúng vào DB', async () => {
    const ws = await seedWorkspace();
    axios.get.mockResolvedValue({
      data: { data: { _id: OUTSIDER_ID, email: 'outsider@gmail.com' } },
    });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .set('Authorization', 'Bearer token-admin')
      .send({ email: 'outsider@gmail.com', permissions: 'viewer' });

    expect(res.status).toBe(200);

    // Kiểm tra DB thực sự
    const updated = await Workspace.findById(ws._id);
    expect(updated.members).toHaveLength(3); // 2 cũ + 1 mới
    const newMember = updated.members.find(
      (m) => m.userId.toString() === OUTSIDER_ID
    );
    expect(newMember).toBeDefined();
    expect(newMember.permissions).toBe('viewer');
  });

  test('✅ Không truyền permissions — mặc định viewer trong DB', async () => {
    const ws = await seedWorkspace();
    axios.get.mockResolvedValue({
      data: { data: { _id: OUTSIDER_ID, email: 'outsider@gmail.com' } },
    });

    await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .set('Authorization', 'Bearer token-admin')
      .send({ email: 'outsider@gmail.com' });

    const updated = await Workspace.findById(ws._id);
    const newMember = updated.members.find(
      (m) => m.userId.toString() === OUTSIDER_ID
    );
    expect(newMember.permissions).toBe('viewer');
  });

  test('❌ MEMBER cố thêm người → 403, DB không thay đổi', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .set('Authorization', 'Bearer token-member')
      .send({ email: 'outsider@gmail.com' });

    expect(res.status).toBe(403);

    // DB không thay đổi
    const unchanged = await Workspace.findById(ws._id);
    expect(unchanged.members).toHaveLength(2);
  });

  test('❌ Thêm người đã có trong workspace → 400', async () => {
    const ws = await seedWorkspace();
    // member-id đã có trong members
    axios.get.mockResolvedValue({
      data: { data: { _id: MEMBER_ID, email: 'member@gmail.com' } },
    });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'member@gmail.com' })
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Member already in group workspace');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/workspaces/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/workspaces/:id', () => {
  const app = createApp();

  test('✅ Xóa workspace — deletedAt được set trong DB', async () => {
    const ws = await seedWorkspace();
    axios.delete.mockResolvedValue({ data: {} });

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);

    // Kiểm tra soft delete trong DB
    const deleted = await Workspace.findById(ws._id)
      .setOptions({ includeDeleted: true });
    expect(deleted.deletedAt).not.toBeNull();
  });

  test('✅ Xóa workspace — folders con cũng bị soft delete', async () => {
    const ws = await seedWorkspace();

    // Seed 2 folders thuộc workspace
    await Folder.create([
      { name: 'Folder 1', workspaceId: ws._id, createdBy: ADMIN_ID },
      { name: 'Folder 2', workspaceId: ws._id, createdBy: ADMIN_ID },
    ]);

    axios.delete.mockResolvedValue({ data: {} });

    await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-admin');

    // Kiểm tra folders bị soft delete
    const folders = await Folder.find({ workspaceId: ws._id })
      .setOptions({ includeDeleted: true });
    expect(folders.every((f) => f.deletedAt !== null)).toBe(true);
  });

  test('✅ Workspace đã xóa không hiện trong GET list', async () => {
    const ws = await seedWorkspace();
    axios.delete.mockResolvedValue({ data: {} });

    await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-admin');

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', 'Bearer token-admin');

    expect(res.body.data).toHaveLength(0);
  });

  test('❌ MEMBER cố xóa workspace → 403, DB không thay đổi', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('Authorization', 'Bearer token-member');

    expect(res.status).toBe(403);

    // DB không thay đổi
    const unchanged = await Workspace.findById(ws._id);
    expect(unchanged.deletedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/workspaces/:id/members/:targetUserId
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/workspaces/:id/members/:targetUserId', () => {
  const app = createApp();

  test('✅ ADMIN xóa MEMBER — member biến mất khỏi DB', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${MEMBER_ID}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);

    const updated = await Workspace.findById(ws._id);
    const stillMember = updated.members.find(
      (m) => m.userId.toString() === MEMBER_ID
    );
    expect(stillMember).toBeUndefined();
    expect(updated.members).toHaveLength(1);
  });

  test('✅ User tự rời khi còn admin khác — thành công', async () => {
    const ws = await seedWorkspace();
    // Thêm admin thứ 2
    ws.members.push({
      userId:      new mongoose.Types.ObjectId(OUTSIDER_ID),
      role:        'ADMIN',
      permissions: 'editor',
    });
    await ws.save();

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${ADMIN_ID}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);

    const updated = await Workspace.findById(ws._id);
    expect(updated.members).toHaveLength(2); // admin + outsider còn lại
  });

  test('❌ Admin duy nhất tự rời → 400, DB không thay đổi', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${ADMIN_ID}`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cannot leave workspace if you are only Admin');

    // DB không thay đổi
    const unchanged = await Workspace.findById(ws._id);
    expect(unchanged.members).toHaveLength(2);
  });

  test('❌ MEMBER cố xóa người khác → 403', async () => {
    const ws = await seedWorkspace();

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${ADMIN_ID}`)
      .set('Authorization', 'Bearer token-member');

    expect(res.status).toBe(403);
  });
});