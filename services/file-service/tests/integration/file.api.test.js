const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server'); // Thêm Mock DB
const app = require('./app'); 
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');

// Kích hoạt Mocking cho Axios để chặn gọi sang Workspace và Storage Service
jest.mock('axios');

// Ép dùng chung Secret Key
process.env.JWT_SECRET = 'test_secret_key_123';

describe('Integration Test: File & Worker APIs', () => {
    let token = '';
    let testUserId = new mongoose.Types.ObjectId();
    let testWorkspaceId = new mongoose.Types.ObjectId();
    
    let testPhysicalFileId = '';
    let testPersonalDocId = '';
    let testWorkspaceDocId = '';
    let testDeletedDocId = '';

    let mongoServer; // Biến chứa instance của Mock DB

    beforeAll(async () => {
        // KHỞI ĐỘNG MOCK DB TRÊN RAM
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        token = jwt.sign({ userId: testUserId.toString() }, process.env.JWT_SECRET);
    });

    beforeEach(async () => {
        // Dọn rác DB trước mỗi test
        await Document.deleteMany({});
        await PhysicalFile.deleteMany({});
        jest.clearAllMocks(); 

        // 1. Tạo 1 Physical File gốc (để test checkHash)
        const pFile = await PhysicalFile.create({
            hashString: 'hash-abc-123',
            minioObjectPath: 'file/test.pdf',
            sizeBytes: 1024,
            mimeType: 'application/pdf'
        });
        testPhysicalFileId = pFile._id.toString();

        // 2. Tạo File cá nhân (Không thuộc workspace)
        const doc1 = await Document.create({
            originalName: 'CaNhan.pdf',
            workspaceId: null,
            physicalFileId: testPhysicalFileId,
            uploadedBy: testUserId
        });
        testPersonalDocId = doc1._id.toString();

        // 3. Tạo File của Nhóm (Thuộc workspace, do người khác up)
        const doc2 = await Document.create({
            originalName: 'Nhom.pdf',
            workspaceId: testWorkspaceId,
            physicalFileId: testPhysicalFileId,
            uploadedBy: new mongoose.Types.ObjectId() 
        });
        testWorkspaceDocId = doc2._id.toString();

        // 4. Tạo File đã bị xóa mềm (Để test restore)
        const doc3 = await Document.create({
            originalName: 'DaXoa.pdf',
            workspaceId: null,
            physicalFileId: testPhysicalFileId,
            uploadedBy: testUserId,
            deletedAt: new Date() 
        });
        testDeletedDocId = doc3._id.toString();
    });

    afterAll(async () => {
        // Dọn sạch rác và TẮT MOCK DB
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoServer.stop();
    });

    // ==========================================
    // PHẦN 1: FILE WORKER CONTROLLER (Luồng Upload)
    // ==========================================
    describe('FILE WORKER CONTROLLER', () => {

        describe('POST /api/files-worker/hash', () => {
            it('Nên trả về 200 và copy file ngay lập tức nếu trùng Hash', async () => {
                const res = await request(app)
                    .post('/api/files-worker/hash')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ filename: 'Copy.pdf', hashString: 'hash-abc-123' }); 

                expect(res.status).toBe(200);
                expect(res.body.data.isDuplicate).toBe(true);

                const clonedDoc = await Document.findOne({ originalName: 'Copy.pdf' });
                expect(clonedDoc).not.toBeNull();
                expect(clonedDoc.physicalFileId.toString()).toBe(testPhysicalFileId);
            });

            it('Nên trả về 404 nếu băm Hash ra một file hoàn toàn mới', async () => {
                const res = await request(app)
                    .post('/api/files-worker/hash')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ filename: 'MoiTinh.pdf', hashString: 'new-hash-xyz' });

                expect(res.status).toBe(404);
                expect(res.body.data.isDuplicate).toBe(false);
            });
        });

        describe('POST /api/files-worker/init', () => {
            it('Nên gọi Storage-Service để xin Presigned URLs', async () => {
                axios.post.mockResolvedValue({
                    data: { data: { uploadId: 'up-123', objectName: 'file/test', presignedUrls: ['url1'] } }
                });

                const res = await request(app)
                    .post('/api/files-worker/init')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ filename: 'test.pdf', totalChunks: 1, mimeType: 'application/pdf', sizeBytes: 1000 });

                expect(res.status).toBe(201);
                expect(res.body.data.uploadId).toBe('up-123');
                
                expect(axios.post).toHaveBeenCalledWith(
                    expect.stringContaining('/api/storage/multipart/init'),
                    expect.any(Object)
                );
            });
        });

        describe('POST /api/files-worker/merge', () => {
            it('Nên gọi Storage-Service merge và lưu data vào DB', async () => {
                axios.post.mockResolvedValue({}); 

                const res = await request(app)
                    .post('/api/files-worker/merge')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ 
                        uploadId: 'up-123', objectName: 'file/vid.mp4', filename: 'vid.mp4', 
                        hashString: 'hash-vid-123', mimeType: 'video/mp4', sizeBytes: 50000,
                        totalChunks: 1, 
                        etags: [{ partNumber: 1, etag: 'etag123' }] 
                    });

                expect(res.status).toBe(200);

                const newPhysical = await PhysicalFile.findOne({ hashString: 'hash-vid-123' });
                expect(newPhysical).not.toBeNull();

                const newDoc = await Document.findOne({ originalName: 'vid.mp4' });
                expect(newDoc).not.toBeNull();
            });
        });
    });

    // ==========================================
    // PHẦN 2: FILE CONTROLLER (CRUD Cơ bản)
    // ==========================================
    describe('FILE CONTROLLER', () => {

        describe('GET /api/files/', () => {
            it('Nên trả về danh sách file cá nhân (workspaceId = null)', async () => {
                const res = await request(app)
                    .get('/api/files/')
                    .set('Authorization', `Bearer ${token}`);

                expect(res.status).toBe(200);
                expect(res.body.data.length).toBeGreaterThanOrEqual(1); 
            });
        });

        describe('GET /api/files/:id/link', () => {
            it('Nên gọi Axios sang Storage-Service để lấy Link tải (File cá nhân)', async () => {
                axios.get.mockResolvedValue({
                    data: { data: { url: 'https://minio.local/download-link' } }
                });

                const res = await request(app)
                    .get(`/api/files/${testPersonalDocId}/link`)
                    .set('Authorization', `Bearer ${token}`)
                    .query({ action: 'download' });

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.data.url).toBe('https://minio.local/download-link');

                expect(axios.get).toHaveBeenCalledWith(
                    expect.stringContaining('/api/storage/file/url'),
                    expect.objectContaining({ params: expect.objectContaining({ action: 'download' }) })
                );
            });

            it('Nên bị chặn 403 nếu cố xin link file cá nhân của người khác', async () => {
                const otherToken = jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, process.env.JWT_SECRET);
                
                const res = await request(app)
                    .get(`/api/files/${testPersonalDocId}/link`)
                    .set('Authorization', `Bearer ${otherToken}`);

                expect(res.status).toBe(403);
            });
        });

        describe('PUT /api/files/:id/rename', () => {
            it('Nên đổi tên file cá nhân thành công', async () => {
                const res = await request(app)
                    .put(`/api/files/${testPersonalDocId}/rename`)
                    .set('Authorization', `Bearer ${token}`)
                    .send({ name: 'TenMoi.pdf' });

                expect(res.status).toBe(200);
                const checkDoc = await Document.findById(testPersonalDocId);
                expect(checkDoc.originalName).toBe('TenMoi.pdf');
            });
        });

        describe('DELETE /api/files/:id', () => {
            it('Nên xóa mềm thành công file cá nhân (Đi cửa sau kiểm tra deletedAt)', async () => {
                const res = await request(app)
                    .delete(`/api/files/${testPersonalDocId}`)
                    .set('Authorization', `Bearer ${token}`);

                expect(res.status).toBe(200);

                const checkDoc = await Document.collection.findOne({ _id: new mongoose.Types.ObjectId(testPersonalDocId) });
                expect(checkDoc.deletedAt).not.toBeNull();
            });

            it('Nên gọi Axios check quyền ADMIN bên Workspace Service trước khi xóa file Nhóm', async () => {
                axios.get.mockResolvedValue({
                    data: { data: { members: [{ userId: testUserId.toString(), role: 'ADMIN' }] } }
                });

                const res = await request(app)
                    .delete(`/api/files/${testWorkspaceDocId}`)
                    .set('Authorization', `Bearer ${token}`);

                expect(res.status).toBe(200);

                expect(axios.get).toHaveBeenCalledWith(
                    expect.stringContaining(`/api/workspaces/${testWorkspaceId}`),
                    expect.any(Object)
                );
            });
        });

        describe('PUT /api/files/:id/restore', () => {
            it('Nên khôi phục file bị xóa mềm thành công', async () => {
                const res = await request(app)
                    .put(`/api/files/${testDeletedDocId}/restore`)
                    .set('Authorization', `Bearer ${token}`);

                expect(res.status).toBe(200);

                const checkDoc = await Document.collection.findOne({ _id: new mongoose.Types.ObjectId(testDeletedDocId) });
                expect(checkDoc.deletedAt).toBeNull();
            });
        });

        describe('PUT /api/files/:id/move/:targetFolderId', () => {
            it('Nên di chuyển file cá nhân sang folder khác thành công', async () => {
                const mockFolderId = new mongoose.Types.ObjectId().toString();

                const res = await request(app)
                    .put(`/api/files/${testPersonalDocId}/move/${mockFolderId}`)
                    .set('Authorization', `Bearer ${token}`);

                expect(res.status).toBe(200);
                
                const checkDoc = await Document.findById(testPersonalDocId);
                expect(checkDoc.folderId.toString()).toBe(mockFolderId);
            });
        });

    });
});