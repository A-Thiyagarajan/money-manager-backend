const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const BillReminder = require('../models/BillReminder');
const Notification = require('../models/Notification');

router.use(auth);

// List reminders
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const reminders = await BillReminder.find({ userId }).sort({ dueDate: 1 });
    res.json({ success: true, reminders });
  } catch (e) {
    console.error('List reminders error', e);
    res.status(500).json({ message: e.message });
  }
});

// Add reminder
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, amount, dueDate } = req.body;
    if (!name || !amount || !dueDate) return res.status(400).json({ message: 'name, amount, dueDate required' });
    const rem = new BillReminder({ userId, name, amount, dueDate });
    await rem.save();
    res.json({ success: true, reminder: rem });
  } catch (e) {
    console.error('Add reminder error', e);
    res.status(500).json({ message: e.message });
  }
});

// Dismiss reminder
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const id = req.params.id;
    await BillReminder.deleteOne({ _id: id, userId });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete reminder error', e);
    res.status(500).json({ message: e.message });
  }
});

// Run check for due reminders within next 7 days. This endpoint can be called by frontend at login.
router.post('/check-due', async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Check for bills due within next 7 days
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const dueSoon = await BillReminder.find({ 
      userId, 
      dueDate: { $gte: today, $lte: sevenDaysFromNow } 
    });

    // Notifications are now generated dynamically in the frontend Notifications component
    // instead of being created here, so this endpoint just returns success

    res.json({ success: true, created: dueSoon.length });
  } catch (e) {
    console.error('Check due error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
