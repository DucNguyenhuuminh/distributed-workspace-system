const httpMocks = require('node-mocks-http');
const storageController = require('../src/controllers/storage.controller');
const { minioClient } = require('../src/config/minio.config');

// Mock toàn bộ thư viện MinIO Client
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

describe('Storage Controller Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse();
        jest.clearAllMocks();
    });

    describe('initMultipartUpload', () => {
        beforeEach(() => {
            // ĐÃ FIX: Truyền đầy đủ data để pass Validation
            req.body = { 
                filename: 'test.pdf', 
                mimeType: 'application/pdf', 
                totalChunks: 3 
            };
        });

        it('Thất bại: Thiếu hoặc sai số lượng chunk (400)', async () => {
            req.body.totalChunks = 0;
            await storageController.initMultipartUpload(req, res);
            expect(res.statusCode).toBe(400);
            expect(res._getJSONData().message).toBe("Lack of chunks");
        });

        it('Thất bại: MinIO Server bị sập (500)', async () => {
            minioClient.initiateNewMultipartUpload.mockRejectedValue(new Error('MinIO connection refused'));
            await storageController.initMultipartUpload(req, res);
            expect(res.statusCode).toBe(500);
            expect(res._getJSONData().message).toBe('MinIO connection refused');
        });

        it('Thành công: Khởi tạo và trả về đúng số lượng Presigned URLs (201)', async () => {
            minioClient.initiateNewMultipartUpload.mockResolvedValue('fake-upload-id');
            minioClient.presignedUrl.mockResolvedValue('http://fake-minio.url/part');

            await storageController.initMultipartUpload(req, res);

            expect(res.statusCode).toBe(201);
            const responseData = res._getJSONData().data;
            expect(responseData.uploadId).toBe('fake-upload-id');
            expect(responseData.objectName).toContain('test.pdf');
            expect(responseData.presignedURLs).toHaveLength(3); // Khớp với totalChunks = 3
            
            // Kiểm tra xem hàm tạo URL có được gọi đúng 3 lần không
            expect(minioClient.presignedUrl).toHaveBeenCalledTimes(3);
        });
    });

    describe('completeMultipartUpload', () => {
        beforeEach(() => {
            req.body = {
                uploadId: 'up123',
                objectName: 'file/123_test.pdf',
                etags: [
                    { partNumber: 2, etag: 'etag2' },
                    { partNumber: 1, etag: 'etag1' },
                    { partNumber: 3, etag: 'etag3' }
                ]
            };
        });

        it('Thất bại: MinIO merge lỗi (500)', async () => {
            minioClient.completeMultipartUpload.mockRejectedValue(new Error('Invalid parts'));
            await storageController.completeMultipartUpload(req, res);
            expect(res.statusCode).toBe(500);
        });

        it('Thành công: ETags được sort đúng và merge thành công (200)', async () => {
            minioClient.completeMultipartUpload.mockResolvedValue(true);

            await storageController.completeMultipartUpload(req, res);

            // Kiểm tra xem dữ liệu truyền vào MinIO đã được map và sort đúng chưa
            const calledArgs = minioClient.completeMultipartUpload.mock.calls[0];
            const passedEtags = calledArgs[3]; // Tham số thứ 4 là sortedEtags

            // ĐÃ FIX: Kiểm tra biến 'Part' thay vì 'partNumber'
            expect(passedEtags[0].part).toBe(1);
            expect(passedEtags[0].etag).toBe('etag1');
            expect(passedEtags[1].part).toBe(2);
            expect(passedEtags[2].part).toBe(3);

            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().message).toBe("Merge chunks successfully");
        });
    });

    describe('getDownloadURL', () => {
        it('Thất bại: Thiếu objectName (400)', async () => {
            req.query = {};
            await storageController.getDownloadURL(req, res);
            expect(res.statusCode).toBe(400);
        });

        it('Thành công: Lấy URL Download với header attachment', async () => {
            req.query = { objectName: 'file/abc.pdf', originalName: 'my-doc.pdf', action: 'download' };
            minioClient.presignedGetObject.mockResolvedValue('http://download.link');

            await storageController.getDownloadURL(req, res);

            // Kiểm tra Header được cấu hình để ép tải file xuống
            expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
                'test-bucket',
                'file/abc.pdf',
                expect.any(Number),
                { 'response-content-disposition': 'attachment; filename="my-doc.pdf"' }
            );
            expect(res.statusCode).toBe(200);
            expect(res._getJSONData().data.url).toBe('http://download.link');
        });

        it('Thành công: Lấy URL Preview với header inline', async () => {
            req.query = { objectName: 'file/abc.pdf', action: 'preview' };
            minioClient.presignedGetObject.mockResolvedValue('http://preview.link');

            await storageController.getDownloadURL(req, res);

            // Kiểm tra Header được cấu hình để xem trực tiếp trên trình duyệt
            expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
                'test-bucket',
                'file/abc.pdf',
                expect.any(Number),
                { 'response-content-disposition': 'inline' }
            );
            expect(res.statusCode).toBe(200);
        });
    });

    describe('deleteDupFile', () => {
        it('Thành công: Gọi hàm xóa của MinIO', async () => {
            req.body = { objectName: 'file/abc.pdf' };
            minioClient.removeObject.mockResolvedValue(true);

            await storageController.deleteDupFile(req, res);

            expect(minioClient.removeObject).toHaveBeenCalledWith('test-bucket', 'file/abc.pdf');
            expect(res.statusCode).toBe(200);
        });
    });
});