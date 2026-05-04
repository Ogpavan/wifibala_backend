import pool from "../../config/db.js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ottUploadDir = path.join(__dirname, "../../uploads/ott-platforms");
if (!fs.existsSync(ottUploadDir)) fs.mkdirSync(ottUploadDir, { recursive: true });

const saveOttLogo = async (file) => {
  if (!file) return null;
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const outputPath = path.join(ottUploadDir, fileName);
  await sharp(file.buffer)
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath);
  return `/uploads/ott-platforms/${fileName}`;
};

const removeOttLogoIfExists = (logoUrl) => {
  if (!logoUrl) return;
  const normalized = logoUrl.startsWith("/") ? logoUrl.slice(1) : logoUrl;
  const fullPath = path.join(__dirname, "../../", normalized);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
};

const getOTTPlatforms = async (req, res) => {
  try {
    const query = `
      SELECT 
        ott_id,
        ott_name,
        logo_url
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

export const createOTTPlatform = async (req, res) => {
  try {
    const ott_name = String(req.body.ott_name || "").trim();
    if (!ott_name) {
      return res.status(400).json({ message: "OTT platform name is required" });
    }

    const logoUrl = req.file ? await saveOttLogo(req.file) : null;
    const result = await pool.query(
      `
        INSERT INTO ott_platforms (ott_name, logo_url)
        VALUES ($1, $2)
        RETURNING ott_id, ott_name, logo_url
      `,
      [ott_name, logoUrl],
    );

    return res.status(201).json({
      message: "OTT platform created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Create OTT platform error:", error);
    return res.status(500).json({
      message: "Failed to create OTT platform",
      error: error.message,
    });
  }
};

export const updateOTTPlatform = async (req, res) => {
  try {
    const { id } = req.params;
    const ott_name = String(req.body.ott_name || "").trim();
    const removeLogo = String(req.body.remove_logo) === "true";

    if (!ott_name) {
      return res.status(400).json({ message: "OTT platform name is required" });
    }

    const existing = await pool.query(
      "SELECT ott_id, logo_url FROM ott_platforms WHERE ott_id = $1",
      [id],
    );
    if (!existing.rows.length) {
      return res.status(404).json({ message: "OTT platform not found" });
    }

    let nextLogoUrl = existing.rows[0].logo_url;
    if (req.file) {
      const uploaded = await saveOttLogo(req.file);
      removeOttLogoIfExists(nextLogoUrl);
      nextLogoUrl = uploaded;
    } else if (removeLogo) {
      removeOttLogoIfExists(nextLogoUrl);
      nextLogoUrl = null;
    }

    const result = await pool.query(
      `
        UPDATE ott_platforms
        SET ott_name = $1, logo_url = $2
        WHERE ott_id = $3
        RETURNING ott_id, ott_name, logo_url
      `,
      [ott_name, nextLogoUrl, id],
    );

    return res.json({
      message: "OTT platform updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update OTT platform error:", error);
    return res.status(500).json({
      message: "Failed to update OTT platform",
      error: error.message,
    });
  }
};

export const deleteOTTPlatform = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT ott_id, logo_url FROM ott_platforms WHERE ott_id = $1",
      [id],
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "OTT platform not found" });
    }

    await client.query("DELETE FROM plan_ott_platforms WHERE ott_id = $1", [id]);
    await client.query("DELETE FROM ott_platforms WHERE ott_id = $1", [id]);
    await client.query("COMMIT");

    removeOttLogoIfExists(existing.rows[0].logo_url);

    return res.json({ message: "OTT platform deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete OTT platform error:", error);
    return res.status(500).json({
      message: "Failed to delete OTT platform",
      error: error.message,
    });
  } finally {
    client.release();
  }
};
