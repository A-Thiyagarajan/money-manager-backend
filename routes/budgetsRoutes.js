const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Budget = require('../models/Budget');

router.use(auth);

// Get budget for year/month (defaults to current month)
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const bud = await Budget.findOne({ userId, year, month });
    res.json({ success: true, budget: bud });
  } catch (e) {
    console.error('Get budget error', e);
    res.status(500).json({ message: e.message });
  }
});

// Set or update budget for user/month
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { year, month, amount } = req.body;
    if (!year || !month || typeof amount !== 'number') {
      return res.status(400).json({ message: 'year, month and amount required' });
    }
    const filter = { userId, year, month };
    const update = { $set: { amount } };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    const result = await Budget.findOneAndUpdate(filter, update, opts);
    res.json({ success: true, budget: result });
  } catch (e) {
    console.error('Set budget error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
