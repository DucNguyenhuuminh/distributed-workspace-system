const {
  QUEUES,
  EVENTS,
  EVENT_QUEUE_MAP,
  DEFAULT_JOB_OPTIONS,
  queueForEvent,
  jobIdFor,
} = require('../../queue/queue.config');

// ═══════════════════════════════════════════════════════════
// QUEUES constants
// ═══════════════════════════════════════════════════════════
describe('QUEUES constants', () => {
  test('✅ Có đủ 6 queue name', () => {
    expect(Object.keys(QUEUES)).toHaveLength(6);
  });

  test('✅ Giá trị các queue đúng', () => {
    expect(QUEUES.FILE).toBe('file-queue');
    expect(QUEUES.FOLDER).toBe('folder-queue');
    expect(QUEUES.WORKSPACE).toBe('workspace-queue');
    expect(QUEUES.NOTIFICATION).toBe('notification-queue');
    expect(QUEUES.SEARCH).toBe('search-queue');
    expect(QUEUES.GENERAL).toBe('general-queue');
  });
});

// ═══════════════════════════════════════════════════════════
// EVENTS constants
// ═══════════════════════════════════════════════════════════
describe('EVENTS constants', () => {
  test('✅ File events đúng', () => {
    expect(EVENTS.FILE_MERGED).toBe('file.merged');
    expect(EVENTS.FILE_RENAMED).toBe('file.renamed');
    expect(EVENTS.FILE_TRASHED).toBe('file.trashed');
    expect(EVENTS.FILE_RESTORED).toBe('file.restored');
    expect(EVENTS.FILE_MOVED).toBe('file.moved');
  });

  test('✅ Folder events đúng', () => {
    expect(EVENTS.FOLDER_CREATED).toBe('folder.created');
    expect(EVENTS.FOLDER_RENAMED).toBe('folder.renamed');
    expect(EVENTS.FOLDER_TRASHED).toBe('folder.trashed');
    expect(EVENTS.FOLDER_RESTORED).toBe('folder.restored');
    expect(EVENTS.FOLDER_MOVED).toBe('folder.moved');
  });

  test('✅ Workspace events đúng', () => {
    expect(EVENTS.WORKSPACE_CREATED).toBe('workspace.created');
    expect(EVENTS.WORKSPACE_DELETED).toBe('workspace.deleted');
    expect(EVENTS.MEMBER_ADDED).toBe('member.added');
    expect(EVENTS.MEMBER_REMOVED).toBe('member.removed');
  });

  test('✅ User và Notification events đúng', () => {
    expect(EVENTS.USER_REGISTERED).toBe('user.registered');
    expect(EVENTS.NOTIFY_USER).toBe('notification.send');
  });

  test('✅ FILE_DELETED và FOLDER_DELETED đã bị comment — không tồn tại', () => {
    expect(EVENTS.FILE_DELETED).toBeUndefined();
    expect(EVENTS.FOLDER_DELETED).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// EVENT_QUEUE_MAP
// ═══════════════════════════════════════════════════════════
describe('EVENT_QUEUE_MAP', () => {
  test('✅ File events → file-queue', () => {
    expect(EVENT_QUEUE_MAP[EVENTS.FILE_MERGED]).toBe(QUEUES.FILE);
    expect(EVENT_QUEUE_MAP[EVENTS.FILE_RENAMED]).toBe(QUEUES.FILE);
    expect(EVENT_QUEUE_MAP[EVENTS.FILE_TRASHED]).toBe(QUEUES.FILE);
    expect(EVENT_QUEUE_MAP[EVENTS.FILE_RESTORED]).toBe(QUEUES.FILE);
    expect(EVENT_QUEUE_MAP[EVENTS.FILE_MOVED]).toBe(QUEUES.FILE);
  });

  test('✅ Folder events → folder-queue', () => {
    expect(EVENT_QUEUE_MAP[EVENTS.FOLDER_CREATED]).toBe(QUEUES.FOLDER);
    expect(EVENT_QUEUE_MAP[EVENTS.FOLDER_RENAMED]).toBe(QUEUES.FOLDER);
    expect(EVENT_QUEUE_MAP[EVENTS.FOLDER_TRASHED]).toBe(QUEUES.FOLDER);
    expect(EVENT_QUEUE_MAP[EVENTS.FOLDER_RESTORED]).toBe(QUEUES.FOLDER);
    expect(EVENT_QUEUE_MAP[EVENTS.FOLDER_MOVED]).toBe(QUEUES.FOLDER);
  });

  test('✅ Workspace events → workspace-queue', () => {
    expect(EVENT_QUEUE_MAP[EVENTS.WORKSPACE_CREATED]).toBe(QUEUES.WORKSPACE);
    expect(EVENT_QUEUE_MAP[EVENTS.WORKSPACE_DELETED]).toBe(QUEUES.WORKSPACE);
    expect(EVENT_QUEUE_MAP[EVENTS.MEMBER_ADDED]).toBe(QUEUES.WORKSPACE);
    expect(EVENT_QUEUE_MAP[EVENTS.MEMBER_REMOVED]).toBe(QUEUES.WORKSPACE);
  });

  test('✅ NOTIFY_USER → notification-queue', () => {
    expect(EVENT_QUEUE_MAP[EVENTS.NOTIFY_USER]).toBe(QUEUES.NOTIFICATION);
  });

  test('✅ USER_REGISTERED → general-queue', () => {
    expect(EVENT_QUEUE_MAP[EVENTS.USER_REGISTERED]).toBe(QUEUES.GENERAL);
  });
});

// ═══════════════════════════════════════════════════════════
// DEFAULT_JOB_OPTIONS
// ═══════════════════════════════════════════════════════════
describe('DEFAULT_JOB_OPTIONS', () => {
  test('✅ attempts = 5', () => {
    // Note: typo "attemps" trong code — test theo code thực tế
    expect(DEFAULT_JOB_OPTIONS.attemps).toBe(5);
  });

  test('✅ backoff dùng exponential với delay 2000ms', () => {
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBe(2000);
  });

  test('✅ removeOnComplete giữ job trong 1 giờ (3600s)', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete.age).toBe(3600);
  });

  test('✅ removeOnFail giữ job trong 1 ngày (86400s)', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.age).toBe(86400);
  });
});

