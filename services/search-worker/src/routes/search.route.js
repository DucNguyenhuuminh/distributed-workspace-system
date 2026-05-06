const router = require('express').Router();
const { search }         = require('../controllers/search.controller');
const { authMiddleware } = require('shared');

router.get('/', authMiddleware, search);

module.exports = router;