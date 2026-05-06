const {EVENTS} = require('shared');
const notificationService = require('../services/noti.service');

const notiHandlers = {
    [EVENTS.NOTIFY_USER]: async (job) => {
        const {userId, actorId, type, title, message, actionUrl, metadata} = job.data;
        console.log(`[NotificationHandler] NOTIFY_USER - userId: ${userId}`);

        await notificationService.createNotification({
            userId,
            actorId: actorId || null,
            type: type || 'GENERAL', 
            title,
            message,
            actionUrl: actionUrl || null,
            metadata: metadata || {},
        });
    },
    'notification.send_bulk': async (job) => {
        const {notifications} = job.data;
        console.log(`[NotificationHandler] SEND_BULK - total: ${notifications.length}`);
        await notificationService.createBulkNotifications(notifications);
    }
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