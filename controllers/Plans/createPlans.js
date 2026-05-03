import pool from "../../config/db.js";

const createPlan = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      operator_id,
      description,
      price,
      validity,
      speed,
      data_limit,
      ott_platforms = [],
      is_active = true,
    } = req.body;

    if (!operator_id || !price || !validity || !speed) {
      return res.status(400).json({
        message: "operator_id, price, validity, and speed are required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Insert plan
    const planResult = await client.query(
      `
      INSERT INTO plans (
        operator_id,
        description,
        price,
        validity,
        speed,
        data_limit,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING plan_id
      `,
      [operator_id, description, price, validity, speed, data_limit, is_active],
    );

    const plan_id = planResult.rows[0].plan_id;

    // 2️⃣ Insert OTT mappings
    const uniqueOttPlatforms = [...new Set(ott_platforms.map(Number).filter(Boolean))];
    if (uniqueOttPlatforms.length > 0) {
      const values = uniqueOttPlatforms
        .map((_, index) => `($1, $${index + 2})`)
        .join(",");

      await client.query(
        `
        INSERT INTO plan_ott_platforms (plan_id, ott_id)
        VALUES ${values}
        ON CONFLICT (plan_id, ott_id) DO NOTHING
        `,
        [plan_id, ...uniqueOttPlatforms],
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Plan created successfully",
      plan_id,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create plan error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create plan",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export default createPlan;
