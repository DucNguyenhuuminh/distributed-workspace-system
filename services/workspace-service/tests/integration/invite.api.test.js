const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');

const Workspace = require('../../src/models/workspace.model');
const WorkspaceInvite = require('../../src/models/workspace-invite.model');
const JoinRequest = require('../../src/models/join-request.model');
const { addJob } = require('shared');
const inviteController = require('../../src/controllers/invite-workspace.controller'); 

// ── 1. MOCK DEPENDENCIES ────────────────────────────────────
jest.mock('axios');
jest.mock('shared', () => ({
  addJob: jest.fn(),
  queueForEvent: jest.fn((e) => `queue:${e}`),
  jobIdFor: jest.fn((e, id) => `${e}_${id}`),
  EVENTS: { MEMBER_ADDED: 'member.added', NOTIFY_USER: 'notify.user' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
}));

process.env.FRONTEND_URL = 'http://localhost:5137';
process.env.AUTH_SERVICE_URL = 'http://localhost:3001';

// ── 2. SETUP APP & DB ───────────────────────────────────────
let mongoServer;
let currentUserId; 

function createApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.user = { userId: currentUserId };
    next();
  });

  app.post('/api/workspaces/:id/invite', inviteController.createInviteLink);
  app.get('/api/workspaces/invite/:token', inviteController.getInviteInfo);
  app.post('/api/workspaces/invite/:token/join', inviteController.joinWorkspace);
  app.get('/api/workspaces/:id/requests', inviteController.getJoinRequests);
  
  app.patch('/api/workspaces/:id/requests/approved-all', inviteController.approveAllRequests);
  app.patch('/api/workspaces/:id/requests/:requestId', inviteController.reviewJoinRequest);
  
  app.delete('/api/workspaces/:id/invite/:token', inviteController.revokeInviteLink);
  app.get('/api/workspaces/:id/invites', inviteController.getInviteLinks);
  app.get('/api/workspaces/:id/requests/my', inviteController.getMyJoinRequest);

  return app;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  console.error.mockRestore();
  console.warn.mockRestore();
  console.log.mockRestore();
});

afterEach(async () => {
  await Workspace.deleteMany({});
  await WorkspaceInvite.deleteMany({});
  await JoinRequest.deleteMany({});
  jest.clearAllMocks();
});

