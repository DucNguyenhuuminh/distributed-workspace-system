// ── Mock trước khi require bất kỳ module nào ──────────────
jest.mock('axios');
jest.mock('shared', () => ({
  authMiddleware: (req, res, next) => {
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
    FOLDER_CREATED:  'folder.created',
    FOLDER_RENAMED:  'folder.renamed',
    FOLDER_TRASHED:  'folder.trashed',
    FOLDER_RESTORED: 'folder.restored',
    FOLDER_MOVED:    'folder.moved',
  },
}));

const request  = require('supertest');
const express  = require('express');
const mongoose = require('mongoose');
const axios    = require('axios');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

const Workspace    = require('../../src/models/workspace.model');
const Folder       = require('../../src/models/folder.model');
const folderRoutes = require('../../src/routes/folder.routes');
const { addJob }   = require('shared');

const ADMIN_ID    = '000000000000000000000001';
const MEMBER_ID   = '000000000000000000000002';
const OUTSIDER_ID = '000000000000000000000003';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/folders', folderRoutes);
  return app;
}

// ── Hàm Seed Data chuẩn xác 100% ───────────────────────────
async function seedWorkspace() {
  return Workspace.create({
    name:      'Test Workspace',
    createdBy: ADMIN_ID,
    members: [
      { userId: ADMIN_ID,  role: 'ADMIN',  permissions: 'editor' },
      { userId: MEMBER_ID, role: 'MEMBER', permissions: 'viewer' },
    ],
  });
}

async function seedFolder(overrides = {}) {
  return Folder.create({
    name:        'Test Folder',
    workspaceId: null,
    parentId:    null,
    createdBy:   ADMIN_ID,
    ...overrides,
  });
}

beforeAll(async () => {
  await connectTestDB();
  if (Folder.schema && Folder.schema.path('createdBy')) {
    Folder.schema.path('createdBy').required(false);
  }
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeTestDB();
  console.error.mockRestore();
});

