const mongoose = require("mongoose");

const AccountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: String,
  accountNumber: String,
  balance: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Account", AccountSchema);
