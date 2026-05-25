const axios = require('axios');
const Document = require('../../src/models/documents.model');
const ShareLink = require('../../src/models/share.model');

const {
    createShareLink, getSharedFile, verifySharePassword,
    accessSharedFile, saveShareFile, revokeShareLink, getShareLinks
} = require('../../src/controllers/share.controller');

// ── 1. Mock Dependencies ────────────────────────────────────
jest.mock('axios');
jest.mock('../../src/models/documents.model');
jest.mock('../../src/models/share.model');

process.env.WORKSPACE_SERVICE_URL = 'http://localhost:3003';
process.env.STORAGE_SERVICE_URL = 'http://localhost:3005';
process.env.FRONTEND_URL = 'http://localhost:5137';

// ── 2. Helpers tạo Request, Response ───────────────────────
const mockRequest = (body = {}, params = {}, userId = 'user-1') => ({
    body, params,
    user: { userId },
    headers: { authentication: 'Bearer token' }
});

const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

// 🟢 Helper mock Mongoose Query (populate/sort/select)
const mockMongooseQuery = (data) => {
    const query = Promise.resolve(data);
    query.populate = jest.fn().mockReturnValue(query);
    query.select = jest.fn().mockReturnValue(query);
    query.sort = jest.fn().mockReturnValue(query);
    return query;
};

// ── 3. Test Suites ──────────────────────────────────────────
describe('ShareLink Controller - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {}); 
        jest.spyOn(console, 'log').mockImplementation(() => {}); 
        jest.spyOn(console, 'warn').mockImplementation(() => {}); 
    });

    afterAll(() => {
        console.error.mockRestore();
        console.log.mockRestore();
        console.warn.mockRestore();
    });

    // =========================================================================
    // TEST: validateShareLink (Helper Logic)
    // =========================================================================
    describe('validateShareLink (Helper Logic)', () => {
        test('❌ Token không tồn tại → 404', async () => {
            ShareLink.findOne.mockResolvedValue(null);
            const res = mockResponse();
            await getSharedFile(mockRequest({}, { token: 'fake' }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('❌ Token đã bị thu hồi → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ isRevoked: true });
            const res = mockResponse();
            await getSharedFile(mockRequest({}, { token: 'fake' }), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Share link has been revoked' });
        });
    });

    // =========================================================================
    // TEST: createShareLink
    // =========================================================================
    describe('createShareLink', () => {
        test('✅ Tạo link thành công (My Drive) → 200', async () => {
            Document.findById.mockReturnValue(mockMongooseQuery({
                workspaceId: null, 
                uploadedBy: { toString: () => 'user-1' }, 
                originalName: 'test.pdf',
                physicalFileId: { sizeBytes: 100, mimeType: 'pdf' }
            }));
            ShareLink.create.mockResolvedValue({ 
                token: 'abc-123', permissions: ['view'], password: null, settings: {} 
            });

            const res = mockResponse();
            await createShareLink(mockRequest({ permissions: ['view'] }, { id: 'f1' }, 'user-1'), res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Share link created successfully'
            }));
        });
    });

    // =========================================================================
    // TEST: saveShareFile
    // =========================================================================
    describe('saveShareFile', () => {
        const mockShare = {
            fileId: 'f1', 
            permissions: ['save'], 
            settings: { allowedSave: true },
            verifyPassword: jest.fn().mockResolvedValue(true)
        };

        test('❌ File đã được lưu trước đó → 409', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({ 
                uploadedBy: { toString: () => 'other' }, 
                physicalFileId: { _id: 'p1' } 
            }));
            // 🟢 ĐÃ FIX: Sửa lỗi chính tả biến 'alreadySaved'
            Document.findOne.mockResolvedValue({ _id: 'doc-already-saved' }); 

            const res = mockResponse();
            await saveShareFile(mockRequest({}, { token: 't1' }, 'user-1'), res);
            
            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: 'File already saved'
            }));
        });

        test('✅ Lưu file thành công → 201', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({ 
                uploadedBy: { toString: () => 'other' }, 
                physicalFileId: { _id: 'p1' } 
            }));
            Document.findOne.mockResolvedValue(null); 
            Document.create.mockResolvedValue({ 
                _id: 'new-doc', originalName: 'f.pdf', mimeType: 'pdf', sizeBytes: 100 
            });

            const res = mockResponse();
            await saveShareFile(mockRequest({ folderId: 'folder1' }, { token: 't1' }, 'user-1'), res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ 
                message: 'File save into your space' 
            }));
        });
    });

    // =========================================================================
    // TEST: revokeShareLink
    // =========================================================================
    describe('revokeShareLink', () => {
        test('✅ Thu hồi link thành công → 200', async () => {
            const mockShare = { 
                createdBy: { toString: () => 'user-1' }, 
                isRevoked: false, 
                save: jest.fn().mockResolvedValue(true) 
            };
            ShareLink.findOne.mockResolvedValue(mockShare);
            const res = mockResponse();
            
            await revokeShareLink(mockRequest({}, { id: 'f1', token: 't1' }, 'user-1'), res);
            
            expect(mockShare.isRevoked).toBe(true);
            expect(mockShare.save).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Share link revoked successfully' });
        });
    });
});