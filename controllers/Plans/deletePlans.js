import pool from "../../config/db.js";

const deletePlan = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Plan id is required",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Delete OTT platform mappings first
    await client.query(`DELETE FROM plan_ott_platforms WHERE plan_id = $1`, [
      id,
    ]);

    // 2️⃣ Delete the plan
    const result = await client.query(
      `DELETE FROM plans WHERE plan_id = $1 RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Plan deleted successfully",
      deletedPlan: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete plan error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete plan",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export default deletePlan;
