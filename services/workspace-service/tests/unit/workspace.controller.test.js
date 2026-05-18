// ── Mock trước khi require bất kỳ module nào ──────────────
jest.mock('axios',                         () => require('./mocks/axios.mock'));
jest.mock('shared',                        () => require('./mocks/shared.mock'));
jest.mock('../../src/models/workspace.model', () => require('./mocks/models.mock').WorkspaceMock);
jest.mock('../../src/models/folder.model',    () => require('./mocks/models.mock').FolderMock);

const request = require('supertest');
const express = require('express');
const axios   = require('axios');

// ✅ Import getFreshWorkspace từ models.mock
const { WorkspaceMock: Workspace, FolderMock: Folder, getFreshWorkspace } = require('./mocks/models.mock');
const { addJob } = require('shared');

const workspaceRoutes = require('../../src/routes/workspace.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', workspaceRoutes);
  return app;
}

// ── Ẩn console.error để Terminal sạch sẽ khi test rớt Queue ──
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// POST /api/workspaces — createWorkspace
// ═══════════════════════════════════════════════════════════
describe('POST /api/workspaces', () => {
  const app = createApp();

  test('✅ Tạo workspace thành công — trả 201 + data', async () => {
    const ws = getFreshWorkspace();
    Workspace.create.mockResolvedValue(ws);

    const res = await request(app)
      .post('/api/workspaces')
      .send({ name: 'Test Workspace' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Create workspace successfully');
    expect(res.body.data).toBeDefined();
    expect(Workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name:      'Test Workspace',
        createdBy: 'user-001',
        members:   expect.arrayContaining([
          expect.objectContaining({ role: 'ADMIN', permissions: 'editor' }),
        ]),
      })
    );
  });

  test('✅ Người tạo tự động được gán role ADMIN + permissions editor', async () => {
    const ws = getFreshWorkspace();
    Workspace.create.mockResolvedValue(ws);

    await request(app)
      .post('/api/workspaces')
      .send({ name: 'My Workspace' });

    const callArg = Workspace.create.mock.calls[0][0];
    expect(callArg.members[0].role).toBe('ADMIN');
    expect(callArg.members[0].userId).toBe('user-001');
    expect(callArg.members[0].permissions).toBe('editor');
  });

  test('✅ BullMQ job được enqueue sau khi tạo workspace', async () => {
    const ws = getFreshWorkspace();
    Workspace.create.mockResolvedValue(ws);

    await request(app)
      .post('/api/workspaces')
      .send({ name: 'My Workspace' });

    expect(addJob).toHaveBeenCalledWith(
      'queue:workspace.created',
      'workspace.created',
      expect.objectContaining({
        workspaceId: ws._id.toString(),
        createdBy:   'user-001',
      }),
      expect.any(Object)
    );
  });

  test('✅ BullMQ lỗi không ảnh hưởng response — vẫn trả 201', async () => {
    const ws = getFreshWorkspace();
    Workspace.create.mockResolvedValue(ws);
    addJob.mockRejectedValueOnce(new Error('Redis connection failed'));

    const res = await request(app)
      .post('/api/workspaces')
      .send({ name: 'My Workspace' });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
  });

  test('❌ Thiếu name → 400', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .send({});
    expect(res.status).toBe(400); 
  });

  test('❌ Name rỗng → 400', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('❌ DB lỗi → 500', async () => {
    Workspace.create.mockRejectedValue(new Error('DB connection failed'));

    const res = await request(app)
      .post('/api/workspaces')
      .send({ name: 'My Workspace' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB connection failed');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/workspaces — getWorkspaces
// ═══════════════════════════════════════════════════════════
describe('GET /api/workspaces', () => {
  const app = createApp();

  test('✅ Lấy danh sách workspace của user thành công', async () => {
    const ws = getFreshWorkspace();
    Workspace.find.mockResolvedValue([ws]);

    const res = await request(app).get('/api/workspaces');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Workspace.find).toHaveBeenCalledWith({
      'members.userId': 'user-001',
    });
  });

  test('✅ Trả mảng rỗng khi user không có workspace nào', async () => {
    Workspace.find.mockResolvedValue([]);

    const res = await request(app).get('/api/workspaces');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('✅ Trả nhiều workspace cùng lúc', async () => {
    Workspace.find.mockResolvedValue([getFreshWorkspace(), getFreshWorkspace()]);

    const res = await request(app).get('/api/workspaces');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('❌ DB lỗi → 500', async () => {
    Workspace.find.mockRejectedValue(new Error('DB timeout'));

    const res = await request(app).get('/api/workspaces');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB timeout');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/workspaces/:id — getWorkspaceById
// ═══════════════════════════════════════════════════════════
describe('GET /api/workspaces/:id', () => {
  const app = createApp();

  test('✅ Lấy workspace thành công — user là thành viên', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    Workspace.findById.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/workspaces/not-exist-id');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not exist');
  });

  test('❌ User không phải thành viên → 403', async () => {
    const ws = getFreshWorkspace();
    ws.members = [{ userId: { toString: () => 'user-999' }, role: 'ADMIN' }];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have permission to access');
  });

  test('❌ DB lỗi → 500', async () => {
    Workspace.findById.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/workspaces/random-id');

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/workspaces/:id/members — addMember
// ═══════════════════════════════════════════════════════════
describe('POST /api/workspaces/:id/members', () => {
  const app = createApp();

  const targetUser = {
    _id:   { toString: () => 'user-003' },
    email: 'newmember@gmail.com',
  };

  test('✅ Thêm thành viên mới thành công', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockResolvedValue({ data: { data: targetUser } });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'newmember@gmail.com', permissions: 'viewer' }); 

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Adding member success');
    expect(ws.save).toHaveBeenCalled();
  });

  test('✅ Permissions mặc định khi không truyền', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockResolvedValue({ data: { data: targetUser } });

    await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'newmember@gmail.com' });

    const addedMember = ws.members[ws.members.length - 1];
    expect(addedMember.permissions).toEqual('viewer'); 
  });

  test('✅ BullMQ job được enqueue sau khi thêm member', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockResolvedValue({ data: { data: targetUser } });

    await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'newmember@gmail.com' });

    expect(addJob).toHaveBeenCalledWith(
      'queue:member.added',
      'member.added',
      expect.objectContaining({
        workspaceId:  ws._id.toString(),
        targetUserId: 'user-003',
      }),
      expect.any(Object)
    );
  });

  test('✅ BullMQ lỗi không ảnh hưởng response — vẫn trả 200', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockResolvedValue({ data: { data: targetUser } });
    addJob.mockRejectedValueOnce(new Error('Redis down'));

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'newmember@gmail.com' });

    expect(res.status).toBe(200);
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    Workspace.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/workspaces/not-exist/members')
      .send({ email: 'newmember@gmail.com' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not exist');
  });

  test('❌ Người thêm không phải ADMIN → 403', async () => {
    const ws = getFreshWorkspace();
    // Đổi role người thao tác thành MEMBER
    ws.members.find(m => m.userId.toString() === 'user-001').role = 'MEMBER';
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'newmember@gmail.com' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only Admin can perform this action');
  });

  test('❌ Email không tồn tại trong hệ thống → 404', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'notexist@gmail.com' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('User not exist in this system');
  });

  test('❌ auth-service không kết nối được → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'test@gmail.com' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Cannot connect to auth-service');
  });

  test('❌ User đã là thành viên → 400', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    // User 002 đã có trong mock mặc định
    axios.get.mockResolvedValue({
      data: { data: { _id: { toString: () => 'user-002' }, email: 'user002@gmail.com' } },
    });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'user002@gmail.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Member already in group workspace');
  });

  test('❌ DB lỗi → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockRejectedValue(new Error('DB crashed'));

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/members`)
      .send({ email: 'test@gmail.com' });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/workspaces/:id — deleteWorkspace
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/workspaces/:id', () => {
  const app = createApp();

  test('✅ Xóa workspace thành công (soft delete)', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.delete.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({});

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted workspace');
    expect(ws.deletedAt).not.toBeNull();
    expect(ws.save).toHaveBeenCalled();
  });

  test('✅ Folders được soft delete khi xóa workspace', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.delete.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({ modifiedCount: 3 });

    await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(Folder.updateMany).toHaveBeenCalledWith(
      { workspaceId: ws._id },
      { deletedAt: expect.any(Date) }
    );
  });

  test('✅ file-service được gọi để xóa documents', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.delete.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({});

    await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining(`/api/files/internal/by-workspace/${ws._id}`)
    );
  });

  test('✅ BullMQ job được enqueue sau khi xóa', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.delete.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({});

    await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(addJob).toHaveBeenCalledWith(
      'queue:workspace.deleted',
      'workspace.deleted',
      expect.objectContaining({ workspaceId: ws._id.toString() }),
      expect.any(Object)
    );
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    Workspace.findById.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/workspaces/not-exist');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not exist');
  });

  test('❌ Người xóa không phải ADMIN → 403', async () => {
    const ws = getFreshWorkspace();
    ws.members.find(m => m.userId.toString() === 'user-001').role = 'MEMBER';
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only Admin can perform this action');
  });

  test('❌ file-service lỗi → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);
    axios.delete.mockRejectedValue(new Error('file-service down'));

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(500);
  });

  test('❌ DB lỗi → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/workspaces/:id/members/:targetUserId — removeMember
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/workspaces/:id/members/:targetUserId', () => {
  const app = createApp();

  test('✅ ADMIN xóa MEMBER khác thành công', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-002`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Removed member out workspace');
    expect(ws.save).toHaveBeenCalled();
  });

  test('✅ User tự rời workspace khi còn Admin khác', async () => {
    const ws = getFreshWorkspace();
    // Tạo 2 ADMIN để user-001 tự rời được
    ws.members = [
      { userId: { toString: () => 'user-001' }, role: 'ADMIN', permissions: 'editor' },
      { userId: { toString: () => 'user-002' }, role: 'ADMIN', permissions: 'editor' },
    ];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-001`);

    expect(res.status).toBe(200);
  });

  test('✅ BullMQ job được enqueue sau khi xóa member', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);

    await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-002`);

    expect(addJob).toHaveBeenCalledWith(
      'queue:member.removed',
      'member.removed',
      expect.objectContaining({
        workspaceId:  ws._id.toString(),
        targetUserId: 'user-002',
        removedBy:    'user-001',
      }),
      expect.any(Object)
    );
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    Workspace.findById.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/workspaces/not-exist/members/user-002');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not exist');
  });

  test('❌ Target user không phải thành viên → 400', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-not-in-ws`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Member not in this workspace');
  });

  test('❌ Current user không phải thành viên → 403', async () => {
    const ws = getFreshWorkspace();
    // Xóa user-001 (người request) khỏi mock
    ws.members = [{ userId: { toString: () => 'user-002' }, role: 'ADMIN', permissions: 'editor' }];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-002`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You are not a member of this workspace');
  });

  test('❌ MEMBER cố xóa người khác → 403', async () => {
    const ws = getFreshWorkspace();
    ws.members = [
      { userId: { toString: () => 'user-001' }, role: 'MEMBER', permissions: 'viewer' },
      { userId: { toString: () => 'user-002' }, role: 'MEMBER', permissions: 'viewer' },
    ];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-002`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only Admin can remove other members');
  });

  test('❌ Admin duy nhất cố tự rời → 400', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-001`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cannot leave workspace if you are only Admin');
  });

  test('❌ DB lỗi → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockRejectedValue(new Error('DB crashed'));

    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/user-002`);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/workspaces/:id/members/:targetUserId/permissions — setUserPermission
// ═══════════════════════════════════════════════════════════
describe('PATCH /api/workspaces/:id/members/:targetUserId/permission', () => {
  const app = createApp();

  test('✅ Cập nhật quyền thành công → 200', async () => {
    const ws = getFreshWorkspace();
    // Cấu hình user-001 là ADMIN, user-002 là MEMBER
    ws.members = [
      { userId: { toString: () => 'user-001' }, role: 'ADMIN' },
      { userId: { toString: () => 'user-002' }, role: 'MEMBER', permissions: 'viewer' }
    ];
    Workspace.findById.mockResolvedValue(ws);

    const newPermissions = 'editor';
    
    // 🟢 Đã fix: Gửi đúng định dạng Object JSON
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-002/permission`)
      .send({ permissions: newPermissions });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Set permission successfully');
    
    // Kiểm tra data được cập nhật đúng
    const targetMember = ws.members.find(m => m.userId.toString() === 'user-002');
    expect(targetMember.permissions).toBe(newPermissions);
    
    expect(ws.save).toHaveBeenCalled();
    expect(addJob).toHaveBeenCalled();
  });

  test('✅ BullMQ lỗi không ảnh hưởng response — vẫn trả 200', async () => {
    const ws = getFreshWorkspace();
    ws.members = [
      { userId: { toString: () => 'user-001' }, role: 'ADMIN' },
      { userId: { toString: () => 'user-002' }, role: 'MEMBER', permissions: 'viewer' }
    ];
    Workspace.findById.mockResolvedValue(ws);
    addJob.mockRejectedValueOnce(new Error('Redis Timeout'));

    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-002/permission`)
      .send({ permissions: 'editor' });

    expect(res.status).toBe(200);
    expect(ws.save).toHaveBeenCalled();
  });

  test('❌ Workspace không tồn tại → 400', async () => {
    Workspace.findById.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/workspaces/ws-999/members/user-002/permission')
      .send({ permissions: 'editor' });
    
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Workspace not exist');
  });

  test('❌ User mục tiêu không có trong Workspace → 400', async () => {
    const ws = getFreshWorkspace();
    ws.members = [{ userId: { toString: () => 'user-001' }, role: 'ADMIN' }];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-not-found/permission`)
      .send({ permissions: 'editor' });
    
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Member not in this workspace');
  });

  test('❌ Người thực hiện không phải là ADMIN → 403', async () => {
    const ws = getFreshWorkspace();
    ws.members = [
      { userId: { toString: () => 'user-001' }, role: 'MEMBER' }, // Hạ quyền user test
      { userId: { toString: () => 'user-002' }, role: 'MEMBER', permissions: 'viewer' }
    ];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-002/permission`)
      .send({ permissions: 'editor' });
    
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You are not an Admin to set permission');
  });

  test('❌ Người thực hiện không thuộc Workspace → 403', async () => {
    const ws = getFreshWorkspace();
    ws.members = [
      { userId: { toString: () => 'user-002' }, role: 'MEMBER', permissions: 'viewer' }
    ];
    Workspace.findById.mockResolvedValue(ws);

    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-002/permission`)
      .send({ permissions: 'editor' });
    
    expect(res.status).toBe(403);
  });

  test('❌ DB lỗi (Crash) → 500', async () => {
    const ws = getFreshWorkspace();
    Workspace.findById.mockRejectedValue(new Error('DB Query Error'));
    
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/user-002/permission`)
      .send({ permissions: 'editor' });
    
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Query Error');
  });
});