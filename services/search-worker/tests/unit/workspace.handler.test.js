const chromaService = require('../../src/config/chroma.config');

jest.mock('shared', () => ({
  EVENTS: {
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
    MEMBER_ADDED: 'workspace.member_added',
    MEMBER_REMOVED: 'workspace.member_removed'
  }
}));
jest.mock('../../src/config/chroma.config');

const { EVENTS } = require('shared');
const { workspaceProcessor } = require('../../src/handlers/workspace.handler');

describe('Workspace Handler Processor', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('✅ Log đúng event WORKSPACE_CREATED', async () => {
    await workspaceProcessor({ name: 'workspace.created', data: { workspaceId: 'ws-1' } });
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] WORKSPACE_CREATED — ws-1');
  });

  test('✅ WORKSPACE_DELETED - Gọi ChromaService xóa theo workspaceId', async () => {
    await workspaceProcessor({ name: 'workspace.deleted', data: { workspaceId: 'ws-1' } });
    expect(chromaService.deleteByWorkspace).toHaveBeenCalledWith('ws-1');
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] Deleted all vectors for workspace: ws-1');
  });

  test('✅ MEMBER_ADDED - Chạy thành công', async () => {
    await workspaceProcessor({ name: 'workspace.member_added', data: { workspaceId: 'ws-1', targetUserId: 'u1' } });
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] MEMBER_ADDED — ws: ws-1, user: u1');
  });

  test('❌ Bỏ qua event không xác định', async () => {
    await workspaceProcessor({ name: 'workspace.magic', data: {} });
    expect(console.warn).toHaveBeenCalledWith('[WorkspaceHandler] Unknown event: workspace.magic');
  });

  test('❌ Ném lỗi và log error nếu ChromaService crash', async () => {
    chromaService.deleteByWorkspace.mockRejectedValueOnce(new Error('Chroma Down'));

    await expect(
      workspaceProcessor({ name: 'workspace.deleted', data: { workspaceId: 'ws-1' } })
    ).rejects.toThrow('Chroma Down');
    
    expect(console.error).toHaveBeenCalledWith(
      '[WorkspaceHandler] Error processing workspace.deleted:',
      'Chroma Down'
    );
  });
});