const httpMocks = require('node-mocks-http');
const axios = require('axios'); // Import axios để mock
const { createWorkspace, getWorkspaces, getWorkspaceById, addMember, deleteWorkspace, removeMember } = require('../../../src/controllers/workspace.controller');

// MOCK MODEL & AXIOS
jest.mock('axios');
jest.mock('../../../src/models/workspace.model');
jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/models/document.model');

const Workspace = require('../../../src/models/workspace.model');
const Folder = require('../../../src/models/folder.model');
const Document = require('../../../src/models/document.model');

describe('Workspace Controller Unit Tests', () => {
    let req, res, mockSave;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSave = jest.fn().mockResolvedValue(true);
        req = httpMocks.createRequest({
            user: { userId: 'admin-1' }
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
                createdBy: 'admin-1',
                members: [{
                    userId: 'admin-1',
                    role: "ADMIN",
                    permissions: ["preview", "download", "upload"],
                }]
            });
        });
    });

    // ==========================================
    // 2. GET WORKSPACES (LIST)
    // ==========================================
    describe('getWorkspaces API', () => {
        it('SUCCESS: Nên lấy danh sách Workspace mà user là thành viên', async () => {
            const mockList = [{ name: 'WS 1' }, { name: 'WS 2' }];
            Workspace.find.mockResolvedValue(mockList);

            await getWorkspaces(req, res);

            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data).toEqual(mockList);
            expect(Workspace.find).toHaveBeenCalledWith({ 'members.userId': 'admin-1' });
        });
    });

    // ==========================================
    // 3. GET WORKSPACE BY ID
    // ==========================================
    describe('getWorkspaceById API', () => {
        it('SUCCESS: Nên lấy chi tiết 1 Workspace', async () => {
            req.params = { id: 'ws-1' };
            Workspace.findById.mockResolvedValue({ _id: 'ws-1', name: 'WS 1' });

            await getWorkspaceById(req, res);

            expect(res.statusCode).toBe(200);
            expect(Workspace.findById).toHaveBeenCalledWith('ws-1');
        });
    });

    // ==========================================
    // 4. ADD MEMBER (CÓ GỌI AXIOS)
    // ==========================================
    describe('addMember API', () => {
        beforeEach(() => {
            req.params = { id: 'ws-1' };
            req.body = { email: 'newbie@gmail.com', permissions: ['preview', 'upload'] };
        });

        it('SUCCESS: Nên gọi auth-service tìm user và add vào nhóm thành công', async () => {
            // Giả lập DB trả về Workspace
            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [{ userId: 'admin-1' }],
                save: mockSave
            });

            // Giả lập Axios gọi sang Auth-Service thành công
            axios.get.mockResolvedValue({
                data: { data: { _id: 'new-user-id' } }
            });

            await addMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(axios.get).toHaveBeenCalledWith(
                `${process.env.AUTH_SERVICE_URL}/api/auth/internal/find-by-email`, 
                { params: { email: 'newbie@gmail.com' } }
            );
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('ERROR: Nên trả về 404 nếu auth-service báo không tìm thấy user (User not exist)', async () => {
            Workspace.findById.mockResolvedValue({ members: [] });
            
            // Giả lập Axios bị lỗi 404
            axios.get.mockRejectedValue({ response: { status: 404 } });

            await addMember(req, res);

            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("User not exist in this system");
        });

        it('ERROR: Nên trả về 500 nếu auth-service sập (Cannot connect)', async () => {
            Workspace.findById.mockResolvedValue({ members: [] });
            
            // Giả lập Axios lỗi mạng / Không có response
            axios.get.mockRejectedValue(new Error("Network Error"));

            await addMember(req, res);

            expect(res.statusCode).toBe(500);
            expect(res._getJSONData().message).toBe("Cannot connect to auth-service");
        });

        it('ERROR: Nên trả về 400 nếu user ĐÃ LÀ thành viên của nhóm', async () => {
            // Nhóm đã có sẵn 'new-user-id'
            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [{ userId: 'new-user-id' }] 
            });

            // Axios tìm thấy 'new-user-id'
            axios.get.mockResolvedValue({
                data: { data: { _id: 'new-user-id' } }
            });

            await addMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member already in group workspace");
            expect(mockSave).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // 5. DELETE WORKSPACE
    // ==========================================
    describe('deleteWorkspace API', () => {
        it('SUCCESS: Nên Soft Delete Workspace, Folders và Documents', async () => {
            req.params = { id: 'ws-1' };
            
            jest.spyOn(Folder, 'updateMany').mockResolvedValue(true);
            jest.spyOn(Document, 'updateMany').mockResolvedValue(true);
            jest.spyOn(Workspace, 'findByIdAndUpdate').mockResolvedValue(true);

            await deleteWorkspace(req, res);

            expect(res.statusCode).toBe(200);
            expect(Folder.updateMany).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { deletedAt: expect.any(Date) });
            expect(Document.updateMany).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { deletedAt: expect.any(Date) });
            expect(Workspace.findByIdAndUpdate).toHaveBeenCalledWith('ws-1', { deletedAt: expect.any(Date) });
        });
    });

    // ==========================================
    // 6. REMOVE MEMBER
    // ==========================================
    describe('removeMember API', () => {
        beforeEach(() => {
            req.params = { id: 'ws-1', targetUserId: 'target-user' };
        });

        it('SUCCESS: Nên xóa member thành công nếu điều kiện hợp lệ', async () => {
            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [
                    { userId: 'admin-1', role: 'ADMIN' },
                    { userId: 'target-user', role: 'MEMBER' }
                ],
                save: mockSave
            });

            await removeMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('ERROR: Nên trả về 400 nếu Target User không nằm trong Workspace', async () => {
            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [{ userId: 'admin-1', role: 'ADMIN' }] // Không có target-user
            });

            await removeMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Member not in this workspace");
        });

        it('ERROR: Nên trả về 400 nếu Admin duy nhất tự kích chính mình (Self Remove)', async () => {
            req.params.targetUserId = 'admin-1'; // Cố tình kích chính mình

            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [{ userId: 'admin-1', role: 'ADMIN' }] // Chỉ có 1 Admin
            });

            await removeMember(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Cannot out workspace if only Admin");
        });

        it('SUCCESS: Cho phép Admin tự rời nhóm (Self Remove) nếu nhóm CÒN Admin khác', async () => {
            req.params.targetUserId = 'admin-1'; // Tự rời

            Workspace.findById.mockResolvedValue({
                _id: 'ws-1',
                members: [
                    { userId: 'admin-1', role: 'ADMIN' },
                    { userId: 'admin-2', role: 'ADMIN' } // Có người gánh team
                ],
                save: mockSave
            });

            await removeMember(req, res);

            expect(res.statusCode).toBe(200);
            expect(mockSave).toHaveBeenCalledTimes(1);
        });
    });
});