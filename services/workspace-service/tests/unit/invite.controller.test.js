const request = require('supertest');
const express = require('express');
const axios = require('axios');

const Workspace = require('../../src/models/workspace.model');
const WorkspaceInvite = require('../../src/models/workspace-invite.model');
const JoinRequest = require('../../src/models/join-request.model');
const { addJob } = require('shared');

// Đã cập nhật đúng tên file controller của bạn
const inviteController = require('../../src/controllers/invite-workspace.controller'); 

// ── 1. MOCK DEPENDENCIES ────────────────────────────────────
jest.mock('axios');
jest.mock('../../src/models/workspace.model');
jest.mock('../../src/models/workspace-invite.model');
jest.mock('../../src/models/join-request.model');
jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}_${id}`),
  EVENTS: { MEMBER_ADDED: 'member.added', NOTIFY_USER: 'notify.user' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
}));

process.env.FRONTEND_URL = 'http://localhost:5137';
process.env.AUTH_SERVICE_URL = 'http://localhost:3001';

// ── 2. SETUP APP & HELPER ───────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());
  
  app.use((req, res, next) => {
    req.user = { userId: 'user-admin' }; 
    next();
  });

  app.post('/api/workspaces/:id/invite', inviteController.createInviteLink);
  app.get('/api/workspaces/invite/:token', inviteController.getInviteInfo);
  app.post('/api/workspaces/invite/:token/join', inviteController.joinWorkspace);
  app.get('/api/workspaces/:id/requests', inviteController.getJoinRequests);
  
  // 🟢 ĐÃ FIX LỖI ROUTING EXPRESS (Phải đặt approved-all LÊN TRƯỚC :requestId)
  app.patch('/api/workspaces/:id/requests/approved-all', inviteController.approveAllRequests);
  app.patch('/api/workspaces/:id/requests/:requestId', inviteController.reviewJoinRequest);
  
  app.delete('/api/workspaces/:id/invite/:token', inviteController.revokeInviteLink);
  app.get('/api/workspaces/:id/invites', inviteController.getInviteLinks);
  app.get('/api/workspaces/:id/requests/my', inviteController.getMyJoinRequest);

  return app;
}

const mockMongooseQuery = (data) => ({
  select: jest.fn().mockResolvedValue(data),
  sort: jest.fn().mockResolvedValue(data)
});

const getFreshWorkspace = (overrides = {}) => ({
  _id: { toString: () => 'ws-1' },
  name: 'Test WS',
  members: [{ userId: { toString: () => 'user-admin' }, role: 'ADMIN' }],
  save: jest.fn().mockResolvedValue(true),
  ...overrides
});

// ── 3. TEST SUITES ──────────────────────────────────────────
describe('Workspace Invite & Request Controller', () => {
  const app = createApp();

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: createInviteLink
  // ═══════════════════════════════════════════════════════════
  describe('POST /api/workspaces/:id/invite', () => {
    test('❌ Workspace không tồn tại → 404', async () => {
      Workspace.findById.mockResolvedValue(null);
      const res = await request(app).post('/api/workspaces/ws-1/invite');
      expect(res.status).toBe(404);
    });

    test('❌ Người tạo không phải là Member/Admin → 403', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace({ members: [] }));
      const res = await request(app).post('/api/workspaces/ws-1/invite');
      expect(res.status).toBe(403);
    });

    test('✅ Tạo link thành công (Không có hạn) → 201', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      WorkspaceInvite.create.mockResolvedValue({ token: 'tok-123', expiredAt: null });

      const res = await request(app).post('/api/workspaces/ws-1/invite').send({ autoApprove: true });
      expect(res.status).toBe(201);
      expect(res.body.data.token).toBe('tok-123');
    });

    test('❌ Lỗi DB → 500', async () => {
      Workspace.findById.mockRejectedValue(new Error('DB Crash'));
      const res = await request(app).post('/api/workspaces/ws-1/invite');
      expect(res.status).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: getInviteInfo
  // ═══════════════════════════════════════════════════════════
  describe('GET /api/workspaces/invite/:token', () => {
    test('❌ Link không tồn tại → 404', async () => {
      WorkspaceInvite.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/workspaces/invite/tok-1');
      expect(res.status).toBe(404);
    });

    test('❌ Link đã bị thu hồi (isRevoked) → 403', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ isRevoked: true });
      const res = await request(app).get('/api/workspaces/invite/tok-1');
      expect(res.status).toBe(403);
    });

    test('❌ Link đã hết hạn → 403', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ expiredAt: new Date(Date.now() - 10000) });
      const res = await request(app).get('/api/workspaces/invite/tok-1');
      expect(res.status).toBe(403);
    });

    test('✅ Link hợp lệ, trả về thông tin Workspace → 200', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', autoApprove: false });
      Workspace.findById.mockReturnValue(mockMongooseQuery({ name: 'WS Test', members: [{}, {}] }));
      
      const res = await request(app).get('/api/workspaces/invite/tok-1');
      expect(res.status).toBe(200);
      expect(res.body.data.memberCount).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: joinWorkspace
  // ═══════════════════════════════════════════════════════════
  describe('POST /api/workspaces/invite/:token/join', () => {
    test('❌ User đã là thành viên → 409', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', createdBy: 'user-admin', autoApprove: false });
      Workspace.findById.mockResolvedValue(getFreshWorkspace()); // 'user-admin' đã có sẵn trong mock

      const res = await request(app).post('/api/workspaces/invite/tok-1/join');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('You are already a member');
    });

    test('✅ Auto Approve = true (Vào thẳng Workspace) → 200', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', createdBy: 'user-admin', autoApprove: true });
      const ws = getFreshWorkspace({ members: [] }); 
      Workspace.findById.mockResolvedValue(ws);
      axios.get.mockRejectedValue(new Error('Auth failed')); 
      addJob.mockRejectedValue(new Error('Queue Error')); 

      const res = await request(app).post('/api/workspaces/invite/tok-1/join');
      expect(res.status).toBe(200);
      expect(ws.members.length).toBe(1); 
      expect(res.body.data.status).toBe('approved');
    });

    test('❌ Auto Approve = false (Gửi Request) - Đã có request pending → 409', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', createdBy: 'user-admin', autoApprove: false });
      Workspace.findById.mockResolvedValue(getFreshWorkspace({ members: [] }));
      JoinRequest.findOne.mockResolvedValue({ _id: 'req-1' }); 

      const res = await request(app).post('/api/workspaces/invite/tok-1/join');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('You already have a pending request');
    });

    test('✅ Auto Approve = false - Tạo Request thành công → 201', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', createdBy: 'user-admin', autoApprove: false });
      Workspace.findById.mockResolvedValue(getFreshWorkspace({ members: [] }));
      JoinRequest.findOne.mockResolvedValue(null);
      JoinRequest.create.mockResolvedValue({ _id: 'req-new' });
      axios.get.mockResolvedValue({ data: { data: { email: 'a@a.com', username: 'AA' } } });

      const res = await request(app).post('/api/workspaces/invite/tok-1/join').send({ message: 'Cho mình vào với' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('pending');
      expect(addJob).toHaveBeenCalled();
    });

    test('❌ Lỗi trùng lặp index DB (11000) → 409', async () => {
      WorkspaceInvite.findOne.mockResolvedValue({ workspaceId: 'ws-1', createdBy: 'user-admin', autoApprove: false });
      Workspace.findById.mockResolvedValue(getFreshWorkspace({ members: [] }));
      const error = new Error('Dup');
      error.code = 11000;
      JoinRequest.findOne.mockRejectedValue(error);

      const res = await request(app).post('/api/workspaces/invite/tok-1/join');
      expect(res.status).toBe(409);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: getJoinRequests 
  // ═══════════════════════════════════════════════════════════
  describe('GET /api/workspaces/:id/requests', () => {
    test('❌ Không phải Admin → 403', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace({ members: [{ userId: { toString: () => 'user-admin' }, role: 'MEMBER' }] }));
      const res = await request(app).get('/api/workspaces/ws-1/requests');
      expect(res.status).toBe(403);
    });

    test('✅ Trả về danh sách request (Đã sửa lỗi Controller) → 200', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      JoinRequest.find.mockReturnValue(mockMongooseQuery([{ _id: 'req-1' }]));

      const res = await request(app).get('/api/workspaces/ws-1/requests');
      expect(res.status).toBe(200); 
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: reviewJoinRequest
  // ═══════════════════════════════════════════════════════════
  describe('PATCH /api/workspaces/:id/requests/:requestId', () => {
    test('❌ Action sai cú pháp → 400', async () => {
      const res = await request(app).patch('/api/workspaces/ws-1/requests/req-1').send({ action: 'delete' });
      expect(res.status).toBe(400);
    });

    test('❌ Không tìm thấy request đang pending → 404', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      JoinRequest.findOne.mockResolvedValue(null);
      const res = await request(app).patch('/api/workspaces/ws-1/requests/req-1').send({ action: 'approve' });
      expect(res.status).toBe(404);
    });

    test('✅ Phê duyệt (Approve) thành công → Thêm user & Gọi Job → 200', async () => {
      const ws = getFreshWorkspace();
      Workspace.findById.mockResolvedValue(ws);
      const mockReq = { userId: { toString: () => 'user-new' }, save: jest.fn() };
      JoinRequest.findOne.mockResolvedValue(mockReq);

      const res = await request(app).patch('/api/workspaces/ws-1/requests/req-1').send({ action: 'approve' });
      
      expect(res.status).toBe(200);
      expect(mockReq.status).toBe('approved');
      expect(ws.members.length).toBe(2); 
      expect(addJob).toHaveBeenCalled();
    });

    test('✅ Từ chối (Reject) thành công → Gọi Job gửi Notification → 200', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      const mockReq = { userId: { toString: () => 'user-new' }, save: jest.fn() };
      JoinRequest.findOne.mockResolvedValue(mockReq);
      addJob.mockRejectedValue(new Error('Noti Queue Down')); 

      const res = await request(app).patch('/api/workspaces/ws-1/requests/req-1').send({ action: 'reject' });
      
      expect(res.status).toBe(200);
      expect(mockReq.status).toBe('rejected');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TEST: approveAllRequests
  // ═══════════════════════════════════════════════════════════
  describe('PATCH /api/workspaces/:id/requests/approved-all', () => {
    test('✅ Báo không có request nào pending → 200', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      JoinRequest.find.mockResolvedValue([]);
      
      const res = await request(app).patch('/api/workspaces/ws-1/requests/approved-all');
      expect(res.body.message).toBe('No pending requests');
    });

    test('✅ Approve hàng loạt thành công, bỏ qua user đã là member → 200', async () => {
      const ws = getFreshWorkspace(); 
      Workspace.findById.mockResolvedValue(ws);
      
      const mockReq1 = { userId: { toString: () => 'user-new' }, save: jest.fn() }; 
      const mockReq2 = { userId: { toString: () => 'user-admin' }, save: jest.fn() }; 

      JoinRequest.find.mockResolvedValue([mockReq1, mockReq2]);

      const res = await request(app).patch('/api/workspaces/ws-1/requests/approved-all');
      
      expect(res.status).toBe(200);
      expect(res.body.data.approved).toBe(1); 
      expect(res.body.data.total).toBe(2);
      expect(ws.save).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CÁC TEST GETTERS & DELETE
  // ═══════════════════════════════════════════════════════════
  describe('revokeInviteLink & getInviteLinks & getMyJoinRequest', () => {
    test('✅ Revoke link thành công', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());

      // Controller uses findOneAndUpdate -> mock it directly
      const updatedInvite = { isRevoked: true };
      WorkspaceInvite.findOneAndUpdate = jest.fn().mockResolvedValue(updatedInvite);

      const res = await request(app).delete('/api/workspaces/ws-1/invite/tok-1');
      expect(res.status).toBe(200);
      expect(WorkspaceInvite.findOneAndUpdate).toHaveBeenCalled();
      expect(res.body.message).toBe('Invite link revoked');
    });

    test('✅ Lấy danh sách invites', async () => {
      Workspace.findById.mockResolvedValue(getFreshWorkspace());
      WorkspaceInvite.find.mockReturnValue(mockMongooseQuery([{ token: 'a' }]));

      const res = await request(app).get('/api/workspaces/ws-1/invites');
      expect(res.status).toBe(200);
    });

    test('✅ User lấy request pending của chính mình', async () => {
      JoinRequest.findOne.mockReturnValue(mockMongooseQuery({ _id: 'req-1' }));
      const res = await request(app).get('/api/workspaces/ws-1/requests/my');
      expect(res.status).toBe(200);
    });
  });
});