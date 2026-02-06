const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: String,
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    category: String,
    division: String,
    account: String,
    fromAccount: String,
    toAccount: String,
    description: String,
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
