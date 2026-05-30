const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Import Model thật và Controller thật
const Notification = require('../../src/models/noti.model');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
} = require('../../src/controllers/noti.controller');

// ── Setup App và Database ─────────────────────────────────
let mongod;
const USER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_USER_ID = new mongoose.Types.ObjectId().toString();

function createApp() {
  const app = express();
  app.use(express.json());

  // Mock Middleware xác thực
  app.use((req, res, next) => {
    req.user = { userId: USER_ID };
    next();
  });

  // Mount trực tiếp các route đến controller
  app.get('/api/notifications', getNotifications);
  app.patch('/api/notifications/read-all', markAllAsRead); // Phải đặt trước :id để không bị nhầm route
  app.patch('/api/notifications/:id/read', markAsRead);
  app.delete('/api/notifications/:id', deleteNotification);

  return app;
}

const app = createApp();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await Notification.deleteMany({});
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
  console.error.mockRestore?.();
});

// ── Helper: Tạo data mẫu trước mỗi bài test ───────────────
async function seedNotifications() {
  const now = Date.now();
  const notis = await Notification.insertMany([
    { userId: USER_ID, type: 'GENERAL', title: 'Noti 1', message: 'M1', isRead: false, createdAt: new Date(now - 3000) }, // Cũ nhất
    { userId: USER_ID, type: 'GENERAL', title: 'Noti 2', message: 'M2', isRead: true,  createdAt: new Date(now - 2000) },
    { userId: USER_ID, type: 'GENERAL', title: 'Noti 3', message: 'M3', isRead: false, createdAt: new Date(now - 1000) }, // Mới nhất của USER_ID
    { userId: OTHER_USER_ID, type: 'GENERAL', title: 'Noti 4', message: 'M4', isRead: false, createdAt: new Date(now) },
  ]);
  return notis;
}

