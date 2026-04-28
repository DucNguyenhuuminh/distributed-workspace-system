// Mock bullmq Worker
jest.mock('bullmq', () => {
  const mockOn    = jest.fn();
  const mockClose = jest.fn().mockResolvedValue(undefined);

  const MockWorker = jest.fn().mockImplementation((name, processor, opts) => ({
    name,
    processor,
    opts,
    on:    mockOn,
    close: mockClose,
    // Bug fix: đây là worker instance, không phải workers Map
  }));

  return { Worker: MockWorker };
});

// Mock queueProducer để tránh kết nối Redis thật
jest.mock('../queue/queueProducer', () => ({
  connection: { status: 'ready' },
}));

const { Worker } = require('bullmq');
const { createWorker, closeAllWorkers } = require('../queue/queueWorker');

afterEach(() => {
  jest.clearAllMocks();
  closeAllWorkers().catch(() => {});
});

// ═══════════════════════════════════════════════════════════
// createWorker()
// ═══════════════════════════════════════════════════════════
describe('createWorker()', () => {
  const mockProcessor = jest.fn().mockResolvedValue('done');

  test('✅ Tạo Worker với đúng queueName và processor', () => {
    const worker = createWorker('file-queue', mockProcessor);

    expect(Worker).toHaveBeenCalledWith(
      'file-queue',
      mockProcessor,
      expect.objectContaining({ connection: { status: 'ready' } })
    );
    expect(worker).toBeDefined();
  });

  test('✅ Đăng ký event handlers failed và completed', () => {
    const worker = createWorker('folder-queue', mockProcessor);
    expect(worker.on).toHaveBeenCalledWith('failed',    expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
  });

  test('✅ opts được merge vào Worker options', () => {
    const customOpts = { concurrency: 5, limiter: { max: 10, duration: 1000 } };
    createWorker('workspace-queue', mockProcessor, customOpts);

    expect(Worker).toHaveBeenCalledWith(
      'workspace-queue',
      mockProcessor,
      expect.objectContaining(customOpts)
    );
  });

  test('✅ Gọi createWorker 2 lần cùng tên → trả cùng instance (cache)', () => {
    const w1 = createWorker('cached-queue', mockProcessor);
    const w2 = createWorker('cached-queue', mockProcessor);

    expect(w1).toBe(w2);
    // Worker constructor chỉ gọi 1 lần
    expect(Worker).toHaveBeenCalledTimes(1);
  });

  test('✅ Queue khác tên → tạo Worker riêng biệt', () => {
    const w1 = createWorker('queue-alpha', mockProcessor);
    const w2 = createWorker('queue-beta',  mockProcessor);

    expect(w1).not.toBe(w2);
    expect(Worker).toHaveBeenCalledTimes(2);
  });

  test('✅ failed event handler log lỗi khi job fail', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    createWorker('log-queue', mockProcessor);

    const failedHandler = Worker.mock.results[0].value.on.mock.calls
        .find(([event]) => event === 'failed')[1];

    failedHandler({ id: 'job-123' }, new Error('Processing failed'));

    // ✅ Argument 1 là 1 string gộp, argument 2 là Error object riêng
    expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('log-queue') &&
        expect.stringContaining('job-123'),
        expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test('✅ completed event handler log info khi job done', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    createWorker('done-queue', mockProcessor);

    const completedHandler = Worker.mock.results[0].value.on.mock.calls
        .find(([event]) => event === 'completed')[1];

    completedHandler({ id: 'job-456' });

    // ✅ Chỉ có 1 argument duy nhất là string gộp
    expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('done-queue') &&
        expect.stringContaining('job-456')
    );

    consoleSpy.mockRestore();
  });

  test('✅ failed handler xử lý job = undefined (null safe)', () => {
    createWorker('null-job-queue', mockProcessor);

    const failedHandler = Worker.mock.results[0].value.on.mock.calls
      .find(([event]) => event === 'failed')[1];

    // Không throw khi job là undefined
    expect(() => failedHandler(undefined, new Error('crash'))).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// closeAllWorkers()
// ═══════════════════════════════════════════════════════════
describe('closeAllWorkers()', () => {
  const mockProcessor = jest.fn();

  test('✅ Close tất cả workers trong cache', async () => {
    const w1 = createWorker('w1', mockProcessor);
    const w2 = createWorker('w2', mockProcessor);

    await closeAllWorkers();

    expect(w1.close).toHaveBeenCalled();
    expect(w2.close).toHaveBeenCalled();
  });

  test('✅ Sau closeAll — cache bị xóa, createWorker tạo Worker mới', async () => {
    createWorker('persist-queue', mockProcessor);
    expect(Worker).toHaveBeenCalledTimes(1);

    await closeAllWorkers();

    createWorker('persist-queue', mockProcessor);
    expect(Worker).toHaveBeenCalledTimes(2);
  });

  test('✅ closeAllWorkers không throw dù worker.close lỗi', async () => {
    const w = createWorker('fail-close', mockProcessor);
    w.close.mockRejectedValueOnce(new Error('Close error'));

    await expect(closeAllWorkers()).resolves.not.toThrow();
  });

  test('✅ closeAllWorkers khi không có worker nào — không lỗi', async () => {
    await closeAllWorkers(); // clear trước
    await expect(closeAllWorkers()).resolves.not.toThrow();
  });
});