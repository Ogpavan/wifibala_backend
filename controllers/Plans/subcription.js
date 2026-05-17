import pool from "../../config/db.js";

// Get the latest subscription for a single user
export const getLatestSubscriptionForUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    if (!user_id) {
      return res.status(400).json({ message: "Missing user_id" });
    }

    const query = `
      SELECT
        us.subscription_id,
        us.user_id,
        us.plan_id,
        us.price_paid,
        us.end_date,
        us.auto_renew,
        us.created_at,
        us.updated_at,
        p.description AS plan_description,
        p.price AS plan_price,
        p.validity,
        p.speed,
        p.data_limit,
        o.id AS operator_id,
        o.name AS operator_name,
        o.logo_url
      FROM user_subscriptions us
      JOIN plans p ON us.plan_id = p.plan_id
      LEFT JOIN operators o ON p.operator_id = o.id
      WHERE us.user_id = $1
      ORDER BY us.created_at DESC, us.subscription_id DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [user_id]);

    return res.status(200).json({
      success: true,
      message: "Latest subscription fetched successfully",
      subscription: rows[0] || null,
    });
  } catch (error) {
    console.error("Get latest subscription error:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Delete a user subscription
export const deleteSubscription = async (req, res) => {
  try {
    const { subscription_id } = req.params;
    if (!subscription_id) {
      return res.status(400).json({ message: "Missing subscription_id" });
    }
    const query = `DELETE FROM user_subscriptions WHERE subscription_id = $1 RETURNING *;`;
    const { rows } = await pool.query(query, [subscription_id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Subscription not found" });
    }
    return res.status(200).json({
      message: "Subscription deleted successfully",
      subscription: rows[0],
    });
  } catch (error) {
    console.error("Delete subscription error:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};
// Get all subscribed user details
export const getAllSubscriptions = async (req, res) => {
  try {
    // Pagination and filters
    const { page = 1, limit = 20, search = "", operator_id = "", status = "all" } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = "";
    const whereValues = [];

    if (search && search.trim() !== "") {
      whereValues.push(`%${search.toLowerCase()}%`);
      whereClause += ` AND (LOWER(u.name) LIKE $${whereValues.length} OR u.phone_number LIKE $${whereValues.length})`;
    }

    if (operator_id) {
      whereValues.push(parseInt(operator_id));
      whereClause += ` AND p.operator_id = $${whereValues.length}`;
    }

    if (status === "active") {
      whereClause += ` AND us.end_date >= CURRENT_DATE`;
    } else if (status === "expired") {
      whereClause += ` AND us.end_date < CURRENT_DATE`;
    }

    const values = [...whereValues, parseInt(limit), offset];
    const limitParam = `$${whereValues.length + 1}`;
    const offsetParam = `$${whereValues.length + 2}`;

    const query = `
      SELECT us.*, u.name AS user_name, u.email, u.phone_number,
        p.plan_id, p.operator_id, p.description AS plan_description, p.price AS plan_price, p.validity, p.speed, p.data_limit, p.is_active,
        o.id AS operator_id, o.name AS operator_name, o.logo_url
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.user_id
      JOIN plans p ON us.plan_id = p.plan_id
      LEFT JOIN operators o ON p.operator_id = o.id
      WHERE 1=1
      ${whereClause}
      ORDER BY us.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.user_id
      JOIN plans p ON us.plan_id = p.plan_id
      WHERE 1=1
      ${whereClause}
    `;
    const { rows } = await pool.query(query, values);
    const countRes = await pool.query(countQuery, whereValues);
    const total = parseInt(countRes.rows[0]?.total || 0);
    return res.status(200).json({
      message: "All subscriptions fetched successfully",
      subscriptions: rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Get all subscriptions error:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Create a new user subscription
export const createSubscription = async (req, res) => {
  try {
    const {
      user_id,
      plan_id,
      price_paid,
      end_date,
      auto_renew = false,
    } = req.body;
    if (!user_id || !plan_id || !price_paid || !end_date) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const query = `
			INSERT INTO user_subscriptions (
				user_id, plan_id, price_paid, end_date, auto_renew
			) VALUES ($1, $2, $3, $4, $5)
			RETURNING *;
		`;
    const values = [user_id, plan_id, price_paid, end_date, auto_renew];
    const { rows } = await pool.query(query, values);
    return res.status(201).json({
      message: "Subscription created successfully",
      subscription: rows[0],
    });
  } catch (error) {
    console.error("Create subscription error:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};
