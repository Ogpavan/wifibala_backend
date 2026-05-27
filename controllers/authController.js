/* global process */
import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import https from "https";
import { randomInt } from "crypto";
import {
  applyReferralReward,
  ensureUserReferralCode,
  findUserByReferralCode,
  generateUniqueReferralCode,
} from "../utils/referral.js";

const OTP_EXPIRY_MINUTES = 5;
const OTP_VERIFIED_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

function normalizeIndianMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

function buildOtpProviderMobile(mobile) {
  return `91${mobile}`;
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body,
        });
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error("OTP provider request timed out"));
    });

    req.on("error", reject);
  });
}

export async function ensureMobileOtpSchema(client = pool) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS mobile_otp_verifications (
       mobile VARCHAR(15) PRIMARY KEY,
       otp_hash VARCHAR(255) NOT NULL,
       expires_at TIMESTAMPTZ NOT NULL,
       attempts INTEGER NOT NULL DEFAULT 0,
       verified_until TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

async function isMobileOtpVerified(mobile) {
  await ensureMobileOtpSchema(pool);
  const result = await pool.query(
    `SELECT 1
     FROM mobile_otp_verifications
     WHERE mobile = $1
       AND verified_until > NOW()
     LIMIT 1`,
    [mobile],
  );
  return result.rows.length > 0;
}

async function consumeMobileOtpVerification(client, mobile) {
  await client.query(
    `UPDATE mobile_otp_verifications
     SET verified_until = NULL,
         expires_at = NOW(),
         updated_at = NOW()
     WHERE mobile = $1`,
    [mobile],
  );
}

async function sendMobileOtp(normalizedMobile) {
  const authKey = process.env.APITXT_AUTH_KEY;
  if (!authKey) {
    const error = new Error("Server configuration error - OTP auth key missing");
    error.status = 500;
    throw error;
  }

  await ensureMobileOtpSchema(pool);

  const otp = String(randomInt(1000, 10000));
  const otpHash = await bcrypt.hash(otp, 10);
  const otpUrl = new URL(
    process.env.APITXT_SEND_OTP_URL || "https://apitxt.com/api/sendOTP",
  );
  otpUrl.searchParams.set("authkey", authKey);
  otpUrl.searchParams.set("mobile", buildOtpProviderMobile(normalizedMobile));
  otpUrl.searchParams.set("otp", otp);

  const providerResponse = await requestText(otpUrl);
  if (!providerResponse.ok) {
    const error = new Error("Failed to send OTP");
    error.status = 502;
    throw error;
  }

  await pool.query(
    `INSERT INTO mobile_otp_verifications
     (mobile, otp_hash, expires_at, attempts, verified_until, created_at, updated_at)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'), 0, NULL, NOW(), NOW())
     ON CONFLICT (mobile)
     DO UPDATE SET otp_hash = EXCLUDED.otp_hash,
                   expires_at = EXCLUDED.expires_at,
                   attempts = 0,
                   verified_until = NULL,
                   updated_at = NOW()`,
    [normalizedMobile, otpHash, OTP_EXPIRY_MINUTES],
  );
}

function makeDeletedPhoneValue(userId) {
  const idPart = Number(userId).toString(36).toUpperCase();
  const timePart = (Date.now() % 2176782336).toString(36).toUpperCase().slice(-6);
  return `D${idPart}${timePart}`.slice(0, 15);
}

function makeDeletedEmailValue(userId) {
  return `d${Number(userId).toString(36).toLowerCase()}@d.l`.slice(0, 15);
}

async function ensureUserIdentityArchiveSchema(client = pool) {
  await client.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_phone_number VARCHAR(50)",
  );
  await client.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_email VARCHAR(255)",
  );
  await client.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_operator_id INTEGER DEFAULT NULL",
  );
  await client.query(
    `UPDATE users
     SET deleted_phone_number = COALESCE(deleted_phone_number, phone_number),
         deleted_email = COALESCE(deleted_email, email),
         phone_number = CASE
           WHEN isdeleted = true THEN CONCAT('D', LPAD(user_id::text, 8, '0'))
           ELSE phone_number
         END,
         email = CASE
           WHEN isdeleted = true THEN CONCAT('d', user_id::text, '@d.l')
           ELSE email
         END,
         updated_at = NOW()
     WHERE isdeleted = true
       AND (deleted_phone_number IS NULL OR deleted_email IS NULL OR phone_number IS NULL OR email IS NULL OR phone_number NOT LIKE 'deleted_%' OR email NOT LIKE 'deleted_%')`,
  );
}

