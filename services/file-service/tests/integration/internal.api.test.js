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

  return app;
}

// ── Hàm Seed Data vào Database thật ────────────────────────
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
    // 🟢 Dùng ObjectId thật chuẩn của Mongoose
    const wsId = new mongoose.Types.ObjectId().toString();
    const otherWsId = new mongoose.Types.ObjectId().toString();

    // Seed 2 file thuộc wsId và 1 file thuộc workspace khác
    const doc1 = await seedDocument({ workspaceId: wsId });
    const doc2 = await seedDocument({ workspaceId: wsId });
    const docOther = await seedDocument({ workspaceId: otherWsId });

    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${wsId}`);

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

    // 🟢 Chỗ này cũng truyền 1 ID chuẩn
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${fakeId}`);

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
    // 🟢 Dùng ObjectId thật chuẩn của Mongoose
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
    
    // Kiểm tra doc3 thuộc folder khác thì vẫn an toàn (deletedAt là null)
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
    // 🟢 Dùng ObjectId thật chuẩn của Mongoose
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

  // Helper để tạo Physical File nhanh trong test này nếu file setup chưa có
  async function seedPhysical(overrides = {}) {
    return PhysicalFile.create({
      hashString: `hash-${Date.now()}-${Math.random()}`,
      minioObjectPath: `test-path-${Date.now()}.pdf`,
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      ...overrides
    });
  }

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