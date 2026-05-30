const { notificationProcessor } = require('../../src/handlers/noti.handler');
const notificationService = require('../../src/services/noti.service');

// ── Mock module shared để đảm bảo các EVENTS luôn tồn tại ──
jest.mock('shared', () => ({
  EVENTS: {
    FILE_MERGED: 'file.merged',
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
    MEMBER_ADDED: 'member.added',
    MEMBER_REMOVED: 'member.removed',
    MEMBER_PERMISSION: 'member.permission',
    USER_REGISTERED: 'user.registered',
    NOTIFY_USER: 'notify.user',
  }
}));

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

  // ═══════════════════════════════════════════════════════════
  // 1. TEST LUỒNG (PROCESSOR ROUTING & BẮT LỖI)
  // ═══════════════════════════════════════════════════════════
  describe('Processor Routing', () => {
    test('❌ Bỏ qua và log warning nếu Event không tồn tại', async () => {
      await notificationProcessor({ name: 'UNKNOWN_EVENT', data: {} });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown event: UNKNOWN_EVENT'));
      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    test('❌ Log error và throw error nếu handler nội bộ crash', async () => {
      notificationService.createNotification.mockRejectedValueOnce(new Error('Service Crash'));
      
      await expect(notificationProcessor({ 
        name: EVENTS.FILE_MERGED, 
        data: { uploadedBy: 'user-1' } // Tránh lỗi destructuring
      })).rejects.toThrow('Service Crash');
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing'),
        'Service Crash'
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. TEST CHI TIẾT TỪNG HANDLER
  // ═══════════════════════════════════════════════════════════
  describe('Handlers Implementation', () => {

    // ── FILE EVENTS ──
    test('✅ FILE_MERGED - Có workspaceId → trỏ về Workspace', async () => {
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

    test('✅ FILE_MERGED - Không có workspaceId → trỏ về My Drive', async () => {
      await notificationProcessor({
        name: EVENTS.FILE_MERGED,
        data: { uploadedBy: 'user-1', originalName: 'doc.pdf' }
      });

      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        actionUrl: '/my-drive'
      }));
    });

    // ── WORKSPACE EVENTS ──
    test('✅ WORKSPACE_CREATED - Xử lý đúng và fallback tên workspace', async () => {
      // Test 1: Có tên workspace
      await notificationProcessor({
        name: EVENTS.WORKSPACE_CREATED,
        data: { workspaceId: 'ws-1', createdBy: 'user-1', name: 'My Team' }
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'WORKSPACE_CREATED',
        message: 'Workspace "My Team" đã được tạo thành công',
        actionUrl: '/workspaces/ws-1'
      }));

      // Test 2: Không có tên → fallback hiển thị ID
      await notificationProcessor({
        name: EVENTS.WORKSPACE_CREATED,
        data: { workspaceId: 'ws-2', createdBy: 'user-1' } // Thiếu name
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Workspace "ws-2" đã được tạo thành công'
      }));
    });

    test('✅ WORKSPACE_DELETED - Bỏ qua nếu mảng memberIds rỗng', async () => {
      await notificationProcessor({
        name: EVENTS.WORKSPACE_DELETED,
        data: { workspaceId: 'ws-1', name: 'Team', memberIds: [] }
      });
      expect(notificationService.createBulkNotifications).not.toHaveBeenCalled();
    });

    test('✅ WORKSPACE_DELETED - Gửi bulk notification cho tất cả members', async () => {
      await notificationProcessor({
        name: EVENTS.WORKSPACE_DELETED,
        data: { workspaceId: 'ws-1', name: 'Team', memberIds: ['user-1', 'user-2'], actorId: 'admin' }
      });
      
      expect(notificationService.createBulkNotifications).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'user-1', type: 'WORKSPACE_DELETED', actorId: 'admin' }),
        expect.objectContaining({ userId: 'user-2', type: 'WORKSPACE_DELETED', actorId: 'admin' })
      ]);
    });

    // ── MEMBER EVENTS ──
    test('✅ MEMBER_ADDED - Xử lý thông báo mời vào workspace', async () => {
      await notificationProcessor({
        name: EVENTS.MEMBER_ADDED,
        data: { workspaceId: 'ws-1', targetUserId: 'user-1', workspaceName: 'Design', actorId: 'admin' }
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        actorId: 'admin',
        type: 'MEMBER_ADDED',
        message: 'Bạn đã được thêm vào workspace "Design"'
      }));
    });

    test('✅ MEMBER_REMOVED - Xử lý thông báo bị kick (fallback actorId=null)', async () => {
      await notificationProcessor({
        name: EVENTS.MEMBER_REMOVED,
        data: { workspaceId: 'ws-1', targetUserId: 'user-1', workspaceName: 'Design' } // Không có removedBy
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        actorId: null, // Fallback an toàn
        type: 'MEMBER_REMOVED'
      }));
    });

    test('✅ MEMBER_PERMISSION - Xử lý thay đổi quyền', async () => {
      await notificationProcessor({
        name: EVENTS.MEMBER_PERMISSION,
        data: { workspaceId: 'ws-1', targetUserId: 'user-1', workspaceName: 'Design', newPermissions: 'EDITOR' }
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'MEMBER_PERMISSION',
        message: 'Quyền của bạn trong workspace "Design" đã được đổi thành "EDITOR"',
        metadata: { workspaceId: 'ws-1', newPermissions: 'EDITOR' }
      }));
    });

    // ── USER EVENTS ──
    test('✅ USER_REGISTERED - Thông báo chào mừng thành viên mới', async () => {
      await notificationProcessor({
        name: EVENTS.USER_REGISTERED,
        data: { userId: 'user-1', email: 'test@gmail.com' }
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        type: 'USER_REGISTERED',
        message: 'Tài khoản test@gmail.com đã được tạo thành công'
      }));
    });

    // ── GENERAL EVENTS ──
    test('✅ NOTIFY_USER - Fallback type và giá trị mặc định chuẩn xác', async () => {
      await notificationProcessor({
        name: EVENTS.NOTIFY_USER,
        data: { userId: 'user-1', title: 'Hello', message: 'World' } // Thiếu type, actionUrl, metadata
      });

      expect(notificationService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        type: 'GENERAL', // Fallback
        title: 'Hello',
        message: 'World',
        actionUrl: null,
        metadata: {}
      }));
    });
  });
});