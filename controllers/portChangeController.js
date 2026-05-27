import pool from "../config/db.js";

const VALID_STATUSES = new Set(["pending", "approved", "rejected", "completed"]);
let portRequestKeyColumnPromise = null;

export const ensurePortChangeRequestsSchema = async () => {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS current_operator_id INTEGER DEFAULT NULL
  `);
  await pool.query(`
    ALTER TABLE port_change_requests
      ADD COLUMN IF NOT EXISTS user_id INTEGER DEFAULT NULL REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS current_operator_id INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS requested_operator_id INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS reviewed_by INTEGER DEFAULT NULL REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
};

async function resolveOperatorId(value) {
  if (!value) return null;

  const normalized = String(value).trim();
  const numericId = Number(normalized);

  if (!Number.isNaN(numericId) && numericId > 0) {
    const byId = await pool.query("SELECT id FROM operators WHERE id = $1::int LIMIT 1", [numericId]);
    if (byId.rows.length) return byId.rows[0].id;
  }

  const byName = await pool.query(
    "SELECT id FROM operators WHERE LOWER(name) = LOWER($1::text) OR LOWER(code) = LOWER($1::text) LIMIT 1",
    [normalized],
  );
  if (byName.rows.length) return byName.rows[0].id;

  return null;
}

async function getPortRequestKeyColumn() {
  if (!portRequestKeyColumnPromise) {
    portRequestKeyColumnPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'port_change_requests'
            AND column_name IN ('request_id', 'id', 'port_change_request_id')
          ORDER BY CASE column_name
            WHEN 'request_id' THEN 1
            WHEN 'id' THEN 2
            WHEN 'port_change_request_id' THEN 3
            ELSE 4
          END
          LIMIT 1
        `,
      )
      .then((result) => result.rows[0]?.column_name || "request_id")
      .catch(() => "request_id");
  }

  return portRequestKeyColumnPromise;
}

async function getLatestPortChangeRequestByUser(userId) {
  const keyColumn = await getPortRequestKeyColumn();
  const result = await pool.query(
    `SELECT
       pcr.${keyColumn} AS request_id,
       pcr.user_id,
       pcr.current_operator_id,
       pcr.requested_operator_id,
       pcr.status,
       pcr.remarks,
       pcr.reviewed_by,
       pcr.reviewed_at,
       pcr.created_at,
       pcr.updated_at,
       COALESCE(u.name, 'Unknown User') AS user_name,
       u.phone_number,
       COALESCE(current_op.name, 'Unknown') AS current_provider,
       COALESCE(requested_op.name, 'Unknown') AS requested_provider
     FROM port_change_requests pcr
     LEFT JOIN users u ON u.user_id = pcr.user_id
     LEFT JOIN operators current_op ON current_op.id = pcr.current_operator_id
     LEFT JOIN operators requested_op ON requested_op.id = pcr.requested_operator_id
     WHERE pcr.user_id = $1::int
     ORDER BY pcr.created_at DESC
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] || null;
}

