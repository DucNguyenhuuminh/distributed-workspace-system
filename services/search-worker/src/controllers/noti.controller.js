const Notification = require('../models/noti.model');

//-------------GET /api/notifications---------------
async function getNotifications(req,res) {
    try {
        const userId = req.user.userId;
        const {page=1, limit=20, unreadOnly} = req.query;

        const query = {userId};
        if (unreadOnly === 'true') {
            query.isRead = false;
        }

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query).sort({createdAt: -1}).skip((page-1)*limit).limit(parseInt(limit)),
            Notification.countDocuments(query),
            Notification.countDocuments({userId, isRead: false}),
        ]);

        return res.json({
            data: {
                notifications, 
                pagination: {
                    page: parseInt(page), 
                    limit: parseInt(limit), 
                    total, 
                    totalPages: Math.ceil(total/limit),
                },
                unreadCount,
            },
        });
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------------PATCH /api/notifications/:id/read---------------
async function markAsRead(req,res) {
    try {
        const userId = req.user.userId;
        const {id} = req.params;

        const notification = await Notification.findOneAndUpdate(
            {_id: id, userId},
            {isRead: true},
            {new: true}
        );

        if (!notification) {
            return res.status(404).json({message: 'Notification not exists'});
        }

        return res.json({message: 'Marked as read', data: notification});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------------PATCH /api/notifications/read-all---------------
async function markAllAsRead(req,res) {
    try {
        const userId = req.user.userId;

        const result = await Notification.updateMany(
            {userId, isRead: false},
            {isRead: true}
        );

        return res.json({message: 'All marked as read', modifiedCount: result.modifiedCount});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

//-------------DELETE /api/notifications/:id---------------
async function deleteNotification(req,res) {
    try {
        const userId = req.user.userId;
        const {id} = req.params;

        const notification = await Notification.findOneAndDelete({_id: id, userId});
        if (!notification) {
            return res.status(404).json({message: 'Notification not exists'});
        }

        return res.json({message: 'Delete noti successfully'});
    } catch(err) {
        return res.status(500).json({message: err.message});
    }
}

module.exports = {
    getNotifications, 
    markAllAsRead, 
    markAsRead, 
    deleteNotification
}