import pool from "../../config/db.js";

const getOperators = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        name,
        code,
        logo_url,
        description,
        active,
        created_at
      FROM operators
      ORDER BY id ASC;
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      message: "Operators fetched successfully",
      operators: result.rows,
    });
  } catch (error) {
    console.error("Get operators error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export default getOperators;
