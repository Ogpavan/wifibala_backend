import pool from "../config/db.js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoUploadDir = path.join(__dirname, "../uploads/settings");
if (!fs.existsSync(logoUploadDir)) fs.mkdirSync(logoUploadDir, { recursive: true });

const saveLogoImage = async (file) => {
  if (!file) return null;
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const outputPath = path.join(logoUploadDir, fileName);
  await sharp(file.buffer)
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toFile(outputPath);
  return `/uploads/settings/${fileName}`;
};

const removeLogoIfExists = (logoUrl) => {
  if (!logoUrl) return;
  const fullPath = path.join(__dirname, "..", logoUrl);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
};

/**
 * GET all settings
 */
export const getAllSettings = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM settings ORDER BY id ASC");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
};
/**
 * GET settings by ID
 */
export const getSettingsById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM settings WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Settings not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch settings" });
  }
};
/**
 * CREATE settings
 */
export const createSettings = async (req, res) => {
  try {
    const {
      primary_number,
      secondary_number,
      whatsapp_number,
      email_id,
      company_name,
      theme_color
    } = req.body;

    const logoUrl = req.file ? await saveLogoImage(req.file) : null;

    const result = await pool.query(
      `INSERT INTO settings 
        (primary_number, secondary_number, whatsapp_number, email_id, company_name, logo_url, theme_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        primary_number,
        secondary_number,
        whatsapp_number,
        email_id,
        company_name,
        logoUrl,
        theme_color || "blue"
      ]
    );

    res.status(201).json({
      message: "Settings created successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create settings" });
  }
};
/**
 * UPDATE settings
 */
export const updateSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      primary_number,
      secondary_number,
      whatsapp_number,
      email_id,
      company_name,
      remove_logo,
      theme_color
    } = req.body;

    const existing = await pool.query("SELECT logo_url FROM settings WHERE id = $1", [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ message: "Settings not found" });
    }
    let nextLogoUrl = existing.rows[0].logo_url;
    if (req.file) {
      const uploaded = await saveLogoImage(req.file);
      removeLogoIfExists(nextLogoUrl);
      nextLogoUrl = uploaded;
    } else if (String(remove_logo) === "true") {
      removeLogoIfExists(nextLogoUrl);
      nextLogoUrl = null;
    }

    const result = await pool.query(
      `UPDATE settings SET
        primary_number = $1,
        secondary_number = $2,
        whatsapp_number = $3,
        email_id = $4,
        company_name = $5,
        logo_url = $6,
        theme_color = $7,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        primary_number,
        secondary_number,
        whatsapp_number,
        email_id,
        company_name,
        nextLogoUrl,
        theme_color || "blue",
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Settings not found" });
    }

    res.json({
      message: "Settings updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update settings" });
  }
};
/**
 * DELETE settings
 */
export const deleteSettings = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM settings WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Settings not found" });
    }

    res.json({ message: "Settings deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete settings" });
  }
};
