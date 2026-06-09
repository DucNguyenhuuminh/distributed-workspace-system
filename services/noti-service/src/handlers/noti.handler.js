const {EVENTS} = require('shared');
const notificationService = require('../services/noti.service');
const { nodeKeyToRedisOptions } = require('ioredis/built/cluster/util');

const notiHandlers = {
  // ── File events ──────────────────────────────────────
  [EVENTS.FILE_MERGED]: async (job) => {
    const { uploadedBy, originalName, workspaceId } = job.data;
    if (!uploadedBy) {
      console.warn(`[NotiHandler] SKIP [FILE_MERGED]: Missing 'uploadedBy' for file "${originalName}"`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [FILE_MERGED]: Sending notification to user ${uploadedBy}`);
    await notificationService.createNotification({
      userId:    uploadedBy,
      actorId:   null,
      type:      'FILE_MERGED',
      title:     'Upload successful',
      message:   `File "${originalName}" has been uploaded successfully`,
      actionUrl: workspaceId ? `/workspaces/${workspaceId}` : '/',
      metadata:  { originalName, workspaceId },
    });
    console.log(`[NotiHandler] SUCCESS [FILE_MERGED]: Notification sent to user ${uploadedBy}`);
  },

  // ── Workspace events ──────────────────────────────────
  [EVENTS.WORKSPACE_CREATED]: async (job) => {
    const { workspaceId, createdBy, name } = job.data;
    if (!createdBy) {
      console.warn(`[NotiHandler] SKIP [WORKSPACE_CREATED]: Missing 'createdBy' for workspace "${name}"`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [WORKSPACE_CREATED]: Sending notification to user ${createdBy}`);
    await notificationService.createNotification({
      userId:    createdBy,
      actorId:   null,
      type:      'WORKSPACE_CREATED',
      title:     'Workspace has been created',
      message:   `Workspace "${name}" has been created successfully`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, name },
    });
    console.log(`[NotiHandler] SUCCESS [WORKSPACE_CREATED]: Notification sent to user ${createdBy}`);
  },

  [EVENTS.WORKSPACE_DELETED]: async (job) => {
    const { workspaceId, name, memberIds = [], actorId } = job.data;
    console.log(`[NotiHandler] PROCESSING [WORKSPACE_DELETED]: Sending bulk notifications to ${memberIds.length} members`);
    
    if (!memberIds.length) {
        console.warn(`[NotiHandler] SKIP [WORKSPACE_DELETED]: No members to notify`);
        return;
    }

    const notifications = memberIds.map((userId) => ({
      userId,
      actorId:   actorId || null,
      type:      'WORKSPACE_DELETED',
      title:     'Workspace has been deleted',
      message:   `Workspace "${name}" has been deleted`,
      actionUrl: `/workspaces`,
      metadata:  { workspaceId, name },
    }));

    await notificationService.createBulkNotifications(notifications);
    console.log(`[NotiHandler] SUCCESS [WORKSPACE_DELETED]: Bulk notifications sent to ${memberIds.length} members`);
  },

  [EVENTS.MEMBER_ADDED]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, actorId } = job.data;
    console.log(`[NotiHandler - MEMBER_ADDED] Check ID: targetUserId = ${targetUserId}`);
    
    if (!targetUserId) {
      console.warn(`[NotiHandler] SKIP [MEMBER_ADDED]: Missing 'targetUserId'`);
      return;
    }
    
    await notificationService.createNotification({
      userId:    targetUserId,
      actorId:   actorId || null,
      type:      'MEMBER_ADDED',
      title:     'You have been invited to a workspace',
      message:   `You have been added to the workspace "${workspaceName || workspaceId}"`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, workspaceName },
    });
    console.log(`[NotiHandler] SUCCESS [MEMBER_ADDED]: Notification sent to user ${targetUserId}`);
  },

  [EVENTS.MEMBER_REMOVED]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, removedBy } = job.data;

    if (!targetUserId) {
      console.warn(`[NotiHandler] SKIP [MEMBER_REMOVED]: Missing 'targetUserId'`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [MEMBER_REMOVED]: Notifying user ${targetUserId}`);
    await notificationService.createNotification({
      userId:   targetUserId,
      actorId:  removedBy || null,
      type:     'MEMBER_REMOVED',
      title:    'You have been removed from a workspace',
      message:  `You have been removed from the workspace "${workspaceName || workspaceId}"`,
      actionUrl: '/workspaces',
      metadata: { workspaceId, workspaceName },
    });
    console.log(`[NotiHandler] SUCCESS [MEMBER_REMOVED]: Notification sent to user ${targetUserId}`);
  },

  [EVENTS.MEMBER_PERMISSION]: async (job) => {
    const { workspaceId, targetUserId, workspaceName, newPermissions, actorId } = job.data;
    if (!targetUserId) {
      console.warn(`[NotiHandler] SKIP [MEMBER_PERMISSION]: Missing 'targetUserId'`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [MEMBER_PERMISSION]: Notifying user ${targetUserId}`);
    await notificationService.createNotification({
      userId:    targetUserId,
      actorId:   actorId || null,
      type:      'MEMBER_PERMISSION',
      title:     'Your permissions have been changed',
      message:   `Your permissions in the workspace "${workspaceName || workspaceId}" have been updated to "${newPermissions}"`,
      actionUrl: `/workspaces/${workspaceId}`,
      metadata:  { workspaceId, workspaceName, newPermissions },
    });
    console.log(`[NotiHandler] SUCCESS [MEMBER_PERMISSION]: Notification sent to user ${targetUserId}`);
  },

  // ── User events ───────────────────────────────────────
  [EVENTS.USER_REGISTERED]: async (job) => {
    const { userId, email } = job.data;

    if (!userId) {
      console.warn(`[NotiHandler] SKIP [USER_REGISTERED]: Missing 'userId' for email ${email}`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [USER_REGISTERED]: Sending welcome notification to user ${userId}`);
    await notificationService.createNotification({
      userId,
      actorId:  null,
      type:     'USER_REGISTERED',
      title:    'Welcome to CloudSpace!',
      message:  `Your account ${email} has been created successfully`,
      metadata: { email },
    });
    console.log(`[NotiHandler] SUCCESS [USER_REGISTERED]: Welcome notification sent to user ${userId}`);
  },
  
  [EVENTS.PASSWORD_RESET]: async (job) => {
    const {userId, email} = job.data;
    if (!userId) {
      console.warn(`[NotiHandler] SKIP [PASSWORD_RESET]: Missing 'userId' for email ${email}`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [PASSWORD_RESET]: Notifying user ${userId}`);
    await notificationService.createNotification({
      userId,
      actorId: null,
      type: 'PASSWORD_RESET',
      title: 'You have successfully changed your password',
      message: `Your account ${email} has successfully changed its password`,
      metadata: {email},
    });
    console.log(`[NotiHandler] SUCCESS [PASSWORD_RESET]: Notification sent to user ${userId}`);
  },

  // ── General ───────────────────────────────────────────
  [EVENTS.NOTIFY_USER]: async (job) => {
    const { userId, actorId, type, title, message, actionUrl, metadata } = job.data;
    if (!userId) {
      console.warn(`[NotiHandler] SKIP [NOTIFY_USER]: Missing 'userId'`);
      return;
    }

    console.log(`[NotiHandler] PROCESSING [NOTIFY_USER]: Sending general notification to user ${userId}`);
    await notificationService.createNotification({
      userId,
      actorId:   actorId   || null,
      type:      type || 'GENERAL',
      title,
      message,
      actionUrl: actionUrl || null,
      metadata:  metadata  || {},
    });
    console.log(`[NotiHandler] SUCCESS [NOTIFY_USER]: General notification sent to user ${userId}`);
  },
};

async function notificationProcessor(job) {
    const handler = notiHandlers[job.name];

    if (!handler) {
        console.warn(`[NotificationWorker] UNKNOWN EVENT: Job ${job.id} skipped. Event name '${job.name}' is not supported.`);
        return;
    }

    console.log(`[NotificationWorker] STARTING JOB ${job.id} | Event: ${job.name}`);

    try {
    await handler(job);
    console.log(`[NotificationWorker] COMPLETED JOB ${job.id} | Event: ${job.name}\n`);
  } catch (err) {
    console.error(`[NotificationWorker] FAILED JOB ${job.id} | Event: ${job.name}\n`);
    console.error(`[NotificationWorker] Error Details:`, err.message);
    if (err.stack) console.error(err.stack);
    throw err;
  }
}

module.exports = {notificationProcessor};