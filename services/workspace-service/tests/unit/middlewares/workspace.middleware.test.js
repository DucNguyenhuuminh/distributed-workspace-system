const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');
const { 
    checkWorkspaceExists, 
    requireAdminRole, 
    requireMemberRole 
} = require('../../../src/middlewares/workspace.middleware');
const Workspace = require('../../../src/models/workspace.model');

jest.mock('../../../src/models/workspace.model');

describe('Workspace Middleware Unit Tests', () => {
    let req, res, next;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        next = jest.fn();
        req.user = { userId: new mongoose.Types.ObjectId().toString() };
    });

    describe('checkWorkspaceExists', () => {
        it('Thất bại: ID sai định dạng (400)', async () => {
            req.params.id = 'invalid-mongodb-id';
            await checkWorkspaceExists(req, res, next);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Invalid Workspace ID format");
        });

        it('Thất bại: Workspace không tồn tại (404)', async () => {
            req.params.id = new mongoose.Types.ObjectId().toString();
            Workspace.findById.mockResolvedValue(null);
            await checkWorkspaceExists(req, res, next);
            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("Workspace not exist");
        });

        it('Thành công: Gán workspace vào req và gọi next()', async () => {
            const mockWs = { _id: 'ws1', name: 'Test WS' };
            req.params.id = new mongoose.Types.ObjectId().toString();
            Workspace.findById.mockResolvedValue(mockWs);
            
            await checkWorkspaceExists(req, res, next);
            expect(req.workspace).toEqual(mockWs);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('requireAdminRole', () => {
        it('Thất bại: Không phải là member (403)', () => {
            req.workspace = { members: [] };
            requireAdminRole(req, res, next);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("Only Admin can perform this action");
        });

        it('Thất bại: Là member nhưng không phải ADMIN (403)', () => {
            req.workspace = { 
                members: [{ userId: req.user.userId, role: 'MEMBER' }] 
            };
            requireAdminRole(req, res, next);
            expect(res.statusCode).toBe(403);
        });

        it('Thành công: Là ADMIN và gọi next()', () => {
            req.workspace = { 
                members: [{ userId: req.user.userId, role: 'ADMIN' }] 
            };
            requireAdminRole(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('requireMemberRole', () => {
        it('Thất bại: Không phải là thành viên của Workspace (403)', () => {
            req.workspace = { members: [{ userId: 'another-user' }] };
            requireMemberRole(req, res, next);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("You do not have permission to access");
        });

        it('Thành công: Là thành viên bình thường (200)', () => {
            req.workspace = { members: [{ userId: req.user.userId, role: 'MEMBER' }] };
            requireMemberRole(req, res, next);
            expect(next).toHaveBeenCalled();
        });
    });
});