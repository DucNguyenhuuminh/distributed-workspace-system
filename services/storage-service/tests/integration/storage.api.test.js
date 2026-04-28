jest.mock('../../src/config/minio.config', () =>
  require('./mocks/minio.mock')
);

const request  = require('supertest');
const express  = require('express');
const { minioClient } = require('./mocks/minio.mock');

// Import app thật — Validator + Route + Controller đều chạy thật
const storageRoutes = require('../../src/routes/storage.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/storage', storageRoutes);
  return app;
}

afterEach(() => jest.clearAllMocks());
afterAll((done) => done());

// ═══════════════════════════════════════════════════════════
// POST /api/storage/multipart/init — initMultipartUpload
// ═══════════════════════════════════════════════════════════
describe('[Integration] POST /api/storage/multipart/init', () => {
  const app = createApp();

  // ── Success ───────────────────────────────────────────────
  test('✅ Init thành công — 201 + uploadId + presignedURLs', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-001');
    minioClient.presignedUrl.mockImplementation((method, bucket, obj, exp, opts) =>
      Promise.resolve(`https://minio/upload?part=${opts.partNumber}`)
    );

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'video.mp4', mimeType: 'video/mp4', totalChunks: 3 });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Init multipart upload successfully');
    expect(res.body.data.uploadId).toBe('upload-id-001');
    expect(res.body.data.objectName).toContain('video.mp4');
    expect(res.body.data.objectName).toContain('file/');
    expect(res.body.data.presignedURLs).toHaveLength(3);
    expect(res.body.data.presignedURLs[0]).toContain('part=1');
    expect(res.body.data.presignedURLs[1]).toContain('part=2');
    expect(res.body.data.presignedURLs[2]).toContain('part=3');
  });

  test('✅ presignedUrl gọi đúng số lần và đúng partNumber', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-002');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'doc.pdf', mimeType: 'application/pdf', totalChunks: 5 });

    expect(minioClient.presignedUrl).toHaveBeenCalledTimes(5);
    for (let i = 1; i <= 5; i++) {
      expect(minioClient.presignedUrl).toHaveBeenCalledWith(
        'PUT', 'test-bucket',
        expect.stringContaining('doc.pdf'),
        7 * 3600,
        expect.objectContaining({ partNumber: i, uploadId: 'upload-id-002' })
      );
    }
  });

  test('✅ mimeType truyền đúng vào Content-Type cho MinIO', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-003');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'img.png', mimeType: 'image/png', totalChunks: 1 });

    expect(minioClient.initiateNewMultipartUpload).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringContaining('img.png'),
      { 'Content-Type': 'image/png' }
    );
  });

  test('✅ totalChunks = 1 — hoạt động đúng', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id-004');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'small.txt', mimeType: 'text/plain', totalChunks: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.presignedURLs).toHaveLength(1);
    expect(minioClient.presignedUrl).toHaveBeenCalledTimes(1);
  });

  test('✅ objectName có prefix file/ và timestamp', async () => {
    minioClient.initiateNewMultipartUpload.mockResolvedValue('upload-id');
    minioClient.presignedUrl.mockResolvedValue('https://minio/url');

    const before = Date.now();
    const res    = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', totalChunks: 2 });

    const objectName = res.body.data.objectName;
    const timestamp  = parseInt(objectName.replace('file/', '').split('_')[0]);
    expect(objectName.startsWith('file/')).toBe(true);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });

  // ── Validator failures ────────────────────────────────────
  test('❌ Thiếu filename — validator trả 400 + đúng message', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ mimeType: 'application/pdf', totalChunks: 3 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'Filename is required' }),
      ])
    );
  });

  test('❌ Thiếu mimeType — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', totalChunks: 3 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mimeType: 'MIME type is required' }),
      ])
    );
  });

  test('❌ Thiếu totalChunks — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks is required' }),
      ])
    );
  });

  test('❌ totalChunks = 0 — validator bắt min:1', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 0 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks must be integer greater than 1' }),
      ])
    );
  });

  test('❌ totalChunks âm — validator bắt min:1', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: -5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalChunks: 'Total chunks must be integer greater than 1' }),
      ])
    );
  });

  test('❌ totalChunks là string — validator bắt isInt', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(minioClient.initiateNewMultipartUpload).not.toHaveBeenCalled();
  });

  test('❌ filename là số — validator bắt isString', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/init')
      .send({ filename: 123, mimeType: 'application/pdf', totalChunks: 3 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'Filename must be string' }),
      ])
    );
  });

  // ── Controller / MinIO failures ───────────────────────────
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
      .send({ filename: 'file.pdf', mimeType: 'application/pdf', totalChunks: 2 });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to generate presigned URL');
  });

  test('❌ MinIO lỗi có response object → trả đúng status từ MinIO', async () => {
    const minioError    = new Error('Forbidden');
    minioError.response = { status: 403, data: { message: 'Access denied' } };
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
describe('[Integration] POST /api/storage/multipart/complete', () => {
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

  // ── Success ───────────────────────────────────────────────
  test('✅ Merge thành công — 200 + objectName', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Merge chunks successfully');
    expect(res.body.data.objectName).toBe(validBody.objectName);
  });

  test('✅ ETags lộn xộn → được sort 1→2→3 trước khi gửi MinIO', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags[0].part).toBe(1);
    expect(calledEtags[1].part).toBe(2);
    expect(calledEtags[2].part).toBe(3);
  });

  test('✅ ETags convert đúng format { part, etag }', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags[0]).toEqual({ part: 1, etag: 'etag-chunk-1' });
    expect(calledEtags[1]).toEqual({ part: 2, etag: 'etag-chunk-2' });
    expect(calledEtags[2]).toEqual({ part: 3, etag: 'etag-chunk-3' });
  });

  test('✅ MinIO được gọi với đúng tham số', async () => {
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

  test('✅ Chỉ 1 chunk — merge thành công', async () => {
    minioClient.completeMultipartUpload.mockResolvedValue({});

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'upload-single',
        objectName: 'file/small.txt',
        etags:      [{ partNumber: 1, etag: 'only-etag' }],
      });

    expect(res.status).toBe(200);
    const calledEtags = minioClient.completeMultipartUpload.mock.calls[0][3];
    expect(calledEtags).toHaveLength(1);
    expect(calledEtags[0]).toEqual({ part: 1, etag: 'only-etag' });
  });

  // ── Validator failures ────────────────────────────────────
  // ── Validator failures ────────────────────────────────────
  test('❌ Thiếu uploadId — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({ objectName: 'file/test.pdf', etags: [{ partNumber: 1, etag: 'e1' }] });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uploadId: 'Upload ID is required' }),
      ])
    );
  });

  test('❌ Thiếu objectName — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({ uploadId: 'id-001', etags: [{ partNumber: 1, etag: 'e1' }] });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' }),
      ])
    );
  });

  test('❌ etags là mảng rỗng — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({ uploadId: 'id-001', objectName: 'file/test.pdf', etags: [] });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ etags: 'ETags must be a non-empty array' }),
      ])
    );
  });

  test('❌ etags thiếu partNumber — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'id-001',
        objectName: 'file/test.pdf',
        etags:      [{ etag: 'etag-1' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 'etags[0].partNumber': 'Part number is required for each etag' }),
      ])
    );
  });

  test('❌ etags partNumber = 0 — validator bắt min:1', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'id-001',
        objectName: 'file/test.pdf',
        etags:      [{ partNumber: 0, etag: 'etag-1' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 'etags[0].partNumber': 'Part number must be an integer >= 1' }),
      ])
    );
  });

  test('❌ etags thiếu etag string — validator trả 400', async () => {
    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send({
        uploadId:   'id-001',
        objectName: 'file/test.pdf',
        etags:      [{ partNumber: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 'etags[0].etag': 'ETag string is required' }),
      ])
    );
  });

  // ── Controller / MinIO failures ───────────────────────────
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

  test('❌ MinIO lỗi có response → trả đúng status MinIO', async () => {
    const err    = new Error('Bad Request');
    err.response = { status: 400, data: { message: 'Invalid uploadId' } };
    minioClient.completeMultipartUpload.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/storage/multipart/complete')
      .send(validBody);

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/storage/file/url — getDownloadURL
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/storage/file/url', () => {
  const app = createApp();

  // ── Success ───────────────────────────────────────────────
  test('✅ Lấy URL inline (không truyền action)', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/signed-url');

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/report.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://minio/signed-url');
    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket', 'file/report.pdf', 7 * 3600,
      { 'response-content-disposition': 'inline' }
    );
  });

  test('✅ action = download + originalName → attachment header', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/download-url');

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/123.pdf', originalName: 'My Report.pdf', action: 'download' });

    expect(res.status).toBe(200);
    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket', 'file/123.pdf', 7 * 3600,
      { 'response-content-disposition': 'attachment; filename="My Report.pdf"' }
    );
  });

  test('✅ action = download không có originalName → filename="file"', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/abc.mp4', action: 'download' });

    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket', 'file/abc.mp4', 7 * 3600,
      { 'response-content-disposition': 'attachment; filename="file"' }
    );
  });

  test('✅ action = preview → inline', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/img.png', action: 'preview' });

    expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
      'test-bucket', 'file/img.png', 7 * 3600,
      { 'response-content-disposition': 'inline' }
    );
  });

  test('✅ URL expiry = 7*3600 giây', async () => {
    minioClient.presignedGetObject.mockResolvedValue('https://minio/url');

    await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/test.pdf' });

    const expiry = minioClient.presignedGetObject.mock.calls[0][2];
    expect(expiry).toBe(7 * 3600);
  });

  // ── Validator failures ────────────────────────────────────
  test('❌ Thiếu objectName — validator trả 400 + đúng message', async () => {
    const res = await request(app)
      .get('/api/storage/file/url')
      .query({});

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' }),
      ])
    );
  });

  test('❌ objectName rỗng — validator trả 400', async () => {
    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: '' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' }),
      ])
    );
  });

  test('❌ action không hợp lệ — validator trả 400', async () => {
    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/test.pdf', action: 'invalid-action' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'Action must be download, preview, or inline' }),
      ])
    );
  });

  // ── Controller / MinIO failures ───────────────────────────
  test('❌ MinIO presignedGetObject lỗi → 500', async () => {
    minioClient.presignedGetObject.mockRejectedValue(
      new Error('Object not found in bucket')
    );

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/not-exist.pdf' });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Object not found in bucket');
  });

  test('❌ MinIO lỗi có response → trả đúng status', async () => {
    const err    = new Error('Not Found');
    err.response = { status: 404, data: { message: 'Object not found' } };
    minioClient.presignedGetObject.mockRejectedValue(err);

    const res = await request(app)
      .get('/api/storage/file/url')
      .query({ objectName: 'file/missing.pdf' });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/storage/file — deleteDupFile
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/storage/file', () => {
  const app = createApp();

  // ── Success ───────────────────────────────────────────────
  test('✅ Xóa file thành công — 200', async () => {
    minioClient.removeObject.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/duplicate-file.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Delete file successfully');
  });

  test('✅ MinIO removeObject được gọi đúng bucket và objectName', async () => {
    minioClient.removeObject.mockResolvedValue({});

    await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 'file/123_video.mp4' });

    expect(minioClient.removeObject).toHaveBeenCalledWith(
      'test-bucket',
      'file/123_video.mp4'
    );
  });

  test('✅ Xóa nhiều file — mỗi request gọi MinIO 1 lần', async () => {
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

  // ── Validator failures ────────────────────────────────────
  test('❌ Thiếu objectName — validator trả 400', async () => {
    const res = await request(app)
      .delete('/api/storage/file')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' }),
      ])
    );
  });

  test('❌ objectName rỗng — validator trả 400', async () => {
    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: '' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name is required' }),
      ])
    );
  });

  test('❌ objectName không phải string — validator trả 400', async () => {
    const res = await request(app)
      .delete('/api/storage/file')
      .send({ objectName: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectName: 'Object name must be a string' }),
      ])
    );
  });

  // ── Controller / MinIO failures ───────────────────────────
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