// ═══════════════════════════════════════════════════════════
// GET /api/notifications
// ═══════════════════════════════════════════════════════════
describe('[Integration] GET /api/notifications', () => {
  test('✅ Lấy danh sách thành công (Mặc định page=1, limit=20)', async () => {
    await seedNotifications();

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    // User này có 3 noti (bỏ qua cái của OTHER_USER_ID)
    expect(res.body.data.notifications.length).toBe(3);
    expect(res.body.data.pagination.total).toBe(3);
    // User này có 2 noti chưa đọc
    expect(res.body.data.unreadCount).toBe(2);
    
    // Đảm bảo sắp xếp mới nhất lên đầu (Noti 3 tạo sau cùng)
    expect(res.body.data.notifications[0].title).toBe('Noti 3');
  });

  test('✅ Phân trang chính xác (limit=2, page=2)', async () => {
    await seedNotifications();

    const res = await request(app).get('/api/notifications?page=2&limit=2');

    expect(res.status).toBe(200);
    // Vì lấy page 2, limit 2, nên chỉ trả về 1 phần tử cuối cùng
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.pagination.page).toBe(2);
    expect(res.body.data.pagination.limit).toBe(2);
    expect(res.body.data.pagination.total).toBe(3);
    expect(res.body.data.pagination.totalPages).toBe(2);
  });

  test('✅ Lấy chính xác noti chưa đọc khi unreadOnly=true', async () => {
    await seedNotifications();

    const res = await request(app).get('/api/notifications?unreadOnly=true');

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(2); // Chỉ có 2 cái isRead: false
    expect(res.body.data.notifications.every(n => n.isRead === false)).toBe(true);
  });

  test('❌ DB Lỗi → 500', async () => {
    const findSpy = jest.spyOn(Notification, 'find').mockImplementationOnce(() => {
      throw new Error('MongoDB timeout');
    });

    try {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('MongoDB timeout');
    } finally {
      findSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════
// PATCH /api/notifications/:id/read
// ═══════════════════════════════════════════════════════════
describe('[Integration] PATCH /api/notifications/:id/read', () => {
  test('✅ Đánh dấu 1 thông báo thành đã đọc thành công', async () => {
    const notis = await seedNotifications();
    const unreadNotiId = notis[0]._id.toString(); // isRead = false

    const res = await request(app).patch(`/api/notifications/${unreadNotiId}/read`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Marked as read');
    expect(res.body.data.isRead).toBe(true);

    // Kiểm tra lại trong DB xem đã thực sự cập nhật chưa
    const updatedNoti = await Notification.findById(unreadNotiId);
    expect(updatedNoti.isRead).toBe(true);
  });

  test('❌ Không tìm thấy do ID sai → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).patch(`/api/notifications/${fakeId}/read`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Notification not exists');
  });

  test('❌ Cố gắng đánh dấu đọc thông báo của User khác → 404', async () => {
    const notis = await seedNotifications();
    const otherUserNotiId = notis[3]._id.toString(); // Của OTHER_USER_ID

    const res = await request(app).patch(`/api/notifications/${otherUserNotiId}/read`);

    expect(res.status).toBe(404); // Vì query có điều kiện userId nên sẽ không tìm thấy
  });

  test('❌ Truyền ID không phải chuẩn MongoID → 500', async () => {
    const res = await request(app).patch('/api/notifications/invalid-string-id/read');
    
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Cast to ObjectId failed');
  });
});

// ═══════════════════════════════════════════════════════════
// PATCH /api/notifications/read-all
// ═══════════════════════════════════════════════════════════
describe('[Integration] PATCH /api/notifications/read-all', () => {
  test('✅ Đánh dấu tất cả thông báo của user thành đã đọc', async () => {
    await seedNotifications();

    const res = await request(app).patch('/api/notifications/read-all');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('All marked as read');
    // User này có 2 thông báo isRead: false, nên modifiedCount = 2
    expect(res.body.modifiedCount).toBe(2);

    // Kiểm tra lại DB: Không còn cái nào của user này bị isRead: false
    const unreadCount = await Notification.countDocuments({ userId: USER_ID, isRead: false });
    expect(unreadCount).toBe(0);

    // Thông báo của user khác KHÔNG bị ảnh hưởng
    const otherUserNoti = await Notification.findOne({ userId: OTHER_USER_ID });
    expect(otherUserNoti.isRead).toBe(false);
  });

  test('❌ DB Lỗi → 500', async () => {
    const spy = jest.spyOn(Notification, 'updateMany').mockRejectedValueOnce(new Error('Update failed'));

    try {
      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/notifications/:id
// ═══════════════════════════════════════════════════════════
describe('[Integration] DELETE /api/notifications/:id', () => {
  test('✅ Xóa thông báo thành công', async () => {
    const notis = await seedNotifications();
    const targetId = notis[0]._id.toString();

    const res = await request(app).delete(`/api/notifications/${targetId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Delete noti successfully');

    // Kiểm tra lại DB xem đã bị xóa thực sự chưa
    const checkDeleted = await Notification.findById(targetId);
    expect(checkDeleted).toBeNull();
  });

  test('❌ Không tìm thấy do ID sai → 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).delete(`/api/notifications/${fakeId}`);

    expect(res.status).toBe(404);
  });

  test('❌ Cố gắng xóa thông báo của User khác → 404', async () => {
    const notis = await seedNotifications();
    const otherUserNotiId = notis[3]._id.toString(); // Của OTHER_USER_ID

    const res = await request(app).delete(`/api/notifications/${otherUserNotiId}`);

    expect(res.status).toBe(404); 
    
    // Đảm bảo thông báo đó VẪN TỒN TẠI trong DB (Không bị xóa nhầm)
    const checkNoti = await Notification.findById(otherUserNotiId);
    expect(checkNoti).not.toBeNull();
  });

  test('❌ Truyền ID không phải chuẩn MongoID → 500', async () => {
    const res = await request(app).delete('/api/notifications/abc-123');
    
    expect(res.status).toBe(500);
  });
});