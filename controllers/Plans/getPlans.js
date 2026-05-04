import pool from "../../config/db.js";

const getPlans = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100,
    );
    const offset = (page - 1) * limit;
    const { operator_id } = req.query;
    const search = (req.query.search || "").trim().toLowerCase();
    const is_active = req.query.is_active;

    const whereConditions = [];
    const values = [];

    if (operator_id) {
      values.push(operator_id);
      whereConditions.push(`p.operator_id = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      whereConditions.push(
        `(LOWER(COALESCE(p.description, '')) LIKE $${values.length} OR LOWER(COALESCE(p.speed, '')) LIKE $${values.length})`,
      );
    }

    if (is_active === "true" || is_active === "false") {
      values.push(is_active === "true");
      whereConditions.push(`p.is_active = $${values.length}`);
    }

    const whereClause = whereConditions.length
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM plans p
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.total || 0;

    const queryValues = [...values, limit, offset];
    const query = `
      SELECT
        p.plan_id,
        p.operator_id,
        p.description,
        p.price,
        p.validity,
        p.speed,
        p.data_limit,
        p.is_active,
        p.created_at,
        p.updated_at,
        COALESCE(
          JSON_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'ott_id', o.ott_id,
              'ott_name', o.ott_name,
              'logo_url', o.logo_url
            )
          ) FILTER (WHERE o.ott_id IS NOT NULL),
          '[]'
        ) AS ott_platforms
      FROM plans p
      LEFT JOIN plan_ott_platforms pop ON pop.plan_id = p.plan_id
      LEFT JOIN ott_platforms o ON o.ott_id = pop.ott_id
      ${whereClause}
      GROUP BY p.plan_id
      ORDER BY p.plan_id DESC
      LIMIT $${queryValues.length - 1}
      OFFSET $${queryValues.length};
    `;

    const result = await pool.query(query, queryValues);
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.status(200).json({
      message: "Plans fetched successfully",
      plans: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Get plans error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export default getPlans;
