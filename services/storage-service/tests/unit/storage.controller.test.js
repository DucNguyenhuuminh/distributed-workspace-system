jest.mock('../../src/config/minio.config', () => require('./mocks/minio.mock'));

const request    = require('supertest');
const express    = require('express');
const { minioClient } = require('./mocks/minio.mock');
const storageRoutes   = require('../../src/routes/storage.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/storage', storageRoutes);
  return app;
}

afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════
// POST /api/storage/multipart/init — initMultipartUpload
// ═══════════════════════════════════════════════════════════
describe('POST /api/storage/multipart/init', () => {
  const app = createApp();

  test('✅ Init thành công — trả 201 + uploadId + presignedURLs', async () => {
    const fakeUploadId = 'upload-abc-123';
    minioClient.initiateNewMultipartUpload.mockResolvedValue(fakeUploadId);
    minioClient.presignedUrl.mockResolvedValue('https://minio/presigned?part=1');

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'video.mp4', mimeType: 'video/mp4', totalChunks: 3 });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Init multipart upload successfully');
    expect(res.body.data.uploadId).toBe(fakeUploadId);
    expect(res.body.data.objectName).toContain('video.mp4');
    expect(res.body.data.objectName).toContain('file/');
    expect(res.body.data.presignedURLs).toHaveLength(3);
  });

  test('✅ presignedUrl được gọi đúng số lần = totalChunks', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'doc.pdf', mimeType: 'application/pdf', totalChunks: 5 });

    expect(minioClient.presignedUrl).toHaveBeenCalledTimes(5);
  });

  test('✅ partNumber được truyền đúng từ 1 đến totalChunks', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.zip', mimeType: 'application/zip', totalChunks: 3 });

    for (let i = 1; i <= 3; i++) {
      expect(minioClient.presignedUrl).toHaveBeenCalledWith(
        'PUT',
        'test-bucket',
        expect.stringContaining('file.zip'),
        7 * 3600,
        expect.objectContaining({ partNumber: i })
      );
    }
  });

  test('✅ mimeType được truyền đúng vào Content-Type header', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'image.png', mimeType: 'image/png', totalChunks: 1 });

    expect(minioClient.initiateNewMultipartUpload).toHaveBeenCalledWith(
      'test-bucket',
      expect.any(String),
      { 'Content-Type': 'image/png' }
    );
  });

  test('✅ totalChunks = 1 — vẫn hoạt động bình thường', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'small.txt', mimeType: 'text/plain', totalChunks: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.presignedURLs).toHaveLength(1);
    expect(minioClient.presignedUrl).toHaveBeenCalledTimes(1);
  });

  test('✅ objectName có timestamp — tránh trùng tên', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    const before = Date.now();
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', totalChunks: 2 });

    const objectName = res.body.data.objectName;
    const timestamp  = parseInt(objectName.split('/')[1].split('_')[0]);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });

  // ── Failure cases ─────────────────────────────────────────
  test('❌ Thiếu totalChunks → 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // 🟢 Sửa msg thành totalChunks
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks is required' })
      ])
    );
    expect(minioClient.initiateNewMultipartUpload).not.toHaveBeenCalled();
  });

  test('❌ totalChunks = 0 → 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 0 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // 🟢 Sửa msg thành totalChunks
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks must be integer greater than 1' })
      ])
    );
    expect(minioClient.initiateNewMultipartUpload).not.toHaveBeenCalled();
  });

  test('❌ totalChunks âm → 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: -5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // 🟢 Sửa msg thành totalChunks
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks must be integer greater than 1' })
      ])
    );
    expect(minioClient.initiateNewMultipartUpload).not.toHaveBeenCalled();
  });

  test('❌ MinIO initiateNewMultipartUpload lỗi → 500', async () => {
    minioClient.initiateNewMultipartUpload.mockRejectedValue(
      new Error('MinIO connection refused')
    );

  const res = await request(app)
    .post('/api/storage/multipart/init')
    .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 3 });

  expect(res.status).toBe(500);
  expect(res.body.message).toBe('MinIO connection refused');
});

  test('❌ MinIO presignedUrl lỗi → 500', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockRejectedValue(
      new Error('Failed to generate presigned URL')
    );

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 3 });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to generate presigned URL');
  });

  test('❌ MinIO lỗi có response object → trả đúng status từ MinIO', async () => {
    const minioError     = new Error('Forbidden');
    minioError.response  = { status: 403, data: { message: 'Access denied' } };
    minioClient.initiateNewMultipartUpload.mockRejectedValue(minioError);

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 2 });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// POST /api/storage/multipart/complete — completeMultipartUpload
// ═══════════════════════════════════════════════════════════
describe('POST /api/storage/multipart/complete', () => {
  const app = createApp();

  const validBody = {
    uploadId:   'upload-abc-123',
    objectName: 'file/1234567890_report.pdf',
    etags: [
      { partNumber: 3, etag: 'etag-chunk-3' },
      { partNumber: 1, etag: 'etag-chunk-1' },
      { partNumber: 2, etag: 'etag-chunk-2' },
    ],
  };

  // ── Success cases ─────────────────────────────────────────
  test('✅ Merge thành công — trả 200 + objectName', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Merge chunks successfully');
    expect(res.body.data.objectName).toBe(validBody.objectName);
  });

  test('✅ ETags được sort theo partNumber tăng dần trước khi gửi MinIO', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags[0].part).toBe(1);
    expect(calledEtags[1].part).toBe(2);
    expect(calledEtags[2].part).toBe(3);
  });

  test('✅ ETags được convert đúng format { part, etag }', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags[0]).toEqual({ part: 1, etag: 'etag-chunk-1' });
    expect(calledEtags[1]).toEqual({ part: 2, etag: 'etag-chunk-2' });
    expect(calledEtags[2]).toEqual({ part: 3, etag: 'etag-chunk-3' });
  });

  test('✅ MinIO được gọi với đúng uploadId, objectName, bucketName', async () => {
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

  test('✅ Chỉ có 1 chunk — vẫn merge thành công', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'upload-single',
        objectName: 'file/small-file.txt',
        etags:      [{ partNumber: 1, etag: 'etag-only' }],
      });

    expect(res.status).toBe(200);
    expect(minioClient.completeMultipartUpload).toHaveBeenCalledTimes(1);

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags).toHaveLength(1);
    expect(calledEtags[0]).toEqual({ part: 1, etag: 'etag-only' });
  });

  test('✅ ETags đã sort sẵn — không thay đổi thứ tự', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'upload-id',
        objectName: 'file/sorted.pdf',
        etags: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
          { partNumber: 3, etag: 'etag-3' },
        ],
      });

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags[0].part).toBe(1);
    expect(calledEtags[1].part).toBe(2);
    expect(calledEtags[2].part).toBe(3);
  });

  // ── Failure cases ─────────────────────────────────────────
  test('❌ MinIO completeMultipartUpload lỗi → 500', async () => {
    minioClient.completeMultipartUpload.mockRejectedValue(
      new Error('Merge failed: invalid parts')
    );

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Merge failed: invalid parts');
  });

  test('❌ MinIO lỗi có response object → trả đúng status', async () => {
    const minioError    = new Error('Bad Request');
    minioError.response = { status: 400, data: { message: 'Invalid uploadId' } };
    minioClient.completeMultipartUpload.mockRejectedValue(minioError);

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(400);
  });

  test('❌ UploadId không hợp lệ — MinIO báo lỗi → 500', async () => {
    minioClient.completeMultipartUpload.mockRejectedValue(
      new Error('The specified upload does not exist')
    );

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({ ...validBody, uploadId: 'invalid-upload-id' });

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('upload does not exist');
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/storage/file/url — getDownloadURL
// ═══════════════════════════════════════════════════════════
describe('GET /api/storage/file/url', () => {
  const app = createApp();

  // ── Success cases ─────────────────────────────────────────
  test('✅ Lấy URL xem trực tuyến (inline) — không truyền action', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/signed-url');

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/report.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Get download URL successfully');
    expect(res.body.data.url).toBe('https://minio/signed-url');
    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/report.pdf',
      7 * 3600,
      { 'response-content-disposition': 'inline' }
    );
  });

  test('✅ Lấy URL download — action = download + originalName', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/download-url');

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({
        objectName:   'file/123_report.pdf',
        originalName: 'My Report.pdf',
        action:       'download',
      });

    expect(res.status).toBe(200);
    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/123_report.pdf',
      7 * 3600,
      { 'response-content-disposition': 'attachment; filename="My Report.pdf"' }
    );
  });

  test('✅ action = download nhưng không có originalName — dùng "file" mặc định', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/abc.mp4', action: 'download' });

    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/abc.mp4',
      7 * 3600,
      { 'response-content-disposition': 'attachment; filename="file"' }
    );
  });

  test('✅ URL hết hạn sau 7*3600 giây', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/test.pdf' });

    const calledExpiry = minioClient.presignedGetObject.mock.calls[0][2];
    expect(calledExpiry).toBe(7 * 3600);
  });

  test('✅ action khác download — dùng inline', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/img.png', action: 'view' });

    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/img.png',
      7 * 3600,
      { 'response-content-disposition': 'inline' }
    );
  });

  // ── Failure cases ─────────────────────────────────────────
  test('❌ Thiếu objectName → 400', async () => {
    const res = await request(app)
      .get('/api/storage/file/url')
      .query({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // 🟢 Sửa msg thành objectName
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' })
      ])
    );
    expect(minioClient.presignedGetObject).not.toHaveBeenCalled();
  });

  test('❌ objectName rỗng → 400', async () => {
    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // 🟢 Sửa msg thành objectName
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' })
      ])
    );
    expect(minioClient.presignedGetObject).not.toHaveBeenCalled();
  });  

  test('❌ MinIO lỗi có response → trả đúng status MinIO', async () => {
    const minioError    = new Error('Not Found');
    minioError.response = { status: 404, data: { message: 'Object not found' } };
    minioClient.presignedGetObject.mockRejectedValue(minioError);

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/missing.pdf' });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/storage/file — deleteDupFile
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/storage/file', () => {
  const app = createApp();

  // ── Success cases ─────────────────────────────────────────
  test('✅ Xóa file thành công — trả 200', async () => {
    minioClient.removeObject.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/duplicate-file.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Delete file successfully');
  });

  test('✅ MinIO removeObject được gọi với đúng bucket và objectName', async () => {
    minioClient.removeObject.mockResolvedValue({});

    await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/123_video.mp4' });

    expect(minioClient.removeObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/123_video.mp4'
    );
  });

  test('✅ Xóa nhiều file riêng lẻ — mỗi lần gọi 1 lần', async () => {
    minioClient.removeObject.mockResolvedValue({});

    await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/file1.pdf' });

    await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/file2.pdf' });

    expect(minioClient.removeObject).toHaveBeenCalledTimes(2);
    expect(minioClient.removeObject).toHaveBeenNthCalledWith(1, 'test-bucket', 'file/file1.pdf');
    expect(minioClient.removeObject).toHaveBeenNthCalledWith(2, 'test-bucket', 'file/file2.pdf');
  });

  // ── Failure cases ─────────────────────────────────────────
  test('❌ MinIO removeObject lỗi → 500', async () => {
    minioClient.removeObject.mockRejectedValue(
      new Error('Object does not exist')
    );

    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/not-exist.pdf' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Object does not exist');
  });

  test('❌ MinIO timeout → 500', async () => {
    minioClient.removeObject.mockRejectedValue(
      new Error('Connection timeout')
    );

    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/any.pdf' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Connection timeout');
  });
});