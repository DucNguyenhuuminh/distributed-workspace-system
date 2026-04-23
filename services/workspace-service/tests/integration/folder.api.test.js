const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('./app'); 
const Folder = require('../../src/models/folder.model');
const Workspace = require('../../src/models/workspace.model');

// CHỈ CÔ LẬP AXIOS (Không gửi request mạng thật sang service khác)
// HOÀN TOÀN KHÔNG CÔ LẬP UTILS NỮA!
jest.mock('axios');

process.env.JWT_SECRET = 'test_secret_key_123';

describe('Deep Integration Test: Folder APIs (Controller + Utils + DB)', () => {
    let token = '';
    let testUserId = new mongoose.Types.ObjectId();
    let testWorkspaceId = '';
    let parentFolderId = '';
    let childFolderId = ''; // Thêm folder con để test thuật toán Utils
    
    let mongoServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        token = jwt.sign({ userId: testUserId.toString() }, process.env.JWT_SECRET);
    });

    beforeEach(async () => {
        await Folder.deleteMany({});
        await Workspace.deleteMany({});
        jest.clearAllMocks(); 

        // 1. Tạo Workspace
        const ws = await Workspace.create({
            name: 'Workspace 1',
            createdBy: testUserId,
            members: [{ userId: testUserId, role: 'ADMIN', permissions: ['upload', 'preview'] }]
        });
        testWorkspaceId = ws._id.toString();

        // 2. TẠO CÂY THƯ MỤC THẬT (Cha chứa Con)
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
            parentId: parentFolderId, // Nằm trong thư mục Cha
            createdBy: testUserId,
        });
        childFolderId = childFolder._id.toString();
    });

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoServer.stop();
    });

    // ==========================================
    // 1. GET /api/folders/:id (TEST THUẬT TOÁN BREADCRUMB)
    // ==========================================
    describe('GET /api/folders/:id', () => {
        it('Nên chạy hàm Utils thật và trả về Breadcrumb chính xác', async () => {
            const res = await request(app)
                .get(`/api/folders/${childFolderId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Thư mục Con');
            
            // SỬA Ở ĐÂY: Kỳ vọng độ dài là 2 (bao gồm cả Cha và Con)
            expect(res.body.breadcrumb).toHaveLength(2);
            
            // Phần tử đầu tiên là thư mục Cha
            expect(res.body.breadcrumb[0]._id.toString()).toBe(parentFolderId);
            expect(res.body.breadcrumb[0].name).toBe('Thư mục Cha');
            
            // Phần tử thứ hai là chính nó (thư mục Con)
            expect(res.body.breadcrumb[1]._id.toString()).toBe(childFolderId);
            expect(res.body.breadcrumb[1].name).toBe('Thư mục Con');
        });
    });

    // ==========================================
    // 2. DELETE /api/folders/:id (TEST THUẬT TOÁN ĐỆ QUY XÓA CON)
    // ==========================================
    describe('DELETE /api/folders/:id', () => {
        it('Nên quét Utils thật, tìm ra thư mục con và Xóa mềm tất cả', async () => {
            axios.delete.mockResolvedValue({}); 

            const res = await request(app)
                .delete(`/api/folders/${parentFolderId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            
            // SỬA Ở ĐÂY: Trích xuất trực tiếp mảng folderIds ra và ép về String để chống lỗi strict type của Jest
            const axiosArgs = axios.delete.mock.calls[0]; // Lấy các tham số của lần gọi axios đầu tiên
            const urlSent = axiosArgs[0];
            const dataSent = axiosArgs[1].data.folderIds.map(id => id.toString()); // Ép hết về String

            expect(urlSent).toContain(`/api/files/internal/by-folders/${parentFolderId}`);
            expect(dataSent).toContain(parentFolderId); // Phải chứa ID của Cha
            expect(dataSent).toContain(childFolderId);  // Phải chứa ID của Con tìm được từ Utils

            // 2. Đi cửa sau DB kiểm tra xem Thư mục CHA bị xóa chưa
            const checkParent = await Folder.collection.findOne({ _id: new mongoose.Types.ObjectId(parentFolderId) });
            expect(checkParent.deletedAt).not.toBeNull();

            // 3. Đi cửa sau DB kiểm tra xem Thư mục CON bị xóa chưa
            const checkChild = await Folder.collection.findOne({ _id: new mongoose.Types.ObjectId(childFolderId) });
            expect(checkChild.deletedAt).not.toBeNull();
        });
    });

    // ==========================================
    // 3. PUT /api/folders/:id/move (TEST THUẬT TOÁN CHỐNG VÒNG LẶP CIRCULAR)
    // ==========================================
    describe('PUT /api/folders/:id/move', () => {
        it('Nên di chuyển Folder thành công nếu hợp lệ', async () => {
            const res = await request(app)
                .put(`/api/folders/${childFolderId}/move`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newParentId: null }); // Đưa ra ngoài cùng

            expect(res.status).toBe(200);
            expect(res.body.data.parentId).toBeNull();
        });

        it('Nên chạy hàm Utils isCircularMove thật và chặn lỗi di chuyển Cha vào Con', async () => {
            // Cố tình MOVE thư mục CHA chui vào trong thư mục CON
            const res = await request(app)
                .put(`/api/folders/${parentFolderId}/move`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newParentId: childFolderId });

            expect(res.status).toBe(400);
            // Xác nhận Utils isCircularMove đã quét DB và phát hiện vòng lặp
            expect(res.body.message).toBe('Cannot move a folder into its subfolder');
        });
    });

    // ==========================================
    // (Các test CRUD cơ bản khác giữ nguyên...)
    // ==========================================
    describe('POST /api/folders', () => {
        it('Nên tạo Folder thành công', async () => {
            const res = await request(app)
                .post('/api/folders')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Mật', parentId: null, workspaceId: testWorkspaceId });
            expect(res.status).toBe(201);
        });
    });
});