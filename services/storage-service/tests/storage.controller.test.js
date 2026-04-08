// Phải mock trước khi require controller
jest.mock('../src/config/minio.config', () => {
  return {
    minioClient: {
      initiateNewMultipartUpload: jest.fn(),
      presignedUrl: jest.fn(),
      completeMultipartUpload: jest.fn(),
      bucketExists: jest.fn().mockResolvedValue(true),
    },
    bucketName: 'test-bucket',
  };
});

const request = require('supertest');
const express = require('express');
const { minioClient } = require('../src/config/minio.config');
const storageRoutes = require('../src/routes/storage.routes');

// Tạo app test
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/storage', storageRoutes);
  return app;
}

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════
// TEST initMultipartUpload
// ═══════════════════════════════════════════════════════
describe('POST /api/storage/multipart/init', () => {
  const app = createApp();

  test('Trả về 201 với uploadId và presignedURLs khi input hợp lệ', async () => {
    const fakeUploadId = 'upload-id-abc123';
    const fakePresignedUrl = 'https://minio/presigned?chunk=';

    minioClient.initiateNewMultipartUpload.mockResolvedValue(fakeUploadId);
    minioClient.presignedUrl.mockImplementation((method, bucket, objectName, expire, opts) =>
      Promise.resolve(`${fakePresignedUrl}${opts.partNumber}`)
    );

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({
        filename: 'test-video.mp4',  
        content: 'video/mp4',
        totalChunks: 3,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('uploadId', fakeUploadId);
    expect(res.body.data).toHaveProperty('objectName');
    expect(res.body.data.presignedURLs).toHaveLength(3);

    expect(res.body.data.presignedURLs[0]).toContain('chunk=1');
    expect(res.body.data.presignedURLs[1]).toContain('chunk=2');
    expect(res.body.data.presignedURLs[2]).toContain('chunk=3');
  });

  test('presignedUrl được gọi đúng số lần = totalChunks', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-xyz');
    minioClient.presignedUrl.mockResolvedValue('https://minio/presigned');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({
        filename: 'report.pdf',
        content: 'application/pdf',
        totalChunks: 5,
      });

    expect(minioClient.presignedUrl).toHaveBeenCalledTimes(5);

    for (let i = 1; i <= 5; i++) {
      expect(minioClient.presignedUrl).toHaveBeenCalledWith(
        'PUT',
        'test-bucket',
        expect.stringContaining('report.pdf'),
        3600,
        expect.objectContaining({ partNumber: i })
      );
    }
  });

  test('objectName phải chứa tên file gốc và prefix file/', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-123');
    minioClient.presignedUrl.mockResolvedValue('https://minio/presigned');

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({
        filename: 'myfile.docx',
        content: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        totalChunks: 2,
      });

    expect(res.body.data.objectName).toContain('myfile.docx');
    expect(res.body.data.objectName).toContain('file/'); 
  });

  test('Trả về 400 khi totalChunks không hợp lệ', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({
        filename: 'file.txt',
        content: 'text/plain',
        totalChunks: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Lack of chunks');
  });

  test('Trả về 500 khi MinIO lỗi', async () => {
    minioClient.initiateNewMultipartUpload.mockRejectedValue(
      new Error('MinIO connection refused')
    );

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({
        filename: 'file.pdf',
        content: 'application/pdf',
        totalChunks: 3,
      });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('MinIO connection refused');
  });
});

// ═══════════════════════════════════════════════════════
// TEST completeMultipartUpload
// ═══════════════════════════════════════════════════════
describe('POST /api/storage/multipart/complete', () => {
  const app = createApp();

  const validBody = {
    uploadId: 'upload-id-abc123',
    objectName: 'file/123456_test.pdf',
    etags: [
      { partNumber: 3, etag: 'etag-chunk-3' },
      { partNumber: 1, etag: 'etag-chunk-1' },
      { partNumber: 2, etag: 'etag-chunk-2' },
    ],
  };

  test('Trả về 200 khi merge thành công', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Merge chunks successfully');
    expect(res.body.data.objectName).toBe(validBody.objectName);
  });

  test('ETags phải được sort đúng trước khi gửi lên MinIO', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    const calledWithEtags =
      minioClient.completeMultipartUpload.mock.calls[0][3];

    expect(calledWithEtags[0].partNumber).toBe(1);
    expect(calledWithEtags[1].partNumber).toBe(2);
    expect(calledWithEtags[2].partNumber).toBe(3);
  });

  test('Gọi MinIO với đúng tham số', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(minioClient.completeMultipartUpload).toHaveBeenCalledWith(
      'test-bucket',
      validBody.objectName,
      validBody.uploadId,
      expect.any(Array)
    );
  });

  test('Trả về 500 khi MinIO merge lỗi', async () => {
    minioClient.completeMultipartUpload.mockRejectedValue(
      new Error('Merge failed: invalid parts')
    );

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Merge failed: invalid parts');
  });

  test('Hoạt động đúng khi chỉ có 1 chunk', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId: 'upload-id-single',
        objectName: 'file/small-file.txt',
        etags: [{ partNumber: 1, etag: 'etag-only' }],
      });

    expect(res.status).toBe(200);
    expect(minioClient.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });
});