const httpMocks = require('node-mocks-http');
const axios = require('axios');
const fileController = require('../../src/controllers/file.controller');
const Document = require('../../src/models/documents.model');

jest.mock('axios');
jest.mock('../../src/models/documents.model');

describe('File Controller Unit Tests', () => {
    let req, res;
    const userId = 'user123';

    beforeEach(() => {
        req = httpMocks.createRequest({ user: { userId } });
        res = httpMocks.createResponse();
        jest.clearAllMocks();
    });

    describe('getFiles', () => {
        it('Thành công: Lấy danh sách file với chuỗi find.populate.sort', async () => {
            req.query = { folderId: 'f1' };
            // Mock chain methods của Mongoose
            const mockSort = jest.fn().mockResolvedValue([{ name: 'file1.pdf' }]);
            const mockPopulate = jest.fn().mockReturnValue({ sort: mockSort });
            Document.find.mockReturnValue({ populate: mockPopulate });

            await fileController.getFiles(req, res);

            expect(Document.find).toHaveBeenCalledWith({ folderId: 'f1' });
            expect(mockPopulate).toHaveBeenCalledWith('physicalFileId', 'sizeBytes mimeType minioObjectPath');
            expect(res.statusCode).toBe(200);
        });
    });

    describe('getFileById', () => {
        it('Thất bại: File không tồn tại (404)', async () => {
            req.params.id = 'file1';
            Document.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

            await fileController.getFileById(req, res);
            expect(res.statusCode).toBe(404);
        });

        it('Thất bại: File cá nhân của người khác (403)', async () => {
            req.params.id = 'file1';
            Document.findById.mockReturnValue({ 
                populate: jest.fn().mockResolvedValue({ uploadedBy: 'hacker123', workspaceId: null }) 
            });

            await fileController.getFileById(req, res);
            expect(res.statusCode).toBe(403);
        });
    });

    describe('renameFile', () => {
        it('Thành công: Rename file cá nhân', async () => {
            req.params.id = 'file1';
            req.body = { name: 'NewName.pdf' };
            
            const mockFile = { 
                uploadedBy: userId, 
                workspaceId: null, 
                originalName: 'Old.pdf',
                save: jest.fn().mockResolvedValue(true)
            };
            Document.findById.mockResolvedValue(mockFile);

            await fileController.renameFile(req, res);
            
            expect(mockFile.originalName).toBe('NewName.pdf');
            expect(mockFile.save).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });

        it('Thất bại: Axios gọi Workspace lỗi (500)', async () => {
            req.params.id = 'file1';
            Document.findById.mockResolvedValue({ uploadedBy: 'other', workspaceId: 'ws1' });
            axios.get.mockRejectedValue(new Error('Workspace Timeout'));

            await fileController.renameFile(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    describe('restoreFile', () => {
        it('Thất bại: Quá hạn 10 ngày (400)', async () => {
            req.params.id = 'file1';
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 11);

            Document.findOne.mockResolvedValue({ deletedAt: oldDate });

            await fileController.restoreFile(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain("over 10 days");
        });

        it('Thất bại: Member thường không được restore trong Workspace (403)', async () => {
            req.params.id = 'file1';
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

            Document.findOne.mockResolvedValue({ deletedAt: twoDaysAgo, workspaceId: 'ws1' });
            // Mock Axios trả về role MEMBER
            axios.get.mockResolvedValue({ 
                data: { data: { members: [{ userId, role: 'MEMBER' }] } } 
            });

            await fileController.restoreFile(req, res);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toContain("Only Workspace's Admin");
        });
    });

    describe('getFileLink', () => {
        it('Thành công: Lấy presigned URL', async () => {
            req.params.id = 'file1';
            req.query.action = 'preview';
            
            const mockFile = { 
                uploadedBy: userId, workspaceId: null, originalName: 'test.pdf',
                physicalFileId: { minioObjectPath: 'path/obj' }
            };
            Document.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(mockFile) });
            
            // Mock Storage Service trả về URL
            axios.get.mockResolvedValue({ data: { data: { url: 'http://minio.link/test' } } });

            await fileController.getFileLink(req, res);
            
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data.url).toBe('http://minio.link/test');
        });
    });

    describe('moveFile', () => {
        it('Thành công: Đưa file ra ngoài root (targetFolderId = null)', async () => {
            req.params.id = 'file1';
            req.params.targetFolderId = null; // Hoặc 'null' tùy router cấu hình

            const mockFile = { 
                uploadedBy: userId, workspaceId: null, folderId: 'f1',
                save: jest.fn().mockResolvedValue(true)
            };
            Document.findById.mockResolvedValue(mockFile);

            await fileController.moveFile(req, res);

            expect(mockFile.folderId).toBeNull();
            expect(mockFile.save).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });
    });
});