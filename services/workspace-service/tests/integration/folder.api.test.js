const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');

// MOCK TRÊN CÙNG ĐỂ CHẶN TIẾN TRÌNH NGẦM
jest.mock('axios');
jest.mock('ioredis', () => require('ioredis-mock'));

jest.mock('shared', () => {
    const originalShared = jest.requireActual('shared');
    return {
        ...originalShared,
        addJob: jest.fn().mockResolvedValue(true),
        queueForEvent: jest.fn().mockReturnValue('mock-queue'),
        jobIdFor: jest.fn().mockReturnValue('mock-job-id'),
        EVENTS: {
            ...originalShared.EVENTS,
            FOLDER_CREATED: 'FOLDER_CREATED',
            FOLDER_RENAMED: 'FOLDER_RENAMED',
            FOLDER_TRASHED: 'FOLDER_TRASHED',
            FOLDER_RESTORED: 'FOLDER_RESTORED',
            FOLDER_MOVED: 'FOLDER_MOVED',
        },
        DEFAULT_JOB_OPTIONS: { attempts: 3   }
    };
});

const app = require('./app'); 
const Folder = require('../../src/models/folder.model');
const Workspace = require('../../src/models/workspace.model');
const { addJob, EVENTS } = require('shared');

process.env.JWT_SECRET = 'test_secret_key_123';

// Nới lỏng thời gian chờ của Jest cho toàn bộ file này lên 60 giây
jest.setTimeout(60000);

