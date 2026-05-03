import pool from "../../config/db.js";

export default async (req, res) => {
  try {
    const { is_active, plan_id } = req.query;

    let query = `
      SELECT 
        o.offer_id,
        o.plan_id,
        o.offer_name,
        o.description AS offer_description,
        o.discount_type,
        o.discount_value,
        o.max_discount,
        o.start_date,
        o.end_date,
        o.is_active,
        o.created_at,
        o.updated_at,
        p.description AS plan_description,
        p.operator_id,
        op.name AS operator_name,
        p.price,
        p.validity,
        p.speed,
        p.data_limit
      FROM offers o 
      LEFT JOIN plans p ON o.plan_id = p.plan_id 
      LEFT JOIN operators op ON p.operator_id = op.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    // Filter by active status if specified
    if (is_active !== undefined) {
      query += ` AND o.is_active = $${paramCount++}`;
      values.push(is_active === "true");
    }

    // Filter by plan_id if specified
    if (plan_id) {
      query += ` AND o.plan_id = $${paramCount++}`;
      values.push(plan_id);
    }

    query += ` ORDER BY o.created_at DESC`;

    const result = await pool.query(query, values);

    res.status(200).json({
      success: true,
      message: "Offers fetched successfully",
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("GET OFFERS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching offers",
      error: error.message,
    });
  }
};
