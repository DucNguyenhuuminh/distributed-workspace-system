// Mock BullMQ và IORedis trước khi require module
jest.mock('bullmq', () => {
  const mockAdd   = jest.fn().mockResolvedValue({ id: 'job-001' });
  const mockClose = jest.fn().mockResolvedValue(undefined);

  const MockQueue = jest.fn().mockImplementation((name) => ({
    name,
    add:   mockAdd,
    close: mockClose,
  }));

  return { Queue: MockQueue };
});

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    status:       'ready',
    on:           jest.fn(),
    quit:         jest.fn().mockResolvedValue('OK'),
    disconnect:   jest.fn(),
  }));
});

const { Queue }    = require('bullmq');
const { addJob, getQueue, closeAll, connection } = require('../queue/queueProducer');

afterEach(() => {
  jest.clearAllMocks();
  // Reset cache giữa các test
  closeAll().catch(() => {});
});

// ═══════════════════════════════════════════════════════════
// connection
// ═══════════════════════════════════════════════════════════
describe('Redis connection', () => {
  test('✅ connection được khởi tạo khi require module', () => {
    expect(connection).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// getQueue()
// ═══════════════════════════════════════════════════════════
describe('getQueue()', () => {
  test('✅ Tạo Queue mới nếu chưa có trong cache', () => {
    const q = getQueue('test-queue');
    expect(q).toBeDefined();
    expect(Queue).toHaveBeenCalledWith('test-queue', expect.any(Object));
  });

  test('✅ Trả cùng 1 instance nếu đã cache — không tạo Queue mới', () => {
    const q1 = getQueue('my-queue');
    const q2 = getQueue('my-queue');

    expect(q1).toBe(q2);
    // Queue constructor chỉ được gọi 1 lần
    expect(Queue).toHaveBeenCalledTimes(1);
  });

  test('✅ Các queue khác tên → tạo instance riêng biệt', () => {
    const qA = getQueue('queue-a');
    const qB = getQueue('queue-b');

    expect(qA).not.toBe(qB);
    expect(Queue).toHaveBeenCalledTimes(2);
  });

  test('✅ Queue được khởi tạo với đúng connection', () => {
    getQueue('connection-test');
    expect(Queue).toHaveBeenCalledWith(
      'connection-test',
      expect.objectContaining({ connection })
    );
  });
});

// ═══════════════════════════════════════════════════════════
// addJob()
// ═══════════════════════════════════════════════════════════
describe('addJob()', () => {
  test('✅ Thêm job thành công — trả về job object', async () => {
    const result = await addJob('file-queue', 'file.uploaded', { fileId: '123' });
    expect(result).toEqual({ id: 'job-001' });
  });

  test('✅ Gọi queue.add với đúng jobName và data', async () => {
    const data = { workspaceId: 'ws-001', userId: 'user-001' };
    await addJob('workspace-queue', 'workspace.created', data);

    const q = getQueue('workspace-queue');
    expect(q.add).toHaveBeenCalledWith('workspace.created', data, {});
  });

  test('✅ Truyền options vào queue.add', async () => {
    const opts = { jobId: 'file.uploaded:123', attempts: 3 };
    await addJob('file-queue', 'file.uploaded', { fileId: '123' }, opts);

    const q = getQueue('file-queue');
    expect(q.add).toHaveBeenCalledWith('file.uploaded', { fileId: '123' }, opts);
  });

  test('✅ options mặc định là {} khi không truyền', async () => {
    await addJob('folder-queue', 'folder.created', { folderId: 'f-001' });

    const q = getQueue('folder-queue');
    expect(q.add).toHaveBeenCalledWith(
      'folder.created',
      { folderId: 'f-001' },
      {}
    );
  });

  test('✅ Nhiều job khác queue — mỗi queue.add gọi độc lập', async () => {
    await addJob('file-queue',      'file.uploaded',      { id: '1' });
    await addJob('workspace-queue', 'workspace.created',  { id: '2' });
    await addJob('folder-queue',    'folder.created',     { id: '3' });

    expect(Queue).toHaveBeenCalledTimes(3);
  });

  test('❌ queue.add lỗi → addJob throw error', async () => {
    const q = getQueue('error-queue');
    q.add.mockRejectedValueOnce(new Error('Redis connection lost'));

    await expect(
      addJob('error-queue', 'some.event', { id: '1' })
    ).rejects.toThrow('Redis connection lost');
  });
});

// ═══════════════════════════════════════════════════════════
// closeAll()
// ═══════════════════════════════════════════════════════════
describe('closeAll()', () => {
  test('✅ Close tất cả queue trong cache', async () => {
    const q1 = getQueue('q1');
    const q2 = getQueue('q2');

    await closeAll();

    expect(q1.close).toHaveBeenCalled();
    expect(q2.close).toHaveBeenCalled();
  });

  test('✅ Sau closeAll — cache bị xóa, getQueue tạo Queue mới', async () => {
    getQueue('persistent-queue');
    expect(Queue).toHaveBeenCalledTimes(1);

    await closeAll();

    getQueue('persistent-queue');
    // Phải tạo lại Queue mới
    expect(Queue).toHaveBeenCalledTimes(2);
  });

  test('✅ closeAll không throw dù queue.close lỗi', async () => {
    const q = getQueue('fail-close-queue');
    q.close.mockRejectedValueOnce(new Error('Close failed'));

    // Không throw
    await expect(closeAll()).resolves.not.toThrow();
  });

  test('✅ closeAll khi cache rỗng — không lỗi', async () => {
    await closeAll(); // reset cache trước
    await expect(closeAll()).resolves.not.toThrow();
  });
});