// ── 3. TEST SUITES ──────────────────────────────────────────
describe('[Integration] Workspace Invite & Request Controller', () => {
  const app = createApp();
  let adminId, memberId, outsiderId, workspaceId;

  beforeEach(async () => {
    adminId = new mongoose.Types.ObjectId().toString();
    memberId = new mongoose.Types.ObjectId().toString();
    outsiderId = new mongoose.Types.ObjectId().toString();
    currentUserId = adminId; 

    const ws = await Workspace.create({
      name: 'Integration WS',
      createdBy: adminId,
      members: [
        { userId: adminId, role: 'ADMIN', permissions: 'editor' },
        { userId: memberId, role: 'MEMBER', permissions: 'viewer' }
      ]
    });
    workspaceId = ws._id.toString();
  });

  // ═══════════════════════════════════════════════════════════
  describe('POST /api/workspaces/:id/invite', () => {
    test('✅ Tạo link thành công (Auto Approve = true, có expiresInHours)', async () => {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/invite`)
        .send({ expiresInHours: 24, autoApprove: true });

      expect(res.status).toBe(201);
      expect(res.body.data.token).toBeDefined();
    });

    test('❌ Không phải thành viên của workspace → 403', async () => {
      currentUserId = outsiderId; // Đổi thành outsider để khớp logic Controller
      const res = await request(app).post(`/api/workspaces/${workspaceId}/invite`);
      expect(res.status).toBe(403);
    });

    test('❌ Workspace không tồn tại → 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).post(`/api/workspaces/${fakeId}/invite`);
      expect(res.status).toBe(404);
    });

    test('❌ Lỗi DB (Crash) → 500', async () => {
      jest.spyOn(Workspace, 'findById').mockRejectedValueOnce(new Error('DB Crash'));
      const res = await request(app).post(`/api/workspaces/${workspaceId}/invite`);
      expect(res.status).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('GET /api/workspaces/invite/:token', () => {
    let inviteToken;
    beforeEach(async () => {
      // 🟢 ĐÃ FIX: Bổ sung expiredAt: null để tránh lỗi Cast to Date
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, expiredAt: null });
      inviteToken = inv.token;
    });

    test('✅ Link hợp lệ → 200', async () => {
      const res = await request(app).get(`/api/workspaces/invite/${inviteToken}`);
      expect(res.status).toBe(200);
    });

    test('❌ Link bị thu hồi → 403', async () => {
      await WorkspaceInvite.updateOne({ token: inviteToken }, { isRevoked: true });
      const res = await request(app).get(`/api/workspaces/invite/${inviteToken}`);
      expect(res.status).toBe(403);
    });

    test('❌ Link hết hạn → 403', async () => {
      await WorkspaceInvite.updateOne({ token: inviteToken }, { expiredAt: new Date(Date.now() - 10000) });
      const res = await request(app).get(`/api/workspaces/invite/${inviteToken}`);
      expect(res.status).toBe(403);
    });

    test('❌ Link không tồn tại → 404', async () => {
      const res = await request(app).get('/api/workspaces/invite/fake-token');
      expect(res.status).toBe(404);
    });

    test('❌ Lỗi DB (Crash) → 500', async () => {
      jest.spyOn(WorkspaceInvite, 'findOne').mockRejectedValueOnce(new Error('Crash'));
      const res = await request(app).get(`/api/workspaces/invite/${inviteToken}`);
      expect(res.status).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('POST /api/workspaces/invite/:token/join', () => {
    beforeEach(() => {
      currentUserId = outsiderId; 
      axios.get.mockResolvedValue({ data: { data: { email: 'out@test.com', username: 'Outsider' } } });
      addJob.mockResolvedValue(true);
    });

    test('✅ Tham gia thẳng (Auto Approve = true) → 200', async () => {
      // 🟢 ĐÃ FIX: expiredAt: null
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: true, expiredAt: null });
      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      
      expect(res.status).toBe(200);
    });

    test('✅ Bắt lỗi an toàn nếu Queue sập (Auto Approve = true) → 200', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: true, expiredAt: null });
      addJob.mockRejectedValueOnce(new Error('Queue Down'));
      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(200); 
    });

    test('✅ Tạo Request (Auto Approve = false) → 201', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: false, expiredAt: null });
      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`).send({ message: 'Hi' });
      
      expect(res.status).toBe(201);
    });

    test('✅ Tiếp tục xử lý nếu gọi Auth Service lỗi (Mất email)', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: false, expiredAt: null });
      axios.get.mockRejectedValueOnce(new Error('Auth Crash')); 
      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(201); 
    });

    test('❌ Đã gửi request trước đó rồi → 409', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: false, expiredAt: null });
      // 🟢 ĐÃ FIX: Bổ sung inviteToken bắt buộc cho JoinRequest
      await JoinRequest.create({ workspaceId, userId: outsiderId, inviteToken: inv.token, status: 'pending' });

      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(409);
    });

    test('❌ Đã là thành viên → 409', async () => {
      currentUserId = memberId; 
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, expiredAt: null });
      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(409);
    });

    test('❌ Lỗi DB Trùng Lặp (code 11000) → 409', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: false, expiredAt: null });
      jest.spyOn(JoinRequest, 'create').mockImplementationOnce(() => {
        const err = new Error('Dup'); err.code = 11000; throw err;
      });

      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(409);
    });

    test('❌ Lỗi DB Khác → 500', async () => {
      const inv = await WorkspaceInvite.create({ workspaceId, createdBy: adminId, autoApprove: false, expiredAt: null });
      jest.spyOn(JoinRequest, 'create').mockRejectedValueOnce(new Error('Crash DB'));

      const res = await request(app).post(`/api/workspaces/invite/${inv.token}/join`);
      expect(res.status).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('GET /api/workspaces/:id/requests', () => {
    test('✅ Trả về danh sách request → 200', async () => {
      await JoinRequest.create({ workspaceId, userId: outsiderId, inviteToken: 'tok', status: 'pending' });
      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests`);
      expect(res.status).toBe(200);
    });

    test('❌ Không phải Admin → 403', async () => {
      currentUserId = memberId;
      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests`);
      expect(res.status).toBe(403);
    });

    test('❌ Workspace không tồn tại → 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).get(`/api/workspaces/${fakeId}/requests`);
      expect(res.status).toBe(404);
    });

    test('❌ Lỗi DB → 500', async () => {
      // 🟢 ĐÃ FIX LỖI CRASH: Mock chuỗi find().sort() cho Mongoose
      jest.spyOn(JoinRequest, 'find').mockReturnValueOnce({
        sort: jest.fn().mockRejectedValueOnce(new Error('Crash'))
      });
      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests`);
      expect(res.status).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('PATCH /api/workspaces/:id/requests/:requestId', () => {
    let reqId;
    beforeEach(async () => {
      const jr = await JoinRequest.create({ workspaceId, userId: outsiderId, inviteToken: 'tok', status: 'pending' });
      reqId = jr._id.toString();
    });

    test('✅ Phê duyệt (Approve) thành công → 200', async () => {
      const res = await request(app).patch(`/api/workspaces/${workspaceId}/requests/${reqId}`).send({ action: 'approve' });
      expect(res.status).toBe(200);
    });

    test('✅ Từ chối (Reject) thành công → Gọi Job gửi Notification → 200', async () => {
      const res = await request(app).patch(`/api/workspaces/${workspaceId}/requests/${reqId}`).send({ action: 'reject' });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('PATCH /api/workspaces/:id/requests/approved-all', () => {
    test('✅ Duyệt tất cả request pending', async () => {
      await JoinRequest.create({ workspaceId, userId: outsiderId, inviteToken: 'tok', status: 'pending' });
      const res = await request(app).patch(`/api/workspaces/${workspaceId}/requests/approved-all`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════
  describe('DELETE /api/workspaces/:id/invite/:token & GETs', () => {
    let inviteToken;
    
    beforeEach(async () => {
      currentUserId = adminId;
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/invite`)
        .send({ autoApprove: false, expiresInHours: 24 });
        
      inviteToken = res.body.data.token;
    });

    test('✅ Revoke link thành công', async () => {
      const res = await request(app).delete(`/api/workspaces/${workspaceId}/invite/${inviteToken}`);
      
      // Nếu API vẫn văng 500, dòng này sẽ in thẳng lỗi nội bộ ra Terminal để kiểm tra
      if (res.status === 500) {
        console.error('LỖI API REVOKE:', res.body.message);
      }
      
      expect(res.status).toBe(200);
      
      const inv = await WorkspaceInvite.findOne({ token: inviteToken });
      expect(inv.isRevoked).toBe(true);
    });

    test('✅ Admin lấy được list invite links', async () => {
      const res = await request(app).get(`/api/workspaces/${workspaceId}/invites`);
      expect(res.status).toBe(200);
    });

    test('✅ User lấy được request pending của mình', async () => {
      currentUserId = outsiderId; 
      // Dùng API để tạo Request luôn cho chuẩn xác
      await request(app).post(`/api/workspaces/invite/${inviteToken}/join`).send({ message: 'Hi' });

      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests/my`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe(outsiderId);
    });

    test('❌ User get request nhưng không có → 404', async () => {
      currentUserId = outsiderId;
      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests/my`);
      expect(res.status).toBe(404);
    });

    test('❌ Lỗi DB → 500', async () => {
      jest.spyOn(JoinRequest, 'findOne').mockReturnValueOnce({
        sort: jest.fn().mockRejectedValueOnce(new Error('Crash'))
      });
      currentUserId = outsiderId;
      const res = await request(app).get(`/api/workspaces/${workspaceId}/requests/my`);
      expect(res.status).toBe(500);
    });
  });
});