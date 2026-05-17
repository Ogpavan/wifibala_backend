import pool from "../config/db.js";
import {
  applyReferralReward,
  ensureReferralSchema,
  ensureUserReferralCode,
  getReferralSettings,
  updateReferralSettings,
} from "../utils/referral.js";

export { ensureReferralSchema };

export const getReferralConfig = async (req, res) => {
  try {
    const settings = await getReferralSettings();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load referral settings",
      error: error.message,
    });
  }
};

export const saveReferralConfig = async (req, res) => {
  try {
    const rewardAmount = Number(req.body.reward_amount);
    const isEnabled =
      req.body.is_enabled === undefined ? true : String(req.body.is_enabled) === "true";

    if (Number.isNaN(rewardAmount) || rewardAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Reward amount must be a valid number",
      });
    }

    const settings = await updateReferralSettings({
      reward_amount: rewardAmount,
      is_enabled: isEnabled,
    });

    res.json({
      success: true,
      message: "Referral settings updated",
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update referral settings",
      error: error.message,
    });
  }
};

export const getReferralOverview = async (req, res) => {
  try {
    const settings = await getReferralSettings();
    const summary = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE referred_by_user_id IS NOT NULL)::int AS referred_users,
         COUNT(*) FILTER (WHERE referral_code IS NOT NULL AND referral_code <> '')::int AS users_with_codes,
         COALESCE(SUM(wallet), 0)::numeric(10,2) AS total_wallet
       FROM users
       WHERE isdeleted = false`,
    );

    const rewards = await pool.query(
      `SELECT
         rr.reward_id AS id,
         rr.reward_amount,
         rr.referral_code,
         rr.created_at,
         ref.user_id AS referrer_user_id,
         ref.name AS referrer_name,
         ref.phone_number AS referrer_mobile,
         newu.user_id AS referred_user_id,
         newu.name AS referred_name,
         newu.phone_number AS referred_mobile
       FROM referral_rewards rr
       JOIN users ref ON ref.user_id = rr.referrer_user_id
       JOIN users newu ON newu.user_id = rr.referred_user_id
       ORDER BY rr.created_at DESC
       LIMIT 100`,
    );

    const users = await pool.query(
      `SELECT
         user_id,
         name,
         phone_number,
         wallet,
         referral_code,
         referred_by_user_id,
         created_at
       FROM users
       WHERE isdeleted = false
       ORDER BY created_at DESC
       LIMIT 100`,
    );

    res.json({
      success: true,
      settings,
      summary: summary.rows[0] || {
        referred_users: 0,
        users_with_codes: 0,
        total_wallet: 0,
      },
      rewards: rewards.rows,
      users: users.rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load referral overview",
      error: error.message,
    });
  }
};

export const getUserReferralInfo = async (req, res) => {
  const { userId } = req.params;

  if (!userId || Number.isNaN(Number(userId))) {
    return res.status(400).json({
      success: false,
      message: "Valid user id is required",
    });
  }

  try {
    const referralCode = await ensureUserReferralCode(Number(userId));
    const settings = await getReferralSettings();

    res.json({
      success: true,
      referral_code: referralCode,
      referral_link: `${req.protocol}://${req.get("host")}/signup?ref=${encodeURIComponent(
        referralCode || "",
      )}`,
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load referral info",
      error: error.message,
    });
  }
};

export const getUserReferralRewards = async (req, res) => {
  const { userId } = req.params;

  if (!userId || Number.isNaN(Number(userId))) {
    return res.status(400).json({
      success: false,
      message: "Valid user id is required",
    });
  }

  try {
    const user = await pool.query(
      `SELECT user_id, name, phone_number, wallet, referral_code
       FROM users
       WHERE user_id = $1 AND isdeleted = false
       LIMIT 1`,
      [userId],
    );

    if (!user.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const recharges = await pool.query(
      `SELECT
         tr.recharge_id AS id,
         tr.amount AS reward_amount,
         tr.source,
         tr.reference_table,
         tr.reference_id,
         tr.description,
         tr.created_at,
         rr.referral_code,
         newu.name AS referred_name,
         newu.phone_number AS referred_mobile
       FROM wallet_recharge_transactions tr
       LEFT JOIN referral_rewards rr ON rr.reward_id = tr.reference_id
       LEFT JOIN users newu ON newu.user_id = rr.referred_user_id
       WHERE tr.user_id = $1
       ORDER BY tr.created_at DESC
       LIMIT 50`,
      [userId],
    );

    res.json({
      success: true,
      balance: Number(user.rows[0].wallet || 0),
      referral_code: user.rows[0].referral_code || null,
      rewards: recharges.rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load referral rewards",
      error: error.message,
    });
  }
};

export async function processSignupReferral({ userId, referralCode, client = pool }) {
  return applyReferralReward({
    referredUserId: userId,
    referralCode,
    client,
  });
}
