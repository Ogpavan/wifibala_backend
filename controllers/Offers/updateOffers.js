import pool from "../../config/db.js";

export default async (req, res) => {
  try {
    const { id } = req.params;
    const {
      plan_id,
      offer_name,
      description,
      discount_type,
      discount_value,
      max_discount,
      start_date,
      end_date,
      is_active,
    } = req.body;

    // Check if offer exists
    const existingOffer = await pool.query(
      "SELECT * FROM offers WHERE offer_id = $1",
      [id],
    );

    if (!existingOffer.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    // Validate discount_type if provided
    if (discount_type && !["percentage", "flat"].includes(discount_type)) {
      return res.status(400).json({
        success: false,
        message: "discount_type must be either 'percentage' or 'flat'",
      });
    }

    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (plan_id !== undefined) {
      updateFields.push(`plan_id = $${paramCount++}`);
      values.push(plan_id);
    }
    if (offer_name !== undefined) {
      updateFields.push(`offer_name = $${paramCount++}`);
      values.push(offer_name);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (discount_type !== undefined) {
      updateFields.push(`discount_type = $${paramCount++}`);
      values.push(discount_type);
    }
    if (discount_value !== undefined) {
      updateFields.push(`discount_value = $${paramCount++}`);
      values.push(discount_value);
    }
    if (max_discount !== undefined) {
      updateFields.push(`max_discount = $${paramCount++}`);
      values.push(max_discount);
    }
    if (start_date !== undefined) {
      updateFields.push(`start_date = $${paramCount++}`);
      values.push(start_date);
    }
    if (end_date !== undefined) {
      updateFields.push(`end_date = $${paramCount++}`);
      values.push(end_date);
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    // Add updated_at
    updateFields.push("updated_at = CURRENT_TIMESTAMP");

    // Add offer_id for WHERE clause
    values.push(id);

    const result = await pool.query(
      `UPDATE offers SET ${updateFields.join(", ")} WHERE offer_id = $${paramCount} RETURNING *`,
      values,
    );

    res.json({
      success: true,
      message: "Offer updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("UPDATE OFFER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error updating offer",
      error: error.message,
    });
  }
};
