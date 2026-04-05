const httpMocks = require('node-mocks-http');
const {createFolder, getFolders, getFolderById, 
    renameFolder, deleteFolder, moveFolder} = require('../../../src/controllers/folder.controller');

jest.mock('../../../src/models/folder.model');
jest.mock('../../../src/models/workspace.model');
jest.mock('../../../src/utils/folder.util');
jest.mock('../../../src/models/document.model');

const Folder = require('../../../src/models/folder.model');
const Workspace = require('../../../src/models/workspace.model');
const folderUtil = require('../../../src/utils/folder.util');
const Document = require('../../../src/models/document.model');

describe('Folder Controller Unit Tests', () => {
    let req, res, mockSave; 

    beforeEach(() => {
        jest.clearAllMocks();
        mockSave = jest.fn().mockResolvedValue(true);
        
        req = httpMocks.createRequest({
            user: {userId: 'user-1'},
            // 2. Sửa _id thành 'source-folder-id' và gắn đúng mockSave vào đây
            folder: {
                _id: 'source-folder-id', 
                name: 'Test Folder', 
                ownerId: 'user-1',
                save: mockSave 
            },
            body: {}
        });
        res = httpMocks.createResponse();
        
        // 3. Đảm bảo các test case mặc định không bị lặp vòng
        folderUtil.isCircularMove.mockResolvedValue(false);
    });

    // describe('createFolder API', () => {
    //     it('should create a new folder successfully in MyDrive', async () => {
    //         const req = httpMocks.createRequest({
    //             user: {userId: 'user-1'},
    //             body: {name: 'Test MyDrive Folder'}
    //         });
    //         const res = httpMocks.createResponse();
    //         const mockCreatedFolder = {_id: 'folder1', name: 'Test MyDriveFolder', ownerId: 'user-1'};
    //         Folder.create.mockResolvedValue(mockCreatedFolder);

    //         await createFolder(req,res);
    //         expect(res.statusCode).toBe(201);
    //         expect(res._getJSONData()).toEqual({
    //             message: "Create folder successfully",
    //             data: mockCreatedFolder
    //         });
    //         expect(Folder.create).toHaveBeenCalledWith(expect.objectContaining({
    //             name: 'Test MyDrive Folder',
    //             workspaceId: null,
    //             ownerId: 'user-1',
    //             parentId: null,
    //             createdBy: 'user-1'
    //         }));
    //     });
    // });

    // describe('getFolders API', () => {
    //     it('should get all folders in MyDrive successfully', async () => {
    //         const req = httpMocks.createRequest({
    //             user: {userId: 'user-2'},
    //             query: {}
    //         });
    //         const res = httpMocks.createResponse();
    //         Folder.find.mockResolvedValue({name: 'Test MyDrive Folder 1'});
            
    //         await getFolders(req,res);
    //         expect(res.statusCode).toBe(200);
    //         expect(Folder.find).toHaveBeenCalledWith({
    //             parentId: null,
    //             ownerId: 'user-2',
    //             workspaceId: null
    //         });
    //     });
    // });

    // describe('getFolders API', () => {
    //     it('should get all folders in MyDrive successfully (Returning 2 folders)', async () => {
    //         const req = httpMocks.createRequest({
    //             user: { userId: 'user-1' }, 
    //             query: {}
    //         });
    //         const res = httpMocks.createResponse();

    //         const mockFoldersList = [
    //             { _id: 'folder1', name: 'Test MyDrive Folder 1', ownerId: 'user-1' },
    //             { _id: 'folder2', name: 'Test MyDrive Folder 2', ownerId: 'user-1' }
    //         ];
    //         Folder.find.mockResolvedValue(mockFoldersList);
            
    //         await getFolders(req, res);
    //         expect(res.statusCode).toBe(200);

    //         const responseData = res._getJSONData();
    //         expect(responseData.data).toHaveLength(2); 
    //         expect(responseData.data).toEqual(mockFoldersList); 
            
    //         expect(Folder.find).toHaveBeenCalledWith({
    //             parentId: null,
    //             ownerId: 'user-1',
    //             workspaceId: null
    //         });
    //     });
    // });

    // describe('getFolderById API', () => {
    //     it('should get folder details successfully', async () => {
    //         const req = httpMocks.createRequest({
    //             folder: {_id: 'folder1', name: "Test MyDrive Folder"}
    //         });
    //         const res = httpMocks.createResponse();
    //         const mockBreadcrumb = [
    //             {_id: 'root', name: 'Root Folder', parentId: null},
    //             {_id: 'folder1', name: 'Test MyDrive Folder', parentId: 'root'}
    //         ];
    //         folderUtil.getBreadcrumbPath.mockResolvedValue(mockBreadcrumb);

    //         await getFolderById(req,res);
    //         expect(res.statusCode).toBe(200);
    //         expect(res._getJSONData()).toEqual({
    //             data: {_id: 'folder1', name: "Test MyDrive Folder"},
    //             breadcrumb: mockBreadcrumb
    //         });
    //         expect(folderUtil.getBreadcrumbPath).toHaveBeenCalledWith('folder1');
    //     });
    // });

    // describe('renameFolder API', () => {
    //     it('should rename folder successfully', async () => {
    //         const mockSave = jest.fn().mockResolvedValue();
    //         const req = httpMocks.createRequest({
    //             folder: {_id: 'folder1', name: "Test MyDrive Folder", save: mockSave},
    //             body: {name: "Test renamed Folder"}
    //         });
    //         const res = httpMocks.createResponse();
            
    //         await renameFolder(req,res);
    //         expect(res.statusCode).toBe(200);
    //         expect(req.folder.name).toBe("Test renamed Folder");
    //         expect(mockSave).toHaveBeenCalledTimes(1);
    //         expect(res._getJSONData()).toEqual({
    //             data: {_id: 'folder1', name: "Test renamed Folder"},
    //             message: "Rename successfully"
    //         });
    //     });
    // });

    // describe('deleteFolder API', () => {
    //     it('should delete folder successfully', async () => {
    //         const req = httpMocks.createRequest({
    //             params: {id: 'folder1'}
    //         });
    //         const res = httpMocks.createResponse();
    //         folderUtil.getAllDescendantIds.mockResolvedValue(['child-1', 'child-2','child-3']);

    //         jest.spyOn(Document, 'updateMany').mockResolvedValue(true);
    //         jest.spyOn(Folder, 'updateMany').mockResolvedValue(true);

    //         await deleteFolder(req,res);
    //         expect(res.statusCode).toBe(200);
    //         expect(Folder.updateMany).toHaveBeenCalledWith(
    //             {_id: {$in: ['folder1', 'child-1', 'child-2','child-3']}},
    //             {deletedAt: expect.any(Date)}
    //         );
    //         expect(Document.updateMany).toHaveBeenCalledWith(
    //             {folderId: {$in: ['folder1', 'child-1', 'child-2','child-3']}},
    //             {deletedAt: expect.any(Date)}
    //         );
    //     });
    // });

    // TEST CASES FOR 8 ERROR CASES SCENARIOS

    // 1. Error movement of folder to itself
    describe('SUCCESS CASES', () => {

        it('1. Nên move thành công vào một Folder khác trong My Drive', async () => {
            req.body = { newParentId: 'target-folder-id' };
            Folder.findById.mockResolvedValue({
                _id: 'target-folder-id',
                workspaceId: null,
                createdBy: 'user-1' // Folder này do chính user tạo ra
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(200);
            expect(req.folder.parentId).toBe('target-folder-id');
            expect(req.folder.workspaceId).toBeNull();
            expect(req.folder.ownerId).toBe('user-1');
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('2. Nên move thành công vào một Folder bên trong Workspace', async () => {
            req.body = { newParentId: 'target-folder-id' };
            Folder.findById.mockResolvedValue({
                _id: 'target-folder-id',
                workspaceId: 'workspace-1'
            });
            Workspace.findById.mockResolvedValue({
                _id: 'workspace-1',
                members: [{ userId: 'user-1', role: 'MEMBER', permissions: ['upload'] }]
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(200);
            expect(req.folder.parentId).toBe('target-folder-id');
            expect(req.folder.workspaceId).toBe('workspace-1');
            expect(req.folder.ownerId).toBeNull(); // Đã vào Nhóm thì mất ownerId cá nhân
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('3. Nên move thành công ra Gốc (Root) của Workspace', async () => {
            req.body = { newParentId: null, targetWorkspaceId: 'workspace-root-id' };
            Workspace.findById.mockResolvedValue({
                _id: 'workspace-root-id',
                members: [{ userId: 'user-1', role: 'ADMIN', permissions: [] }] // ADMIN có quyền tối cao
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(200);
            expect(req.folder.parentId).toBeNull(); // Ra Gốc nên không có cha
            expect(req.folder.workspaceId).toBe('workspace-root-id');
            expect(mockSave).toHaveBeenCalledTimes(1);
        });

        it('4. Nên move thành công từ thư mục con ra Gốc (Root) của My Drive', async () => {
            req.body = { newParentId: null, targetWorkspaceId: null };
            // Không truyền target ID nào tức là lôi nó ra ngoài cùng của My Drive

            await moveFolder(req, res);

            expect(res.statusCode).toBe(200);
            expect(req.folder.parentId).toBeNull();
            expect(req.folder.workspaceId).toBeNull();
            expect(req.folder.ownerId).toBe('user-1');
            expect(mockSave).toHaveBeenCalledTimes(1);
        });
    });

    // ==========================================
    // PHẦN 2: ERROR CASES (CÁC TRƯỜNG HỢP LỖI BẢO MẬT/LOGIC)
    // ==========================================
    describe('ERROR CASES', () => {

        it('5. Nên trả về 400 nếu cố move folder vào chính nó', async () => {
            req.body = { newParentId: 'source-folder-id' }; // Cùng ID với req.folder._id

            await moveFolder(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Cannot move folder into itself");
            expect(mockSave).not.toHaveBeenCalled();
        });

        it('6. Nên trả về 404 nếu Folder đích (newParentId) không tồn tại', async () => {
            req.body = { newParentId: 'ghost-folder-id' };
            Folder.findById.mockResolvedValue(null);

            await moveFolder(req, res);

            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("Target parent folder not found");
        });

        it('7. Nên trả về 403 nếu cố move vào My Drive Folder của người khác', async () => {
            req.body = { newParentId: 'target-folder-id' };
            Folder.findById.mockResolvedValue({
                _id: 'target-folder-id',
                workspaceId: null,
                createdBy: 'user-999' // Thuộc về user khác
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("No permission to move to the target folder");
        });

        it('8. Nên trả về 403 nếu cố lôi Folder của người khác về My Drive Root của mình', async () => {
            req.body = { newParentId: null, targetWorkspaceId: null };
            req.folder.ownerId = 'user-999'; // Cố lôi thư mục của người khác

            await moveFolder(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("Cannot move another user's folder to your My Drive root");
        });

        it('9. Nên trả về 404 nếu Workspace Đích không tồn tại', async () => {
            req.body = { newParentId: null, targetWorkspaceId: 'ghost-workspace-id' };
            Workspace.findById.mockResolvedValue(null);

            await moveFolder(req, res);

            expect(res.statusCode).toBe(404);
            expect(res._getJSONData().message).toBe("Target workspace not found");
        });

        it('10. Nên trả về 403 nếu không phải là thành viên của Workspace Đích', async () => {
            req.body = { newParentId: null, targetWorkspaceId: 'workspace-1' };
            Workspace.findById.mockResolvedValue({
                _id: 'workspace-1',
                members: [{ userId: 'Admin', role: 'ADMIN', permissions: [] }] // Không có user-1
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("You are not a member of the target workspace");
        });

        it('11. Nên trả về 403 nếu là thành viên nhưng KHÔNG CÓ quyền Upload', async () => {
            req.body = { newParentId: null, targetWorkspaceId: 'workspace-1' };
            Workspace.findById.mockResolvedValue({
                _id: 'workspace-1',
                members: [{ userId: 'user-1', role: 'MEMBER', permissions: ['preview', 'download'] }] // Thiếu 'upload'
            });

            await moveFolder(req, res);

            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("No 'upload' permission for target workspace");
        });

        it('12. Nên trả về 400 nếu phát hiện lặp vòng (Circular Loop)', async () => {
            req.body = { newParentId: 'target-folder-id' };
            Folder.findById.mockResolvedValue({
                _id: 'target-folder-id',
                workspaceId: null,
                createdBy: 'user-1'
            });
            // Giả lập Helper bắt được lỗi vòng lặp
            folderUtil.isCircularMove.mockResolvedValue(true); 

            await moveFolder(req, res);

            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Cannot move a folder into its subfolder");
            expect(mockSave).not.toHaveBeenCalled();
        });
    });
});