async function getCurrentPortProviderByUser(userId) {
  const latestPortResult = await pool.query(
    `SELECT COALESCE(requested_op.name, 'Airtel') AS current_port_provider
     FROM port_change_requests pcr
     LEFT JOIN operators requested_op ON requested_op.id = pcr.requested_operator_id
     WHERE pcr.user_id = $1::int
       AND LOWER(pcr.status) IN ('approved', 'completed')
     ORDER BY pcr.created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (latestPortResult.rows[0]?.current_port_provider) {
    return latestPortResult.rows[0].current_port_provider;
  }

  const signupProviderResult = await pool.query(
    `SELECT COALESCE(op.name, 'Airtel') AS current_port_provider
     FROM users u
     LEFT JOIN operators op ON op.id = u.current_operator_id
     WHERE u.user_id = $1::int
     LIMIT 1`,
    [userId],
  );

  return signupProviderResult.rows[0]?.current_port_provider || "Airtel";
}

function normalizeStatus(status) {
  if (!status) return "pending";
  const value = String(status).toLowerCase();
  return VALID_STATUSES.has(value) ? value : null;
}

export const submitPortChangeRequest = async (req, res) => {
  const {
    user_id,
    current_provider,
    requested_provider,
    remarks = "",
  } = req.body;

  if (!user_id || !requested_provider || !current_provider) {
    return res.status(400).json({
      success: false,
      message: "User ID, current provider, and requested provider are required",
    });
  }

  try {
    const latestRequest = await getLatestPortChangeRequestByUser(user_id);
    if (latestRequest?.status === "pending") {
      return res.status(429).json({
        success: false,
        message:
          "You already have a pending port change request. Please wait for the status to change before submitting again.",
        latest_request: latestRequest,
      });
    }

    const currentOperatorId = await resolveOperatorId(current_provider);
    const requestedOperatorId = await resolveOperatorId(requested_provider);

    if (!currentOperatorId || !requestedOperatorId) {
      return res.status(400).json({
        success: false,
        message: "Invalid current or requested operator",
      });
    }

    const result = await pool.query(
      `INSERT INTO port_change_requests (
        user_id,
        current_operator_id,
        requested_operator_id,
        status,
        remarks,
        created_at,
        updated_at
      ) VALUES ($1::int, $2::int, $3::int, 'pending', $4::text, NOW(), NOW())
      RETURNING *`,
      [
        user_id,
        currentOperatorId,
        requestedOperatorId,
        remarks || "",
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Port change request submitted successfully",
      request: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const getAllPortChangeRequests = async (req, res) => {
  try {
    const keyColumn = await getPortRequestKeyColumn();
    const result = await pool.query(
      `SELECT
         pcr.${keyColumn} AS request_id,
         pcr.user_id,
         pcr.current_operator_id,
         pcr.requested_operator_id,
         pcr.status,
         pcr.remarks,
         pcr.reviewed_by,
         pcr.reviewed_at,
         pcr.created_at,
         pcr.updated_at,
         COALESCE(u.name, 'Unknown User') AS user_name,
         u.phone_number,
         COALESCE(current_op.name, 'Unknown') AS current_provider,
         COALESCE(requested_op.name, 'Unknown') AS requested_provider
       FROM port_change_requests pcr
       LEFT JOIN users u ON u.user_id = pcr.user_id
       LEFT JOIN operators current_op ON current_op.id = pcr.current_operator_id
       LEFT JOIN operators requested_op ON requested_op.id = pcr.requested_operator_id
       ORDER BY pcr.created_at DESC`,
    );

    return res.json({
      success: true,
      requests: result.rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const getLatestPortChangeRequest = async (req, res) => {
  const { userId } = req.params;
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid user id",
    });
  }

  try {
    const latestRequest = await getLatestPortChangeRequestByUser(numericUserId);
    const currentPortProvider = await getCurrentPortProviderByUser(numericUserId);

    return res.json({
      success: true,
      can_request: !latestRequest || latestRequest.status !== "pending",
      latest_request: latestRequest,
      current_port_provider: currentPortProvider,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const updatePortChangeRequestStatus = async (req, res) => {
  const { id } = req.params;
  const { status, remarks = "", reviewed_by = null } = req.body;
  const normalizedStatus = normalizeStatus(status);
  const requestId = Number(id);

  if (!normalizedStatus) {
    return res.status(400).json({
      success: false,
      message: "Invalid request status",
    });
  }

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid request id",
    });
  }

  try {
    const keyColumn = await getPortRequestKeyColumn();
    const values = [normalizedStatus, remarks || "", reviewed_by, requestId];
    const result = await pool.query(
      `UPDATE port_change_requests
       SET status = $1::text,
           remarks = CASE WHEN $2::text = '' THEN remarks ELSE $2::text END,
           reviewed_by = COALESCE($3::int, reviewed_by),
           reviewed_at = CASE
             WHEN $1::text = 'pending' THEN reviewed_at
             ELSE NOW()
           END,
           updated_at = NOW()
       WHERE ${keyColumn} = $4::int
       RETURNING *`,
      values,
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Port change request not found",
      });
    }

    return res.json({
      success: true,
      message: "Port change request updated successfully",
      request: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const deletePortChangeRequest = async (req, res) => {
  const { id } = req.params;
  const requestId = Number(id);

  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid request id",
    });
  }

  try {
    const keyColumn = await getPortRequestKeyColumn();
    const result = await pool.query(
      `DELETE FROM port_change_requests WHERE ${keyColumn} = $1::int RETURNING *`,
      [requestId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Port change request not found",
      });
    }

    return res.json({
      success: true,
      message: "Port change request deleted successfully",
      request: result.rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
