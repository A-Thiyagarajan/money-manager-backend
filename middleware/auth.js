const jwt = require("jsonwebtoken");
const Session = require("../models/Session");
const User = require("../models/User");

module.exports = async function (req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.query.token || req.body.token);

  if (!token) {
    return res.status(401).json({ message: "Not authorized, token missing" });
  }

  try {
    const secret = process.env.JWT_SECRET || "change_this_secret";
    const decoded = jwt.verify(token, secret);
    const id = decoded && decoded.id ? (typeof decoded.id === "string" ? decoded.id : String(decoded.id)) : null;
    const sessionId = decoded && decoded.sessionId ? decoded.sessionId : null;

    if (!id || !sessionId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    // Verify session exists and belongs to user
    const session = await Session.findOne({ sessionId, userId: id });
    if (!session) {
      return res.status(401).json({ message: "Session invalidated" });
    }

    // update lastActiveAt on session and also the user's embedded session record
    session.lastActiveAt = new Date();
    await session.save();

    try {
      await User.updateOne(
        { _id: id, "sessions.sessionId": sessionId },
        { $set: { "sessions.$.lastActiveAt": new Date() } }
      );
    } catch (e) {
      // non-fatal
    }

    req.user = { id, username: decoded && decoded.username, sessionId };
    next();
  } catch (error) {
    console.error("Auth middleware error:", error.message || error);
    return res.status(401).json({ message: "Invalid token" });
  }
};
