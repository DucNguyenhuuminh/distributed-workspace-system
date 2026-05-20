jest.mock('axios');

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const internalController = require('../../src/controllers/internal.controller');
const Document = require('../../src/models/documents.model');
const PhysicalFile = require('../../src/models/physical-file.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup/db.setup');

// ── Cài đặt App giả lập ────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  app.delete('/api/files/internal/by-workspace/:id', internalController.deletedByWorkspace);
  app.delete('/api/files/internal/by-folders', internalController.deletedByFolders);
  app.put('/api/files/internal/by-folders/restore', internalController.restoreByFolders);
  app.delete('/api/files/internal/by-folders/force', internalController.forceDeleteFilesByFolders); 
  app.get('/api/files/internal/by-folders/getFiles', internalController.getListFiles);
  app.get('/api/files/internal/by-searching', internalController.getFileIds);
  app.get('/api/files/internal/by-admin', internalController.getFilesAdmin);
  app.get('/api/files/internal/stats', internalController.getStats); // Phải để trước /:id
  app.get('/api/files/internal/by-admin/:id', internalController.getFileByIdAdmin);

  return app;
}

// ── Hàm Seed Data vào Database thật ────────────────────────

// 🟢 ĐÃ FIX: Chuyển hàm seedPhysical ra ngoài cùng để dùng chung cho mọi test case
async function seedPhysical(overrides = {}) {
  return PhysicalFile.create({
    hashString: `hash-${Date.now()}-${Math.random()}`,
    minioObjectPath: `test-path-${Date.now()}.pdf`,
    sizeBytes: 1024,
    mimeType: 'application/pdf',
    ...overrides
  });
}

async function seedDocument(overrides = {}) {
  return Document.create({
    originalName: 'test-internal.pdf',
    uploadedBy: new mongoose.Types.ObjectId(), // Bắt buộc phải có ObjectId hợp lệ
    physicalFileId: new mongoose.Types.ObjectId(),
    workspaceId: null,
    folderId: null,
    deletedAt: null,
    ...overrides,
  });
}

