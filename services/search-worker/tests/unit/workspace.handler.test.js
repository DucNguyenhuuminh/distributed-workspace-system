const { workspaceProcessor } = require('../../src/handlers/workspace.handler');
const chromaService = require('../../src/config/chroma.config');
const { EVENTS, addJob, jobIdFor, QUEUES } = require('shared');

// ── 1. MOCK TẤT CẢ MODULES BÊN NGOÀI ─────────────────────────────
jest.mock('shared', () => ({
  EVENTS: {
    WORKSPACE_CREATED: 'workspace.created',
    WORKSPACE_DELETED: 'workspace.deleted',
  },
  QUEUES: { NOTIFICATION: 'notification_queue' },
  DEFAULT_JOB_OPTIONS: { attempts: 3 },
  // Giả lập hàm jobIdFor trả về dạng "prefix:id"
  jobIdFor: jest.fn((prefix, id) => `${prefix}:${id}`),
  // Giả lập addJob thành công
  addJob: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/config/chroma.config', () => ({
  deleteByWorkspace: jest.fn()
}));

// ── 2. SETUP DATA VÀ TEST SUITE ──────────────────────────────────
describe('Workspace Handler Processor', () => {
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
  // LUỒNG CHÍNH VÀ BẮT LỖI
  // ═══════════════════════════════════════════════════════════
  test('❌ Bỏ qua và cảnh báo nếu event không xác định', async () => {
    const jobData = { foo: 'bar' };
    await workspaceProcessor({ name: 'workspace.magic', data: jobData });
    
    // Lưu ý: console.warn của bạn truyền 2 tham số (string và object)
    expect(console.warn).toHaveBeenCalledWith(
      '[WorkspaceHandler] Unknown event: workspace.magic -data: ', 
      jobData
    );
  });

  test('❌ Ném lỗi và log error chuẩn xác nếu Handler nội bộ crash', async () => {
    chromaService.deleteByWorkspace.mockRejectedValueOnce(new Error('Chroma Down'));

    await expect(
      workspaceProcessor({ name: EVENTS.WORKSPACE_DELETED, data: { workspaceId: 'ws-1' } })
    ).rejects.toThrow('Chroma Down');
    
    // Kiểm tra định dạng log error mới (là một Object chứa workspaceId, error, stack)
    expect(console.error).toHaveBeenCalledWith(
      `[WorkspaceHandler] Error processing ${EVENTS.WORKSPACE_DELETED}:`,
      expect.objectContaining({
        workspaceId: 'ws-1',
        error: 'Chroma Down',
        stack: expect.any(String) // Stack trace là chuỗi ngẫu nhiên
      })
    );
  });

  // ═══════════════════════════════════════════════════════════
  // SỰ KIỆN CHI TIẾT
  // ═══════════════════════════════════════════════════════════
  test('✅ WORKSPACE_CREATED - Log đúng và forward qua Notification', async () => {
    const job = { name: EVENTS.WORKSPACE_CREATED, data: { workspaceId: 'ws-1', createdBy: 'user-99' } };
    
    await workspaceProcessor(job);
    
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] WORKSPACE_CREATED — ws-1 by user-99');
    
    // Kiểm tra hàm addJob được gọi với đúng tham số
    expect(addJob).toHaveBeenCalledWith(
      QUEUES.NOTIFICATION,
      EVENTS.WORKSPACE_CREATED,
      job.data,
      expect.objectContaining({
        attempts: 3,
        jobId: `${EVENTS.WORKSPACE_CREATED}_noti:ws-1`
      })
    );
    expect(console.log).toHaveBeenCalledWith(`[WorkspaceHandler] Redirect ${EVENTS.WORKSPACE_CREATED} to notification-queue`);
  });

  test('✅ WORKSPACE_DELETED - Xóa ChromaDB và forward qua Notification', async () => {
    const job = { name: EVENTS.WORKSPACE_DELETED, data: { workspaceId: 'ws-2', name: 'Dev Team', actorId: 'u1' } };
    
    await workspaceProcessor(job);
    
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] WORKSPACE_DELETED — ws-2');
    expect(chromaService.deleteByWorkspace).toHaveBeenCalledWith('ws-2');
    expect(console.log).toHaveBeenCalledWith('[WorkspaceHandler] Deleted all vectors for workspace: ws-2');
    
    expect(addJob).toHaveBeenCalledWith(
      QUEUES.NOTIFICATION,
      EVENTS.WORKSPACE_DELETED,
      job.data,
      expect.objectContaining({
        jobId: `${EVENTS.WORKSPACE_DELETED}_noti:ws-2`
      })
    );
  });

  // ═══════════════════════════════════════════════════════════
  // KIỂM TRA LUỒNG FORWARD (CORNER CASES)
  // ═══════════════════════════════════════════════════════════
  test('✅ forwardToNotification - Bắt lỗi an toàn nếu Redis/Queue sập (Không crash App)', async () => {
    addJob.mockRejectedValueOnce(new Error('Redis Queue Down'));
    const job = { name: EVENTS.WORKSPACE_CREATED, data: { workspaceId: 'ws-1' } };

    // Sẽ KHÔNG văng lỗi ra ngoài nhờ try-catch trong forwardToNotification
    await workspaceProcessor(job);

    expect(console.error).toHaveBeenCalledWith(
      `[NotificationHandler] Error redirecting ${EVENTS.WORKSPACE_CREATED} to notification-queue:`,
      'Redis Queue Down'
    );
  });

  test('✅ forwardToNotification - Fallback dùng Date.now() nếu thiếu workspaceId', async () => {
    const job = { name: EVENTS.WORKSPACE_CREATED, data: { createdBy: 'u1' } }; // Không có workspaceId
    
    await workspaceProcessor(job);

    // Kiểm tra xem tham số thứ 2 truyền vào jobIdFor có phải là một số Number (từ Date.now()) không
    expect(jobIdFor).toHaveBeenCalledWith(`${EVENTS.WORKSPACE_CREATED}_noti`, expect.any(Number));
  });
});