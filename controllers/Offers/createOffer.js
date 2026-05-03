import pool from "../../config/db.js";

export default async function createOffer(req, res) {
  try {
    const {
      plan_id,
      offer_name,
      description,
      discount_type,
      discount_value,
      max_discount,
      start_date,
      end_date,
      is_active = true,
    } = req.body;

    // Validate required fields
    if (
      !plan_id ||
      !offer_name ||
      !discount_type ||
      !discount_value ||
      !start_date ||
      !end_date
    ) {
      return res.status(400).json({
        message:
          "Missing required fields: plan_id, offer_name, discount_type, discount_value, start_date, end_date",
      });
    }

    // Validate discount_type
    if (!["percentage", "flat"].includes(discount_type)) {
      return res.status(400).json({
        message: "discount_type must be either 'percentage' or 'flat'",
      });
    }

    const result = await pool.query(
      `INSERT INTO offers
       (plan_id, offer_name, description, discount_type, discount_value, max_discount, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        plan_id,
        offer_name,
        description,
        discount_type,
        discount_value,
        max_discount,
        start_date,
        end_date,
        is_active,
      ],
    );

    res.status(201).json({
      success: true,
      message: "Offer created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("CREATE OFFER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error creating offer",
      error: error.message,
    });
  }
}
