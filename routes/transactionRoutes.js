const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const auth = require("../middleware/auth");
const Budget = require("../models/Budget");
const Notification = require("../models/Notification");

// Protect all transaction routes
router.use(auth);

// Add transaction - POST /transactions/add
router.post("/add", async (req, res) => {
  try {
    const userId = req.user.id;
    const { ...transactionData } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const transaction = new Transaction({ userId, ...transactionData });
    transaction.username = user.username;
    await transaction.save();

    // After saving transaction, check budget exceed for the month if it's an expense
    try {
      if (transaction.type && transaction.type.toLowerCase() === 'expense') {
        const txDate = new Date(transaction.date || Date.now());
        const y = txDate.getFullYear();
        const m = txDate.getMonth() + 1;
        // Sum expenses for that user/month
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0, 23, 59, 59, 999);
        const agg = await Transaction.aggregate([
          { $match: { userId: require('mongoose').Types.ObjectId(userId), type: { $regex: /^expense$/i }, date: { $gte: start, $lte: end } } },
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalExpense = (agg[0] && agg[0].total) || 0;
        const bud = await Budget.findOne({ userId, year: y, month: m });
        if (bud && bud.amount > 0 && totalExpense > bud.amount) {
          // create alert notification
          await Notification.create({ userId, type: 'budget', title: `Budget exceeded for ${m}/${y}`, body: `You spent ${totalExpense} which exceeds your budget of ${bud.amount}`, data: { year: y, month: m, totalExpense, budget: bud.amount } });
        }
      }
    } catch (e) {
      console.error('Budget check error', e);
    }
    res.status(201).json({ success: true, transaction: { ...transaction.toObject(), username: user.username } });
  } catch (error) {
    console.error("Error adding transaction:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all transactions with filters (category, division, account, date range)
// GET /transactions?start=...&end=...&category=...&division=...&account=...
router.get("/", async (req, res) => {
  try {
    const { start, end, category, division, account } = req.query;
    const userId = req.user.id;
    console.log("Authenticated user id (req.user.id):", userId);
    // Use the string userId directly; Mongoose will cast to ObjectId where needed.
    const filter = { userId };

    // Date range filter
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
      console.log("Date filter:", { startDate, endDate });
    }

    // Category filter
    if (category && category !== "") {
      filter.category = category;
    }

    // Division filter
    if (division && division !== "") {
      filter.division = division;
    }

    // Account filter (case-insensitive substring match for transfers like "A → B")
    if (account && account !== "") {
      filter.account = { $regex: account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    console.log("MongoDB filter object:", filter);
    const transactions = await Transaction.find(filter).sort({ date: -1 });
    console.log(`Found ${transactions.length} transactions for user ${userId}`);
    if (transactions.length > 0) {
      console.log("First transaction userId:", transactions[0].userId.toString());
    }
    res.json(transactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ message: error.message });
  }
});

// Update transaction (within 12 hours)
// PUT /transactions/:id
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.userId.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const hoursDiff = (Date.now() - new Date(transaction.date)) / (1000 * 60 * 60);

    if (hoursDiff > 12) {
      return res.status(403).json({ message: "Edit time expired" });
    }

    // Prevent changing ownership
    if (req.body.userId) delete req.body.userId;
    const updated = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (error) {
    console.error("Error updating transaction:", error);
    res.status(500).json({ message: error.message });
  }
});

// Delete transaction
// DELETE /transactions/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    if (transaction.userId.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const deleted = await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Transaction deleted", deleted });
  } catch (error) {
    console.error("Error deleting transaction:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
