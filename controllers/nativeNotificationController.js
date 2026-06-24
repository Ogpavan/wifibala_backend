import pool from "../config/db.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;
const DEFAULT_APP_URL = "https://app.wifibala.com";

function toPositiveInt(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function isExpoPushToken(value) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(String(value || "").trim());
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getPublicBaseUrl(req) {
  const configured =
    process.env.PUBLIC_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL;

  if (configured) return configured.replace(/\/+$/, "");

  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = forwardedHost || req.get("host");
  return `${protocol}://${host}`;
}

function toAbsoluteUrl(req, maybePath) {
  if (!maybePath) return null;
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  return `${getPublicBaseUrl(req)}${maybePath.startsWith("/") ? "" : "/"}${maybePath}`;
}

function getAppNotificationUrl() {
  const appUrl = (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
  return `${appUrl}/user/notifications`;
}

export async function ensureNativeNotificationSchema(client = pool) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS native_push_tokens (
       id SERIAL PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
       expo_push_token TEXT NOT NULL UNIQUE,
       platform VARCHAR(20),
       device_name VARCHAR(255),
       enabled BOOLEAN NOT NULL DEFAULT true,
       last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );

  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS platform VARCHAR(20)",
  );
  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS device_name VARCHAR(255)",
  );
  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true",
  );
  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );
  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );
  await client.query(
    "ALTER TABLE native_push_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  );

  await client.query(
    `CREATE TABLE IF NOT EXISTS native_notifications (
       notification_id SERIAL PRIMARY KEY,
       title VARCHAR(160) NOT NULL,
       body TEXT NOT NULL,
       media_url TEXT,
       target_type VARCHAR(20) NOT NULL,
       target_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
       requested_recipients INTEGER NOT NULL DEFAULT 0,
       sent_count INTEGER NOT NULL DEFAULT 0,
       failed_count INTEGER NOT NULL DEFAULT 0,
       expo_response JSONB NOT NULL DEFAULT '[]'::jsonb,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );

  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS media_url TEXT",
  );
  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL",
  );
  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS requested_recipients INTEGER NOT NULL DEFAULT 0",
  );
  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0",
  );
  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0",
  );
  await client.query(
    "ALTER TABLE native_notifications ADD COLUMN IF NOT EXISTS expo_response JSONB NOT NULL DEFAULT '[]'::jsonb",
  );

  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_native_push_tokens_user_id ON native_push_tokens(user_id)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_native_push_tokens_enabled ON native_push_tokens(enabled)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_native_notifications_target_user ON native_notifications(target_user_id)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_native_notifications_created_at ON native_notifications(created_at)",
  );
}

async function postExpoPushBatch(messages) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || payload?.message || "Expo push request failed";
    throw new Error(message);
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function sendExpoPushMessages(messages) {
  const results = [];

  for (const chunk of chunkArray(messages, EXPO_BATCH_SIZE)) {
    try {
      const tickets = await postExpoPushBatch(chunk);
      chunk.forEach((message, index) => {
        results.push({
          token: message.to,
          ticket: tickets[index] || { status: "error", message: "No Expo ticket returned" },
        });
      });
    } catch (err) {
      chunk.forEach((message) => {
        results.push({
          token: message.to,
          ticket: {
            status: "error",
            message: err.message,
          },
        });
      });
    }
  }

  return results;
}

export const registerNativePushToken = async (req, res) => {
  const userId = toPositiveInt(req.body?.user_id || req.body?.userId);
  const expoPushToken = String(
    req.body?.expo_push_token || req.body?.expoPushToken || "",
  ).trim();
  const platform = normalizeText(req.body?.platform, 20);
  const deviceName = normalizeText(req.body?.device_name || req.body?.deviceName, 255);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Valid user_id is required",
    });
  }

  if (!isExpoPushToken(expoPushToken)) {
    return res.status(400).json({
      success: false,
      message: "Valid Expo push token is required",
    });
  }

  try {
    await ensureNativeNotificationSchema(pool);

    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND isdeleted = false LIMIT 1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const result = await pool.query(
      `INSERT INTO native_push_tokens
       (user_id, expo_push_token, platform, device_name, enabled, last_registered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())
       ON CONFLICT (expo_push_token)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     platform = EXCLUDED.platform,
                     device_name = EXCLUDED.device_name,
                     enabled = true,
                     last_registered_at = NOW(),
                     updated_at = NOW()
       RETURNING id, user_id, expo_push_token, platform, enabled, last_registered_at`,
      [userId, expoPushToken, platform || null, deviceName || null],
    );

    return res.json({
      success: true,
      message: "Push token registered",
      token: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const unregisterNativePushToken = async (req, res) => {
  const expoPushToken = String(
    req.body?.expo_push_token || req.body?.expoPushToken || "",
  ).trim();

  if (!expoPushToken) {
    return res.status(400).json({
      success: false,
      message: "Expo push token is required",
    });
  }

  try {
    await ensureNativeNotificationSchema(pool);
    await pool.query(
      `UPDATE native_push_tokens
       SET enabled = false,
           updated_at = NOW()
       WHERE expo_push_token = $1`,
      [expoPushToken],
    );

    return res.json({
      success: true,
      message: "Push token unregistered",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const listNativeNotificationUsers = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);
  const search = String(req.query.search || "").trim().toLowerCase();
  const values = [];
  let whereClause = "WHERE u.isdeleted = false";

  if (search) {
    values.push(`%${search}%`);
    whereClause += ` AND (
      LOWER(u.name) LIKE $${values.length}
      OR u.phone_number LIKE $${values.length}
      OR LOWER(COALESCE(u.email, '')) LIKE $${values.length}
    )`;
  }

  values.push(limit);

  try {
    await ensureNativeNotificationSchema(pool);

    const result = await pool.query(
      `SELECT u.user_id,
              u.name,
              u.phone_number,
              u.email,
              COUNT(npt.id) FILTER (WHERE npt.enabled = true)::int AS push_token_count,
              MAX(npt.last_registered_at) AS last_registered_at
       FROM users u
       LEFT JOIN native_push_tokens npt ON npt.user_id = u.user_id
       ${whereClause}
       GROUP BY u.user_id, u.name, u.phone_number, u.email, u.created_at
       ORDER BY push_token_count DESC, u.created_at DESC
       LIMIT $${values.length}`,
      values,
    );

    return res.json({
      success: true,
      users: result.rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const getNativeNotificationStats = async (_req, res) => {
  try {
    await ensureNativeNotificationSchema(pool);

    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users WHERE isdeleted = false) AS active_users,
         (SELECT COUNT(*)::int FROM native_push_tokens WHERE enabled = true) AS active_tokens,
         (SELECT COUNT(DISTINCT user_id)::int FROM native_push_tokens WHERE enabled = true) AS users_with_tokens,
         (SELECT COUNT(*)::int FROM native_notifications) AS notifications_sent`,
    );

    return res.json({
      success: true,
      stats: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const listNativeNotifications = async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "25", 10), 1), 100);

  try {
    await ensureNativeNotificationSchema(pool);

    const result = await pool.query(
      `SELECT nn.notification_id,
              nn.title,
              nn.body,
              nn.media_url,
              nn.target_type,
              nn.target_user_id,
              u.name AS target_user_name,
              u.phone_number AS target_user_mobile,
              nn.requested_recipients,
              nn.sent_count,
              nn.failed_count,
              nn.created_at
       FROM native_notifications nn
       LEFT JOIN users u ON u.user_id = nn.target_user_id
       ORDER BY nn.created_at DESC
       LIMIT $1`,
      [limit],
    );

    return res.json({
      success: true,
      notifications: result.rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const listUserNativeNotifications = async (req, res) => {
  const userId = toPositiveInt(req.params.user_id || req.params.userId);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 100);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Valid user_id is required",
    });
  }

  try {
    await ensureNativeNotificationSchema(pool);

    const result = await pool.query(
      `SELECT notification_id,
              title,
              body,
              media_url,
              target_type,
              created_at
       FROM native_notifications
       WHERE target_type = 'all'
          OR target_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    return res.json({
      success: true,
      notifications: result.rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const sendNativeNotification = async (req, res) => {
  const targetType = String(req.body?.target_type || "all").trim().toLowerCase();
  const targetUserId = toPositiveInt(req.body?.user_id || req.body?.target_user_id);
  const title = normalizeText(req.body?.title, 160);
  const body = normalizeText(req.body?.body || req.body?.message, 1000);
  const mediaUrl = req.notificationMediaPath || null;
  const absoluteMediaUrl = toAbsoluteUrl(req, mediaUrl);

  if (!["all", "user"].includes(targetType)) {
    return res.status(400).json({
      success: false,
      message: "target_type must be all or user",
    });
  }

  if (targetType === "user" && !targetUserId) {
    return res.status(400).json({
      success: false,
      message: "User is required for single-user notification",
    });
  }

  if (!title || !body) {
    return res.status(400).json({
      success: false,
      message: "Title and message are required",
    });
  }

  try {
    await ensureNativeNotificationSchema(pool);

    if (targetType === "user") {
      const userResult = await pool.query(
        "SELECT user_id FROM users WHERE user_id = $1 AND isdeleted = false LIMIT 1",
        [targetUserId],
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
    }

    const values = [];
    let tokenWhere = "WHERE npt.enabled = true AND u.isdeleted = false";

    if (targetType === "user") {
      values.push(targetUserId);
      tokenWhere += ` AND npt.user_id = $${values.length}`;
    }

    const tokenResult = await pool.query(
      `SELECT npt.user_id, npt.expo_push_token
       FROM native_push_tokens npt
       JOIN users u ON u.user_id = npt.user_id
       ${tokenWhere}
       ORDER BY npt.last_registered_at DESC`,
      values,
    );

    const notificationResult = await pool.query(
      `INSERT INTO native_notifications
       (title, body, media_url, target_type, target_user_id, requested_recipients)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING notification_id, title, body, media_url, target_type, target_user_id, created_at`,
      [
        title,
        body,
        mediaUrl,
        targetType,
        targetType === "user" ? targetUserId : null,
        tokenResult.rows.length,
      ],
    );

    const notification = notificationResult.rows[0];
    const messages = tokenResult.rows.map((row) => ({
      to: row.expo_push_token,
      sound: "default",
      title,
      body,
      channelId: "default",
      priority: "high",
      mutableContent: !!absoluteMediaUrl,
      data: {
        notification_id: String(notification.notification_id),
        target_type: targetType,
        user_id: String(row.user_id),
        media_url: absoluteMediaUrl || "",
        url: getAppNotificationUrl(),
        screen: "notifications",
      },
      ...(absoluteMediaUrl
        ? {
            richContent: {
              image: absoluteMediaUrl,
            },
          }
        : {}),
    }));

    const expoResults = messages.length ? await sendExpoPushMessages(messages) : [];
    const sentCount = expoResults.filter((item) => item.ticket?.status === "ok").length;
    const failedCount = Math.max(messages.length - sentCount, 0);
    const invalidTokens = expoResults
      .filter((item) => item.ticket?.details?.error === "DeviceNotRegistered")
      .map((item) => item.token);

    if (invalidTokens.length) {
      await pool.query(
        `UPDATE native_push_tokens
         SET enabled = false,
             updated_at = NOW()
         WHERE expo_push_token = ANY($1::text[])`,
        [invalidTokens],
      );
    }

    await pool.query(
      `UPDATE native_notifications
       SET sent_count = $1,
           failed_count = $2,
           expo_response = $3::jsonb
       WHERE notification_id = $4`,
      [
        sentCount,
        failedCount,
        JSON.stringify(expoResults.slice(0, 500)),
        notification.notification_id,
      ],
    );

    return res.json({
      success: true,
      message:
        messages.length === 0
          ? "Notification saved, but no active native devices are registered"
          : "Notification sent",
      notification: {
        ...notification,
        requested_recipients: messages.length,
        sent_count: sentCount,
        failed_count: failedCount,
      },
      results: {
        requested_recipients: messages.length,
        sent_count: sentCount,
        failed_count: failedCount,
        disabled_tokens: invalidTokens.length,
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
