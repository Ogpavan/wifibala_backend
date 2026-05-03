import pool from "../../config/db.js";

export default async (req, res) => {
  try {
    const { plan_id } = req.query;

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
        p.price,
        p.validity,
        p.speed,
        p.data_limit,
        p.operator_id
      FROM offers o 
      LEFT JOIN plans p ON o.plan_id = p.plan_id 
      WHERE o.is_active = true 
        AND o.start_date <= CURRENT_TIMESTAMP 
        AND o.end_date >= CURRENT_TIMESTAMP
    `;
    const values = [];
    let paramCount = 1;

    // Filter by plan_id if specified
    if (plan_id) {
      query += ` AND o.plan_id = $${paramCount++}`;
      values.push(plan_id);
    }

    query += ` ORDER BY o.discount_value DESC, o.created_at DESC`;

    const result = await pool.query(query, values);

    // Calculate final price after discount for each offer
    const offersWithCalculations = result.rows.map((offer) => {
      let finalPrice = parseFloat(offer.price);
      let savings = 0;

      if (offer.discount_type === "percentage") {
        savings = (finalPrice * parseFloat(offer.discount_value)) / 100;
        if (offer.max_discount && savings > parseFloat(offer.max_discount)) {
          savings = parseFloat(offer.max_discount);
        }
      } else {
        savings = parseFloat(offer.discount_value);
      }

      finalPrice = Math.max(0, finalPrice - savings);

      return {
        ...offer,
        original_price: offer.price,
        final_price: finalPrice.toFixed(2),
        savings: savings.toFixed(2),
        discount_percentage:
          offer.discount_type === "percentage"
            ? offer.discount_value
            : ((savings / parseFloat(offer.price)) * 100).toFixed(1),
      };
    });

    res.status(200).json({
      success: true,
      message: "Active offers fetched successfully",
      data: offersWithCalculations,
      count: offersWithCalculations.length,
    });
  } catch (error) {
    console.error("GET USER OFFERS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching offers",
      error: error.message,
    });
  }
};
