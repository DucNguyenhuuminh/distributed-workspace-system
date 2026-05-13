const { getNotifications, markAsRead, markAllAsRead, deleteNotification } = require('../../src/controllers/noti.controller');
const Notification = require('../../src/models/noti.model');

jest.mock('../../src/models/noti.model');

describe('Notification Controller', () => {
  let req, res;

  beforeEach(() => {
    req = {
      user: { userId: 'user-123' },
      query: {},
      params: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // GET /api/notifications
  // ═══════════════════════════════════════════════════════════
  describe('getNotifications', () => {
    test('✅ Lấy danh sách thành công (Mặc định page=1, limit=20)', async () => {
      const mockQueryObj = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(['noti1', 'noti2']) // Giả lập trả về 2 kết quả
      };
      
      Notification.find.mockReturnValue(mockQueryObj);
      Notification.countDocuments
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3); // unreadCount

      await getNotifications(req, res);

      // Kiểm tra pipeline query
      expect(Notification.find).toHaveBeenCalledWith({ userId: 'user-123' });
      expect(mockQueryObj.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(mockQueryObj.skip).toHaveBeenCalledWith(0); // (1-1)*20
      expect(mockQueryObj.limit).toHaveBeenCalledWith(20);

      expect(res.json).toHaveBeenCalledWith({
        data: {
          notifications: ['noti1', 'noti2'],
          pagination: { page: 1, limit: 20, total: 10, totalPages: 1 },
          unreadCount: 3
        }
      });
    });

    test('✅ Lấy danh sách thành công với tham số unreadOnly=true', async () => {
      req.query = { unreadOnly: 'true', page: 2, limit: 5 };
      
      const mockQueryObj = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]) 
      };
      Notification.find.mockReturnValue(mockQueryObj);
      Notification.countDocuments.mockResolvedValue(0);

      await getNotifications(req, res);

      // Cần chắc chắn truy vấn có chèn thêm isRead: false
      expect(Notification.find).toHaveBeenCalledWith({ userId: 'user-123', isRead: false });
      expect(mockQueryObj.skip).toHaveBeenCalledWith(5); // (2-1)*5
      expect(mockQueryObj.limit).toHaveBeenCalledWith(5);
    });

    test('❌ Thất bại (Lỗi DB) → 500', async () => {
      Notification.find.mockImplementation(() => { throw new Error('DB Down'); });

      await getNotifications(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: 'DB Down' });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PATCH /api/notifications/:id/read
  // ═══════════════════════════════════════════════════════════
  describe('markAsRead', () => {
    test('✅ Đánh dấu đã đọc thành công', async () => {
      req.params.id = 'noti-123';
      Notification.findOneAndUpdate.mockResolvedValue({ _id: 'noti-123', isRead: true });

      await markAsRead(req, res);

      expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'noti-123', userId: 'user-123' },
        { isRead: true },
        { new: true }
      );
      expect(res.json).toHaveBeenCalledWith({ message: 'Marked as read', data: expect.any(Object) });
    });

    test('❌ Báo 404 nếu không tìm thấy Notification (Hoặc của user khác)', async () => {
      req.params.id = 'invalid-id';
      Notification.findOneAndUpdate.mockResolvedValue(null);

      await markAsRead(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Notification not exists' });
    });

    test('❌ Thất bại (Lỗi DB) → 500', async () => {
      Notification.findOneAndUpdate.mockRejectedValue(new Error('Timeout'));
      await markAsRead(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PATCH /api/notifications/read-all
  // ═══════════════════════════════════════════════════════════
  describe('markAllAsRead', () => {
    test('✅ Đánh dấu tất cả đã đọc thành công', async () => {
      Notification.updateMany.mockResolvedValue({ modifiedCount: 5 });

      await markAllAsRead(req, res);

      expect(Notification.updateMany).toHaveBeenCalledWith(
        { userId: 'user-123', isRead: false },
        { isRead: true }
      );
      expect(res.json).toHaveBeenCalledWith({ message: 'All marked as read', modifiedCount: 5 });
    });

    test('❌ Thất bại (Lỗi DB) → 500', async () => {
      Notification.updateMany.mockRejectedValue(new Error('Timeout'));
      await markAllAsRead(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // DELETE /api/notifications/:id
  // ═══════════════════════════════════════════════════════════
  describe('deleteNotification', () => {
    test('✅ Xóa notification thành công', async () => {
      req.params.id = 'noti-123';
      Notification.findOneAndDelete.mockResolvedValue({ _id: 'noti-123' });

      await deleteNotification(req, res);

      expect(Notification.findOneAndDelete).toHaveBeenCalledWith({ _id: 'noti-123', userId: 'user-123' });
      expect(res.json).toHaveBeenCalledWith({ message: 'Delete noti successfully' });
    });

    test('❌ Báo 404 nếu notification không tồn tại', async () => {
      req.params.id = 'invalid-id';
      Notification.findOneAndDelete.mockResolvedValue(null);

      await deleteNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('❌ Thất bại (Lỗi DB) → 500', async () => {
      Notification.findOneAndDelete.mockRejectedValue(new Error('Timeout'));
      await deleteNotification(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});