const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Import Model và Controller của bạn
const Workspace = require('../../src/models/workspace.model'); // Đổi đường dẫn cho khớp
const {
    getWorkspacesInternal,
    getWorkspaceByIdInternal,
    getWorkspaceStats
} = require('../../src/controllers/internal-workspace.controller'); // Đổi đường dẫn cho khớp

let mongod;

// ── 1. Cài đặt App giả lập (Setup Express) ─────────────────
function createApp() {
    const app = express();
    app.use(express.json());

    // Middleware giả lập Authentication
    app.use((req, res, next) => {
        // 🟢 FIX: Nếu không truyền x-user-id thì sinh ra một ObjectId hợp lệ để tránh lỗi CastError
        req.user = { userId: req.headers['x-user-id'] || new mongoose.Types.ObjectId().toString() };
        req.headers.authorization = 'Bearer test-token';
        next();
    });

    // Gắn các routes internal
    app.get('/api/workspaces/internal', getWorkspacesInternal);
    app.get('/api/workspaces/internal/stats', getWorkspaceStats); 
    app.get('/api/workspaces/internal/:id', getWorkspaceByIdInternal);

    return app;
}

// ── 2. Lifecycle Mongoose & Memory Server ──────────────────
beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
});

beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {}); // Ẩn log lỗi
    await Workspace.deleteMany({}); // Dọn sạch DB trước mỗi test case
});

afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
    console.error.mockRestore();
});

// ── 3. BẮT ĐẦU CÁC TEST SUITES ─────────────────────────────
describe('[Integration] Internal Workspace Controller', () => {
    const app = createApp();

    // Biến lưu trữ ID của dữ liệu mẫu
    let ws1Id, ws2Id;
    
    // 🟢 FIX: Sử dụng ObjectId chuẩn của MongoDB thay vì text thường
    const USER_1 = new mongoose.Types.ObjectId().toString();
    const USER_2 = new mongoose.Types.ObjectId().toString();

    beforeEach(async () => {
        // Seed dữ liệu mẫu vào In-memory DB
        // 🟢 FIX: Bổ sung trường 'createdBy' bắt buộc
        const ws1 = await Workspace.create({
            name: 'Alpha Project',
            createdBy: USER_1, 
            members: [{ userId: USER_1, role: 'ADMIN' }, { userId: USER_2, role: 'MEMBER' }]
        });
        const ws2 = await Workspace.create({
            name: 'Beta Campaign',
            createdBy: USER_2,
            members: [{ userId: USER_2, role: 'ADMIN' }] // user-1 không có trong này
        });
        const ws3 = await Workspace.create({
            name: 'Gamma Test',
            createdBy: USER_1,
            members: []
        });

        ws1Id = ws1._id.toString();
        ws2Id = ws2._id.toString();
    });

    // ══════════════════════════════════════════════════════════
    // TEST: GET /api/workspaces/internal
    // ══════════════════════════════════════════════════════════
    describe('GET /api/workspaces/internal', () => {
        test('✅ [Admin] Lấy danh sách (Không có search) → 200, phân trang đúng', async () => {
            const res = await request(app)
                .get('/api/workspaces/internal')
                .query({ isAdminContext: 'true', page: 1, limit: 2 });

            expect(res.status).toBe(200);
            expect(res.body.data.workspaces.length).toBe(2); // Do limit = 2
            expect(res.body.data.pagination).toEqual(expect.objectContaining({
                total: 3, page: 1, limit: 2, totalPages: 2
            }));
        });

        test('✅ [Admin] Lấy danh sách (Có search regex) → 200', async () => {
            const res = await request(app)
                .get('/api/workspaces/internal')
                .query({ isAdminContext: 'true', search: 'Alpha' });

            expect(res.status).toBe(200);
            expect(res.body.data.workspaces.length).toBe(1);
            expect(res.body.data.workspaces[0].name).toBe('Alpha Project');
        });

        test('✅ [User] Lấy danh sách Workspace của cá nhân → 200 (Không phân trang)', async () => {
            const res = await request(app)
                .get('/api/workspaces/internal')
                .query({ isAdminContext: 'false' }) // Context User
                .set('x-user-id', USER_1);          // Đóng vai USER_1

            expect(res.status).toBe(200);
            expect(res.body.data).toBeInstanceOf(Array);
            expect(res.body.data.length).toBe(1); // USER_1 chỉ thuộc về ws1
            expect(res.body.data[0].name).toBe('Alpha Project');
        });

        test('❌ Lỗi Database (Giả lập lỗi Mongoose) → 500', async () => {
            jest.spyOn(Workspace, 'find').mockImplementationOnce(() => { throw new Error('DB Crash'); });
            
            const res = await request(app).get('/api/workspaces/internal');
            
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('DB Crash');
        });
    });

    // ══════════════════════════════════════════════════════════
    // TEST: GET /api/workspaces/internal/:id
    // ══════════════════════════════════════════════════════════
    describe('GET /api/workspaces/internal/:id', () => {
        test('✅ [User] Là thành viên của Workspace → 200', async () => {
            const res = await request(app)
                .get(`/api/workspaces/internal/${ws1Id}`)
                .set('x-user-id', USER_1);

            expect(res.status).toBe(200);
            expect(res.body.data._id).toBe(ws1Id);
            expect(res.body.data.name).toBe('Alpha Project');
        });

        test('✅ [Admin] Không cần là thành viên vẫn lấy được → 200', async () => {
            const res = await request(app)
                .get(`/api/workspaces/internal/${ws2Id}`) // ws2 không có USER_1
                .query({ isAdminContext: 'true' })
                .set('x-user-id', USER_1); // Dù đóng vai USER_1 nhưng có cờ Admin

            expect(res.status).toBe(200);
            expect(res.body.data._id).toBe(ws2Id);
        });

        test('❌ [User] Không phải thành viên của Workspace → 403', async () => {
            const res = await request(app)
                .get(`/api/workspaces/internal/${ws2Id}`) // ws2 không có USER_1
                .set('x-user-id', USER_1);

            expect(res.status).toBe(403);
            expect(res.body.message).toBe('You do not have permission to access');
        });

        test('❌ Workspace không tồn tại → 404', async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const res = await request(app).get(`/api/workspaces/internal/${fakeId}`);
            
            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Workspace not exist');
        });

        test('❌ Truyền ID không hợp lệ (Lỗi CastError của Mongoose) → 500', async () => {
            const res = await request(app).get(`/api/workspaces/internal/invalid-id-format`);
            
            expect(res.status).toBe(500);
        });
    });

    // ══════════════════════════════════════════════════════════
    // TEST: GET /api/workspaces/internal/stats
    // ══════════════════════════════════════════════════════════
    describe('GET /api/workspaces/internal/stats', () => {
        test('✅ Lấy thống kê tổng số lượng Workspace thành công → 200', async () => {
            const res = await request(app).get('/api/workspaces/internal/stats');
            
            expect(res.status).toBe(200);
            expect(res.body.data.total).toBe(3); // Do ở phần beforeEach đã seed 3 bản ghi
        });

        test('❌ Lỗi Database khi đếm số lượng → 500', async () => {
            jest.spyOn(Workspace, 'countDocuments').mockImplementationOnce(() => { throw new Error('Count Failed'); });
            
            const res = await request(app).get('/api/workspaces/internal/stats');
            
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Count Failed');
        });
    });
});