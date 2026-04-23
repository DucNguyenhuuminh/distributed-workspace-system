const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./app'); // Import app của storage-service

// 1. MOCK MINIO CLIENT ĐỂ TRÁNH GỌI MINIO THẬT
jest.mock('../src/config/minio.config', () => ({
    minioClient: {
        initiateNewMultipartUpload: jest.fn(),
        presignedUrl: jest.fn(),
        completeMultipartUpload: jest.fn(),
        presignedGetObject: jest.fn(),
        removeObject: jest.fn()
    },
    bucketName: 'test-bucket'
}));

// Import bản mock ra để chúng ta có thể điều khiển nó trong từng bài test
const { minioClient } = require('../src/config/minio.config');

// Ép dùng chung Secret Key (Đề phòng có middleware verifyToken)
process.env.JWT_SECRET = 'test_secret_key_123';

describe('Integration Test: Storage APIs', () => {
    let token = '';

    beforeAll(() => {
        // Tạo token giả (Dùng nếu routes của bạn có auth.middleware)
        token = jwt.sign({ userId: '123456789' }, process.env.JWT_SECRET);
    });

    beforeEach(() => {
        // Xóa lịch sử gọi hàm của MinioClient sau mỗi bài test
        jest.clearAllMocks(); 
    });

    // ==========================================
    // 1. POST /api/storage/multipart/init
    // ==========================================
    describe('POST /api/storage/multipart/init', () => {
        it('Nên khởi tạo multipart upload và trả về danh sách URL thành công', async () => {
            // Giả vờ MinIO trả về uploadId
            minioClient.initiateNewMultipartUpload.mockResolvedValue('fake-upload-id-123');
            // Giả vờ MinIO sinh ra URL thành công
            minioClient.presignedUrl.mockResolvedValue('https://minio.local/fake-url');

            const res = await request(app)
                .post('/api/storage/multipart/init')
                .set('Authorization', `Bearer ${token}`)
                .send({ 
                    filename: 'video.mp4', 
                    mimeType: 'video/mp4', 
                    totalChunks: 3 
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Init multipart upload successfully');
            expect(res.body.data.uploadId).toBe('fake-upload-id-123');
            // Tên file phải có format file/{timestamp}_video.mp4
            expect(res.body.data.objectName).toContain('video.mp4'); 
            expect(res.body.data.presignedURLs).toHaveLength(3); // Phải có đúng 3 link tương ứng 3 chunk

            // Kiểm tra MinIO Client có được gọi đúng tham số không
            expect(minioClient.initiateNewMultipartUpload).toHaveBeenCalledWith(
                'test-bucket',
                expect.any(String),
                { 'Content-Type': 'video/mp4' }
            );
            // Hàm lấy URL phải được gọi đúng 3 lần
            expect(minioClient.presignedUrl).toHaveBeenCalledTimes(3);
        });

        it('Nên báo lỗi 400 nếu totalChunks <= 0 hoặc bị thiếu', async () => {
            const res = await request(app)
                .post('/api/storage/multipart/init')
                .set('Authorization', `Bearer ${token}`)
                .send({ filename: 'video.mp4', mimeType: 'video/mp4' }); // Thiếu totalChunks

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });
    });

    // ==========================================
    // 2. POST /api/storage/multipart/complete
    // ==========================================
    describe('POST /api/storage/multipart/complete', () => {
        it('Nên gộp các chunk lại thành công (và tự động sắp xếp eTag)', async () => {
            minioClient.completeMultipartUpload.mockResolvedValue({});

            // Cố tình gửi etags bị lộn xộn thứ tự (part 2 trước part 1)
            const mockEtags = [
                { partNumber: 2, etag: 'etag2' },
                { partNumber: 1, etag: 'etag1' }
            ];

            const res = await request(app)
                .post('/api/storage/multipart/complete')
                .set('Authorization', `Bearer ${token}`)
                .send({ 
                    uploadId: 'fake-upload-id-123', 
                    objectName: 'file/video.mp4', 
                    etags: mockEtags 
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Merge chunks successfully');

            // Kiểm tra xem controller có tự động sort lại eTag theo thứ tự tăng dần không
            expect(minioClient.completeMultipartUpload).toHaveBeenCalledWith(
                'test-bucket',
                'file/video.mp4',
                'fake-upload-id-123',
                [
                    { part: 1, etag: 'etag1' },
                    { part: 2, etag: 'etag2' }
                ] // Phải được sort đúng 1 rồi mới đến 2
            );
        });
    });

    // ==========================================
    // 3. GET /api/storage/file/url
    // ==========================================
    describe('GET /api/storage/file/url', () => {
        it('Nên trả về URL TẢI XUỐNG (download) nếu action=download', async () => {
            minioClient.presignedGetObject.mockResolvedValue('https://minio.local/download-link');

            const res = await request(app)
                .get('/api/storage/file/url')
                .set('Authorization', `Bearer ${token}`)
                .query({ objectName: 'file/test.pdf', originalName: 'Tài_liệu.pdf', action: 'download' });

            expect(res.status).toBe(200);
            expect(res.body.data.url).toBe('https://minio.local/download-link');

            // Header tải xuống phải là "attachment"
            expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
                'test-bucket',
                'file/test.pdf',
                25200, // 7 * 3600
                { 'response-content-disposition': 'attachment; filename="Tài_liệu.pdf"' }
            );
        });

        it('Nên trả về URL XEM TRỰC TIẾP (inline) nếu không truyền action', async () => {
            minioClient.presignedGetObject.mockResolvedValue('https://minio.local/view-link');

            const res = await request(app)
                .get('/api/storage/file/url')
                .set('Authorization', `Bearer ${token}`)
                .query({ objectName: 'file/test.pdf' });

            expect(res.status).toBe(200);

            // Header xem trực tiếp phải là "inline"
            expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
                'test-bucket',
                'file/test.pdf',
                25200,
                { 'response-content-disposition': 'inline' }
            );
        });

        it('Nên báo lỗi 400 nếu thiếu objectName', async () => {
            const res = await request(app)
                .get('/api/storage/file/url')
                .set('Authorization', `Bearer ${token}`)
                .query({}); // Không truyền gì cả

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });
    });

    // ==========================================
    // 4. DELETE /api/storage/file/
    // ==========================================
    describe('DELETE /api/storage/file/', () => {
        it('Nên gọi lệnh xóa file trên MinIO thành công', async () => {
            minioClient.removeObject.mockResolvedValue({});

            const res = await request(app)
                .delete('/api/storage/file/')
                .set('Authorization', `Bearer ${token}`)
                .send({ objectName: 'file/delete-me.pdf' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Delete file successfully');

            expect(minioClient.removeObject).toHaveBeenCalledWith(
                'test-bucket',
                'file/delete-me.pdf'
            );
        });
    });
});