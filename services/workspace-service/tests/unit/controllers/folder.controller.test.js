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
    beforeEach(() => {
        jest.clearAllMocks();
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

    describe('moveFolder API', () => {
        it('should block and return error 404 if find out circuler loop', async () => {
            const req = httpMocks.createRequest({
                user: {userId: 'user-1'},
                folder: {_id: 'source-folder'},
                body: {newParentId: 'target-folder'}
            });
            const res = httpMocks.createResponse();

            Folder.findById.mockResolvedValue({
                _id: 'target-folder',
                workspaceId: null,
                createdBy: 'user-1'
            });
            folderUtil.isCircularMove.mockResolvedValue(true);

            await moveFolder(req,res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData()).toEqual({
                message: "Cannot move a folder into its subfolder"
            });
            expect(req.folder.save).toBeUndefined();
        });

        it('should return 403 if try to move in Workspace without permission (upload)', async () => {
            const req = httpMocks.createRequest({
                user: {userId: 'user-1'},
                folder: {_id: 'source-folder'},
                body: {newParentId: 'target-folder', targetWorkspaceId: 'workspace1'}
            });
            const res = httpMocks.createResponse();
            Folder.findById.mockResolvedValue({
                _id: 'target-folder',
                workspaceId: 'workspace1'
            });

            Workspace.findById.mockResolvedValue({
                _id: 'workspace1',
                members: [{userId: 'user-1', role: 'MEMBER', permissions: ['preview']}]
            });

            await moveFolder(req,res);
            expect(res.statusCode).toBe(403);
            expect(res._getJSONData().message).toBe("No 'upload' permission");
        });
    });
});