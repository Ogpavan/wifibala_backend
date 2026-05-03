import pool from "../../config/db.js";

export default async (req, res) => {
  try {
    const { id } = req.params;

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

    const result = await pool.query(
      `DELETE FROM offers WHERE offer_id = $1 RETURNING *`,
      [id],
    );

    res.json({
      success: true,
      message: "Offer deleted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("DELETE OFFER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting offer",
      error: error.message,
    });
  }
};
