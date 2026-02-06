const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

router.use(auth);

// List notifications (most recent first) - ONLY UNREAD
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const notes = await Notification.find({ userId, read: false }).sort({ createdAt: -1 });
    const unreadCount = notes.length;
    res.json({ success: true, notifications: notes, unreadCount });
  } catch (e) {
    console.error('Notifications list error', e);
    res.status(500).json({ message: e.message });
  }
});

// Mark notification as read
router.post('/read/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const id = req.params.id;
    // If id is not a valid ObjectId (e.g., local-only ids like 'budget-exceed-2026-2'),
    // skip server update and return success so clients don't see a 500 error.
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ success: true, skipped: true });
    }
    await Notification.updateOne({ _id: id, userId }, { $set: { read: true } });
    res.json({ success: true });
  } catch (e) {
    console.error('Mark read error', e);
    res.status(500).json({ message: e.message });
  }
});

// Create a new notification (used by clients that want to push a server notification)
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, body, type } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title required' });
    // Deduplicate: if a notification with same title+body exists for this user in recent history, return it
    const existing = await Notification.findOne({ userId, title: title, body: body || '' }).sort({ createdAt: -1 });
    if (existing) {
      return res.json({ success: true, notification: existing, duplicated: true });
    }
    const note = new Notification({ userId, title, body: body || '', type: type || 'info' });
    await note.save();
    res.json({ success: true, notification: note });
  } catch (e) {
    console.error('Create notification error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
