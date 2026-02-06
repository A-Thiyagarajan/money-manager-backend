const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Session = require('../models/Session');
const User = require('../models/User');

// Protect all
router.use(auth);

// Get sessions for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const sessions = await Session.find({ userId }).sort({ lastActiveAt: -1 });
    res.json({ success: true, sessions });
  } catch (e) {
    console.error('Get sessions error', e);
    res.status(500).json({ message: e.message });
  }
});

// Logout current session
router.delete('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.user.sessionId;
    await Session.deleteOne({ sessionId, userId });
    await User.updateOne({ _id: userId }, { $pull: { sessions: { sessionId } } });
    res.json({ success: true, message: 'Logged out' });
  } catch (e) {
    console.error('Logout me error', e);
    res.status(500).json({ message: e.message });
  }
});

// Logout specific session (device)
router.delete('/:sessionId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    // only allow user to delete own sessions
    await Session.deleteOne({ sessionId, userId });
    await User.updateOne({ _id: userId }, { $pull: { sessions: { sessionId } } });
    res.json({ success: true, message: 'Session removed' });
  } catch (e) {
    console.error('Delete session error', e);
    res.status(500).json({ message: e.message });
  }
});

// Logout from all devices
router.delete('/', async (req, res) => {
  try {
    const userId = req.user.id;
    await Session.deleteMany({ userId });
    await User.updateOne({ _id: userId }, { $set: { sessions: [] } });
    res.json({ success: true, message: 'All sessions removed' });
  } catch (e) {
    console.error('Logout all error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
