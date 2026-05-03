import pool from "../../config/db.js";

export default async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT o.*, p.description, p.price as plan_price, p.validity, p.speed, p.data_limit
       FROM offers o
       LEFT JOIN plans p ON o.plan_id = p.plan_id
       WHERE o.offer_id = $1`,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    res.json({
      success: true,
      message: "Offer details fetched successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("GET OFFER DETAILS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching offer details",
      error: error.message,
    });
  }
};
