const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server'); 
const app = require('./app'); // Đã sửa lại đường dẫn chuẩn
const Workspace = require('../../src/models/workspace.model');
const Folder = require('../../src/models/folder.model');

// Kích hoạt Mocking cho Axios
jest.mock('axios');

// Ép hệ thống test dùng chung 1 khóa bí mật
process.env.JWT_SECRET = 'test_secret_key_123';

describe('Integration Test: Workspace APIs', () => {
    let token = '';
    let testUserId = new mongoose.Types.ObjectId();
    let testMemberId = new mongoose.Types.ObjectId();
    let testWorkspaceId = '';
    
    let mongoServer; // Khai báo biến chứa DB ảo

    beforeAll(async () => {
        // Bật DB ảo trên RAM
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        // Tạo token giả với testUserId
        token = jwt.sign(
            { userId: testUserId.toString() }, 
            process.env.JWT_SECRET
        );
    });

    beforeEach(async () => {
        await Workspace.deleteMany({});
        await Folder.deleteMany({});
        jest.clearAllMocks(); 

        // Seed 1 Workspace
        const ws = await Workspace.create({
            name: 'Nhóm Đồ Án Tốt Nghiệp',
            createdBy: testUserId,
            members: [
                {
                    userId: testUserId,
                    role: 'ADMIN',
                    permissions: ['preview', 'download', 'upload']
                },
                {
                    userId: testMemberId,
                    role: 'MEMBER',
                    permissions: ['preview']
                }
            ]
        });
        testWorkspaceId = ws._id.toString();
    });

    afterAll(async () => {
        // Dọn dẹp và tắt DB ảo sau khi test xong
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoServer.stop();
    });

    // ==========================================
    // 1. POST /api/workspaces
    // ==========================================
    describe('POST /api/workspaces', () => {
        it('Nên tạo mới thành công và mặc định User đó là ADMIN', async () => {
            const res = await request(app)
                .post('/api/workspaces')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Dự án Hệ thống bãi đỗ xe' });

            expect(res.status).toBe(201);
            expect(res.body.data.name).toBe('Dự án Hệ thống bãi đỗ xe');
            expect(res.body.data.members[0].role).toBe('ADMIN');
            expect(res.body.data.members[0].userId.toString()).toBe(testUserId.toString());
        });
    });

    // ==========================================
    // 2. GET /api/workspaces 
    // ==========================================
    describe('GET /api/workspaces', () => {
        it('Nên trả về danh sách các Workspace mà user đang tham gia', async () => {
            const res = await request(app)
                .get('/api/workspaces')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe('Nhóm Đồ Án Tốt Nghiệp');
        });
    });

    // ==========================================
    // 3. GET /api/workspaces/:id
    // ==========================================
    describe('GET /api/workspaces/:id', () => {
        it('Nên trả về chi tiết 1 Workspace', async () => {
            const res = await request(app)
                .get(`/api/workspaces/${testWorkspaceId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data._id.toString()).toBe(testWorkspaceId);
        });
    });

    // ==========================================
    // 4. POST /api/workspaces/:id/members
    // ==========================================
    describe('POST /api/workspaces/:id/members', () => {
        it('Nên gọi Axios sang Auth-Service và thêm user thành công', async () => {
            const mockTargetUserId = new mongoose.Types.ObjectId();
            axios.get.mockResolvedValue({
                data: { data: { _id: mockTargetUserId, email: 'new@gmail.com' } }
            });

            const res = await request(app)
                .post(`/api/workspaces/${testWorkspaceId}/members`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'new@gmail.com', permissions: ['preview', 'download'] });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Adding member success');
            
            const checkWs = await Workspace.findById(testWorkspaceId);
            expect(checkWs.members).toHaveLength(3); 
        });

        it('Nên báo lỗi 400 nếu User đã ở trong Workspace rồi', async () => {
            axios.get.mockResolvedValue({
                data: { data: { _id: testMemberId, email: 'already@gmail.com' } }
            });

            const res = await request(app)
                .post(`/api/workspaces/${testWorkspaceId}/members`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'already@gmail.com' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Member already in group workspace');
        });

        it('Nên báo lỗi 404 nếu Auth-Service trả về user không tồn tại', async () => {
            axios.get.mockRejectedValue({ response: { status: 404 } });

            const res = await request(app)
                .post(`/api/workspaces/${testWorkspaceId}/members`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'ghost@gmail.com' });

            expect(res.status).toBe(404);
        });
    });

    // ==========================================
    // 5. DELETE /api/workspaces/:id/members/:targetUserId
    // ==========================================
    describe('DELETE /api/workspaces/:id/members/:targetUserId', () => {
        it('Nên cho phép ADMIN đuổi MEMBER khác thành công', async () => {
            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}/members/${testMemberId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Removed member out workspace');

            const checkWs = await Workspace.findById(testWorkspaceId);
            expect(checkWs.members).toHaveLength(1); 
        });

        it('Nên chặn không cho phép xóa nếu mình là ADMIN duy nhất', async () => {
            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}/members/${testUserId}`) 
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Cannot leave workspace if you are only Admin');
        });

        it('Nên cho phép tự rời nhóm (Self-remove) nếu chỉ là MEMBER', async () => {
            const memberToken = jwt.sign({ userId: testMemberId.toString() }, process.env.JWT_SECRET);

            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}/members/${testMemberId}`)
                .set('Authorization', `Bearer ${memberToken}`);

            expect(res.status).toBe(200);
        });
    });

    // ==========================================
    // 6. DELETE /api/workspaces/:id
    // ==========================================
    describe('DELETE /api/workspaces/:id', () => {
        it('Nên gọi Axios xóa File, soft-delete Folder và Workspace', async () => {
            await Folder.create({ name: 'Folder 1', workspaceId: testWorkspaceId, createdBy: testUserId });

            axios.delete.mockResolvedValue({});

            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            
            // 1. Kiểm tra axios đã gọi đúng url chưa (Đúng 1 tham số như controller của bạn)
            expect(axios.delete).toHaveBeenCalledWith(
                expect.stringContaining(`/api/files/internal/by-workspace/${testWorkspaceId}`)
            );
            
            // 2. Đi cửa sau để check xóa mềm Workspace
            const checkWs = await Workspace.collection.findOne({ 
                _id: new mongoose.Types.ObjectId(testWorkspaceId) 
            });
            expect(checkWs.deletedAt).not.toBeNull();

            // 3. Đi cửa sau để check xóa mềm Folder
            const checkFolder = await Folder.collection.findOne({ 
                workspaceId: new mongoose.Types.ObjectId(testWorkspaceId) 
            });
            expect(checkFolder.deletedAt).not.toBeNull();
        });
    });
});