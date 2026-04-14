const httpMocks = require('node-mocks-http');
const axios = require('axios');

const folderController = require('../../../src/controllers/folder.controller');
const Folder = require('../../../src/models/folder.model');
const folderUtil = require('../../../src/utils/folder.util');

jest.mock('axios');
jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/utils/folder.util');

describe('Folder Controller Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        req.user = { userId: 'user123' };
    });

    describe('restoreFolder', () => {
        it('Thất bại: Thư mục không nằm trong thùng rác', async () => {
            req.folder = { deletedAt: null };
            await folderController.restoreFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Folder not in the trash");
        });

        it('Thất bại: Quá hạn 10 ngày khôi phục (400)', async () => {
            const elevenDaysAgo = new Date();
            elevenDaysAgo.setDate(elevenDaysAgo.getDate() - 11);
            
            req.folder = { 
                deletedAt: elevenDaysAgo,
                save: jest.fn()
            };

            await folderController.restoreFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain("over 10 days");
        });

        it('Thành công: Khôi phục thư mục trong hạn 10 ngày', async () => {
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            
            req.folder = { 
                deletedAt: twoDaysAgo,
                save: jest.fn().mockResolvedValue(true)
            };

            await folderController.restoreFolder(req, res);
            expect(req.folder.deletedAt).toBeNull();
            expect(res.statusCode).toBe(200);
        });
    });

    describe('moveFolder', () => {
        it('Thất bại: Di chuyển vào chính nó', async () => {
            req.folder = { _id: 'f1' };
            req.body = { newParentId: 'f1' };
            await folderController.moveFolder(req, res);
            expect(res.statusCode).toBe(400);
        });

        it('Thất bại: Di chuyển tạo thành vòng lặp (Circular Move)', async () => {
            req.folder = { _id: 'f1' };
            req.body = { newParentId: 'sub-f1' };
            
            // Mock các bước kiểm tra thư mục cha mục tiêu
            Folder.findById.mockResolvedValue({ _id: 'sub-f1', createdBy: 'user123' });
            folderUtil.isCircularMove.mockResolvedValue(true);

            await folderController.moveFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain("subfolder");
        });
    });

    describe('deleteFolder', () => {
        it('Thành công: Gọi File Service và update database', async () => {
            // Khởi tạo Request chuẩn xác hơn cho node-mocks-http
            req = httpMocks.createRequest({
                method: 'DELETE',
                url: '/api/folders/f1',
                params: { id: 'f1' },
                headers: { authorization: 'Bearer token' },
                user: { userId: 'user123' }
            });
            res = httpMocks.createResponse();
            
            folderUtil.getAllDescendantIds.mockResolvedValue(['f2', 'f3']);
            axios.delete.mockResolvedValue({ data: 'ok' });
            Folder.updateMany.mockResolvedValue({ nModified: 3 });

            await folderController.deleteFolder(req, res);

            // NẾU VẪN LỖI, HÃY NHÌN VÀO TERMINAL XEM DÒNG CONSOLE NÀY IN RA GÌ NHÉ:
            if (res.statusCode !== 200) {
                console.log("LỖI CONTROLLER BẮN RA LÀ:", res._getJSONData());
            }

            expect(axios.delete).toHaveBeenCalled();
            expect(Folder.updateMany).toHaveBeenCalledWith(
                { _id: { $in: ['f1', 'f2', 'f3'] } },
                { deletedAt: expect.any(Date) }
            );
            expect(res.statusCode).toBe(200);
        });
    });
});