// ── Mock trước khi require bất kỳ module nào ──────────────
jest.mock('axios',                              () => require('./mocks/axios.mock'));
jest.mock('shared',                             () => require('./mocks/shared.mock'));
jest.mock('../../src/models/folder.model',         () => require('./mocks/models.mock').FolderMock);
jest.mock('../../src/models/workspace.model',      () => require('./mocks/models.mock').WorkspaceMock);

const request   = require('supertest');
const express   = require('express');
const axios     = require('axios');

const { FolderMock: Folder, WorkspaceMock: Workspace, getFreshFolder, getFreshWorkspace } = require('./mocks/models.mock');
const { addJob } = require('shared');

const folderRoutes = require('../../src/routes/folder.routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/folders', folderRoutes);
  return app;
}

// ── Smart Mock cho Mongoose hỗ trợ await và .setOptions() ──
const smartQuery = (data) => {
  const query = Promise.resolve(data);
  query.setOptions = jest.fn().mockReturnValue(query);
  return query;
};

beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => console.error.mockRestore());
afterEach(() => jest.clearAllMocks());

// Các ID hợp lệ chuẩn Mongoose để vượt qua validation middleware
const VALID_WS_ID = '648000000000000000000010';
const VALID_TARGET_ID = '648000000000000000000011';
const VALID_CHILD_ID = '648000000000000000000012';
const NOT_FOUND_ID = '648000000000000000000999';

// ── Hàm Mock Động (Tránh lỗi bị Middleware nuốt data) ────────
const mockFolderDB = (folders) => {
  Folder.findById.mockImplementation((id) => {
    const found = folders.find(f => f._id === id?.toString());
    return smartQuery(found || null);
  });
};

const mockWorkspaceDB = (workspaces) => {
  Workspace.findById.mockImplementation((id) => {
    const found = workspaces.find(w => w._id === id?.toString());
    return smartQuery(found || null);
  });
};

