// controllers/operatorChange.controller.js
import pool from "../config/db.js";

export const requestOperatorChange = async (req, res) => {
  try {
    const userId = req.user.user_id; // auth se aayega
    const { to_operator_id } = req.body;

    if (!to_operator_id) {
      return res.status(400).json({ message: "Operator required" });
    }

    // 🔒 check pending request
    const pending = await pool.query(
      `SELECT 1 FROM operator_change_requests 
       WHERE user_id = $1 AND status = 'PENDING'`,
      [userId]
    );

    if (pending.rows.length) {
      return res
        .status(400)
        .json({ message: "You already have a pending request" });
    }

    // ✅ insert request
    await pool.query(
      `INSERT INTO operator_change_requests (user_id, to_operator_id)
       VALUES ($1, $2)`,
      [userId, to_operator_id]
    );

    res.status(201).json({ message: "Operator change request submitted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
