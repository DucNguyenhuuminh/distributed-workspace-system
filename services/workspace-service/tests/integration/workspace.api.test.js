const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('axios');
jest.mock('ioredis', () => require('ioredis-mock'));

// 2. Kích hoạt Mocking cho thư viện Queue (BullMQ) từ 'shared'
jest.mock('shared', () => {
    // ĐƯA DÒNG NÀY VÀO BÊN TRONG HÀM MOCK ĐỂ TRÁNH LỖI OUT-OF-SCOPE
    const originalShared = jest.requireActual('shared');
    
    return {
        ...originalShared,
        addJob: jest.fn().mockResolvedValue(true),
        queueForEvent: jest.fn().mockReturnValue('mock-queue'),
        jobIdFor: jest.fn().mockReturnValue('mock-job-id'),
        EVENTS: {
            WORKSPACE_CREATED: 'WORKSPACE_CREATED',
            MEMBER_ADDED: 'MEMBER_ADDED',
            WORKSPACE_DELETED: 'WORKSPACE_DELETED',
            MEMBER_REMOVED: 'MEMBER_REMOVED'
        },
        DEFAULT_JOB_OPTIONS: { attempts: 3 }
    };
});

const app = require('./app'); 
const Workspace = require('../../src/models/workspace.model');
const Folder = require('../../src/models/folder.model');
const { addJob, EVENTS, authMiddleware } = require('shared');

process.env.JWT_SECRET = 'test_secret_key_123';

describe('Integration Test: Workspace APIs', () => {
    let token = '';
    let testUserId = new mongoose.Types.ObjectId();
    let testMemberId = new mongoose.Types.ObjectId();
    let testWorkspaceId = '';
    
    let mongoServer; 

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        token = jwt.sign(
            { userId: testUserId.toString() }, 
            process.env.JWT_SECRET
        );
    });

    beforeEach(async () => {
        await Workspace.deleteMany({});
        await Folder.deleteMany({});
        jest.clearAllMocks(); // Đảm bảo clear cả mock của axios và addJob

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
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoServer.stop();
    });

    // ==========================================
    // 1. POST /api/workspaces
    // ==========================================
    describe('POST /api/workspaces', () => {
        it('Nên tạo mới thành công, set user là ADMIN và bắn Queue Event', async () => {
            const res = await request(app)
                .post('/api/workspaces')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Dự án Hệ thống bãi đỗ xe' });

            expect(res.status).toBe(201);
            expect(res.body.data.name).toBe('Dự án Hệ thống bãi đỗ xe');
            expect(res.body.data.members[0].role).toBe('ADMIN');
            
            // Kiểm tra xem Queue Manager đã được gọi chưa
            expect(addJob).toHaveBeenCalledTimes(1);
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue', 
                EVENTS.WORKSPACE_CREATED, 
                expect.objectContaining({ createdBy: testUserId.toString() }), 
                expect.any(Object)
            );
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
        it('Nên thêm user thành công và bắn Queue Event', async () => {
            const mockTargetUserId = new mongoose.Types.ObjectId();
            axios.get.mockResolvedValue({
                data: { data: { _id: mockTargetUserId, email: 'new@gmail.com' } }
            });

            const res = await request(app)
                .post(`/api/workspaces/${testWorkspaceId}/members`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'new@gmail.com', permissions: ['preview'] });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Adding member success');
            
            // Kiểm tra Event bắn vào Queue
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.MEMBER_ADDED,
                expect.objectContaining({ 
                    workspaceId: testWorkspaceId,
                    targetUserId: mockTargetUserId.toString()
                }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 5. DELETE /api/workspaces/:id/members/:targetUserId
    // ==========================================
    describe('DELETE /api/workspaces/:id/members/:targetUserId', () => {
        it('Nên đuổi MEMBER thành công và bắn Queue Event', async () => {
            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}/members/${testMemberId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            
            // Kiểm tra Event bắn vào Queue
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.MEMBER_REMOVED,
                expect.objectContaining({ 
                    targetUserId: testMemberId.toString(),
                    removedBy: testUserId.toString()
                }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 6. DELETE /api/workspaces/:id
    // ==========================================
    describe('DELETE /api/workspaces/:id', () => {
        it('Nên xóa mềm Workspace, xóa Folder, bắn Queue Event VÀ gọi Axios sang File Service', async () => {
            // 0. CẤU HÌNH MOCK AXIOS: Giả lập File Service trả về thành công
            axios.delete.mockResolvedValue({ data: { message: 'Files deleted successfully' } });

            // Chuẩn bị dữ liệu: Tạo 1 folder trong workspace
            await Folder.create({ name: 'Folder 1', workspaceId: testWorkspaceId, createdBy: testUserId });

            // Gọi API Delete
            const res = await request(app)
                .delete(`/api/workspaces/${testWorkspaceId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            
            // 1. Kiểm tra Soft-delete Workspace
            const checkWs = await Workspace.collection.findOne({ 
                _id: new mongoose.Types.ObjectId(testWorkspaceId) 
            });
            expect(checkWs.deletedAt).not.toBeNull();

            // 2. Kiểm tra Soft-delete Folder
            const checkFolder = await Folder.collection.findOne({ 
                workspaceId: new mongoose.Types.ObjectId(testWorkspaceId) 
            });
            expect(checkFolder.deletedAt).not.toBeNull();

            // 3. Kiểm tra Queue Event (Nếu bạn vẫn giữ hàm addJob trong controller)
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue', 
                EVENTS.WORKSPACE_DELETED, 
                expect.objectContaining({ 
                    workspaceId: testWorkspaceId 
                }),
                expect.any(Object) 
            );
            
            // 4. KIỂM TRA LỆNH GỌI CROSS-SERVICE BẰNG AXIOS
            expect(axios.delete).toHaveBeenCalledTimes(1); // Đảm bảo chỉ gọi đúng 1 lần
            expect(axios.delete).toHaveBeenCalledWith(
                expect.stringContaining(`/api/files/internal/by-workspace/${testWorkspaceId}`)
            );
        });
    });    
});