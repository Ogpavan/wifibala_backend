import pool from "../../config/db.js";

const updatePlan = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      description,
      price,
      validity,
      speed,
      data_limit,
      ott_platforms = [],
      is_active,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        message: "Plan id is required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Update plan
    const query = `
      UPDATE plans
      SET
        description = COALESCE($1, description),
        price = COALESCE($2, price),
        validity = COALESCE($3, validity),
        speed = COALESCE($4, speed),
        data_limit = COALESCE($5, data_limit),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
      WHERE plan_id = $7
      RETURNING *;
    `;

    const values = [
      description,
      price,
      validity,
      speed,
      data_limit,
      is_active,
      id,
    ];

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Plan not found",
      });
    }

    // 2️⃣ Update OTT mappings - delete existing and insert new ones
    await client.query(`DELETE FROM plan_ott_platforms WHERE plan_id = $1`, [
      id,
    ]);

    const uniqueOttPlatforms = [...new Set(ott_platforms.map(Number).filter(Boolean))];
    if (uniqueOttPlatforms.length > 0) {
      const ottValues = uniqueOttPlatforms
        .map((_, index) => `($1, $${index + 2})`)
        .join(",");

      await client.query(
        `
        INSERT INTO plan_ott_platforms (plan_id, ott_id)
        VALUES ${ottValues}
        ON CONFLICT (plan_id, ott_id) DO NOTHING
        `,
        [id, ...uniqueOttPlatforms],
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Plan updated successfully",
      plan: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update plan error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update plan",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export default updatePlan;
