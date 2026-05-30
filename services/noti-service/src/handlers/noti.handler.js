const {EVENTS} = require('shared');
const notificationService = require('../services/noti.service');
const { nodeKeyToRedisOptions } = require('ioredis/built/cluster/util');

const notiHandlers = {
    // ── File events ──────────────────────────────────────
  [EVENTS.FILE_MERGED]: async (job) => {
    const { uploadedBy, originalName, workspaceId } = job.data;
    await notificationService.createNotification({
      userId:    uploadedBy,
      actorId:   null,
      type:      'FILE_MERGED',
      title:     'Upload thành công',
      message:   `File "${originalName}" đã được tải lên thành công`,
      actionUrl: workspaceId ? `/workspaces/${workspaceId}` : '/',
      metadata:  { originalName, workspaceId },
    });
  },

  // ── Workspace events ──────────────────────────────────
  [EVENTS.WORKSPACE_CREATED]: async (job) => {
    const { workspaceId, createdBy, name } = job.data;
    await notificationService.createNotification({
      userId:    createdBy,
      actorId:   null,
      type:      'WORKSPACE_CREATED',
      title:     'Workspace đã được tạo',
      message:   `Workspace "${name}" đã được tạo thành công`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, name },
    });
  },

  [EVENTS.WORKSPACE_DELETED]: async (job) => {
    const { workspaceId, name, memberIds = [], actorId } = job.data;
    if (!memberIds.length) return;

    const notifications = memberIds.map((userId) => ({
      userId,
      actorId:   actorId || null,
      type:      'WORKSPACE_DELETED',
      title:     'Workspace đã bị xóa',
      message:   `Workspace "${name}" đã bị giải tán`,
      actionUrl: `/workspaces`,
      metadata:  { workspaceId, name },
    }));

    await notificationService.createBulkNotifications(notifications);
  },

  [EVENTS.MEMBER_ADDED]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, actorId } = job.data;
    if (!targetUserId)  return;
    
    await notificationService.createNotification({
      userId:    targetUserId,
      actorId:   actorId || null,
      type:      'MEMBER_ADDED',
      title:     'Bạn được mời vào workspace',
      message:   `Bạn đã được thêm vào workspace "${workspaceName || workspaceId}"`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, workspaceName },
    });
  },

  [EVENTS.MEMBER_REMOVED]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, removedBy } = job.data;
    await notificationService.createNotification({
      userId:   targetUserId,
      actorId:  removedBy || null,
      type:     'MEMBER_REMOVED',
      title:    'Bạn đã bị xóa khỏi workspace',
      message:  `Bạn đã bị xóa khỏi workspace "${workspaceName || workspaceId}"`,
      actionUrl: '/workspaces',
      metadata: { workspaceId, workspaceName },
    });
  },

  [EVENTS.MEMBER_PERMISSION]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, newPermissions, actorId } = job.data;
    await notificationService.createNotification({
      userId:    targetUserId,
      actorId:   actorId || null,
      type:      'MEMBER_PERMISSION',
      title:     'Quyền của bạn đã thay đổi',
      message:   `Quyền của bạn trong workspace "${workspaceName || workspaceId}" đã được đổi thành "${newPermissions}"`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, workspaceName, newPermissions },
    });
  },

  // ── User events ───────────────────────────────────────
  [EVENTS.USER_REGISTERED]: async (job) => {
    const { userId, email } = job.data;
    await notificationService.createNotification({
      userId,
      actorId:  null,
      type:     'USER_REGISTERED',
      title:    'Chào mừng bạn!',
      message:  `Tài khoản ${email} đã được tạo thành công`,
      metadata: { email },
    });
  },
  
  [EVENTS.PASSWORD_RESET]: async (job) => {
    const {userId, email} = job.data;
    await notificationService.createNotification({
      userId,
      actorId: null,
      type: 'PASSWORD_RESET',
      title: 'Bạn đã thay đổi mật khẩu thành công',
      message: `Tài khoản ${email} đã thay đổi mật khẩu thành công`,
      metadata: {email},
    })
  },

  // ── General ───────────────────────────────────────────
  [EVENTS.NOTIFY_USER]: async (job) => {
    const { userId, actorId, type, title, message, actionUrl, metadata } = job.data;
    await notificationService.createNotification({
      userId,
      actorId:   actorId   || null,
      type:      type || 'GENERAL',
      title,
      message,
      actionUrl: actionUrl || null,
      metadata:  metadata  || {},
    });
  },
};

async function notificationProcessor(job) {
    const handler = notiHandlers[job.name];

    if (!handler) {
        console.warn(`[NotificationHandler] Unknown event: ${job.name}`);
        return;
    }

    try {
    await handler(job);
  } catch (err) {
    console.error(`[NotificationHandler] Error processing ${job.name}:`, err.message);
    throw err;
  }
}

module.exports = {notificationProcessor};