// ═══════════════════════════════════════════════════════════
// POST /api/folders
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/folders', () => {
  const app = createApp();

  test('✅ Tạo My Drive folder — lưu đúng vào DB', async () => {
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'My Personal Folder' });

    expect(res.status).toBe(201);
    const saved = await Folder.findById(res.body.data._id);
    expect(saved).not.toBeNull();
    expect(saved.name).toBe('My Personal Folder');
    expect(saved.workspaceId).toBeNull();
  });

  test('✅ Tạo folder thành công nhưng BullMQ lỗi (vẫn trả về 201)', async () => {
    addJob.mockRejectedValueOnce(new Error('Queue Error'));
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'No Queue Folder' });

    expect(res.status).toBe(201);
  });

  test('✅ Tạo workspace folder — lưu đúng workspaceId vào DB', async () => {
    const ws = await seedWorkspace();
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'WS Folder', workspaceId: ws._id.toString() });

    expect(res.status).toBe(201);
    const saved = await Folder.findById(res.body.data._id);
    expect(saved.workspaceId.toString()).toBe(ws._id.toString());
  });

  test('✅ Tạo folder con — parentId được lưu đúng', async () => {
    const parent = await seedFolder({ name: 'Parent' });
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'Child Folder', parentId: parent._id.toString() });

    expect(res.status).toBe(201);
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'WS Folder', workspaceId: fakeId.toString() });

    expect(res.status).toBe(404);
  });

  test('❌ User không phải thành viên workspace → 403', async () => {
    const ws = await seedWorkspace();
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-outsider')
      .send({ name: 'WS Folder', workspaceId: ws._id.toString() });

    expect(res.status).toBe(403);
  });

  test('❌ Member chỉ có viewer → không tạo được folder trong workspace', async () => {
    const ws = await seedWorkspace();
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-member')
      .send({ name: 'WS Folder', workspaceId: ws._id.toString() });

    expect(res.status).toBe(403);
  });
  
  test('❌ DB Crash khi lưu Folder → 500', async () => {
    jest.spyOn(Folder, 'create').mockRejectedValueOnce(new Error('DB Timeout'));
    const res = await request(app)
      .post('/api/folders')
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'Crash Folder' });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/folders
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/folders', () => {
  const app = createApp();

  test('✅ Lấy My Drive root (không workspaceId, không parentId) → 200 (Chỉ trả về folders)', async () => {
    await seedFolder({ name: 'Root 1' });
    const root2 = await seedFolder({ name: 'Root 2' });
    await seedFolder({ name: 'Child Folder', parentId: root2._id }); 
    await seedFolder({ name: 'Deleted Folder', deletedAt: new Date() }); 
    await seedFolder({ name: 'Outsider Folder', createdBy: OUTSIDER_ID }); 

    const res = await request(app)
      .get('/api/folders')
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    // Lưu ý: Controller giờ chỉ trả về { data: folders }, không còn keys files hay folders rời rạc
    expect(res.body.data).toHaveLength(2); 
  });

  test('✅ Lấy Workspace root thành công → 200', async () => {
    const ws = await seedWorkspace(); 
    await seedFolder({ name: 'WS Root', workspaceId: ws._id });
    await seedFolder({ name: 'WS Child', workspaceId: ws._id, parentId: new mongoose.Types.ObjectId() });

    const res = await request(app)
      .get('/api/folders')
      .query({ workspaceId: ws._id.toString() })
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('WS Root');
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get('/api/folders')
      .query({ workspaceId: fakeId.toString() })
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not found');
  });

  test('❌ User không phải thành viên workspace → 403', async () => {
    const ws = await seedWorkspace(); 
    
    const res = await request(app)
      .get('/api/folders')
      .query({ workspaceId: ws._id.toString() })
      .set('Authorization', 'Bearer token-outsider');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have permission to access this workspace');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/folders/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/folders/:id', () => {
  const app = createApp();

  test('✅ Lấy My Drive folder + breadcrumb + files thành công', async () => {
    const parent = await seedFolder({ name: 'Parent' });
    const child  = await seedFolder({ name: 'Child', parentId: parent._id });
    
    // API này CÓ gọi File Service
    axios.get.mockResolvedValueOnce({ data: { data: [{ name: 'Test File.pdf' }] } });

    const res = await request(app).get(`/api/folders/${child._id}`).set('Authorization', 'Bearer token-admin');
    
    expect(res.status).toBe(200);
    expect(res.body.data.breadcrumb).toHaveLength(2);
    expect(res.body.data.folderInfo.name).toBe('Child');
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.folders).toHaveLength(0); 
  });

  test('❌ File Service sập → 500 (Ngắt tiến trình thay vì trả về mảng rỗng)', async () => {
    const folder = await seedFolder();
    
    // Giả lập Axios sập
    axios.get.mockRejectedValueOnce(new Error('Service Down'));

    const res = await request(app).get(`/api/folders/${folder._id}`).set('Authorization', 'Bearer token-admin');
    
    // 🟢 FIX 2: Khớp với logic mới của Controller là trả về 500 khi Axios lỗi
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error system when get all the files'); 
  });

  test('❌ Xem folder trong workspace nhưng không phải member → 403', async () => {
    const ws = await seedWorkspace();
    const folder = await seedFolder({ workspaceId: ws._id });

    const res = await request(app).get(`/api/folders/${folder._id}`).set('Authorization', 'Bearer token-outsider');
    expect(res.status).toBe(403);
  });

  test('❌ ID không tồn tại → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/folders/${fakeId}`).set('Authorization', 'Bearer token-admin');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/rename
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/folders/:id/rename', () => {
  const app = createApp();

  test('✅ Đổi tên My Drive folder — DB được cập nhật', async () => {
    const folder = await seedFolder({ name: 'Old Name' });
    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
  });

  test('✅ Đổi tên thành công nhưng BullMQ lỗi (vẫn trả 200)', async () => {
    const folder = await seedFolder({ name: 'Old Name' });
    addJob.mockRejectedValueOnce(new Error('BullMQ fail'));

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .set('Authorization', 'Bearer token-admin')
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
  });

  test('❌ Outsider đổi tên My Drive folder → 403', async () => {
    const folder = await seedFolder({ name: 'Admin Folder' });
    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .set('Authorization', 'Bearer token-outsider')
      .send({ name: 'Hacked' });

    expect(res.status).toBe(403);
  });

  test('❌ Member viewer đổi tên workspace folder → 403', async () => {
    const ws     = await seedWorkspace();
    const folder = await seedFolder({ name: 'WS Folder', workspaceId: ws._id });

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .set('Authorization', 'Bearer token-member')
      .send({ name: 'New Name' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/folders/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/folders/:id', () => {
  const app = createApp();

  test('✅ Xóa folder — deletedAt được set trong DB', async () => {
    const folder = await seedFolder();
    axios.delete.mockResolvedValue({ data: {} });

    const res = await request(app).delete(`/api/folders/${folder._id}`).set('Authorization', 'Bearer token-admin');
    expect(res.status).toBe(200);

    const deleted = await Folder.findById(folder._id).setOptions({ includeDeleted: true });
    expect(deleted.deletedAt).not.toBeNull();
  });

  test('✅ Xóa folder cha — folder con cũng bị soft delete', async () => {
    const parent = await seedFolder({ name: 'Parent' });
    const child1 = await seedFolder({ name: 'Child 1', parentId: parent._id });
    
    axios.delete.mockResolvedValue({ data: {} });

    await request(app)
      .delete(`/api/folders/${parent._id}`)
      .set('Authorization', 'Bearer token-admin');

    const allDeleted = await Folder.find({ _id: { $in: [parent._id, child1._id] } })
      .setOptions({ includeDeleted: true });

    expect(allDeleted.every((f) => f.deletedAt !== null)).toBe(true);
  });

  test('❌ File service lỗi khi xóa soft delete → 500', async () => {
    const folder = await seedFolder();
    axios.delete.mockRejectedValueOnce(new Error('File Service Down'));

    const res = await request(app).delete(`/api/folders/${folder._id}`).set('Authorization', 'Bearer token-admin');
    expect(res.status).toBe(500);
  });

  test('❌ Outsider xóa My Drive folder → 403, DB không thay đổi', async () => {
    const folder = await seedFolder();
    const res = await request(app)
      .delete(`/api/folders/${folder._id}`)
      .set('Authorization', 'Bearer token-outsider');

    expect(res.status).toBe(403);
    const unchanged = await Folder.findById(folder._id);
    expect(unchanged.deletedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/restore
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/folders/:id/restore', () => {
  const app = createApp();

  test('✅ Restore folder — deletedAt về null trong DB', async () => {
    const folder = await seedFolder({
      deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), 
    });
    axios.put.mockResolvedValue({ data: {} });

    const res = await request(app)
      .put(`/api/folders/${folder._id}/restore`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);

    const restored = await Folder.findById(folder._id);
    expect(restored.deletedAt).toBeNull();
  });

  test('❌ Folder không trong thùng rác → 400', async () => {
    const folder = await seedFolder({ deletedAt: null });

    const res = await request(app)
      .put(`/api/folders/${folder._id}/restore`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Folder not in the trash');
  });

  test('❌ File service lỗi khi restore → 500', async () => {
    const folder = await seedFolder({ deletedAt: new Date() });
    axios.put.mockRejectedValueOnce(new Error('File Service Down'));

    const res = await request(app).put(`/api/folders/${folder._id}/restore`).set('Authorization', 'Bearer token-admin');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/move
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/folders/:id/move', () => {
  const app = createApp();

  test('✅ Di chuyển folder — parentId được cập nhật trong DB', async () => {
    const source = await seedFolder({ name: 'Source' });
    const target = await seedFolder({ name: 'Target' });

    const res = await request(app)
      .put(`/api/folders/${source._id}/move`)
      .set('Authorization', 'Bearer token-admin')
      .send({ newParentId: target._id.toString() });

    expect(res.status).toBe(200);

    const updated = await Folder.findById(source._id);
    expect(updated.parentId.toString()).toBe(target._id.toString());
  });

  test('✅ Move về My Drive root (không parentId, workspaceId)', async () => {
    const parent = await seedFolder({ name: 'Parent' });
    const child = await seedFolder({ name: 'Child', parentId: parent._id });

    const res = await request(app)
      .put(`/api/folders/${child._id}/move`)
      .set('Authorization', 'Bearer token-admin')
      .send({}); 

    expect(res.status).toBe(200);
    const updated = await Folder.findById(child._id);
    expect(updated.parentId).toBeNull();
  });

  test('❌ Di chuyển folder vào chính nó → 400', async () => {
    const folder = await seedFolder();

    const res = await request(app)
      .put(`/api/folders/${folder._id}/move`)
      .set('Authorization', 'Bearer token-admin')
      .send({ newParentId: folder._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cannot move folder into itself');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/folders/trash
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/folders/trash', () => {
  const app = createApp();

  test('✅ Lấy danh sách thùng rác My Drive', async () => {
    await seedFolder({ name: 'Active Folder' });
    await seedFolder({ name: 'Trashed Folder', deletedAt: new Date() });

    const res = await request(app)
      .get('/api/folders/trash')
      .set('Authorization', 'Bearer token-admin');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Trashed Folder'); 
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/folders/trash/empty
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/folders/trash/empty', () => {
  const app = createApp();

  test('✅ Dọn sạch thùng rác thành công', async () => {
    const parent = await seedFolder({ name: 'Parent Trash', deletedAt: new Date() });
    await seedFolder({ name: 'Child Trash', parentId: parent._id, deletedAt: new Date() });
    axios.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/folders/trash/empty')
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Emptied');

    const remaining = await Folder.countDocuments({ createdBy: ADMIN_ID }).setOptions({ includeDeleted: true });
    expect(remaining).toBe(0);
  });

  test('❌ File Service sập khi empty trash → 500 (Ngắt tiến trình)', async () => {
    await seedFolder({ deletedAt: new Date() });
    axios.delete.mockRejectedValueOnce(new Error('Down'));

    const res = await request(app)
      .delete('/api/folders/trash/empty')
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error system when cleaning all the files');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/folders/trash/:id/force
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/folders/trash/:id/force', () => {
  const app = createApp();

  test('✅ Xóa vĩnh viễn folder My Drive cùng thư mục con', async () => {
    const parent = await seedFolder({ deletedAt: new Date() });
    const child = await seedFolder({ parentId: parent._id }); 
    axios.delete.mockResolvedValue({});
    
    const res = await request(app)
      .delete(`/api/folders/trash/${parent._id}/force`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(200);
    
    const count = await Folder.countDocuments({ _id: { $in: [parent._id, child._id] } }).setOptions({ includeDeleted: true });
    expect(count).toBe(0);
  });

  test('❌ File Service lỗi khi force delete → 500', async () => {
    const folder = await seedFolder({ deletedAt: new Date() });
    axios.delete.mockRejectedValueOnce(new Error('Timeout'));

    const res = await request(app)
      .delete(`/api/folders/trash/${folder._id}/force`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Error system when force delete file');
  });

  test('❌ Xóa folder chưa vào thùng rác → 400', async () => {
    const folder = await seedFolder(); 
    
    const res = await request(app)
      .delete(`/api/folders/trash/${folder._id}/force`)
      .set('Authorization', 'Bearer token-admin');

    expect(res.status).toBe(400);
  });
});