const { folderProcessor } = require('../../src/handlers/folder.handler');

describe('Folder Handler Processor', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('✅ Log đúng event FOLDER_CREATED', async () => {
    await folderProcessor({ name: 'folder.created', data: { folderId: 'f1' } });
    expect(console.log).toHaveBeenCalledWith('[FolderHandler] FOLDER_CREATED — f1');
  });

  test('✅ Log đúng event FOLDER_TRASHED', async () => {
    await folderProcessor({ name: 'folder.trashed', data: { folderId: 'f1', allFolderIds: ['f1', 'f2'] } });
    expect(console.log).toHaveBeenCalledWith('[FolderHandler] FOLDER_TRASHED — f1, total: 2');
  });

  test('❌ Bỏ qua event không xác định', async () => {
    await folderProcessor({ name: 'folder.unknown', data: {} });
    expect(console.warn).toHaveBeenCalledWith('[FolderHandler] Unknown event: folder.unknown');
  });
});