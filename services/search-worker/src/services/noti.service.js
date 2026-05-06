const Notification = require('../models/noti.model');

async function createNotification({userId, actorId, type, title, message, actionUrl, metadata = {}}) {
    const noti = await Notification.create({
        userId,
        actorId,
        type,
        title,
        message,
        actionUrl,
        metadata,
    });
    console.log(`[NotificationService] Created notification for user ${userId}`);
    return noti;
}

async function createBulkNotifications(notifications) {
    if (!notifications.length) return;
    await Notification.insertMany(notifications);
    console.log(`[NotificationService] Created ${notifications.length} notifications`);
}

module.exports = {createNotification, createBulkNotifications};