const express = require("express");
const router = express.Router();
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Session = require("../models/Session");
const auth = require("../middleware/auth");

// Debug endpoint to inspect authenticated user - GET /auth/me
router.get("/me", auth, (req, res) => {
  try {
    res.json({ success: true, user: req.user });
  } catch (error) {
    console.error("/auth/me error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
});

// Security questions list
const securityQuestions = [
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your favorite movie?",
  "What was your first car model?",
  "What is your favorite book?",
  "In what city did your mother and father meet?",
  "What is your favorite food?",
  "What was the name of your best friend in high school?",
  "What is the name of the street you grew up on?",
  "What was your childhood nickname?",
  "What is your favorite color?",
  "What is the name of your first employer?",
  "In what city or town did your mother and father meet?",
  "What is your favorite sports team?",
  "What was the name of your first school?",
  "What is your favorite vacation destination?",
  "What is the make and model of your first car?",
  "What was your first mobile phone brand?",
  "What is your father's middle name?",
  "In what year was your father born?",
  "What is your favorite restaurant?",
  "What is the name of the city where you were born?",
  "What is your favorite song?",
  "What was the name of your first crush?",
  "What is the brand of your favorite watch?",
  "In what city did you grow up?",
  "What is your favorite hobby?",
  "What was the best gift you've ever received?",
  "What is the name of your oldest friend?"
];

// Register - POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, password, confirmPassword, securityQuestion, securityAnswer } = req.body;

    // Validation
    if (!username || !password || !confirmPassword || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Create new user
    const newUser = new User({
      username,
      password,
      securityQuestion,
      securityAnswer: securityAnswer.toLowerCase().trim()
    });

    await newUser.save();
    res.status(201).json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Login - POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isPasswordValid = await user.matchPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Create session record
    const sessionId = crypto.randomBytes(16).toString("hex");
    const device = (req.headers["user-agent"] || "unknown").slice(0, 200);
    const session = new Session({ sessionId, userId: user._id, device });
    await session.save();

    // Push to user's embedded sessions array
    user.sessions = user.sessions || [];
    user.sessions.push({ sessionId, device, loginAt: session.loginAt, lastActiveAt: session.lastActiveAt });
    await user.save();

    const secret = process.env.JWT_SECRET || "change_this_secret";
    const userIdStr = user._id.toString();
    const token = jwt.sign({ id: userIdStr, username: user.username, sessionId }, secret, { expiresIn: "7d" });
    // Create monthly summary notification for previous month if not present
    try {
      const Notification = require('../models/Notification');
      const Transaction = require('../models/Transaction');
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const y = prev.getFullYear();
      const m = prev.getMonth()+1;
      // compute totals
      const start = new Date(y, m-1, 1);
      const end = new Date(y, m, 0, 23,59,59,999);
      const agg = await Transaction.aggregate([
        { $match: { userId: require('mongoose').Types.ObjectId(user._id), date: { $gte: start, $lte: end } } },
        { $group: { _id: "$type", total: { $sum: "$amount" } } }
      ]);
      let income = 0, expense = 0;
      for (const a of agg) {
        if (/income/i.test(a._id)) income += a.total;
        else if (/expense/i.test(a._id)) expense += a.total;
      }
      const savings = income - expense;
      const key = `monthly_summary_${y}_${m}`;
      const exists = await Notification.findOne({ userId: user._id, type: 'monthly_summary', 'data.year': y, 'data.month': m });
      if (!exists) {
        await Notification.create({ userId: user._id, type: 'monthly_summary', title: `Monthly summary ${m}/${y}`, body: `Income ${income} Expense ${expense} Savings ${savings}`, data: { year: y, month: m, income, expense, savings } });
      }
    } catch (e) {
      console.error('Monthly summary notify error', e);
    }

    res.json({
      success: true,
      message: "Login successful",
      token,
      sessionId,
      userId: userIdStr,
      username: user.username,
      currency: user.currency || "USD",
      language: user.language || "en"
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Forgot Password - POST /auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return security question for frontend to display
    res.json({ 
      success: true, 
      securityQuestion: user.securityQuestion,
      username: user.username
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Verify Security Answer - POST /auth/verify-security
router.post("/verify-security", async (req, res) => {
  try {
    const { username, securityAnswer } = req.body;

    if (!username || !securityAnswer) {
      return res.status(400).json({ message: "Username and security answer required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check security answer (case-insensitive)
    if (user.securityAnswer !== securityAnswer.toLowerCase().trim()) {
      return res.status(401).json({ message: "Incorrect security answer" });
    }

    // Return token or flag to allow password reset
    res.json({ 
      success: true, 
      message: "Security answer verified",
      resetToken: Buffer.from(username).toString("base64")
    });
  } catch (error) {
    console.error("Security verification error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Reset Password - POST /auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { username, newPassword, confirmPassword } = req.body;

    if (!username || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "All fields required" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Set the plain password and let the User model's pre-save hook hash it once
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get security questions - GET /auth/security-questions
router.get("/security-questions", (req, res) => {
  res.json({ questions: securityQuestions });
});

// Update user preferences (currency, language)
router.put('/preferences', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currency, language } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (currency) user.currency = currency;
    if (language) user.language = language;
    await user.save();
    res.json({ success: true, currency: user.currency, language: user.language });
  } catch (e) {
    console.error('Update prefs error', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;