async function findDeletedUserByIdentity(client, mobile, email) {
  const result = await client.query(
    `SELECT user_id
     FROM users
     WHERE isdeleted = true
       AND (
         deleted_phone_number = $1
         OR deleted_email = $2
         OR phone_number = $1
         OR email = $2
       )
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [mobile, email],
  );
  return result.rows[0] || null;
}

async function resolveUserOperatorId(value, client = pool) {
  if (!value) return null;

  const normalized = String(value).trim();
  const numericId = Number(normalized);

  if (!Number.isNaN(numericId) && numericId > 0) {
    const byId = await client.query(
      "SELECT id FROM operators WHERE id = $1::int AND active = true LIMIT 1",
      [numericId],
    );
    if (byId.rows.length) return byId.rows[0].id;
  }

  const byName = await client.query(
    `SELECT id
     FROM operators
     WHERE active = true
       AND (LOWER(name) = LOWER($1::text) OR LOWER(code) = LOWER($1::text))
     LIMIT 1`,
    [normalized],
  );
  return byName.rows[0]?.id || null;
}

/* =======================
   DELETE USER (SOFT)
======================= */
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    await ensureUserIdentityArchiveSchema(pool);
    const result = await pool.query(
      `UPDATE users
       SET isdeleted = true,
           deleted_phone_number = phone_number,
           deleted_email = email,
           phone_number = $2,
           email = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [id, makeDeletedPhoneValue(id), makeDeletedEmailValue(id)],
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
   MOBILE OTP
======================= */
export const sendOtp = async (req, res) => {
  const normalizedMobile = normalizeIndianMobile(req.body?.mobile);

  if (!normalizedMobile) {
    return res.status(400).json({
      success: false,
      message: "Valid 10-digit mobile number is required",
    });
  }

  try {
    const activeExisting = await pool.query(
      `SELECT user_id
       FROM users
       WHERE isdeleted = false
         AND phone_number = $1
       LIMIT 1`,
      [normalizedMobile],
    );

    if (activeExisting.rows.length > 0) {
      return res.status(409).json({
        success: false,
        code: "MOBILE_ALREADY_REGISTERED",
        message: "Number already registered. Please continue with Sign In.",
      });
    }

    await sendMobileOtp(normalizedMobile);

    return res.json({
      success: true,
      message: "OTP sent successfully",
      expires_in_minutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : "Server error",
      error: err.message,
    });
  }
};

export const sendForgotPasswordOtp = async (req, res) => {
  const normalizedMobile = normalizeIndianMobile(req.body?.mobile);

  if (!normalizedMobile) {
    return res.status(400).json({
      success: false,
      message: "Valid 10-digit mobile number is required",
    });
  }

  try {
    const result = await pool.query(
      `SELECT user_id
       FROM users
       WHERE isdeleted = false
         AND phone_number = $1
       LIMIT 1`,
      [normalizedMobile],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "MOBILE_NOT_REGISTERED",
        message: "Number not registered. Please create an account.",
      });
    }

    await sendMobileOtp(normalizedMobile);

    return res.json({
      success: true,
      message: "OTP sent successfully",
      expires_in_minutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      message: err.status ? err.message : "Server error",
      error: err.message,
    });
  }
};