beforeAll(async () => {
  await connectTestDB();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeTestDB();
  console.error.mockRestore();
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-workspace/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/internal/by-workspace/:id', () => {
  const app = createApp();

  test('✅ Xóa documents theo workspaceId — DB được cập nhật deletedAt', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    const otherWsId = new mongoose.Types.ObjectId().toString();

    // Seed 2 file thuộc wsId và 1 file thuộc workspace khác
    const doc1 = await seedDocument({ workspaceId: wsId });
    const doc2 = await seedDocument({ workspaceId: wsId });
    const docOther = await seedDocument({ workspaceId: otherWsId });

    const res = await request(app).delete(`/api/files/internal/by-workspace/${wsId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by workspace');
    expect(res.body.workspaceId).toBe(wsId);

    // Kiểm tra DB: doc1 và doc2 phải có deletedAt, docOther thì không
    const checkDoc1 = await Document.collection.findOne({ _id: doc1._id });
    const checkDoc2 = await Document.collection.findOne({ _id: doc2._id });
    const checkOther = await Document.collection.findOne({ _id: docOther._id });

    expect(checkDoc1.deletedAt).not.toBeNull();
    expect(checkDoc2.deletedAt).not.toBeNull();
    expect(checkOther.deletedAt).toBeNull();
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(Document, 'updateMany').mockRejectedValueOnce(new Error('DB Query Timeout'));

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).delete(`/api/files/internal/by-workspace/${fakeId}`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Query Timeout');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-folders
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/internal/by-folders', () => {
  const app = createApp();

  test('✅ Xóa documents theo folderIds — DB được cập nhật deletedAt', async () => {
    const folder1 = new mongoose.Types.ObjectId().toString();
    const folder2 = new mongoose.Types.ObjectId().toString();
    const folder3 = new mongoose.Types.ObjectId().toString();
    
    const doc1 = await seedDocument({ folderId: folder1 });
    const doc2 = await seedDocument({ folderId: folder2 });
    const doc3 = await seedDocument({ folderId: folder3 });

    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: [folder1, folder2] });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by folders');

    // Kiểm tra DB
    const checkDoc1 = await Document.collection.findOne({ _id: doc1._id });
    const checkDoc2 = await Document.collection.findOne({ _id: doc2._id });
    const activeDoc = await Document.collection.findOne({ _id: doc3._id });

    expect(checkDoc1.deletedAt).not.toBeNull();
    expect(checkDoc2.deletedAt).not.toBeNull();
    expect(activeDoc.deletedAt).toBeNull();
  });

  test('❌ Payload folderIds bị thiếu → 400', async () => {
    const res = await request(app).delete('/api/files/internal/by-folders').send({}); 
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
  });

  test('❌ Payload folderIds là mảng rỗng → 400', async () => {
    const res = await request(app).delete('/api/files/internal/by-folders').send({ folderIds: [] }); 
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
  });

  test('❌ Payload folderIds không phải Array → 400', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).delete('/api/files/internal/by-folders').send({ folderIds: fakeId }); 
    expect(res.status).toBe(400);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(Document, 'updateMany').mockRejectedValueOnce(new Error('Mongoose Connection Lost'));

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: [fakeId] });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Mongoose Connection Lost');
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/internal/by-folders/restore
// ═══════════════════════════════════════════════════════════
describe('[Integration] PUT /api/files/internal/by-folders/restore', () => {
  const app = createApp();

  test('✅ Restore documents theo folderIds — DB xóa field deletedAt', async () => {
    const folder1 = new mongoose.Types.ObjectId().toString();
    const folderOther = new mongoose.Types.ObjectId().toString();
    
    // Tạo file đã bị xóa (nằm trong thùng rác)
    const doc1 = await seedDocument({ folderId: folder1, deletedAt: new Date() });
    // Tạo file bị xóa nhưng thuộc folder khác
    const doc2 = await seedDocument({ folderId: folderOther, deletedAt: new Date() });

    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: [folder1] });

    expect(res.status).toBe(200);

    // Lấy lại từ DB để check
    const restoredDoc = await Document.collection.findOne({ _id: doc1._id });
    const stillDeletedDoc = await Document.collection.findOne({ _id: doc2._id });

    // File thuộc folder1 đã được khôi phục
    expect(restoredDoc.deletedAt).toBeNull();
    // File thuộc folder khác vẫn bị xóa
    expect(stillDeletedDoc.deletedAt).not.toBeNull();
  });

  test('❌ Payload folderIds bị thiếu → 400', async () => {
    const res = await request(app).put('/api/files/internal/by-folders/restore').send({}); 
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Folder Id is required'); 
  });

  test('❌ Payload folderIds là mảng rỗng → 400', async () => {
    const res = await request(app).put('/api/files/internal/by-folders/restore').send({ folderIds: [] }); 
    expect(res.status).toBe(400);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(Document, 'updateMany').mockRejectedValueOnce(new Error('Mongoose Save Error'));

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: [fakeId] });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-folders/force
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/files/internal/by-folders/force', () => {
  const app = createApp();

  test('✅ Xóa vĩnh viễn file (usageCount = 0) → DB & Storage đều được gọi', async () => {
    const pf = await seedPhysical();
    const folderId = new mongoose.Types.ObjectId().toString();
    const doc = await seedDocument({ folderId, physicalFileId: pf._id });

    // Mock cho Axios Storage
    axios.delete.mockResolvedValueOnce({});

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: [folderId] });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Force deleted 1 files');

    // KĐ DB: Document bay màu hoàn toàn
    const checkDoc = await Document.collection.findOne({ _id: doc._id });
    expect(checkDoc).toBeNull();

    // KĐ DB: Physical File cũng bay màu
    const checkPf = await PhysicalFile.collection.findOne({ _id: pf._id });
    expect(checkPf).toBeNull();

    // Storage bị gọi xóa
    expect(axios.delete).toHaveBeenCalled();
  });

  test('✅ Xóa file nhưng usageCount > 0 (Dùng chung Physical File) → Giữ lại Storage', async () => {
    const pf = await seedPhysical();
    const folder1 = new mongoose.Types.ObjectId().toString();
    const folder2 = new mongoose.Types.ObjectId().toString(); // Thư mục không bị xóa

    // 2 file dùng chung 1 physical file
    const doc1 = await seedDocument({ folderId: folder1, physicalFileId: pf._id });
    const doc2 = await seedDocument({ folderId: folder2, physicalFileId: pf._id });

    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: [folder1] }); // Chỉ xóa folder 1

    expect(res.status).toBe(200);

    // KĐ DB: Doc 1 bay màu, Doc 2 còn nguyên
    const checkDoc1 = await Document.collection.findOne({ _id: doc1._id });
    const checkDoc2 = await Document.collection.findOne({ _id: doc2._id });
    expect(checkDoc1).toBeNull();
    expect(checkDoc2).not.toBeNull();

    // KĐ DB: Physical File VẪN CÒN vì doc2 vẫn đang dùng
    const checkPf = await PhysicalFile.collection.findOne({ _id: pf._id });
    expect(checkPf).not.toBeNull();

    // Axios delete storage hoàn toàn không bị gọi
    expect(axios.delete).not.toHaveBeenCalled();
  });

  test('✅ Thư mục rỗng (Không có file nào) → 200', async () => {
    const emptyFolderId = new mongoose.Types.ObjectId().toString();
    
    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: [emptyFolderId] });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No files to clean in these folders');
  });

  test('❌ Thiếu mảng folderIds → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({});

    expect(res.status).toBe(400);
  });

  test('❌ Lỗi Database (Crash) → 500', async () => {
    jest.spyOn(Document, 'find').mockImplementationOnce(() => { 
      throw new Error('Mongoose Timeout'); 
    });
    
    const folderId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete('/api/files/internal/by-folders/force')
      .send({ folderIds: [folderId] });

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// BỔ SUNG: GET /api/files/internal/by-folders/getFiles
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/internal/by-folders/getFiles', () => {
  const app = createApp();

  test('✅ Lấy danh sách file thư mục gốc (folderId = "null")', async () => {
    const pf = await seedPhysical();
    await seedDocument({ folderId: null, deletedAt: null, physicalFileId: pf._id });
    await seedDocument({ folderId: new mongoose.Types.ObjectId(), deletedAt: null }); // Thuộc folder khác

    const res = await request(app).get('/api/files/internal/by-folders/getFiles').query({ folderId: 'null', deletedAt: 'null' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].physicalFileId.sizeBytes).toBe(1024); // KĐ Populate thành công
  });

  test('❌ DB lỗi (Crash) → 500', async () => {
    jest.spyOn(Document, 'find').mockImplementationOnce(() => { throw new Error('Crash'); });
    const res = await request(app).get('/api/files/internal/by-folders/getFiles');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// BỔ SUNG: GET /api/files/internal/by-searching
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/internal/by-searching', () => {
  const app = createApp();

  test('✅ Lấy files qua mảng IDs → 200', async () => {
    const pf = await seedPhysical();
    const doc1 = await seedDocument({ physicalFileId: pf._id });
    const doc2 = await seedDocument({ physicalFileId: pf._id });

    const res = await request(app).get('/api/files/internal/by-searching').query({ ids: `${doc1._id},${doc2._id}` });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].physicalFileId.minioObjectPath).toBeDefined();
  });

  test('❌ Không truyền ids → 400', async () => {
    const res = await request(app).get('/api/files/internal/by-searching');
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// BỔ SUNG: GET /api/files/internal/by-admin
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/internal/by-admin', () => {
  const app = createApp();

  test('✅ Lấy files kèm phân trang, tìm kiếm theo tên và workspace → 200', async () => {
    const wsId = new mongoose.Types.ObjectId().toString();
    await seedDocument({ originalName: 'BaoCao.pdf', workspaceId: wsId });
    await seedDocument({ originalName: 'BaoCao_T2.pdf', workspaceId: wsId });
    await seedDocument({ originalName: 'Khac.pdf' });

    const res = await request(app).get('/api/files/internal/by-admin').query({ page: 1, limit: 10, search: 'baocao', workspaceId: wsId });

    expect(res.status).toBe(200);
    expect(res.body.data.files).toHaveLength(2); // Chỉ ra 2 file BaoCao
    expect(res.body.data.pagination.total).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════
// BỔ SUNG: GET /api/files/internal/by-admin/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/internal/by-admin/:id', () => {
  const app = createApp();

  test('✅ Tìm thấy file → 200', async () => {
    const doc = await seedDocument();
    const res = await request(app).get(`/api/files/internal/by-admin/${doc._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(doc._id.toString());
  });

  test('❌ Không tìm thấy → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/api/files/internal/by-admin/${fakeId}`);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════
// BỔ SUNG: GET /api/files/internal/stats
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/files/internal/stats', () => {
  const app = createApp();

  test('✅ Tính toán Aggregation chính xác % tiết kiệm → 200', async () => {
    // Kịch bản: 1 PhysicalFile dung lượng 10MB, nhưng được sử dụng bởi 3 Documents
    const pf = await seedPhysical({ sizeBytes: 10 * 1024 * 1024 }); 
    
    await seedDocument({ physicalFileId: pf._id });
    await seedDocument({ physicalFileId: pf._id });
    await seedDocument({ physicalFileId: pf._id });

    const res = await request(app).get('/api/files/internal/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.totalDocuments).toBe(3);
    expect(res.body.data.totalPhysicalFiles).toBe(1);
    
    expect(res.body.data.totalSizeBytes).toBe(10485760);  // 10MB
    expect(res.body.data.savedSizeBytes).toBe(20971520);  // 20MB
    
    // (20MB / 30MB) * 100 = 66.67%
    expect(res.body.data.savedPercentage).toBeCloseTo(66.67, 1); 
  });

  test('✅ Database trống hoàn toàn (An toàn phép chia 0) → 200', async () => {
    const res = await request(app).get('/api/files/internal/stats');
    
    expect(res.status).toBe(200);
    expect(res.body.data.savedPercentage).toBe(0);
    expect(res.body.data.totalSizeBytes).toBe(0);
  });

  test('❌ Database lỗi (Crash) → 500', async () => {
    jest.spyOn(Document, 'aggregate').mockRejectedValueOnce(new Error('Agg Crash'));
    const res = await request(app).get('/api/files/internal/stats');
    expect(res.status).toBe(500);
  });
});