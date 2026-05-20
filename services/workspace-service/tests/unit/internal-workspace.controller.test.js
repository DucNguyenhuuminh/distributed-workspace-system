const Workspace = require('../../src/models/workspace.model'); // Thay đổi đường dẫn cho khớp với project của bạn
const {
    getWorkspacesInternal,
    getWorkspaceByIdInternal,
    getWorkspaceStats
} = require('../../src/controllers/internal-workspace.controller'); // Thay đổi đường dẫn cho khớp

// ── 1. Mock Dependencies ────────────────────────────────────
jest.mock('../../src/models/workspace.model');

// ── 2. Helpers tạo Request & Response ──────────────────────
const mockRequest = (query = {}, params = {}, userId = 'user-1') => ({
    query,
    params,
    user: { userId }
});

const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

// Hàm giả lập Mongoose Query Chaining (.sort.skip.limit)
const mockMongooseQuery = (data) => {
    const query = Promise.resolve(data);
    query.sort = jest.fn().mockReturnValue(query);
    query.skip = jest.fn().mockReturnValue(query);
    query.limit = jest.fn().mockReturnValue(query);
    return query;
};

// ── 3. Test Suites ──────────────────────────────────────────
describe('Workspace Internal Controller - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {}); // Ẩn console.error khi test ngoại lệ
    });

    afterAll(() => {
        console.error.mockRestore();
    });

    // ══════════════════════════════════════════════════════════
    // TEST: getWorkspacesInternal
    // ══════════════════════════════════════════════════════════
    describe('getWorkspacesInternal', () => {
        test('✅ [Admin] Lấy danh sách không có search → 200, phân trang đúng', async () => {
            const req = mockRequest({ isAdminContext: 'true', page: '2', limit: '10' });
            const res = mockResponse();

            Workspace.countDocuments.mockResolvedValue(25);
            Workspace.find.mockReturnValue(mockMongooseQuery([{ _id: 'ws-1' }, { _id: 'ws-2' }]));

            await getWorkspacesInternal(req, res);

            expect(Workspace.countDocuments).toHaveBeenCalledWith({});
            expect(Workspace.find).toHaveBeenCalledWith({});
            expect(res.json).toHaveBeenCalledWith({
                data: {
                    workspaces: expect.any(Array),
                    pagination: {
                        page: 2,
                        limit: 10,
                        total: 25,
                        totalPages: 3 // Math.ceil(25/10)
                    }
                }
            });
        });

        test('✅ [Admin] Lấy danh sách có search query → 200', async () => {
            const req = mockRequest({ isAdminContext: 'true', search: 'Project' });
            const res = mockResponse();

            Workspace.countDocuments.mockResolvedValue(5);
            Workspace.find.mockReturnValue(mockMongooseQuery([]));

            await getWorkspacesInternal(req, res);

            const expectedQuery = { name: { $regex: 'Project', $options: 'i' } };
            expect(Workspace.countDocuments).toHaveBeenCalledWith(expectedQuery);
            expect(Workspace.find).toHaveBeenCalledWith(expectedQuery);
            expect(res.json).toHaveBeenCalled();
        });

        test('✅ [User] Lấy danh sách Workspace của cá nhân → 200, không phân trang', async () => {
            const req = mockRequest({ isAdminContext: 'false' }, {}, 'user-1');
            const res = mockResponse();

            const mockData = [{ _id: 'ws-1' }];
            Workspace.find.mockResolvedValue(mockData); // User find không có chaining

            await getWorkspacesInternal(req, res);

            expect(Workspace.countDocuments).not.toHaveBeenCalled();
            expect(Workspace.find).toHaveBeenCalledWith({ 'members.userId': 'user-1' });
            expect(res.json).toHaveBeenCalledWith({ data: mockData });
        });

        test('❌ Lỗi Database (Catch Error) → 500', async () => {
            const req = mockRequest({ isAdminContext: 'true' });
            const res = mockResponse();

            Workspace.countDocuments.mockRejectedValue(new Error('DB Crash'));

            await getWorkspacesInternal(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ message: 'DB Crash' });
        });
    });

    // ══════════════════════════════════════════════════════════
    // TEST: getWorkspaceByIdInternal
    // ══════════════════════════════════════════════════════════
    describe('getWorkspaceByIdInternal', () => {
        test('❌ Workspace không tồn tại → 404', async () => {
            const req = mockRequest({}, { id: 'fake-id' });
            const res = mockResponse();

            Workspace.findById.mockResolvedValue(null);

            await getWorkspaceByIdInternal(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Workspace not exist' });
        });

        test('❌ [User] Không phải thành viên của Workspace → 403', async () => {
            const req = mockRequest({ isAdminContext: 'false' }, { id: 'ws-1' }, 'user-1');
            const res = mockResponse();

            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [{ userId: 'user-other' }] // Không chứa user-1
            });

            await getWorkspaceByIdInternal(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'You do not have permission to access' });
        });

        test('✅ [User] Là thành viên của Workspace → 200', async () => {
            const req = mockRequest({ isAdminContext: 'false' }, { id: 'ws-1' }, 'user-1');
            const res = mockResponse();

            const mockWorkspace = {
                _id: 'ws-1',
                members: [{ userId: 'user-1' }] // Có chứa user-1
            };
            Workspace.findById.mockResolvedValue(mockWorkspace);

            await getWorkspaceByIdInternal(req, res);

            expect(res.status).not.toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ data: mockWorkspace });
        });

        test('✅ [Admin] Bỏ qua check thành viên, truy cập thành công → 200', async () => {
            const req = mockRequest({ isAdminContext: 'true' }, { id: 'ws-1' }, 'admin-1');
            const res = mockResponse();

            const mockWorkspace = {
                _id: 'ws-1',
                members: [{ userId: 'user-other' }] // admin-1 không nằm trong đây
            };
            Workspace.findById.mockResolvedValue(mockWorkspace);

            await getWorkspaceByIdInternal(req, res);

            expect(res.json).toHaveBeenCalledWith({ data: mockWorkspace });
        });

        test('❌ Lỗi Database khi tra cứu ID → 500', async () => {
            const req = mockRequest({}, { id: 'ws-1' });
            const res = mockResponse();

            Workspace.findById.mockRejectedValue(new Error('Invalid ID'));

            await getWorkspaceByIdInternal(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ message: 'Invalid ID' });
        });
    });

    // ══════════════════════════════════════════════════════════
    // TEST: getWorkspaceStats
    // ══════════════════════════════════════════════════════════
    describe('getWorkspaceStats', () => {
        test('✅ Lấy thống kê tổng số lượng Workspace thành công → 200', async () => {
            const req = mockRequest();
            const res = mockResponse();

            Workspace.countDocuments.mockResolvedValue(42);

            await getWorkspaceStats(req, res);

            expect(Workspace.countDocuments).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({ data: { total: 42 } });
        });

        test('❌ Lỗi Database khi đếm số lượng → 500', async () => {
            const req = mockRequest();
            const res = mockResponse();

            Workspace.countDocuments.mockRejectedValue(new Error('DB Query Failed'));

            await getWorkspaceStats(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ message: 'DB Query Failed' });
        });
    });
});