import pool from "../../config/db.js";

export const getPlanById = async (req, res) => {
  const { id } = req.params;

  try {
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
        JSONB_BUILD_OBJECT(
          'id', op.id,
          'name', op.name,
          'code', op.code,
          'logo_url', op.logo_url,
          'description', op.description
        ) AS operator,
        COALESCE(
          JSON_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'ott_id', o.ott_id,
              'ott_name', o.ott_name
            )
          ) FILTER (WHERE o.ott_id IS NOT NULL),
          '[]'
        ) AS ott_platforms
      FROM plans p
      LEFT JOIN operators op ON op.id = p.operator_id
      LEFT JOIN plan_ott_platforms pop ON pop.plan_id = p.plan_id
      LEFT JOIN ott_platforms o ON o.ott_id = pop.ott_id
      WHERE p.plan_id = $1
      GROUP BY p.plan_id, op.id;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Plan not found" });
    }

    return res.status(200).json({
      message: "Plan fetched successfully",
      plan: rows[0],
    });
  } catch (error) {
    console.error("Get plan by ID error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};
