import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/* =======================
   DELETE USER (SOFT)
======================= */
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "UPDATE users SET isdeleted = true, updated_at = NOW() WHERE user_id = $1",
      [id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   SIGNUP
======================= */
export const signup = async (req, res) => {
  const { name, mobile, email, address, password } = req.body;

  if (!name || !mobile || !email || !address || !password) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  try {
    const existing = await pool.query(
      "SELECT user_id FROM users WHERE phone_number = $1 OR email = $2",
      [mobile, email],
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users 
       (name, phone_number, email, password_hash, address, wallet, created_at, updated_at, isdeleted)
       VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW(), false)`,
      [name, mobile, email, hashedPassword, address],
    );

    res.status(201).json({
      success: true,
      message: "Signup successful",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   ADMIN: CREATE USER
======================= */
export const createUserByAdmin = async (req, res) => {
  const { name, mobile, email, address, password } = req.body;

  if (!name || !mobile || !address || !password) {
    return res.status(400).json({
      success: false,
      message: "name, mobile, address and password are required",
    });
  }

  try {
    const normalizedEmail = email?.trim() ? email.trim() : null;
    const existing = normalizedEmail
      ? await pool.query(
          "SELECT user_id FROM users WHERE phone_number = $1 OR email = $2",
          [mobile, normalizedEmail],
        )
      : await pool.query("SELECT user_id FROM users WHERE phone_number = $1", [
          mobile,
        ]);

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await pool.query(
      `INSERT INTO users
       (name, phone_number, email, password_hash, address, wallet, created_at, updated_at, isdeleted)
       VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW(), false)
       RETURNING user_id, name, phone_number, email, address, COALESCE(wallet, 0) AS wallet, created_at`,
      [name, mobile, normalizedEmail, hashedPassword, address],
    );

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: created.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   ADMIN: UPDATE USER
======================= */
export const updateUserByAdmin = async (req, res) => {
  const { id } = req.params;
  const { name, mobile, email, address, password } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "User id is required",
    });
  }

  if (!name || !mobile || !address) {
    return res.status(400).json({
      success: false,
      message: "name, mobile and address are required",
    });
  }

  try {
    const normalizedEmail = email?.trim() ? email.trim() : null;

    const duplicate = normalizedEmail
      ? await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND user_id <> $1
             AND (phone_number = $2 OR email = $3)
           LIMIT 1`,
          [id, mobile, normalizedEmail],
        )
      : await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND user_id <> $1
             AND phone_number = $2
           LIMIT 1`,
          [id, mobile],
        );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Another user with same mobile/email already exists",
      });
    }

    const passwordToSet = password?.trim()
      ? await bcrypt.hash(password.trim(), 10)
      : null;

    const result = await pool.query(
      `UPDATE users
       SET name = $1,
           phone_number = $2,
           email = $3,
           address = $4,
           password_hash = COALESCE($5, password_hash),
           updated_at = NOW()
       WHERE user_id = $6 AND isdeleted = false
       RETURNING user_id, name, phone_number, email, address, COALESCE(wallet, 0) AS wallet, created_at`,
      [name, mobile, normalizedEmail, address, passwordToSet, id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   SIGNIN + JWT
======================= */
export const signin = async (req, res) => {
  const { mobile, password } = req.body;

  if (!mobile || !password) {
    return res.status(400).json({
      success: false,
      message: "Mobile and password required",
    });
  }

  try {
    // ✅ Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error - JWT secret missing",
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE phone_number = $1",
      [mobile],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    if (user.isdeleted) {
      return res.status(403).json({
        success: false,
        message: "User account is deleted",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // ✅ JWT TOKEN with validation
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    res.json({
      success: true,
      message: "Signin successful",
      token,
      user: {
        id: user.user_id,
        name: user.name,
        mobile: user.phone_number,
        email: user.email,
        address: user.address,
        wallet: user.wallet || 0,
      },
    });
  } catch (err) {
    console.error("Signin error:", err); // ✅ Better error logging
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   GET ALL USERS
======================= */
export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100,
    );
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim().toLowerCase();

    let whereClause = "WHERE isdeleted = false";
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      whereClause += ` AND (
        LOWER(name) LIKE $${values.length}
        OR phone_number LIKE $${values.length}
        OR LOWER(email) LIKE $${values.length}
        OR LOWER(address) LIKE $${values.length}
      )`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users
       ${whereClause}`,
      values,
    );
    const total = countResult.rows[0]?.total || 0;

    values.push(limit);
    values.push(offset);

    const result = await pool.query(
      `SELECT user_id, name, phone_number, email, address,
              COALESCE(wallet, 0) AS wallet,
              created_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    res.json({
      success: true,
      users: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   ADD MONEY TO WALLET
======================= */
export const addMoneyToWallet = async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || amount === undefined || amount < 0) {
    return res.status(400).json({
      success: false,
      message: "User ID and valid amount required",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET wallet = $1, updated_at = NOW()
       WHERE user_id = $2 AND isdeleted = false
       RETURNING wallet`,
      [amount, userId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "Wallet updated successfully",
      newBalance: result.rows[0].wallet,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/* =======================
   GET USER WALLET
======================= */
export const getUserWallet = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT user_id, name, COALESCE(wallet, 0) AS wallet
       FROM users
       WHERE user_id = $1 AND isdeleted = false`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      wallet: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
