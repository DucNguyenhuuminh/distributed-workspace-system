const httpMocks = require('node-mocks-http');
const internalController = require('../../src/controllers/internal.controller');
const Document = require('../../src/models/documents.model');

jest.mock('../../src/models/documents.model');

describe('Internal Controller Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        jest.clearAllMocks();
    });

    describe('deletedByWorkspace', () => {
        it('Thành công: Xóa mềm tất cả file trong Workspace', async () => {
            req.params.id = 'ws123';
            Document.updateMany.mockResolvedValue({ nModified: 10 });

            await internalController.deletedByWorkspace(req, res);

            expect(Document.updateMany).toHaveBeenCalledWith(
                { workspaceId: 'ws123' },
                { deletedAt: expect.any(Date) }
            );
            expect(res.statusCode).toBe(200);
        });

        it('Thất bại: Lỗi DB (500)', async () => {
            Document.updateMany.mockRejectedValue(new Error('DB Error'));
            await internalController.deletedByWorkspace(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    describe('deletedByFolders', () => {
        it('Thất bại: Không truyền folderIds hoặc không phải mảng (400)', async () => {
            req.body = { folderIds: "không-phải-mảng" };
            await internalController.deletedByFolders(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("folderIds is required");
        });

        it('Thành công: Xóa mềm theo mảng folderIds', async () => {
            req.body = { folderIds: ['f1', 'f2'] };
            Document.updateMany.mockResolvedValue({ nModified: 5 });

            await internalController.deletedByFolders(req, res);

            expect(Document.updateMany).toHaveBeenCalledWith(
                { folderId: { $in: ['f1', 'f2'] } },
                { deletedAt: expect.any(Date) }
            );
            expect(res.statusCode).toBe(200);
        });
    });
});