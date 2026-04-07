const httpMocks = require('node-mocks-http');
const axios = require('axios');
const { createWorkspace, getWorkspaces, getWorkspaceById, addMember, deleteWorkspace, removeMember } = require('../../../src/controllers/workspace.controller');

jest.mock('axios');
jest.mock('../../../src/models/workspace.model');
jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/models/document.model');

const Workspace = require('../../../src/models/workspace.model');
const Folder = require('../../../src/models/folder.model');
const Document = require('../../../src/models/document.model');

describe('Workspace Controller Unit Tests (Middleware Integrated)', () => {
    let req, res, mockSave;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSave = jest.fn().mockResolvedValue(true);
        
        // Setup chung cho tất cả Request
        req = httpMocks.createRequest({
            user: { userId: 'user-admin' },
            body: {},
            params: {}
        });
        res = httpMocks.createResponse();
    });

    // ==========================================
    // 1. CREATE WORKSPACE
    // ==========================================
    describe('createWorkspace API', () => {
        it('SUCCESS: Nên tạo Workspace thành công và gán user làm ADMIN', async () => {
            req.body = { name: 'Team Alpha' };
            const mockCreatedWs = { _id: 'ws-1', name: 'Team Alpha' };
            Workspace.create.mockResolvedValue(mockCreatedWs);

            await createWorkspace(req, res);

            expect(res.statusCode).toBe(201);
            expect(res._getJSONData().data).toEqual(mockCreatedWs);
            expect(Workspace.create).toHaveBeenCalledWith({
                name: 'Team Alpha',
                createdBy: 'user-admin',
                members: [{
                    userId: 'user-admin',
                    role: "ADMIN",
                    permissions: ["preview", "download", "upload"],
                }]
            });
        });

        it('FAIL: Nên trả về 500 nếu DB bị lỗi khi tạo mới', async () => {
            req.body = { name: 'Team Alpha' };
            Workspace.create.mockRejectedValue(new Error('DB Error'));

            await createWorkspace(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 2. GET WORKSPACES (LIST)
    // ==========================================
    describe('getWorkspaces API', () => {
        it('SUCCESS: Nên lấy danh sách Workspace của user hiện tại', async () => {
            const mockList = [{ _id: 'ws-1', name: 'WS 1' }];
            Workspace.find.mockResolvedValue(mockList);

            await getWorkspaces(req, res);

            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data).toEqual(mockList);
            expect(Workspace.find).toHaveBeenCalledWith({ 'members.userId': 'user-admin' });
        });

        it('FAIL: Nên trả về 500 nếu DB lỗi khi fetch danh sách', async () => {
            Workspace.find.mockRejectedValue(new Error('DB Error'));
            await getWorkspaces(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 3. GET WORKSPACE BY ID
    // ==========================================
    describe('getWorkspaceById API', () => {
        it('SUCCESS: Nên trả về chi tiết Workspace lấy từ Middleware', async () => {
            // Middleware đã gắn sẵn req.workspace
            req.workspace = { _id: 'ws-1', name: 'WS 1' };

            await getWorkspaceById(req, res);

            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data).toEqual(req.workspace);
        });
    });

    // ==========================================
    // 4. ADD MEMBER
    // ==========================================
    describe('addMember API', () => {
        beforeEach(() => {
            req.body = { email: 'newbie@gmail.com', permissions: ['preview'] };
            req.workspace = {
                _id: 'ws-1',
                members: [{ userId: 'user-admin' }],
                save: mockSave
            };
        });

        it('SUCCESS: Nên gọi auth-service và add user vào nhóm thành công', async () => {
            axios.get.mockResolvedValue({ data: { data: { _id: 'new-user-id' } } });

            await addMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(axios.get).toHaveBeenCalledWith(
                `${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-email`, 
                { params: { email: 'newbie@gmail.com' } }
            );
            expect(req.workspace.members).toHaveLength(2); // Đã push thêm 1 người
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('FAIL: Trả về 400 nếu user ĐÃ LÀ thành viên của nhóm', async () => {
            req.workspace.members = [{ userId: 'new-user-id' }]; // Đã có sẵn trong nhóm
            axios.get.mockResolvedValue({ data: { data: { _id: 'new-user-id' } } });

            await addMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member already in group workspace");
            expect(mockSave).not.toHaveBeenCalled();
        });

        it('FAIL: Trả về 404 nếu auth-service báo email không tồn tại', async () => {
            axios.get.mockRejectedValue({ response: { status: 404 } });

            await addMember(req, res);

            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("User not exist in this system");
        });

        it('FAIL: Trả về 500 nếu auth-service bị sập mạng', async () => {
            axios.get.mockRejectedValue(new Error("Network connection lost"));

            await addMember(req, res);

            expect(res.statusCode).toBe(500);
            expect(res._getJSONData().message).toBe("Cannot connect to auth-service");
        });
    });

    // ==========================================
    // 5. DELETE WORKSPACE
    // ==========================================
    describe('deleteWorkspace API', () => {
        it('SUCCESS: Nên Soft Delete Workspace, Folders và Documents', async () => {
            req.workspace = { _id: 'ws-1', save: mockSave };
            
            jest.spyOn(Folder, 'updateMany').mockResolvedValue(true);
            jest.spyOn(Document, 'updateMany').mockResolvedValue(true);

            await deleteWorkspace(req, res);

            expect(res.statusCode).toBe(200);
            expect(Folder.updateMany).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { deletedAt: expect.any(Date) });
            expect(Document.updateMany).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { deletedAt: expect.any(Date) });
            expect(req.workspace.deletedAt).toBeInstanceOf(Date);
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('FAIL: Trả về 500 nếu update DB thất bại', async () => {
            req.workspace = { _id: 'ws-1', save: mockSave };
            jest.spyOn(Folder, 'updateMany').mockRejectedValue(new Error('DB Crash'));

            await deleteWorkspace(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 6. REMOVE MEMBER
    // ==========================================
    describe('removeMember API', () => {
        beforeEach(() => {
            req.params = { targetUserId: 'target-user' };
            req.user = { userId: 'user-admin' }; // Người thực hiện lệnh là Admin
        });

        it('SUCCESS: Admin xóa một Member thường khỏi nhóm thành công', async () => {
            req.workspace = {
                _id: 'ws-1',
                members: [
                    { userId: 'user-admin', role: 'ADMIN' },
                    { userId: 'target-user', role: 'MEMBER' }
                ],
                save: mockSave
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(req.workspace.members).toHaveLength(1); // Mảng đã lọc mất target-user
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('SUCCESS: Admin tự rời nhóm (khi vẫn còn Admin khác gánh team)', async () => {
            req.params.targetUserId = 'user-admin'; // Tự kick chính mình
            req.workspace = {
                _id: 'ws-1',
                members: [
                    { userId: 'user-admin', role: 'ADMIN' },
                    { userId: 'another-admin', role: 'ADMIN' }
                ],
                save: mockSave
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('FAIL: Trả về 400 nếu người cần xóa không nằm trong nhóm', async () => {
            req.workspace = {
                _id: 'ws-1',
                members: [{ userId: 'user-admin', role: 'ADMIN' }]
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member not in this workspace");
        });

        it('FAIL: Trả về 403 nếu người thực hiện lệnh không phải thành viên nhóm', async () => {
            req.user.userId = 'hacker'; // Một kẻ lạ mặt gọi API
            req.workspace = {
                _id: 'ws-1',
                members: [{ userId: 'target-user', role: 'MEMBER' }]
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("You are not a member of this workspace");
        });

        it('FAIL: Trả về 403 nếu Member thường đòi đi xóa người khác', async () => {
            req.user.userId = 'normal-member';
            req.workspace = {
                _id: 'ws-1',
                members: [
                    { userId: 'normal-member', role: 'MEMBER' }, // Không phải ADMIN
                    { userId: 'target-user', role: 'MEMBER' }
                ]
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("Only Admin can remove other members");
        });

        it('FAIL: Trả về 400 nếu Admin DUY NHẤT đòi bỏ trốn (Self Remove)', async () => {
            req.params.targetUserId = 'user-admin';
            req.workspace = {
                _id: 'ws-1',
                members: [{ userId: 'user-admin', role: 'ADMIN' }] // Chỉ có 1 Admin duy nhất
            };

            await removeMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toMatch(/Cannot leave workspace/);
        });
    });
});