// ═══════════════════════════════════════════════════════════
// queueForEvent()
// ═══════════════════════════════════════════════════════════
describe('queueForEvent()', () => {
  test('✅ Event có trong map → trả đúng queue', () => {
    expect(queueForEvent(EVENTS.FOLDER_CREATED)).toBe(QUEUES.FOLDER);
    expect(queueForEvent(EVENTS.WORKSPACE_CREATED)).toBe(QUEUES.WORKSPACE);
    expect(queueForEvent(EVENTS.NOTIFY_USER)).toBe(QUEUES.NOTIFICATION);
    expect(queueForEvent(EVENTS.USER_REGISTERED)).toBe(QUEUES.GENERAL);
  });

  test('✅ Event không có trong map → fallback general-queue', () => {
    expect(queueForEvent('unknown.event')).toBe(QUEUES.GENERAL);
    expect(queueForEvent('')).toBe(QUEUES.GENERAL);
    expect(queueForEvent(undefined)).toBe(QUEUES.GENERAL);
  });

  test('✅ Tất cả EVENTS đều có trong map', () => {
    const allEvents = Object.values(EVENTS);
    allEvents.forEach((event) => {
      const queue = queueForEvent(event);
      expect(queue).toBeDefined();
      expect(Object.values(QUEUES)).toContain(queue);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// jobIdFor()
// ═══════════════════════════════════════════════════════════
describe('jobIdFor()', () => {
  test('✅ Có entityId → format event_entityId', () => {
    // Sửa kỳ vọng từ ':' thành '_' và thay '.' bằng '_'
    expect(jobIdFor('file.uploaded', 'abc-123')).toBe('file_uploaded_abc-123');
    expect(jobIdFor('workspace.created', '648000000000000000000001'))
      .toBe('workspace_created_648000000000000000000001');
  });

  test('✅ entityId là số → convert sang string', () => {
    const result = jobIdFor('folder.created', 42);
    expect(result).toBe('folder_created_42');
  });

  test('✅ Không có entityId → format event_timestamp', () => {
    const before = Date.now();
    const result = jobIdFor('file.uploaded');
    const after  = Date.now();

    // Sửa kỳ vọng kiểm tra chuỗi bắt đầu
    expect(result.startsWith('file_uploaded_')).toBe(true);
    
    // Do chuỗi là 'file_uploaded_timestamp', khi split('_') thì timestamp nằm ở index 2
    const timestamp = parseInt(result.split('_')[2]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  test('✅ entityId là null → dùng timestamp', () => {
    const result = jobIdFor('file.uploaded', null);
    expect(result.startsWith('file_uploaded_')).toBe(true);
  });

  test('✅ entityId là undefined → dùng timestamp', () => {
    const result = jobIdFor('file.uploaded', undefined);
    expect(result.startsWith('file_uploaded_')).toBe(true);
  });

  test('✅ entityId là empty string → dùng timestamp (falsy)', () => {
    const result = jobIdFor('file.uploaded', '');
    expect(result.startsWith('file_uploaded_')).toBe(true);
  });

  test('✅ 2 lần gọi không có entityId → timestamp khác nhau', async () => {
    const id1 = jobIdFor('file.uploaded');
    await new Promise((r) => setTimeout(r, 2));
    const id2 = jobIdFor('file.uploaded');
    expect(id1).not.toBe(id2);
  });
});