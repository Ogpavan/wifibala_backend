import pool from "../../config/db.js";

export const createCarouselOffer = async (req, res) => {
  const { title, description } = req.body;

  const count = await pool.query(
    "SELECT COUNT(*) FROM carousel_offers"
  );

  if (parseInt(count.rows[0].count) >= 3) {
    return res.status(400).json({
      message: "Only 3 carousel cards allowed",
    });
  }

  if (!req.compressedImagePath) {
    return res.status(400).json({
      message: "Image required",
    });
  }

  const result = await pool.query(
    `INSERT INTO carousel_offers (title, description, image_url)
     VALUES ($1,$2,$3) RETURNING *`,
    [title, description, req.compressedImagePath]
  );

  res.status(201).json(result.rows[0]);
};

export const getCarouselOffers = async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM carousel_offers ORDER BY id ASC"
  );
  res.json(result.rows);
};