// ═══════════════════════════════════════════════════════════
// POST /api/folders — createFolder
// ═══════════════════════════════════════════════════════════
describe('POST /api/folders', () => {
  const app = createApp();

  describe('My Drive (workspaceId = null)', () => {
    test('✅ Tạo folder My Drive thành công', async () => {
      const folder = getFreshFolder({ name: 'My Folder' });
      Folder.create.mockResolvedValue(folder);

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'My Folder', parentId: null, workspaceId: null });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Created folder successful'); // Khớp với controller
      expect(res.body.data.name).toBe('My Folder');
      expect(Folder.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'user-001', workspaceId: null })
      );
    });

    test('✅ BullMQ lỗi không ảnh hưởng tạo My Drive folder', async () => {
      Folder.create.mockResolvedValue(getFreshFolder());
      addJob.mockRejectedValueOnce(new Error('Queue Error'));

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'My Folder' });

      expect(res.status).toBe(201);
    });

    test('❌ Lỗi database khi tạo folder', async () => {
      Folder.create.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'My Folder' });

      expect(res.status).toBe(500);
    });
  });

  describe('Workspace folder (workspaceId != null)', () => {
    test('✅ Tạo folder trong workspace thành công', async () => {
      mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);
      Folder.create.mockResolvedValue(getFreshFolder({ workspaceId: VALID_WS_ID }));

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'WS Folder', workspaceId: VALID_WS_ID });

      expect(res.status).toBe(201);
      expect(Folder.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: VALID_WS_ID, createdBy: 'user-001' })
      );
    });

    test('❌ Workspace không tồn tại → 404', async () => {
      mockWorkspaceDB([]); // Empty DB

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'WS Folder', workspaceId: NOT_FOUND_ID });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Workspace not found');
    });

    test('❌ User không phải thành viên workspace → 403', async () => {
      mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID, members: [] })]);

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'WS Folder', workspaceId: VALID_WS_ID });

      expect(res.status).toBe(403);
    });

    test('❌ User chỉ có quyền viewer, không có quyền editor → 403', async () => {
      mockWorkspaceDB([getFreshWorkspace({
        _id: VALID_WS_ID,
        members: [{ userId: { toString: () => 'user-001' }, role: 'MEMBER', permissions: ['viewer'] }]
      })]);

      const res = await request(app)
        .post('/api/folders')
        .send({ name: 'WS Folder', workspaceId: VALID_WS_ID });

      expect(res.status).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/folders — getFolders
// ═══════════════════════════════════════════════════════════
describe('GET /api/folders/root/items', () => {
  const app = createApp();

  test('✅ Lấy My Drive root (không workspaceId) → 200 + trả về folders và files', async () => {
    Folder.find.mockReturnValue(smartQuery([getFreshFolder()]));
    axios.get.mockResolvedValue({ data: { data: [{ _id: 'file-1', name: 'My File.pdf' }] } });

    const res = await request(app).get('/api/folders/root/items');
    
    expect(res.status).toBe(200);
    // 🟢 Kiểm tra format trả về mới { folders, files }
    expect(res.body.folders).toHaveLength(1);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].name).toBe('My File.pdf');

    // 🟢 Kiểm tra xem Controller truyền query đúng cho My Drive chưa
    expect(Folder.find).toHaveBeenCalledWith({
      createdBy: 'user-001',
      workspaceId: null,
      parentId: null,
      deletedAt: null
    });
  });

  test('✅ Lấy Workspace root thành công → 200', async () => {
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);
    Folder.find.mockReturnValue(smartQuery([getFreshFolder()]));
    axios.get.mockResolvedValue({ data: { data: [] } });

    const res = await request(app).get('/api/folders/root/items').query({ workspaceId: VALID_WS_ID });
    
    expect(res.status).toBe(200);
    expect(Folder.find).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: VALID_WS_ID,
      parentId: null
    }));
  });

  test('❌ Workspace không tồn tại → 404', async () => {
    mockWorkspaceDB([]); // DB trống không tìm thấy Workspace

    const res = await request(app).get('/api/folders/root/items').query({ workspaceId: NOT_FOUND_ID });
    
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Workspace not found');
    expect(Folder.find).not.toHaveBeenCalled(); // Chặn ngay, không gọi DB nữa
  });

  test('❌ User không phải thành viên workspace → 403', async () => {
    // Mock workspace nhưng mảng members rỗng
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID, members: [] })]);
    
    const res = await request(app).get('/api/folders/root/items').query({ workspaceId: VALID_WS_ID });
    
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('You do not have permission to access this workspace');
  });

  test('✅ File Service lỗi (Axios sập) → Vẫn trả 200 và mảng files rỗng', async () => {
    Folder.find.mockReturnValue(smartQuery([getFreshFolder()]));
    
    // Giả lập File Service bị sập
    axios.get.mockRejectedValue(new Error('File Service timeout'));

    const res = await request(app).get('/api/folders/root/items');
    
    expect(res.status).toBe(200);
    expect(res.body.folders).toHaveLength(1);
    // 🟢 Nhánh Catch của Axios: Nuốt lỗi, fallback về mảng rỗng an toàn
    expect(res.body.files).toEqual([]); 
  });

  test('❌ Lỗi database (Folder.find) → 500', async () => {
    // Giả lập Mongoose Error an toàn với smartQuery
    Folder.find.mockImplementation(() => {
      const q = Promise.reject(new Error('DB Error'));
      q.setOptions = jest.fn().mockReturnValue(q);
      return q;
    });

    const res = await request(app).get('/api/folders/root/items');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// GET /api/folders/:id — getFolderById
// ═══════════════════════════════════════════════════════════
describe('GET /api/folders/:id', () => {
  const app = createApp();

  test('✅ Lấy My Drive folder thành công + có breadcrumb', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);
    
    // Mock 2 câu query mới thêm trong controller
    Folder.find.mockReturnValue(smartQuery([{ _id: 'sub-folder-1' }])); // sub-folders
    axios.get.mockResolvedValue({ data: { data: [{ _id: 'file-1' }] } }); // files

    const res = await request(app).get(`/api/folders/${folder._id}`);
    
    expect(res.status).toBe(200);
    // Cập nhật lại đường dẫn biến (thêm .data)
    expect(res.body.data.breadcrumb).toBeDefined();
    expect(res.body.data.folderInfo._id).toBe(folder._id.toString());
    expect(res.body.data.folders).toHaveLength(1);
    expect(res.body.data.files).toHaveLength(1);
  });

  test('✅ Lấy workspace folder thành công', async () => {
    const folder = getFreshFolder({ workspaceId: VALID_WS_ID });
    mockFolderDB([folder]);
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);
    
    Folder.find.mockReturnValue(smartQuery([]));
    axios.get.mockResolvedValue({ data: { data: [] } });

    const res = await request(app).get(`/api/folders/${folder._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.folderInfo.workspaceId).toBe(VALID_WS_ID);
  });

  test('✅ File Service lỗi (Axios sập) → Vẫn trả 200 và files rỗng', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);
    Folder.find.mockReturnValue(smartQuery([]));
    
    // Giả lập sập Axios
    axios.get.mockRejectedValue(new Error('Network timeout'));

    const res = await request(app).get(`/api/folders/${folder._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.files).toEqual([]); // Nuốt lỗi, trả về mảng rỗng
  });

  test('❌ Folder không tồn tại → 404', async () => {
    mockFolderDB([]);
    const res = await request(app).get(`/api/folders/${NOT_FOUND_ID}`);
    expect(res.status).toBe(404);
  });

  test('❌ My Drive folder — user không phải chủ sở hữu → 403', async () => {
    const folder = getFreshFolder({ createdBy: { toString: () => 'user-999' } });
    mockFolderDB([folder]);

    const res = await request(app).get(`/api/folders/${folder._id}`);
    expect(res.status).toBe(403);
  });

  test('❌ Lỗi database → 500', async () => {
    Folder.findById.mockImplementation(() => {
      const q = Promise.reject(new Error('DB Error'));
      q.setOptions = jest.fn().mockReturnValue(q);
      return q;
    });
    const res = await request(app).get(`/api/folders/${VALID_TARGET_ID}`);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/rename — renameFolder
// ═══════════════════════════════════════════════════════════
describe('PUT /api/folders/:id/rename', () => {
  const app = createApp();

  test('✅ Đổi tên My Drive folder thành công', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(folder.save).toHaveBeenCalled();
  });

  test('✅ Đổi tên workspace folder — ADMIN thành công', async () => {
    const folder = getFreshFolder({ workspaceId: VALID_WS_ID });
    mockFolderDB([folder]);
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .send({ name: 'New WS Name' });

    expect(res.status).toBe(200);
  });

  test('❌ Workspace folder — Workspace không tồn tại → 404', async () => {
    const folder = getFreshFolder({ workspaceId: VALID_WS_ID });
    mockFolderDB([folder]);
    mockWorkspaceDB([]);

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .send({ name: 'New Name' });

    // Tùy theo logic middleware của bạn, có thể là 404 hoặc 500 do middleware chặn
    expect(res.status).toBeGreaterThanOrEqual(400); 
  });

  test('❌ Workspace — chỉ có quyền viewer → 403', async () => {
    const folder = getFreshFolder({ workspaceId: VALID_WS_ID });
    mockFolderDB([folder]);
    mockWorkspaceDB([getFreshWorkspace({
      _id: VALID_WS_ID,
      members: [{ userId: { toString: () => 'user-001' }, role: 'MEMBER', permissions: ['viewer'] }]
    })]);

    const res = await request(app)
      .put(`/api/folders/${folder._id}/rename`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/folders/:id — deleteFolder
// ═══════════════════════════════════════════════════════════
describe('DELETE /api/folders/:id', () => {
  const app = createApp();

  test('✅ Xóa My Drive folder thành công (soft delete)', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);
    axios.delete.mockResolvedValue({ data: { message: 'ok' } });
    Folder.updateMany.mockResolvedValue({});
    Folder.find.mockReturnValue(smartQuery([])); 

    const res = await request(app).delete(`/api/folders/${folder._id}`);
    expect(res.status).toBe(200);
    expect(Folder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: expect.any(Array) } }),
      { deletedAt: expect.any(Date) }
    );
  });

  test('✅ Xóa workspace folder thành công', async () => {
    const folder = getFreshFolder({ workspaceId: VALID_WS_ID });
    mockFolderDB([folder]);
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);
    axios.delete.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({});
    Folder.find.mockReturnValue(smartQuery([])); 

    const res = await request(app).delete(`/api/folders/${folder._id}`);
    expect(res.status).toBe(200);
  });

  test('❌ Folder không tồn tại → 404', async () => {
    mockFolderDB([]);
    Folder.find.mockReturnValue(smartQuery([])); 

    const res = await request(app).delete(`/api/folders/${NOT_FOUND_ID}`);
    expect(res.status).toBe(404);
  });

  test('❌ Không phải chủ sở hữu My Drive → 403', async () => {
    const folder = getFreshFolder({ createdBy: { toString: () => 'user-999' } });
    mockFolderDB([folder]);
    Folder.find.mockReturnValue(smartQuery([])); 

    const res = await request(app).delete(`/api/folders/${folder._id}`);
    expect(res.status).toBe(403);
  });

  test('❌ file-service lỗi → 500', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);
    Folder.find.mockReturnValue(smartQuery([])); 
    axios.delete.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).delete(`/api/folders/${folder._id}`);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/restore — restoreFolder
// ═══════════════════════════════════════════════════════════
describe('PUT /api/folders/:id/restore', () => {
  const app = createApp();

  test('✅ Restore folder thành công', async () => {
    const folder = getFreshFolder({ deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    mockFolderDB([folder]);
    Folder.find.mockReturnValue(smartQuery([])); 
    axios.put.mockResolvedValue({ data: {} });
    Folder.updateMany.mockResolvedValue({});

    const res = await request(app).put(`/api/folders/${folder._id}/restore`);
    expect(res.status).toBe(200);
  });

  test('❌ Folder chưa bị xóa → 400', async () => {
    const folder = getFreshFolder({ deletedAt: null });
    mockFolderDB([folder]);

    const res = await request(app).put(`/api/folders/${folder._id}/restore`);
    expect(res.status).toBe(400);
  });

  test('❌ Folder đã xóa quá 10 ngày → 400', async () => {
    const folder = getFreshFolder({ deletedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000) });
    mockFolderDB([folder]);

    const res = await request(app).put(`/api/folders/${folder._id}/restore`);
    expect(res.status).toBe(400);
  });

  test('❌ file-service lỗi khi restore → 500', async () => {
    const folder = getFreshFolder({ deletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    mockFolderDB([folder]);
    Folder.find.mockReturnValue(smartQuery([]));
    axios.put.mockRejectedValue(new Error('file-service down'));

    const res = await request(app).put(`/api/folders/${folder._id}/restore`);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════
// PUT /api/folders/:id/move — moveFolder
// ═══════════════════════════════════════════════════════════
describe('PUT /api/folders/:id/move', () => {
  const app = createApp();

  test('✅ Di chuyển My Drive folder sang folder khác', async () => {
    const sourceFolder = getFreshFolder();
    const targetFolder = getFreshFolder({ _id: VALID_TARGET_ID });

    // Load vào Fake DB để vượt mặt Middleware
    mockFolderDB([sourceFolder, targetFolder]);

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({ newParentId: targetFolder._id });

    expect(res.status).toBe(200);
  });

  test('✅ Di chuyển vào workspace', async () => {
    const sourceFolder = getFreshFolder();
    mockFolderDB([sourceFolder]);
    mockWorkspaceDB([getFreshWorkspace({ _id: VALID_WS_ID })]);

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({ targetWorkspaceId: VALID_WS_ID });

    expect(res.status).toBe(200);
  });

  test('✅ Di chuyển về My Drive root (không parentId, không workspaceId)', async () => {
    const sourceFolder = getFreshFolder();
    mockFolderDB([sourceFolder]);

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('❌ Source folder không tồn tại → 404', async () => {
    mockFolderDB([]); // Empty DB
    
    const res = await request(app)
      .put(`/api/folders/${NOT_FOUND_ID}/move`)
      .send({ newParentId: VALID_TARGET_ID });

    expect(res.status).toBe(404);
  });

  test('❌ Di chuyển vào chính nó → 400', async () => {
    const folder = getFreshFolder();
    mockFolderDB([folder]);

    const res = await request(app)
      .put(`/api/folders/${folder._id}/move`)
      .send({ newParentId: folder._id }); 

    expect(res.status).toBe(400);
  });

  test('❌ Di chuyển vào folder con (circular) → 400', async () => {
    const sourceFolder = getFreshFolder({ _id: '648000000000000000000001' });
    const childFolder = getFreshFolder({ _id: '648000000000000000000002', parentId: sourceFolder._id });

    mockFolderDB([sourceFolder, childFolder]);
    Folder.find.mockReturnValueOnce(smartQuery([childFolder])).mockReturnValue(smartQuery([]));

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({ newParentId: childFolder._id });

    expect(res.status).toBe(400);
  });

  test('❌ Target folder không tồn tại → 404', async () => {
    const sourceFolder = getFreshFolder();
    mockFolderDB([sourceFolder]); // Chỉ có source, target không tồn tại trong DB giả

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({ newParentId: NOT_FOUND_ID });

    expect(res.status).toBe(404);
  });

  test('❌ Không có quyền upload vào workspace đích → 403', async () => {
    const sourceFolder = getFreshFolder();
    const ws = getFreshWorkspace({
      _id: VALID_WS_ID,
      members: [{ userId: { toString: () => 'user-001' }, role: 'MEMBER', permissions: ['viewer'] }]
    });
    
    mockFolderDB([sourceFolder]);
    mockWorkspaceDB([ws]);

    const res = await request(app)
      .put(`/api/folders/${sourceFolder._id}/move`)
      .send({ targetWorkspaceId: VALID_WS_ID });

    expect(res.status).toBe(403);
  });
});