const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./db");

dotenv.config();

const app = express();
const auth = require("./middleware/auth");

// Connect Database
connectDB();

// CORS Configuration for Render deployment
const corsOptions = {
  origin: function (origin, callback) {
    // Allowed origins
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000"
    ].filter(Boolean); // Remove undefined values

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/transactions", require("./routes/transactionRoutes"));
app.use("/auth", require("./routes/authRoutes"));
app.use("/sessions", require("./routes/sessionsRoutes"));
app.use("/notifications", require("./routes/notificationsRoutes"));
app.use("/budgets", require("./routes/budgetsRoutes"));
app.use("/reminders", require("./routes/remindersRoutes"));
app.use("/stats", require("./routes/statsRoutes"));
app.use("/reports", require("./routes/reportsRoutes"));

// Account routes (for compatibility with frontend)
app.get("/accounts", auth, async (req, res) => {
  try {
    const Account = require("./models/Account");
    const accounts = await Account.find({ userId: req.user.id });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/accounts/add", auth, async (req, res) => {
  try {
    const Account = require("./models/Account");
    const { name, accountNumber, balance } = req.body;
    
    if (!name || !accountNumber) {
      return res.status(400).json({ message: "Missing required fields: name, accountNumber" });
    }
    
    const account = new Account({ 
      name, 
      accountNumber, 
      balance: balance || 0,
      userId: req.user.id 
    });
    await account.save();
    res.json(account);
  } catch (err) {
    console.error('Add account error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to add account' });
  }
});

app.post("/accounts/transfer", auth, async (req, res) => {
  try {
    const Account = require("./models/Account");
    const Transaction = require("./models/Transaction");
    const User = require("./models/User");
    const { from, to, amount } = req.body;

    // Validate inputs
    if (!from || !to || !amount) {
      return res.status(400).json({ message: "Missing required fields: from, to, amount" });
    }

    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const fromAccount = await Account.findById(from);
    const toAccount = await Account.findById(to);

    if (!fromAccount || !toAccount) return res.status(400).json({ message: "Invalid accounts" });
    if (fromAccount.userId.toString() !== userId || toAccount.userId.toString() !== userId) return res.status(403).json({ message: "Unauthorized accounts" });
    if (fromAccount.balance < amount) return res.status(400).json({ message: "Insufficient balance" });

    // Store old balances before update
    const oldFromBalance = fromAccount.balance;
    const oldToBalance = toAccount.balance;

    // Update balances
    fromAccount.balance -= amount;
    toAccount.balance += amount;

    await fromAccount.save();
    await toAccount.save();

    // Record transfer as a transaction
    const transactionData = {
      userId,
      username: user.username,
      type: "transfer",
      amount,
      category: "Transfer",
      division: "Personal",
      fromAccount: JSON.stringify({
        id: fromAccount._id,
        name: fromAccount.name,
        accountNumber: fromAccount.accountNumber,
        oldBalance: oldFromBalance,
        newBalance: fromAccount.balance,
      }),
      toAccount: JSON.stringify({
        id: toAccount._id,
        name: toAccount.name,
        accountNumber: toAccount.accountNumber,
        oldBalance: oldToBalance,
        newBalance: toAccount.balance,
      }),
      date: new Date(),
    };

    await Transaction.create(transactionData);

    res.json({ success: true, from: fromAccount, to: toAccount, message: "Transfer completed successfully" });
  } catch (err) {
    console.error("Transfer error:", err);
    res.status(500).json({ message: err.message || "Transfer failed" });
  }
});

app.put("/accounts/:id", auth, async (req, res) => {
  try {
    const Account = require("./models/Account");
    const mongoose = require("mongoose");
    const { id } = req.params;
    const { name, accountNumber, balance } = req.body;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid account ID format" });
    }

    const account = await Account.findById(id);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (account.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized - account does not belong to this user" });
    }

    if (name) account.name = name;
    if (accountNumber) account.accountNumber = accountNumber;
    if (balance !== undefined) account.balance = parseFloat(balance);

    await account.save();
    res.setHeader('Content-Type', 'application/json');
    res.json(account);
  } catch (err) {
    console.error("Update account error:", err);
    res.status(500).json({ message: err.message || "Failed to update account" });
  }
});

app.delete("/accounts/:id", auth, async (req, res) => {
  try {
    const Account = require("./models/Account");
    const mongoose = require("mongoose");
    const { id } = req.params;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid account ID format" });
    }

    const account = await Account.findById(id);
    if (!account) {
      console.error(`Account not found for ID: ${id}`);
      return res.status(404).json({ message: "Account not found" });
    }

    if (account.userId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized - account does not belong to this user" });
    }

    const result = await Account.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ message: "Account could not be deleted" });
    }

    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, message: "Account deleted successfully", accountId: id });
  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ message: err.message || "Failed to delete account" });
  }
});

app.get("/", (req, res) => {
  res.send("Money Manager API Running");
});

// Temporary debug route: returns authenticated user and their transaction count/sample
app.get("/debug/me-transactions", auth, async (req, res) => {
  try {
    const Transaction = require("./models/Transaction");
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const count = await Transaction.countDocuments({ userId });
    const sample = await Transaction.find({ userId }).sort({ date: -1 }).limit(5);
    res.json({ success: true, user: req.user, count, sample });
  } catch (err) {
    console.error("/debug/me-transactions error:", err.message || err);
    res.status(500).json({ message: err.message });
  }
});

// Global error handling middleware - must be last
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  console.error('Stack:', err.stack);
  
  // Ensure we always return JSON
  res.setHeader('Content-Type', 'application/json');
  
  // Determine status code
  const statusCode = err.statusCode || 500;
  
  // Return error as JSON
  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Server error',
    error: process.env.NODE_ENV === 'development' ? err : undefined
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
