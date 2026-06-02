const Notification = require('../models/noti.model');

async function createNotification({userId, actorId, type, title, message, actionUrl, metadata = {}}) {
    try {
        console.log(`[NotificationService] Saving DB for User: "${userId}" | Type: ${type}`);
        
        if (!userId) {
            console.warn(`[NotificationService] Warning: userId is missing.`);
        }

        const noti = await Notification.create({
            userId,
            actorId,
            type,
            title,
            message,
            actionUrl,
            metadata,
        });
        
        console.log(`[NotificationService] Save successful! Notification ID: ${noti._id}`);
        return noti;
    } catch (err) {
        console.error(`[NotificationService] MONGODB ERROR WHEN SAVING:`, err.message);
        throw err;
    }
}

async function createBulkNotifications(notifications) {
    if (!notifications || !notifications.length) {
        console.log(`[NotificationService] Notifications array is empty, skipping insertMany.`);
        return;
    }
    
    try {
        console.log(`[NotificationService] Saving DB in bulk (${notifications.length} notifications)...`);
        await Notification.insertMany(notifications);
        console.log(`[NotificationService] BULK SAVE SUCCESSFUL!`);
    } catch (err) {
        console.error(`[NotificationService] MONGODB ERROR WHEN SAVING BULK:`, err.message);
        throw err;
    }
}

module.exports = {createNotification, createBulkNotifications};