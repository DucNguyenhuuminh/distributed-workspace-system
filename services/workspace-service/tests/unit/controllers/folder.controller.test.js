jest.mock('axios');
jest.mock('ioredis', () => require('ioredis-mock'));

jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/utils/folder.util');

// Kích hoạt Mock cho BullMQ
jest.mock('shared', () => ({
    addJob: jest.fn().mockResolvedValue(true),
    queueForEvent: jest.fn().mockReturnValue('mock-queue'),
    jobIdFor: jest.fn().mockReturnValue('mock-job-id'),
    EVENTS: {
        FOLDER_CREATED: 'FOLDER_CREATED',
        FOLDER_RENAMED: 'FOLDER_RENAMED',
        FOLDER_TRASHED: 'FOLDER_TRASHED', 
        FOLDER_RESTORED: 'FOLDER_RESTORED',
        FOLDER_MOVED: 'FOLDER_MOVED',
    },
    DEFAULT_JOB_OPTIONS: { attempts: 2 }
}));

const httpMocks = require('node-mocks-http');
const folderController = require('../../../src/controllers/folder.controller');
const Folder = require('../../../src/models/folder.model');
const folderUtil = require('../../../src/utils/folder.util');
const { addJob, EVENTS } = require('shared');

describe('Folder Controller Unit Tests', () => {
    let req, res;
    const currentUserId = 'user123';

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        req.user = { userId: currentUserId };
        jest.clearAllMocks();
    });

    // ==========================================
    // 1. CREATE FOLDER
    // ==========================================
    describe('createFolder', () => {
        it('Thành công: Tạo thư mục mới, lưu DB và bắn Queue Event', async () => {
            req.body = { name: 'Thư mục mới', workspaceId: 'ws1', parentId: null };
            
            const mockFolder = {
                _id: { toString: () => 'f1' },
                workspaceId: 'ws1',
                name: 'Thư mục mới',
                toObject: () => ({ name: 'Thư mục mới' }) 
            };
            Folder.create.mockResolvedValue(mockFolder);

            await folderController.createFolder(req, res);

            expect(Folder.create).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Thư mục mới',
                workspaceId: 'ws1',
                createdBy: currentUserId
            }));
            
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_CREATED,
                expect.objectContaining({ folderId: 'f1', workspaceId: 'ws1' }),
                expect.any(Object)
            );
            expect(res.statusCode).toBe(201);
        });

        it('Thất bại: DB lỗi khi tạo thư mục (500)', async () => {
            Folder.create.mockRejectedValue(new Error('Database Error'));
            await folderController.createFolder(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 2. GET FOLDERS
    // ==========================================
    describe('getFolders', () => {
        it('Thành công: Lấy danh sách thư mục gốc trong Workspace', async () => {
            req.query = { workspaceId: 'ws1' };
            Folder.find.mockResolvedValue([{ name: 'Folder 1' }]);

            await folderController.getFolders(req, res);

            expect(Folder.find).toHaveBeenCalledWith({ parentId: null, workspaceId: 'ws1' });
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data).toHaveLength(1);
        });

        it('Thành công: Lấy danh sách thư mục con dựa theo parentId', async () => {
            req.query = { parentId: 'parent123' };
            Folder.find.mockResolvedValue([{ name: 'Sub Folder' }]);

            await folderController.getFolders(req, res);

            expect(Folder.find).toHaveBeenCalledWith({ parentId: 'parent123' });
            expect(res.statusCode).toBe(200);
        });

        it('Thất bại: Lỗi kết nối DB khi lấy danh sách (500)', async () => {
            Folder.find.mockRejectedValue(new Error('Connection timeout'));
            await folderController.getFolders(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 3. GET FOLDER BY ID
    // ==========================================
    describe('getFolderById', () => {
        it('Thành công: Trả về chi tiết thư mục kèm đường dẫn (Breadcrumb)', async () => {
            req.folder = { _id: 'f1', name: 'Môn Toán' };
            folderUtil.getBreadcrumbPath.mockResolvedValue([{ _id: 'root', name: 'Đại học' }, { _id: 'f1', name: 'Môn Toán' }]);

            await folderController.getFolderById(req, res);

            expect(folderUtil.getBreadcrumbPath).toHaveBeenCalledWith('f1');
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().breadcrumb).toHaveLength(2);
        });

        it('Thất bại: Lỗi hệ thống khi tạo Breadcrumb (500)', async () => {
            req.folder = { _id: 'f1' };
            folderUtil.getBreadcrumbPath.mockRejectedValue(new Error('Unknown error'));

            await folderController.getFolderById(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 4. RENAME FOLDER
    // ==========================================
    describe('renameFolder', () => {
        it('Thành công: Đổi tên thư mục, lưu DB và bắn Queue Event', async () => {
            req.folder = {
                _id: { toString: () => 'f1' },
                name: 'Tên cũ',
                save: jest.fn().mockResolvedValue(true),
                toObject: () => ({ name: 'Tên mới' })
            };
            req.body = { name: 'Tên mới' };

            await folderController.renameFolder(req, res);

            expect(req.folder.name).toBe('Tên mới');
            expect(req.folder.save).toHaveBeenCalled();
            
            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_RENAMED,
                expect.objectContaining({ folderId: 'f1', newName: 'Tên mới' }),
                expect.any(Object)
            );
            expect(res.statusCode).toBe(200);
        });

        it('Thất bại: Lỗi khi lưu DB đổi tên (500)', async () => {
            req.folder = { save: jest.fn().mockRejectedValue(new Error('Save DB failed')) };
            await folderController.renameFolder(req, res);
            expect(res.statusCode).toBe(500);
        });
    });

    // ==========================================
    // 5. RESTORE FOLDER
    // ==========================================
    describe('restoreFolder', () => {
        it('Thất bại: Thư mục không nằm trong thùng rác', async () => {
            req.folder = { 
                _id: { toString: () => 'f1' }, 
                deletedAt: null 
            };
            await folderController.restoreFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Folder not in the trash");
        });

        it('Thất bại: Quá hạn 10 ngày khôi phục (400)', async () => {
            const elevenDaysAgo = new Date();
            elevenDaysAgo.setDate(elevenDaysAgo.getDate() - 11);
            
            req.folder = { 
                _id: { toString: () => 'f1' },
                deletedAt: elevenDaysAgo,
                save: jest.fn()
            };

            await folderController.restoreFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain("over 10 days");
        });

        it('Thành công: Khôi phục thư mục trong hạn 10 ngày và bắn Queue', async () => {
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            
            req.folder = { 
                _id: { toString: () => 'f1' },
                deletedAt: twoDaysAgo
            };

            folderUtil.getAllDescendantIds.mockResolvedValue(['sub-f1', 'sub-f2']);
            Folder.updateMany.mockResolvedValue({ nModified: 3 });

            await folderController.restoreFolder(req, res);
            
            expect(Folder.updateMany).toHaveBeenCalledWith(
                { _id: { $in: ['f1', 'sub-f1', 'sub-f2'] } },
                { deletedAt: null }
            );

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                EVENTS.FOLDER_RESTORED,
                expect.objectContaining({ folderId: 'f1', allFoldersIds: ['f1', 'sub-f1', 'sub-f2'] }),
                expect.any(Object)
            );
            expect(res.statusCode).toBe(200);
        });
    });

    // ==========================================
    // 6. MOVE FOLDER
    // ==========================================
    describe('moveFolder', () => {
        it('Thất bại: Di chuyển vào chính nó (400)', async () => {
            req.folder = { _id: { toString: () => 'f1' } };
            req.body = { newParentId: 'f1' };
            await folderController.moveFolder(req, res);
            expect(res.statusCode).toBe(400);
        });

        it('Thất bại: Di chuyển tạo thành vòng lặp - Circular Move (400)', async () => {
            req.folder = { _id: { toString: () => 'f1' } };
            req.body = { newParentId: 'sub-f1' };
            
            Folder.findById.mockResolvedValue({ _id: 'sub-f1', createdBy: currentUserId });
            folderUtil.isCircularMove.mockResolvedValue(true);

            await folderController.moveFolder(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toContain("subfolder");
        });
    });

    // ==========================================
    // 7. DELETE FOLDER
    // ==========================================
    describe('deleteFolder', () => {
        it('Thành công: Soft delete trong DB và bắn Queue Event dọn dẹp', async () => {
            req = httpMocks.createRequest({
                method: 'DELETE',
                params: { id: 'f1' },
                user: { userId: currentUserId }
            });
            res = httpMocks.createResponse();
            
            folderUtil.getAllDescendantIds.mockResolvedValue(['f2', 'f3']);
            Folder.updateMany.mockResolvedValue({ nModified: 3 });

            await folderController.deleteFolder(req, res);
            
            expect(Folder.updateMany).toHaveBeenCalledWith(
                { _id: { $in: ['f1', 'f2', 'f3'] } },
                { deletedAt: expect.any(Date) }
            );

            expect(addJob).toHaveBeenCalledWith(
                'mock-queue',
                expect.any(String), 
                expect.objectContaining({ folderId: 'f1', allFolderIds: ['f1', 'f2', 'f3'] }),
                expect.any(Object)
            );

            expect(res.statusCode).toBe(200);
        });
    });
});