describe('Integration Test: Folder APIs (Controller + Utils + In-Memory DB)', () => {
    let token = '';
    let testUserId = new mongoose.Types.ObjectId();
    let testWorkspaceId = '';
    let parentFolderId = '';
    let childFolderId = '';
    
    let mongoServer;

    // Bật MongoDB ảo trên RAM (Cấu hình an toàn)
    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        // Thêm cờ chống treo khi connect
        await mongoose.connect(mongoUri, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true 
        });

        token = jwt.sign({ userId: testUserId.toString() }, process.env.JWT_SECRET);
    });

    // Reset dữ liệu trước mỗi Test Case
    beforeEach(async () => {
        await Folder.deleteMany({});
        await Workspace.deleteMany({});
        jest.clearAllMocks(); 

        const ws = await Workspace.create({
            name: 'Workspace 1',
            createdBy: testUserId,
            members: [{ userId: testUserId, role: 'ADMIN', permissions: ['upload', 'preview'] }]
        });
        testWorkspaceId = ws._id.toString();

        const parentFolder = await Folder.create({
            name: 'Thư mục Cha',
            workspaceId: testWorkspaceId,
            ownerId: null,
            parentId: null,
            createdBy: testUserId,
        });
        parentFolderId = parentFolder._id.toString();

        const childFolder = await Folder.create({
            name: 'Thư mục Con',
            workspaceId: testWorkspaceId,
            ownerId: null,
            parentId: parentFolderId,
            createdBy: testUserId,
        });
        childFolderId = childFolder._id.toString();
    });

    // ÉP TẮT KẾT NỐI (Sửa lỗi treo Test)
    afterAll(async () => {
        // Dùng disconnect thay vì close() để dọn dẹp mọi socket ngầm
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.dropDatabase();
            await mongoose.disconnect(); 
        }
        if (mongoServer) {
            await mongoServer.stop();
        }
        // Cho hệ thống nghỉ 100ms để dọn dẹp ioredis-mock rác
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    // ==========================================
    // 1. POST /api/folders 
    // ==========================================
    describe('POST /api/folders', () => {
        it('Nên tạo Folder thành công, lưu vào DB và bắn Queue Event', async () => {
            const res = await request(app)
                .post('/api/folders')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Thư mục Mới', parentId: null, workspaceId: testWorkspaceId });
            
            expect(res.status).toBe(201);
            expect(res.body.data.name).toBe('Thư mục Mới');

            const folderInDb = await Folder.findById(res.body.data._id);
            expect(folderInDb).not.toBeNull();
            expect(folderInDb.name).toBe('Thư mục Mới');

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_CREATED,
                expect.objectContaining({workspaceId: expect.anything(), folder: expect.any(Object) }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 2. GET /api/folders
    // ==========================================
    describe('GET /api/folders', () => {
        it('Nên lấy danh sách thư mục gốc của Workspace thành công', async () => {
            const res = await request(app)
                .get('/api/folders')
                .query({ workspaceId: testWorkspaceId })
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1); 
            expect(res.body.data[0]._id.toString()).toBe(parentFolderId); 
        });

        it('Nên lấy danh sách thư mục con theo parentId thành công', async () => {
            const res = await request(app)
                .get('/api/folders')
                .query({ parentId: parentFolderId })
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0]._id.toString()).toBe(childFolderId); 
        });
    });

    // ==========================================
    // 3. GET /api/folders/:id (TEST THUẬT TOÁN BREADCRUMB)
    // ==========================================
    describe('GET /api/folders/:id', () => {
        it('Nên chạy hàm Utils thật và trả về Breadcrumb chính xác', async () => {
            const res = await request(app)
                .get(`/api/folders/${childFolderId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Thư mục Con');
            expect(res.body.breadcrumb).toHaveLength(2);
            
            expect(res.body.breadcrumb[0]._id.toString()).toBe(parentFolderId);
            expect(res.body.breadcrumb[0].name).toBe('Thư mục Cha');
            expect(res.body.breadcrumb[1]._id.toString()).toBe(childFolderId);
            expect(res.body.breadcrumb[1].name).toBe('Thư mục Con');
        });
    });

    // ==========================================
    // 4. PUT /api/folders/:id/rename
    // ==========================================
    describe('PUT /api/folders/:id/rename', () => {
        it('Nên đổi tên thành công, lưu DB và bắn Queue', async () => {
            const res = await request(app)
                .put(`/api/folders/${childFolderId}/rename`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Thư mục Con Đã Đổi Tên' });

            expect(res.status).toBe(200);

            const folderInDb = await Folder.findById(childFolderId);
            expect(folderInDb.name).toBe('Thư mục Con Đã Đổi Tên');

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_RENAMED,
                expect.objectContaining({ folderId: childFolderId, newName: 'Thư mục Con Đã Đổi Tên' }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 5. DELETE /api/folders/:id (TEST THUẬT TOÁN + AXIOS + QUEUE)
    // ==========================================
    describe('DELETE /api/folders/:id', () => {
        it('Nên quét Utils, xóa mềm tất cả, gọi Axios và bắn Queue Notification', async () => {
            axios.delete.mockResolvedValue({}); 

            const res = await request(app)
                .delete(`/api/folders/${parentFolderId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            
            const axiosArgs = axios.delete.mock.calls[0]; 
            const urlSent = axiosArgs[0];
            const dataSent = axiosArgs[1].data.folderIds.map(id => id.toString());

            expect(urlSent).toContain(`/api/files/internal/by-folders/${parentFolderId}`);
            expect(dataSent).toContain(parentFolderId); 
            expect(dataSent).toContain(childFolderId);  

            const checkParent = await Folder.collection.findOne({ _id: new mongoose.Types.ObjectId(parentFolderId) });
            expect(checkParent.deletedAt).not.toBeNull();

            const checkChild = await Folder.collection.findOne({ _id: new mongoose.Types.ObjectId(childFolderId) });
            expect(checkChild.deletedAt).not.toBeNull();

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_TRASHED, 
                expect.objectContaining({ 
                    folderId: parentFolderId,
                    allFolderIds: expect.any(Array)
                }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 6. PUT /api/folders/:id/restore
    // ==========================================
    describe('PUT /api/folders/:id/restore', () => {
        beforeEach(async () => {
            await Folder.updateMany({}, { deletedAt: new Date() });
        });

        it('Nên khôi phục thư mục, gọi Axios và bắn Queue', async () => {
            axios.put.mockResolvedValue({});

            const res = await request(app)
                .put(`/api/folders/${parentFolderId}/restore`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);

            const axiosArgs = axios.put.mock.calls[0]; 
            const urlSent = axiosArgs[0];
            const dataSent = axiosArgs[1].folderIds.map(id => id.toString());

            expect(urlSent).toContain(`/api/files/internal/by-folder/restore`);
            expect(dataSent).toContain(parentFolderId); 
            expect(dataSent).toContain(childFolderId);

            const checkParent = await Folder.findById(parentFolderId);
            expect(checkParent.deletedAt).toBeNull();
            const checkChild = await Folder.findById(childFolderId);
            expect(checkChild.deletedAt).toBeNull();

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_RESTORED, 
                expect.objectContaining({ folderId: parentFolderId }),
                expect.any(Object)
            );
        });
    });

    // ==========================================
    // 7. PUT /api/folders/:id/move
    // ==========================================
    describe('PUT /api/folders/:id/move', () => {
        it('Nên di chuyển Folder thành công nếu hợp lệ và bắn Queue', async () => {
            const res = await request(app)
                .put(`/api/folders/${childFolderId}/move`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newParentId: null }); 

            expect(res.status).toBe(200);
            expect(res.body.data.parentId).toBeNull();

            const folderInDb = await Folder.findById(childFolderId);
            expect(folderInDb.parentId).toBeNull();

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_MOVED,
                expect.objectContaining({ folderId: childFolderId }),
                expect.any(Object)
            );
        });

        it('Nên chặn lỗi di chuyển vào chính nó', async () => {
            const res = await request(app)
                .put(`/api/folders/${parentFolderId}/move`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newParentId: parentFolderId });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Cannot move folder into itself');
        });

        it('Nên chạy hàm Utils isCircularMove thật và chặn lỗi di chuyển Cha vào Con', async () => {
            const res = await request(app)
                .put(`/api/folders/${parentFolderId}/move`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newParentId: childFolderId });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Cannot move a folder into its subfolder');
        });
    });
}); 