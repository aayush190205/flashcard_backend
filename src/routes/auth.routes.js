const express = require('express');
const router = express.Router();
const { syncUser } = require('../controllers/auth.controller');

// POST /api/auth/sync
router.post('/sync', syncUser);

module.exports = router;