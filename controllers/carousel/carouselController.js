import pool from "../../config/db.js";

/**
 * ADMIN: CREATE SLIDE (WITH IMAGE)
 */
export const createSlide = async (req, res) => {
  try {
    const { position } = req.body;

    if (!req.compressedImagePath) {
      return res.status(400).json({ message: "Image required" });
    }

    const exists = await pool.query(
      "SELECT id FROM carousel_slides WHERE position = $1",
      [position]
    );

    if (exists.rows.length) {
      return res.status(409).json({ message: "Slide already exists" });
    }

    const result = await pool.query(
      `INSERT INTO carousel_slides
       (position, image_url, image_key)
       VALUES ($1, $2, $2)
       RETURNING *`,
      [position, req.compressedImagePath]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ADMIN: READ ONE SLIDE
 */
export const getSlide = async (req, res) => {
  try {
    const { position } = req.params;

    const result = await pool.query(
      `SELECT * FROM carousel_slides WHERE position = $1`,
      [position]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Slide not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ADMIN: UPDATE SLIDE (IMAGE ONLY)
 */
export const updateSlide = async (req, res) => {
  try {
    const { position } = req.params;

    if (!req.compressedImagePath) {
      return res.status(400).json({ message: "Image required" });
    }

    const result = await pool.query(
      `UPDATE carousel_slides
       SET image_url = $1,
           image_key = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE position = $2
       RETURNING *`,
      [req.compressedImagePath, position]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Slide not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ADMIN: DELETE SLIDE
 */
export const deleteSlide = async (req, res) => {
  try {
    const { position } = req.params;

    const result = await pool.query(
      `DELETE FROM carousel_slides
       WHERE position = $1
       RETURNING id`,
      [position]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Slide not found" });
    }

    res.json({ message: "Slide deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ADMIN: LIST ALL SLIDES
 */
export const listSlides = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM carousel_slides ORDER BY position`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
