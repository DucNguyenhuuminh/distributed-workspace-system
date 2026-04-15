const axios = require('axios');
const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');

const { 
    checkFolderExists, 
    checkFolderPermission, 
    requireFolderEditPermission 
} = require('../../../src/middlewares/folder.middleware');
const Folder = require('../../../src/models/folder.model');
const Workspace = require('../../../src/models/workspace.model');

jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/models/workspace.model');

describe('Folder Middleware Unit Tests', () => {
    let req, res, next;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        next = jest.fn();
        req.user = { userId: new mongoose.Types.ObjectId().toString() };
    });

    describe('checkFolderExists', () => {
        it('Thất bại: ID sai định dạng (400)', async () => {
            req.params.id = 'invalid-id';
            await checkFolderExists(req, res, next);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain('format');
        });

        it('Thất bại: Thư mục không tồn tại (404)', async () => {
            req.params.id = new mongoose.Types.ObjectId().toString();
            Folder.findById.mockResolvedValue(null);
            await checkFolderExists(req, res, next);
            expect(res.statusCode).toBe(404);
        });

        it('Thành công: Gán folder vào req và gọi next()', async () => {
            const mockFolder = { _id: 'f1', workspaceId: null };
            req.params.id = new mongoose.Types.ObjectId().toString();
            Folder.findById.mockResolvedValue(mockFolder);
            
            await checkFolderExists(req, res, next);
            expect(req.folder).toEqual(mockFolder);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('checkFolderPermission', () => {
        it('Thất bại: User không phải chủ sở hữu folder cá nhân (403)', () => {
            req.folder = { createdBy: 'another-user', workspaceId: null };
            checkFolderPermission(req, res, next);
            expect(res.statusCode).toBe(403);
        });

        it('Thành công: User là thành viên của Workspace (200)', () => {
            req.folder = { workspaceId: 'ws1' };
            req.workspace = { members: [{ userId: req.user.userId }] };
            checkFolderPermission(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('requireFolderEditPermission', () => {
        it('Thành công: Admin Workspace có quyền sửa', () => {
            req.folder = { workspaceId: 'ws1' };
            req.workspace = { 
                members: [{ userId: req.user.userId, role: 'ADMIN' }] 
            };
            // Mock find vì code dùng .find thay vì .some
            req.workspace.members.find = jest.fn().mockReturnValue(req.workspace.members[0]);
            
            requireFolderEditPermission(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('Thất bại: Member không có quyền upload/edit (403)', () => {
            req.folder = { workspaceId: 'ws1' };
            const member = { userId: req.user.userId, role: 'MEMBER', permissions: ['preview'] };
            req.workspace = { members: [member] };
            
            requireFolderEditPermission(req, res, next);
            expect(res.statusCode).toBe(403);
        });
    });
});