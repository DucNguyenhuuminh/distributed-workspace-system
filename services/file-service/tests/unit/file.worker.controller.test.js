const httpMocks = require('node-mocks-http');
const axios = require('axios');
const workerController = require('../../src/controllers/file.worker.controller');
const PhysicalFile = require('../../src/models/physical-file.model');
const Document = require('../../src/models/documents.model');

jest.mock('axios');
jest.mock('../../src/models/physical-file.model');
jest.mock('../../src/models/documents.model');

describe('File Worker Controller Unit Tests', () => {
    let req, res;
    const userId = 'user123';

    beforeEach(() => {
        req = httpMocks.createRequest({ user: { userId } });
        res = httpMocks.createResponse();
        jest.clearAllMocks();
    });

    describe('initUpload', () => {
        beforeEach(() => {
            req.body = { filename: 'test.pdf', totalChunks: 3, mimeType: 'application/pdf', workspaceId: 'ws1' };
        });

        it('Thất bại: Không có quyền upload trong Workspace (403)', async () => {
            // Giả lập Axios gọi sang Workspace Service trả về mảng không có quyền upload
            axios.get.mockResolvedValue({ 
                data: { data: { members: [{ userId, permissions: ['download'] }] } } 
            });

            await workerController.initUpload(req, res);
            expect(res.statusCode).toBe(403);
        });

        it('Thất bại: Storage Service bị sập (500)', async () => {
            axios.get.mockResolvedValue({ 
                data: { data: { members: [{ userId, permissions: ['upload'] }] } } 
            });
            axios.post.mockRejectedValue(new Error('Storage timeout'));

            await workerController.initUpload(req, res);
            expect(res.statusCode).toBe(500);
            expect(res._getJSONData().message).toBe('Cannot connect to storage-service');
        });

        it('Thành công: Xin được Presigned URLs từ Storage', async () => {
            axios.get.mockResolvedValue({ 
                data: { data: { members: [{ userId, permissions: ['upload'] }] } } 
            });
            axios.post.mockResolvedValue({
                data: { data: { uploadId: 'up1', objectName: 'obj1', presignedUrls: ['url1'] } }
            });

            await workerController.initUpload(req, res);
            expect(res.statusCode).toBe(201);
            expect(res._getJSONData().data.uploadId).toBe('up1');
        });
    });

    // TEST CÁC HÀM CHECK HASH & MERGE (Dựa trên code Deduplication tôi cung cấp trước đó)
    describe('checkHash', () => {
        it('Thành công (Trùng lặp): Tự động tạo Document (200)', async () => {
            req.body = { hashString: 'abc123hash' };
            PhysicalFile.findOne.mockResolvedValue({ _id: 'phys1' });
            Document.create.mockResolvedValue({ _id: 'doc1' });

            await workerController.checkHash(req, res);
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data.isDuplicate).toBe(true);
        });

        it('Thành công (File mới): Trả về 404 để tiếp tục Upload thật', async () => {
            req.body = { hashString: 'newhash' };
            PhysicalFile.findOne.mockResolvedValue(null);

            await workerController.checkHash(req, res);
            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().data.isDuplicate).toBe(false);
        });
    });

    describe('mergeUpload', () => {
        it('Thành công: Gộp chunks và lưu Database', async () => {
            req.body = { uploadId: 'up1', etags: [], hashString: 'hash1' };
            axios.post.mockResolvedValue({ data: 'ok' });
            PhysicalFile.findOne.mockResolvedValue(null);
            PhysicalFile.create.mockResolvedValue({ _id: 'phys1' });
            Document.create.mockResolvedValue({ _id: 'doc1' });

            await workerController.mergeUpload(req, res);
            expect(PhysicalFile.create).toHaveBeenCalled();
            expect(Document.create).toHaveBeenCalled();
            expect(res.statusCode).toBe(200);
        });
    });
});