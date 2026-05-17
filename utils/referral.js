import pool from "../config/db.js";
import { randomInt } from "crypto";

const REFERRAL_CODE_LENGTH = 6;
const REFERRAL_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateReferralCode(length = REFERRAL_CODE_LENGTH) {
  return Array.from({ length }, () => {
    const index = randomInt(0, REFERRAL_CHARSET.length);
    return REFERRAL_CHARSET[index];
  }).join("");
}

async function referralCodeExists(code, client = pool) {
  const result = await client.query(
    "SELECT 1 FROM users WHERE referral_code = $1 LIMIT 1",
    [code],
  );
  return result.rowCount > 0;
}

export async function generateUniqueReferralCode(client = pool) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateReferralCode();
    if (!(await referralCodeExists(code, client))) {
      return code;
    }
  }

  throw new Error("Unable to generate unique referral code");
}

export async function ensureUserReferralCode(userId, client = pool) {
  const existing = await client.query(
    "SELECT referral_code FROM users WHERE user_id = $1",
    [userId],
  );

  if (!existing.rowCount) {
    return null;
  }

  const currentCode = existing.rows[0].referral_code;
  if (currentCode) {
    return currentCode;
  }

  const nextCode = await generateUniqueReferralCode(client);
  await client.query(
    "UPDATE users SET referral_code = $1, updated_at = NOW() WHERE user_id = $2",
    [nextCode, userId],
  );
  return nextCode;
}

export async function findUserByReferralCode(referralCode, client = pool) {
  const result = await client.query(
    `SELECT user_id, name, phone_number, wallet, referral_code
     FROM users
     WHERE referral_code = $1
       AND isdeleted = false
     LIMIT 1`,
    [referralCode],
  );
  return result.rows[0] || null;
}

export async function ensureReferralSchema() {
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12)",
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INTEGER DEFAULT NULL REFERENCES users(user_id) ON DELETE SET NULL",
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique ON users(referral_code)",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_settings (
      id SERIAL PRIMARY KEY,
      reward_amount BIGINT NOT NULL DEFAULT 0,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_rewards (
      reward_id SERIAL PRIMARY KEY,
      referrer_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      referred_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      referral_code VARCHAR(12) NOT NULL,
      reward_amount BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_recharge_transactions (
      recharge_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      amount BIGINT NOT NULL DEFAULT 0,
      source VARCHAR(50) NOT NULL DEFAULT 'referral',
      reference_table VARCHAR(50) DEFAULT 'referral_rewards',
      reference_id INTEGER DEFAULT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred ON referral_rewards(referred_user_id)",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_referral_rewards_created_at ON referral_rewards(created_at)",
  );

  await pool.query(
    "ALTER TABLE referral_settings ALTER COLUMN reward_amount TYPE BIGINT USING ROUND(reward_amount)::BIGINT",
  );
  await pool.query(
    "ALTER TABLE referral_rewards ALTER COLUMN reward_amount TYPE BIGINT USING ROUND(reward_amount)::BIGINT",
  );
  await pool.query(
    "ALTER TABLE wallet_recharge_transactions ALTER COLUMN amount TYPE BIGINT USING ROUND(amount)::BIGINT",
  );

  const existingSettings = await pool.query(
    "SELECT id FROM referral_settings ORDER BY id ASC LIMIT 1",
  );
  if (existingSettings.rowCount === 0) {
    await pool.query(
      "INSERT INTO referral_settings (reward_amount, is_enabled) VALUES (0, true)",
    );
  }

  const missingCodes = await pool.query(
    "SELECT user_id FROM users WHERE referral_code IS NULL OR referral_code = '' ORDER BY user_id ASC",
  );

  for (const row of missingCodes.rows) {
    // Backfill a stable referral code for existing users.
    // This runs once at startup and only touches rows missing a code.
    await ensureUserReferralCode(row.user_id);
  }
}

export async function getReferralSettings(client = pool) {
  const result = await client.query(
    "SELECT id, reward_amount, is_enabled, created_at, updated_at FROM referral_settings ORDER BY id ASC LIMIT 1",
  );
  return result.rows[0] || {
    id: null,
    reward_amount: 0,
    is_enabled: true,
    created_at: null,
    updated_at: null,
  };
}

export async function updateReferralSettings(payload, client = pool) {
  const settings = await getReferralSettings(client);
  const rewardAmount = Number.parseFloat(payload.reward_amount);
  const normalizedRewardAmount = Number.isFinite(rewardAmount) ? Math.round(rewardAmount) : 0;
  const isEnabled = payload.is_enabled === true || String(payload.is_enabled) === "true";

  if (!settings.id) {
    const inserted = await client.query(
      `INSERT INTO referral_settings (reward_amount, is_enabled, updated_at)
       VALUES ($1, $2, NOW())
       RETURNING id, reward_amount, is_enabled, created_at, updated_at`,
      [normalizedRewardAmount, isEnabled],
    );
    return inserted.rows[0];
  }

  const updated = await client.query(
    `UPDATE referral_settings
     SET reward_amount = $1,
         is_enabled = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, reward_amount, is_enabled, created_at, updated_at`,
    [normalizedRewardAmount, isEnabled, settings.id],
  );
  return updated.rows[0];
}

export async function applyReferralReward({
  referredUserId,
  referralCode,
  client = pool,
}) {
  if (!referralCode) {
    return { applied: false, reason: "missing_code" };
  }

  const settings = await getReferralSettings(client);
  const rewardAmount = Math.round(Number(settings.reward_amount) || 0);
  if (!settings.is_enabled || rewardAmount <= 0) {
    return { applied: false, reason: "disabled" };
  }

  const referrer = await findUserByReferralCode(referralCode, client);
  if (!referrer) {
    return { applied: false, reason: "invalid_code" };
  }

  if (referrer.user_id === referredUserId) {
    return { applied: false, reason: "self_referral" };
  }

  await client.query(
    `UPDATE users
     SET wallet = COALESCE(wallet, 0) + $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [rewardAmount, referrer.user_id],
  );

  const rewardInsert = await client.query(
    `INSERT INTO referral_rewards
     (referrer_user_id, referred_user_id, referral_code, reward_amount)
     VALUES ($1, $2, $3, $4)
     RETURNING reward_id`,
    [referrer.user_id, referredUserId, referralCode, rewardAmount],
  );

  await client.query(
    `INSERT INTO wallet_recharge_transactions
     (user_id, amount, source, reference_table, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      referrer.user_id,
      rewardAmount,
      "referral",
      "referral_rewards",
      rewardInsert.rows[0]?.reward_id || null,
      `Referral signup reward for ${referralCode}`,
    ],
  );

  return {
    applied: true,
    reward_amount: rewardAmount,
    referrer_user_id: referrer.user_id,
  };
}
