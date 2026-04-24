const httpMocks = require('node-mocks-http');
const axios = require('axios');
const workspaceController = require('../../../src/controllers/workspace.controller');
const Workspace = require('../../../src/models/workspace.model');
const Folder = require('../../../src/models/folder.model');

const { addJob, EVENTS } = require('shared'); 

jest.mock('axios');
jest.mock('../../../src/models/workspace.model');
jest.mock('../../../src/models/folder.model');

// Kích hoạt Mock cho BullMQ
jest.mock('shared', () => ({
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
}));

describe('Workspace Controller Unit Tests', () => {
    let req, res;
    const currentUserId = 'user123';

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        req.user = { userId: currentUserId };
        jest.clearAllMocks();
    });

    describe('createWorkspace', () => {
        it('Thành công: Tạo workspace mới', async () => {
            req.body = { name: 'My Workspace' };
            
            // Giả lập _id là một object có hàm toString() giống hành vi của Mongoose
            const mockWs = { 
                _id: { toString: () => 'ws1' }, 
                name: 'My Workspace',
                // 👉 ĐÃ THÊM HÀM GIẢ toObject
                toObject: function() { return this; }
            };
            Workspace.create.mockResolvedValue(mockWs);

            await workspaceController.createWorkspace(req, res);

            expect(Workspace.create).toHaveBeenCalledWith(expect.objectContaining({
                name: 'My Workspace',
                createdBy: currentUserId,
                members: expect.arrayContaining([
                    expect.objectContaining({ role: 'ADMIN', userId: currentUserId })
                ])
            }));
            
            expect(res.statusCode).toBe(201);
            expect(res._getJSONData().data.name).toEqual('My Workspace');
        });
    });

    describe('getWorkspaces', () => {
        it('Thành công: Lấy danh sách workspace của user', async () => {
            Workspace.find.mockResolvedValue([{ name: 'WS 1' }]);
            await workspaceController.getWorkspaces(req, res);
            expect(Workspace.find).toHaveBeenCalledWith({ 'members.userId': currentUserId });
            expect(res.statusCode).toBe(200);
        });
    });

    describe('getWorkspaceById', () => {
        it('Thành công: Trả về data từ req.workspace', async () => {
            req.workspace = { _id: 'ws1', name: 'WS 1' };
            await workspaceController.getWorkspaceById(req, res);
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data.name).toBe('WS 1');
        });
    });

    describe('addMember', () => {
        beforeEach(() => {
            req.workspace = { 
                _id: 'ws1', 
                members: [{ userId: currentUserId }], 
                save: jest.fn().mockResolvedValue(true),
                // 👉 ĐÃ THÊM HÀM GIẢ toObject
                toObject: function() { return this; }
            };
            req.body = { email: 'new@test.com' };
        });

        it('Thất bại: Auth Service báo User không tồn tại (404)', async () => {
            axios.get.mockRejectedValue({ response: { status: 404 } });
            await workspaceController.addMember(req, res);
            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("User not exist in this system");
        });

        it('Thất bại: Auth Service sập hoặc lỗi mạng (500)', async () => {
            axios.get.mockRejectedValue(new Error('Network Error'));
            await workspaceController.addMember(req, res);
            expect(res.statusCode).toBe(500);
            expect(res._getJSONData().message).toBe("Cannot connect to auth-service");
        });

        it('Thất bại: User đã ở sẵn trong Workspace (400)', async () => {
            axios.get.mockResolvedValue({ data: { data: { _id: currentUserId } } });
            await workspaceController.addMember(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member already in group workspace");
        });

        it('Thành công: Gọi Axios, thêm mem và lưu DB', async () => {
            axios.get.mockResolvedValue({ data: { data: { _id: 'newUser456' } } });
            await workspaceController.addMember(req, res);
            
            expect(req.workspace.members.length).toBe(2);
            expect(req.workspace.save).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });
    });

    describe('deleteWorkspace', () => {
        it('Thành công: Cập nhật DB và bắn Queue Event (Không dùng Axios nữa)', async () => {
            req.workspace = { 
                _id: 'ws1', 
                save: jest.fn().mockResolvedValue(true),
                // 👉 ĐÃ THÊM HÀM GIẢ toObject
                toObject: function() { return this; }
            };
            Folder.updateMany.mockResolvedValue({ nModified: 5 });

            await workspaceController.deleteWorkspace(req, res);

            // 1. Kiểm tra Database (Folder và Workspace được xóa mềm)
            expect(Folder.updateMany).toHaveBeenCalledWith({ workspaceId: 'ws1' }, expect.any(Object));
            expect(req.workspace.deletedAt).toBeDefined();
            expect(req.workspace.save).toHaveBeenCalled();
            
            // 2. Kiểm tra Queue đã được gọi để bắn Event dọn dẹp
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue', 
                EVENTS.WORKSPACE_DELETED, 
                expect.objectContaining({ workspaceId: 'ws1' }), 
                expect.any(Object)
            );

            expect(res.statusCode).toBe(200);
        });
    });

    describe('removeMember', () => {
        beforeEach(() => {
            req.workspace = { 
                _id: 'ws1',
                members: [
                    { userId: currentUserId, role: 'ADMIN' },
                    { userId: 'target456', role: 'MEMBER' }
                ],
                save: jest.fn().mockResolvedValue(true),
                // 👉 ĐÃ THÊM HÀM GIẢ toObject
                toObject: function() { return this; }
            };
        });

        it('Thất bại: Target user không có trong Workspace (400)', async () => {
            req.params.targetUserId = 'ghost-user';
            await workspaceController.removeMember(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member not in this workspace");
        });

        it('Thất bại: Current user không nằm trong nhóm (403)', async () => {
            req.params.targetUserId = 'target456';
            req.user.userId = 'hacker123'; // Đổi người gửi request
            await workspaceController.removeMember(req, res);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("You are not a member of this workspace");
        });

        it('Thất bại: MEMBER thường định đuổi người khác (403)', async () => {
            req.params.targetUserId = currentUserId; // currentUserId đóng vai trò nạn nhân
            req.user.userId = 'target456'; // Người gửi request là MEMBER thường
            await workspaceController.removeMember(req, res);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("Only Admin can remove other members");
        });

        it('Thất bại: Admin duy nhất tự rời nhóm (400)', async () => {
            req.params.targetUserId = currentUserId; 
            // Set up: Chỉ có 1 Admin
            req.workspace.members = [{ userId: currentUserId, role: 'ADMIN' }];
            
            await workspaceController.removeMember(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Cannot leave workspace if you are only Admin");
        });

        it('Thành công: Admin xóa Member khác', async () => {
            req.params.targetUserId = 'target456';
            await workspaceController.removeMember(req, res);
            
            expect(req.workspace.members.length).toBe(1);
            expect(req.workspace.save).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });

        it('Thành công: Admin tự rời nhóm khi có nhiều Admin khác', async () => {
            req.params.targetUserId = currentUserId;
            // Thêm 1 admin nữa vào nhóm
            req.workspace.members.push({ userId: 'another-admin', role: 'ADMIN' });
            
            await workspaceController.removeMember(req, res);
            expect(req.workspace.save).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });
    });
});