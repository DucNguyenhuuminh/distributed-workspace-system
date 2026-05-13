const notificationService = require('../../src/services/noti.service');
const Notification = require('../../src/models/noti.model');

jest.mock('../../src/models/noti.model');

describe('Notification Service', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    console.log.mockRestore();
  });

  describe('createNotification', () => {
    const mockData = {
      userId: 'user-1',
      actorId: 'user-2',
      type: 'TEST_TYPE',
      title: 'Test Title',
      message: 'Test Message',
      actionUrl: '/test',
      metadata: { key: 'value' }
    };

    test('✅ Tạo notification thành công', async () => {
      Notification.create.mockResolvedValue({ _id: 'noti-1', ...mockData });

      const result = await notificationService.createNotification(mockData);

      expect(Notification.create).toHaveBeenCalledWith(mockData);
      expect(result).toHaveProperty('_id', 'noti-1');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Created notification for user user-1'));
    });

    test('✅ Tạo notification thành công với metadata mặc định (nếu không truyền)', async () => {
      const { metadata, ...dataWithoutMeta } = mockData;
      Notification.create.mockResolvedValue({ _id: 'noti-2', ...dataWithoutMeta, metadata: {} });

      await notificationService.createNotification(dataWithoutMeta);

      expect(Notification.create).toHaveBeenCalledWith({
        ...dataWithoutMeta,
        metadata: {} // fallback mặc định
      });
    });

    test('❌ Thất bại khi DB văng lỗi', async () => {
      Notification.create.mockRejectedValue(new Error('DB Error'));

      await expect(notificationService.createNotification(mockData)).rejects.toThrow('DB Error');
    });
  });

  describe('createBulkNotifications', () => {
    test('✅ Bỏ qua không gọi DB nếu mảng notifications rỗng', async () => {
      await notificationService.createBulkNotifications([]);
      expect(Notification.insertMany).not.toHaveBeenCalled();
    });

    test('✅ Insert số lượng lớn notification thành công', async () => {
      const mockNotis = [{ userId: 'user-1' }, { userId: 'user-2' }];
      Notification.insertMany.mockResolvedValue(mockNotis);

      await notificationService.createBulkNotifications(mockNotis);

      expect(Notification.insertMany).toHaveBeenCalledWith(mockNotis);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Created 2 notifications'));
    });

    test('❌ Thất bại khi DB văng lỗi lúc insertMany', async () => {
      Notification.insertMany.mockRejectedValue(new Error('Bulk DB Error'));

      await expect(notificationService.createBulkNotifications([{ userId: '1' }]))
        .rejects.toThrow('Bulk DB Error');
    });
  });
});