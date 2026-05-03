import pool from "../../config/db.js";

const getOTTPlatforms = async (req, res) => {
  try {
    const query = `
      SELECT 
        ott_id,
        ott_name
      FROM ott_platforms
      ORDER BY ott_name ASC;
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      message: "OTT platforms fetched successfully",
      ottPlatforms: result.rows,
    });
  } catch (error) {
    console.error("Get OTT platforms error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export default getOTTPlatforms;
