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

// ── 2. Helpers tạo Request, Response & Query ───────────────
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
    });

    afterAll(() => {
        console.error.mockRestore();
        console.log.mockRestore();
    });

    // =========================================================================
    // TEST: validateShareLink (Được test ngầm qua getSharedFile)
    // =========================================================================
    describe('validateShareLink (Helper Logic)', () => {
        test('❌ Token không tồn tại → 404', async () => {
            ShareLink.findOne.mockResolvedValue(null);
            const res = mockResponse();
            await getSharedFile(mockRequest({}, { token: 'fake' }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('❌ Token đã bị thu hồi (isRevoked) → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ isRevoked: true });
            const res = mockResponse();
            await getSharedFile(mockRequest({}, { token: 'fake' }), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Share link has been revoked' });
        });

        test('❌ Token đã hết hạn → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ expiredAt: new Date(Date.now() - 10000) }); // Quá khứ
            const res = mockResponse();
            await getSharedFile(mockRequest({}, { token: 'fake' }), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Share link has expired' });
        });
    });

    // =========================================================================
    // TEST: createShareLink
    // =========================================================================
    describe('createShareLink', () => {
        const body = { permissions: ['view', 'download'], expiresInHours: '24' };

        test('❌ File không tồn tại → 404', async () => {
            Document.findById.mockReturnValue(mockMongooseQuery(null));
            const res = mockResponse();
            await createShareLink(mockRequest(body, { id: 'file-1' }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('❌ File cá nhân (My Drive) nhưng người gọi không phải Owner → 403', async () => {
            Document.findById.mockReturnValue(mockMongooseQuery({
                workspaceId: null,
                uploadedBy: { toString: () => 'other-user' } // Mock hàm toString()
            }));
            const res = mockResponse();
            await createShareLink(mockRequest(body, { id: 'file-1' }, 'user-1'), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Only file owner can create share link' });
        });

        test('❌ File Workspace nhưng người gọi không phải ADMIN → 403', async () => {
            Document.findById.mockReturnValue(mockMongooseQuery({ workspaceId: 'ws-1' }));
            axios.get.mockResolvedValue({ data: { data: { members: [{ userId: { toString: () => 'user-1' }, role: 'MEMBER' }] } } });
            
            const res = mockResponse();
            await createShareLink(mockRequest(body, { id: 'file-1' }, 'user-1'), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Only workspace Admin can share files' });
        });

        test('✅ Tạo link chia sẻ thành công (My Drive) → 200', async () => {
            Document.findById.mockReturnValue(mockMongooseQuery({
                workspaceId: null, uploadedBy: { toString: () => 'user-1' }, originalName: 'test.pdf',
                physicalFileId: { sizeBytes: 100, mimeType: 'pdf' }
            }));
            ShareLink.create.mockResolvedValue({ token: 'abc-123', permissions: ['view'] });

            const res = mockResponse();
            await createShareLink(mockRequest(body, { id: 'file-1' }, 'user-1'), res);

            expect(ShareLink.create).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Share link created successfully',
                data: expect.objectContaining({ token: 'abc-123' })
            }));
        });
    });

    // =========================================================================
    // TEST: verifySharePassword
    // =========================================================================
    describe('verifySharePassword', () => {
        test('✅ Link không yêu cầu mật khẩu → trả về verified: true', async () => {
            ShareLink.findOne.mockResolvedValue({ password: null });
            const res = mockResponse();
            await verifySharePassword(mockRequest({}, { token: 't1' }), res);
            expect(res.json).toHaveBeenCalledWith({ message: 'No password required', verified: true });
        });

        test('❌ Sai mật khẩu → 401', async () => {
            const mockShare = { password: 'hashed', verifyPassword: jest.fn().mockResolvedValue(false) };
            ShareLink.findOne.mockResolvedValue(mockShare);
            
            const res = mockResponse();
            await verifySharePassword(mockRequest({ password: 'wrong' }, { token: 't1' }), res);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Incorrect password', verified: false });
        });

        test('✅ Mật khẩu đúng → 200', async () => {
            const mockShare = { password: 'hashed', verifyPassword: jest.fn().mockResolvedValue(true) };
            ShareLink.findOne.mockResolvedValue(mockShare);
            
            const res = mockResponse();
            await verifySharePassword(mockRequest({ password: 'correct' }, { token: 't1' }), res);
            expect(res.json).toHaveBeenCalledWith({ message: 'Password verified', verified: true });
        });
    });

    // =========================================================================
    // TEST: accessSharedFile
    // =========================================================================
    describe('accessSharedFile', () => {
        const mockShare = {
            token: 't1', permissions: ['view', 'download'],
            settings: { allowedDownload: true, notifyOnAccess: false },
            fileId: 'f1', originalName: 'file.pdf', verifyPassword: jest.fn().mockResolvedValue(true)
        };

        test('❌ Action không nằm trong permissions của link → 403', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            const res = mockResponse();
            await accessSharedFile(mockRequest({ action: 'edit' }, { token: 't1' }), res); 
            
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Action edit not allowed' }));
        });

        test('❌ Action Download bị tắt trong settings → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ ...mockShare, settings: { allowedDownload: false } });
            const res = mockResponse();
            await accessSharedFile(mockRequest({ action: 'download' }, { token: 't1' }), res);
            
            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('✅ Trả về URL Storage thành công → 200', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({
                physicalFileId: { minioObjectPath: 'path/file.pdf' }
            }));
            axios.get.mockResolvedValue({ data: { data: { url: 'http://minio/file.pdf' } } });

            const res = mockResponse();
            await accessSharedFile(mockRequest({ action: 'view' }, { token: 't1' }), res);

            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/api/storage/file/url'),
                expect.any(Object)
            );
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ url: 'http://minio/file.pdf' })
            }));
        });
    });

    // =========================================================================
    // TEST: saveShareFile
    // =========================================================================
    describe('saveShareFile', () => {
        const mockShare = {
            fileId: 'f1', permissions: ['save'], settings: { allowedSave: true }
        };

        test('❌ Link không có quyền Save → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ ...mockShare, permissions: ['view'] });
            const res = mockResponse();
            // 🟢 FIX: Gọi saveShareFile
            await saveShareFile(mockRequest({}, { token: 't1' }), res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('❌ File gốc không tồn tại → 403', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery(null));
            const res = mockResponse();
            await saveShareFile(mockRequest({}, { token: 't1' }), res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('❌ User cố lưu file của chính mình → 403', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({ uploadedBy: { toString: () => 'user-1' } })); 
            const res = mockResponse();
            await saveShareFile(mockRequest({}, { token: 't1' }, 'user-1'), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Cannot save your own file' });
        });

        test('❌ File đã được lưu trước đó → 409', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({ uploadedBy: { toString: () => 'other-user' } }));
            Document.findOne.mockResolvedValue({ _id: 'doc-already-saved' }); 

            const res = mockResponse();
            await saveShareFile(mockRequest({}, { token: 't1' }, 'user-1'), res);
            expect(res.status).toHaveBeenCalledWith(409);
        });

        test('✅ Lưu file thành công → 201', async () => {
            ShareLink.findOne.mockResolvedValue(mockShare);
            Document.findById.mockReturnValue(mockMongooseQuery({ 
                uploadedBy: { toString: () => 'other' }, 
                physicalFileId: { _id: 'p1' } 
            }));
            Document.findOne.mockResolvedValue(null); // Chưa lưu
            Document.create.mockResolvedValue({ _id: 'new-doc' });

            const res = mockResponse();
            await saveShareFile(mockRequest({ folderId: 'folder1' }, { token: 't1' }, 'user-1'), res);

            expect(Document.create).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'File save into your space' }));
        });
    });

    // =========================================================================
    // TEST: revokeShareLink
    // =========================================================================
    describe('revokeShareLink', () => {
        test('❌ Không phải người tạo link thu hồi → 403', async () => {
            ShareLink.findOne.mockResolvedValue({ createdBy: { toString: () => 'other-user' } });
            const res = mockResponse();
            await revokeShareLink(mockRequest({}, { id: 'f1', token: 't1' }, 'user-1'), res);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Only link creator can revoke it' });
        });

        test('✅ Thu hồi link thành công → 200', async () => {
            const mockShare = { createdBy: { toString: () => 'user-1' }, isRevoked: false, save: jest.fn() };
            ShareLink.findOne.mockResolvedValue(mockShare);
            const res = mockResponse();
            
            await revokeShareLink(mockRequest({}, { id: 'f1', token: 't1' }, 'user-1'), res);
            
            expect(mockShare.isRevoked).toBe(true);
            expect(mockShare.save).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({ message: 'Share link revoked successfully' });
        });
    });

    // =========================================================================
    // TEST: getShareLinks
    // =========================================================================
    describe('getShareLinks', () => {
        test('✅ Trả về danh sách links → 200', async () => {
            ShareLink.find.mockReturnValue(mockMongooseQuery([{ token: 't1' }, { token: 't2' }]));
            const res = mockResponse();
            
            await getShareLinks(mockRequest({}, { id: 'file-1' }, 'user-1'), res);
            
            expect(ShareLink.find).toHaveBeenCalledWith({ fileId: 'file-1', createdBy: 'user-1' });
            expect(res.json).toHaveBeenCalledWith({ data: expect.any(Array) });
        });
    });
});