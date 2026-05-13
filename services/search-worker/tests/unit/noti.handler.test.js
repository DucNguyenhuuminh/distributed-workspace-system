const { notificationProcessor } = require('../../src/handlers/noti.handler');
const notificationService = require('../../src/services/noti.service');
const { EVENTS } = require('shared');

jest.mock('../../src/services/noti.service', () => ({
  createNotification: jest.fn(),
  createBulkNotifications: jest.fn(),
}));

describe('Notification Handler Processor', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // ── Test Luồng (Processor Routing) ──────────────────────────────────
  test('❌ Bỏ qua và log warning nếu Event không tồn tại', async () => {
    await notificationProcessor({ name: 'UNKNOWN_EVENT', data: {} });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown event: UNKNOWN_EVENT'));
    expect(notificationService.createNotification).not.toHaveBeenCalled();
  });

  test('❌ Log error và throw error nếu handler nội bộ crash', async () => {
    notificationService.createNotification.mockRejectedValueOnce(new Error('Service Crash'));
    
    await expect(notificationProcessor({ 
      name: EVENTS.FILE_MERGED, 
      data: {} 
    })).rejects.toThrow('Service Crash');
    
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing'),
      'Service Crash'
    );
  });

  // ── Test Chi tiết từng Handler ──────────────────────────────────────
  test('✅ FILE_MERGED - Workspace (Có actionUrl workspace)', async () => {
    await notificationProcessor({
      name: EVENTS.FILE_MERGED,
      data: { uploadedBy: 'user-1', originalName: 'doc.pdf', workspaceId: 'ws-1' }
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'FILE_MERGED',
      actionUrl: '/workspaces/ws-1',
      metadata: { originalName: 'doc.pdf', workspaceId: 'ws-1' }
    }));
  });

  test('✅ FILE_MERGED - My Drive (Không có workspaceId)', async () => {
    await notificationProcessor({
      name: EVENTS.FILE_MERGED,
      data: { uploadedBy: 'user-1', originalName: 'doc.pdf' }
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      actionUrl: '/my-drive'
    }));
  });

  test('✅ FILE_RESTORED', async () => {
    await notificationProcessor({
      name: EVENTS.FILE_RESTORED,
      data: { uploadedBy: 'user-1', originalName: 'doc.pdf' }
    });
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'FILE_RESTORED' }));
  });

  test('✅ FOLDER_RESTORED (Có tên thư mục và không tên thư mục)', async () => {
    // Có tên
    await notificationProcessor({ name: EVENTS.FOLDER_RESTORED, data: { actorId: 'u1', folderName: 'Secret' }});
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Thư mục "Secret" đã được khôi phục'
    }));

    // Không tên (Fallback "của bạn")
    await notificationProcessor({ name: EVENTS.FOLDER_RESTORED, data: { actorId: 'u1' }});
    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Thư mục "của bạn" đã được khôi phục'
    }));
  });

  test('✅ WORKSPACE_DELETED (Bulk) - Bỏ qua nếu mảng memberIds rỗng', async () => {
    await notificationProcessor({
      name: EVENTS.WORKSPACE_DELETED,
      data: { workspaceId: 'ws-1', name: 'Team', memberIds: [] }
    });
    expect(notificationService.createBulkNotifications).not.toHaveBeenCalled();
  });

  test('✅ WORKSPACE_DELETED (Bulk) - Insert nhiều noti nếu có member', async () => {
    await notificationProcessor({
      name: EVENTS.WORKSPACE_DELETED,
      data: { workspaceId: 'ws-1', name: 'Team', memberIds: ['user-1', 'user-2'], actorId: 'admin' }
    });
    
    expect(notificationService.createBulkNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'user-1', type: 'WORKSPACE_DELETED' }),
      expect.objectContaining({ userId: 'user-2', type: 'WORKSPACE_DELETED' })
    ]);
  });

  test('✅ NOTIFY_USER - Fallback type và value mặc định', async () => {
    await notificationProcessor({
      name: EVENTS.NOTIFY_USER,
      data: { userId: 'u1', title: 'Hello', message: 'World' }
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'GENERAL',
      actionUrl: null,
      metadata: {}
    }));
  });
});