const router = require('express').Router();
const {markAllAsRead, markAsRead, deleteNotification, getNotifications} = require('../controllers/noti.controller');
const {authMiddleware} = require('shared');

router.use(authMiddleware);
router.get('/',                 getNotifications);
router.patch('/read-all',   markAllAsRead);
router.delete('/:id',           deleteNotification);
router.patch('/:id/read',       markAsRead);

module.exports = router;