export const resetForgotPassword = async (req, res) => {
  const normalizedMobile = normalizeIndianMobile(req.body?.mobile);
  const password = String(req.body?.password || "");

  if (!normalizedMobile) {
    return res.status(400).json({
      success: false,
      message: "Valid 10-digit mobile number is required",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters long",
    });
  }

  try {
    const mobileVerified = await isMobileOtpVerified(normalizedMobile);
    if (!mobileVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify OTP before resetting password",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           updated_at = NOW()
       WHERE phone_number = $2
         AND isdeleted = false
       RETURNING user_id`,
      [hashedPassword, normalizedMobile],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await consumeMobileOtpVerification(pool, normalizedMobile);

    return res.json({
      success: true,
      message: "Password reset successful. Please sign in.",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const verifyOtp = async (req, res) => {
  const normalizedMobile = normalizeIndianMobile(req.body?.mobile);
  const otp = String(req.body?.otp || "").replace(/\D/g, "");

  if (!normalizedMobile || !/^\d{4}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Valid mobile number and 4-digit OTP are required",
    });
  }

  try {
    await ensureMobileOtpSchema(pool);

    const result = await pool.query(
      `SELECT mobile, otp_hash, expires_at, attempts
       FROM mobile_otp_verifications
       WHERE mobile = $1
       LIMIT 1`,
      [normalizedMobile],
    );

    const record = result.rows[0];
    if (!record || new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request a new OTP",
      });
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid OTP attempts. Please request a new OTP",
      });
    }

    const isMatch = await bcrypt.compare(otp, record.otp_hash);
    if (!isMatch) {
      await pool.query(
        `UPDATE mobile_otp_verifications
         SET attempts = attempts + 1,
             updated_at = NOW()
         WHERE mobile = $1`,
        [normalizedMobile],
      );

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await pool.query(
      `UPDATE mobile_otp_verifications
       SET attempts = 0,
           verified_until = NOW() + ($2::int * INTERVAL '1 minute'),
           updated_at = NOW()
       WHERE mobile = $1`,
      [normalizedMobile, OTP_VERIFIED_MINUTES],
    );

    return res.json({
      success: true,
      message: "Mobile number verified successfully",
      verified_for_minutes: OTP_VERIFIED_MINUTES,
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
   SIGNUP
======================= */
export const signup = async (req, res) => {
  const {
    name,
    mobile,
    email,
    address,
    password,
    referral_code,
    current_operator_id,
    current_provider,
    current_company,
  } = req.body;

  if (!name || !mobile || !address || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, mobile, address and password are required",
    });
  }

  const normalizedReferralCode = referral_code?.trim()
    ? referral_code.trim().toUpperCase()
    : null;

  if (normalizedReferralCode && !/^[A-Z0-9]{6}$/.test(normalizedReferralCode)) {
    return res.status(400).json({
      success: false,
      message: "Referral code must be 6 alphanumeric characters",
    });
  }

  let client;

  try {
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile number is required",
      });
    }

    const normalizedEmail = email?.trim() ? email.trim() : null;
    const mobileVerified = await isMobileOtpVerified(normalizedMobile);
    if (!mobileVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify mobile number before signup",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await ensureUserIdentityArchiveSchema(client);

    const currentOperatorId = await resolveUserOperatorId(
      current_operator_id || current_provider || current_company,
      client,
    );

    if (!currentOperatorId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Please select your current WiFi port",
      });
    }

    const activeExisting = normalizedEmail
      ? await client.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND (phone_number = $1 OR email = $2)
           LIMIT 1`,
          [normalizedMobile, normalizedEmail],
        )
      : await client.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND phone_number = $1
           LIMIT 1`,
          [normalizedMobile],
        );

    if (activeExisting.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const deletedMatch = await findDeletedUserByIdentity(
      client,
      normalizedMobile,
      normalizedEmail,
    );

    if (deletedMatch) {
      const restoredCode = await ensureUserReferralCode(
        deletedMatch.user_id,
        client,
      );

      await client.query(
        `UPDATE users
         SET name = $1,
             phone_number = $2,
             email = $3,
             password_hash = $4,
             address = $5,
             current_operator_id = $6,
             referral_code = COALESCE(referral_code, $7),
             deleted_phone_number = NULL,
             deleted_email = NULL,
             isdeleted = false,
             updated_at = NOW()
         WHERE user_id = $8`,
        [
          name,
          normalizedMobile,
          normalizedEmail,
          hashedPassword,
          address,
          currentOperatorId,
          restoredCode,
          deletedMatch.user_id,
        ],
      );

      await consumeMobileOtpVerification(client, normalizedMobile);
      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "Signup successful",
      });
    }

    const newReferralCode = await generateUniqueReferralCode(client);

    const created = await client.query(
      `INSERT INTO users 
       (name, phone_number, email, password_hash, address, wallet, referral_code, referred_by_user_id, current_operator_id, created_at, updated_at, isdeleted)
       VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, $7, NOW(), NOW(), false)
       RETURNING user_id, referral_code`,
      [
        name,
        normalizedMobile,
        normalizedEmail,
        hashedPassword,
        address,
        newReferralCode,
        currentOperatorId,
      ],
    );

    if (normalizedReferralCode) {
      const referrer = await findUserByReferralCode(normalizedReferralCode, client);
      if (!referrer) {
        throw new Error("Invalid referral code");
      }

      await client.query(
        `UPDATE users
         SET referred_by_user_id = $1,
             updated_at = NOW()
         WHERE user_id = $2`,
        [referrer.user_id, created.rows[0].user_id],
      );

      const referralResult = await applyReferralReward({
        referredUserId: created.rows[0].user_id,
        referralCode: normalizedReferralCode,
        client,
      });

      if (!referralResult.applied && referralResult.reason === "invalid_code") {
        throw new Error("Invalid referral code");
      }
    }

    await consumeMobileOtpVerification(client, normalizedMobile);
    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Signup successful",
      referral_code: created.rows[0].referral_code,
    });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK");
    }
    const isReferralError = err.message === "Invalid referral code";
    res.status(isReferralError ? 400 : 500).json({
      success: false,
      message: isReferralError ? err.message : "Server error",
      error: err.message,
    });
  } finally {
    if (client) {
      client.release();
    }
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
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile number is required",
      });
    }

    const normalizedEmail = email?.trim() ? email.trim() : null;
    await ensureUserIdentityArchiveSchema(pool);

    const activeExisting = normalizedEmail
      ? await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND (phone_number = $1 OR email = $2)
           LIMIT 1`,
          [normalizedMobile, normalizedEmail],
        )
      : await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND phone_number = $1
           LIMIT 1`,
          [normalizedMobile],
        );

    if (activeExisting.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const deletedMatch = await findDeletedUserByIdentity(
      pool,
      normalizedMobile,
      normalizedEmail,
    );

    if (deletedMatch) {
      const result = await pool.query(
        `UPDATE users
         SET name = $1,
             phone_number = $2,
             email = $3,
             password_hash = $4,
             address = $5,
             deleted_phone_number = NULL,
             deleted_email = NULL,
             isdeleted = false,
             updated_at = NOW()
         WHERE user_id = $6
         RETURNING user_id, name, phone_number, email, address, COALESCE(wallet, 0) AS wallet, created_at`,
        [
          name,
          normalizedMobile,
          normalizedEmail,
          hashedPassword,
          address,
          deletedMatch.user_id,
        ],
      );

      const referralCode = await ensureUserReferralCode(result.rows[0].user_id);

      return res.status(200).json({
        success: true,
        message: "User created successfully",
        user: {
          ...result.rows[0],
          referral_code: referralCode,
        },
      });
    }

    const created = await pool.query(
      `INSERT INTO users
       (name, phone_number, email, password_hash, address, wallet, created_at, updated_at, isdeleted)
       VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW(), false)
       RETURNING user_id, name, phone_number, email, address, COALESCE(wallet, 0) AS wallet, created_at`,
      [name, normalizedMobile, normalizedEmail, hashedPassword, address],
    );

    const referralCode = await ensureUserReferralCode(created.rows[0].user_id);

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        ...created.rows[0],
        referral_code: referralCode,
      },
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
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile number is required",
      });
    }

    const normalizedEmail = email?.trim() ? email.trim() : null;

    const duplicate = normalizedEmail
      ? await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND user_id <> $1
             AND (phone_number = $2 OR email = $3)
           LIMIT 1`,
          [id, normalizedMobile, normalizedEmail],
        )
      : await pool.query(
          `SELECT user_id
           FROM users
           WHERE isdeleted = false
             AND user_id <> $1
             AND phone_number = $2
           LIMIT 1`,
          [id, normalizedMobile],
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
      [name, normalizedMobile, normalizedEmail, address, passwordToSet, id],
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
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
      return res.status(400).json({
        success: false,
        message: "Valid 10-digit mobile number is required",
      });
    }

    // ✅ Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error - JWT secret missing",
      });
    }

    await ensureUserIdentityArchiveSchema(pool);

    const result = await pool.query(
      `SELECT u.*, op.name AS current_operator_name
       FROM users u
       LEFT JOIN operators op ON op.id = u.current_operator_id
       WHERE u.phone_number = $1`,
      [normalizedMobile],
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

    const referralCode = await ensureUserReferralCode(user.user_id);

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
        current_operator_id: user.current_operator_id,
        current_provider: user.current_operator_name || null,
        referral_code: referralCode,
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
    await ensureUserIdentityArchiveSchema(pool);

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100,
    );
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim().toLowerCase();

    let whereClause = "WHERE u.isdeleted = false";
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      whereClause += ` AND (
        LOWER(u.name) LIKE $${values.length}
        OR u.phone_number LIKE $${values.length}
        OR LOWER(u.email) LIKE $${values.length}
        OR LOWER(u.address) LIKE $${values.length}
        OR LOWER(op.name) LIKE $${values.length}
      )`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       LEFT JOIN operators op ON op.id = u.current_operator_id
       ${whereClause}`,
      values,
    );
    const total = countResult.rows[0]?.total || 0;

    values.push(limit);
    values.push(offset);

    const result = await pool.query(
      `SELECT u.user_id, u.name, u.phone_number, u.email, u.address,
              u.current_operator_id,
              op.name AS current_provider,
              COALESCE(u.wallet, 0) AS wallet,
              u.created_at
       FROM users u
       LEFT JOIN operators op ON op.id = u.current_operator_id
       ${whereClause}
       ORDER BY u.created_at DESC
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
