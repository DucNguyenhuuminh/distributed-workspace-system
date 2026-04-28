// ── 1. Mock Database Models ────────────────────────────
jest.mock('../../src/models/documents.model', () => require('./mocks/models.mock').DocumentMock);
jest.mock('../../src/models/physical-file.model', () => require('./mocks/models.mock').PhysicalFileMock);

const request = require('supertest');
const express = require('express');
const { DocumentMock: Document } = require('./mocks/models.mock');
const internalController = require('../../src/controllers/internal.controller');

// ── 2. Cài đặt App giả lập để test ──────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());

  // Mount các routes trỏ thẳng vào controller
  app.delete('/api/files/internal/by-workspace/:id', internalController.deletedByWorkspace);
  app.delete('/api/files/internal/by-folders', internalController.deletedByFolders);
  app.put('/api/files/internal/by-folders/restore', internalController.restoreByFolders);

  return app;
}

beforeAll(() => {
  // Ẩn console.error nếu hệ thống của bạn có log lỗi 500 ra terminal
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
});

afterEach(() => {
  // Clear mock data sau mỗi test case để tránh State Mutation
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-workspace/:id
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/internal/by-workspace/:id', () => {
  const app = createApp();
  const workspaceId = 'workspace-123';

  test('✅ Xóa documents theo workspaceId thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 5 });

    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${workspaceId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by workspace');
    expect(res.body.workspaceId).toBe(workspaceId);

    // Kiểm tra DB được gọi đúng tham số (set deletedAt = Date hiện tại)
    expect(Document.updateMany).toHaveBeenCalledWith(
      { workspaceId },
      { deletedAt: expect.any(Date) }
    );
  });

  test('❌ Lỗi Database khi xóa theo workspace (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('DB Connection Lost'));

    const res = await request(app)
      .delete(`/api/files/internal/by-workspace/${workspaceId}`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Connection Lost');
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/files/internal/by-folders
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/files/internal/by-folders', () => {
  const app = createApp();

  test('✅ Xóa documents theo mảng folderIds thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 3 });
    const folderIds = ['folder-1', 'folder-2'];

    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Deleted documents by folders');
    expect(res.body.folderIds).toEqual(folderIds);

    expect(Document.updateMany).toHaveBeenCalledWith(
      { folderId: { $in: folderIds } },
      { deletedAt: expect.any(Date) }
    );
  });

  test('❌ Không truyền folderIds (undefined) → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({}); // Payload rỗng

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ folderIds không phải là Array (truyền String) → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: 'folder-1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Mảng folderIds rỗng [] → 400', async () => {
    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('folderIds is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Lỗi Database khi xóa theo folders (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('DB Timeout'));

    const res = await request(app)
      .delete('/api/files/internal/by-folders')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB Timeout');
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/files/internal/by-folders/restore
// ═══════════════════════════════════════════════════════════
describe('PUT /api/files/internal/by-folders/restore', () => {
  const app = createApp();

  test('✅ Restore documents theo mảng folderIds thành công (200)', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 2 });
    const folderIds = ['folder-3', 'folder-4'];

    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds });

    expect(res.status).toBe(200);
    // Code hiện tại đang trả về chuỗi JSON trực tiếp thay vì object
    expect(res.body.message).toBe('Restore files in folderId');

    // Lưu ý: Đoạn expect này viết theo bug "flderId" trong code hiện tại của bạn.
    // Nếu bạn đã sửa thành "folderId" trong controller, hãy sửa lại cả dòng dưới đây.
    expect(Document.updateMany).toHaveBeenCalledWith(
      { folderId: { $in: folderIds } }, 
      { deletedAt: null }
    );
  });

  test('❌ Không truyền folderIds → 400', async () => {
    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({});

    expect(res.status).toBe(400);
    // Code hiện tại trả về string trực tiếp
    expect(res.body.message).toBe('Folder Id is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Mảng folderIds rỗng [] → 400', async () => {
    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Folder Id is required');
    expect(Document.updateMany).not.toHaveBeenCalled();
  });

  test('❌ Lỗi Database khi restore (500)', async () => {
    Document.updateMany.mockRejectedValue(new Error('Mongoose Error'));

    const res = await request(app)
      .put('/api/files/internal/by-folders/restore')
      .send({ folderIds: ['folder-1'] });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Mongoose Error');
  });
});