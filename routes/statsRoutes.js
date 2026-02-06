const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');

router.use(auth);

// Monthly income & expense summary
router.get('/month-summary', async (req, res) => {
  try {
    const userId = req.user.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(401).json({ message: 'Invalid user' });
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const agg = await Transaction.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: start, $lte: end } } },
      { $group: { _id: "$type", total: { $sum: "$amount" } } }
    ]);

    let income = 0, expense = 0;
    for (const a of agg) {
      if (/income/i.test(a._id)) income += a.total;
      else if (/expense/i.test(a._id)) expense += a.total;
    }
    res.json({ success: true, income, expense });
  } catch (e) {
    console.error('Month summary error', e);
    // return safe empty summary instead of 500 to avoid frontend breakage
    res.json({ success: false, income: 0, expense: 0, message: e.message });
  }
});

// Category-wise expense breakdown
router.get('/category-breakdown', async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const agg = await Transaction.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: start, $lte: end }, type: { $regex: /^expense$/i } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } }
    ]);
    const total = agg.reduce((s, x) => s + (x.total || 0), 0);
    const breakdown = agg.map(x => ({ category: x._id || 'Uncategorized', total: x.total, percent: total ? Math.round((x.total / total) * 10000) / 100 : 0 }));
    res.json({ success: true, total, breakdown });
  } catch (e) {
    console.error('Category breakdown error', e);
    res.status(500).json({ message: e.message });
  }
});

// Charts: daily for current week, weekly for month, monthly for year
router.get('/chart', async (req, res) => {
  try {
    const userId = req.user.id;
    const type = req.query.type || 'daily'; // daily | weekly | monthly
    const now = new Date();

    if (type === 'daily') {
      // current week (Mon-Sun)
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      monday.setHours(0,0,0,0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23,59,59,999);

      let agg = [];
      try {
        agg = await Transaction.aggregate([
          { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: monday, $lte: sunday }, type: { $regex: /^expense$/i } } },
          { $group: { _id: { $dayOfWeek: "$date" }, total: { $sum: "$amount" } } }
        ]);
      } catch (errAgg) {
        console.error('Daily chart aggregation failed', errAgg);
        return res.json({ success: false, labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], data: [0,0,0,0,0,0,0] });
      }
      const map = {};
      agg.forEach(a => { map[a._id] = a.total; });
      // dayOfWeek: 1(Sun) ..7
      const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const data = labels.map((_, i) => map[i+1] || 0);
      return res.json({ success: true, labels, data });
    }

    if (type === 'weekly') {
      // weekly totals for current month: weeks indexed by week number
      const year = now.getFullYear();
      const month = now.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month+1, 0, 23,59,59,999);
      let agg = [];
      try {
        agg = await Transaction.aggregate([
          { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: start, $lte: end }, type: { $regex: /^expense$/i } } },
          { $group: { _id: { $isoWeek: "$date" }, total: { $sum: "$amount" } } },
          { $sort: { _id: 1 } }
        ]);
      } catch (errAgg) {
        console.error('Weekly chart aggregation failed', errAgg);
        return res.json({ success: false, labels: [], data: [] });
      }
      const labels = agg.map(a => `W${a._id}`);
      const data = agg.map(a => a.total);
      return res.json({ success: true, labels, data });
    }

    // monthly
    if (type === 'monthly') {
      const year = now.getFullYear();
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23,59,59,999);
      let agg = [];
      try {
        agg = await Transaction.aggregate([
          { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: start, $lte: end }, type: { $regex: /^expense$/i } } },
          { $group: { _id: { $month: "$date" }, total: { $sum: "$amount" } } },
          { $sort: { _id: 1 } }
        ]);
      } catch (errAgg) {
        console.error('Monthly chart aggregation failed', errAgg);
        return res.json({ success: false, labels: [], data: [] });
      }
      const labels = agg.map(a => `M${a._id}`);
      const data = agg.map(a => a.total);
      return res.json({ success: true, labels, data });
    }

    res.status(400).json({ message: 'Unknown chart type' });
  } catch (e) {
    console.error('Chart error', e);
    res.status(500).json({ message: e.message });
  }
});

// Highest spending category for a month
router.get('/highest-category', async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const agg = await Transaction.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId), date: { $gte: start, $lte: end }, type: { $regex: /^expense$/i } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]);
    if (!agg[0]) return res.json({ success: true, category: null, total: 0 });
    res.json({ success: true, category: agg[0]._id || 'Uncategorized', total: agg[0].total });
  } catch (e) {
    console.error('Highest category error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
