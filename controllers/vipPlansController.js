import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import pool from "../config/db.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   Ensure upload directory
========================= */
const uploadDir = path.join(__dirname, "../uploads/vip-plans");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

/* =========================
   Helper: safe parse for arrays
========================= */
const safeParse = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    } catch {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
};

/* =========================
   CREATE VIP PLAN
========================= */
export const createVipPlan = async (req, res) => {
  try {
    const {
      plan_name,
      description,
      speed_mbps,
      data_policy,
      validity_days,
      ott_platforms,
      additional_benefits,
      price,
    } = req.body;

    if (!plan_name || !data_policy || !validity_days) {
      return res.status(400).json({
        error: "plan_name, data_policy and validity_days are required",
      });
    }

    // Handle image upload
    let imageUrl = null;
    if (req.file) {
      const fileName = `${uuidv4()}.webp`;
      const outputPath = path.join(uploadDir, fileName);
      await sharp(req.file.buffer).resize({ width: 800 }).webp({ quality: 70 }).toFile(outputPath);
      imageUrl = `/uploads/vip-plans/${fileName}`;
    }

    // Insert into vip_plans
    const { rows } = await pool.query(
      `INSERT INTO vip_plans
        (plan_name, description, image_url, speed_mbps, data_policy, validity_days, additional_benefits, price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        plan_name,
        description || null,
        imageUrl,
        speed_mbps || null,
        data_policy,
        validity_days,
        safeParse(additional_benefits),
        price || 0,
      ]
    );

    const plan = rows[0];
    const planId = plan.id;

    // Insert OTT platforms into plan_ott_platforms
    const ottIds = [...new Set(safeParse(ott_platforms).map(Number).filter(Boolean))];
    if (ottIds.length) {
      const insertOttQuery = `
        INSERT INTO plan_ott_platforms (plan_id, ott_id)
        VALUES ${ottIds.map((_, i) => `($1, $${i + 2})`).join(", ")}
        ON CONFLICT (plan_id, ott_id) DO NOTHING
      `;
      await pool.query(insertOttQuery, [planId, ...ottIds]);
    }

    // Fetch plan with attached OTT platforms
    const { rows: planWithOtt } = await pool.query(
      `SELECT vp.*,
        COALESCE(json_agg(json_build_object(
          'ott_id', o.ott_id,
          'ott_name', o.ott_name,
          'logo_url', o.logo_url
        )) FILTER (WHERE o.ott_id IS NOT NULL), '[]') AS ott_platforms
       FROM vip_plans vp
       LEFT JOIN plan_ott_platforms pop ON vp.id = pop.plan_id
       LEFT JOIN ott_platforms o ON pop.ott_id = o.ott_id
       WHERE vp.id = $1
       GROUP BY vp.id`,
      [planId]
    );

    const finalPlan = planWithOtt[0];
    finalPlan.additional_benefits = safeParse(finalPlan.additional_benefits);
    res.status(201).json(finalPlan);
  } catch (err) {
    console.error("Error creating VIP plan:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   UPDATE VIP PLAN
========================= */
export const updateVipPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      plan_name,
      description,
      speed_mbps,
      data_policy,
      validity_days,
      ott_platforms,
      additional_benefits,
      price,
    } = req.body;

    // Get existing plan
    const oldData = await pool.query("SELECT image_url FROM vip_plans WHERE id = $1", [id]);
    if (!oldData.rows.length) return res.status(404).json({ error: "VIP plan not found" });

    let imageUrl = oldData.rows[0].image_url;

    // Handle new image
    if (req.file) {
      if (imageUrl) {
        const oldPath = path.join(__dirname, "..", imageUrl);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const fileName = `${uuidv4()}.webp`;
      const outputPath = path.join(uploadDir, fileName);
      await sharp(req.file.buffer).resize({ width: 800 }).webp({ quality: 70 }).toFile(outputPath);
      imageUrl = `/uploads/vip-plans/${fileName}`;
    }

    // Update vip_plans
    await pool.query(
      `UPDATE vip_plans SET
        plan_name = COALESCE($1, plan_name),
        description = COALESCE($2, description),
        image_url = $3,
        speed_mbps = COALESCE($4, speed_mbps),
        data_policy = COALESCE($5, data_policy),
        validity_days = COALESCE($6, validity_days),
        additional_benefits = COALESCE($7, additional_benefits),
        price = COALESCE($8, price)
       WHERE id = $9`,
      [
        plan_name,
        description,
        imageUrl,
        speed_mbps,
        data_policy,
        validity_days,
        safeParse(additional_benefits),
        price,
        id,
      ]
    );

    // Update OTT platforms
    if (ott_platforms !== undefined) {
      // Delete old OTT links
      await pool.query("DELETE FROM plan_ott_platforms WHERE plan_id = $1", [id]);

      // Insert new OTT links
      const ottIds = [...new Set(safeParse(ott_platforms).map(Number).filter(Boolean))];
      if (ottIds.length) {
        const insertOttQuery = `
          INSERT INTO plan_ott_platforms (plan_id, ott_id)
          VALUES ${ottIds.map((_, i) => `($1, $${i + 2})`).join(", ")}
          ON CONFLICT (plan_id, ott_id) DO NOTHING
        `;
        await pool.query(insertOttQuery, [id, ...ottIds]);
      }
    }

    // Fetch updated plan with OTT platforms
    const { rows: planWithOtt } = await pool.query(
      `SELECT vp.*,
        COALESCE(json_agg(json_build_object(
          'ott_id', o.ott_id,
          'ott_name', o.ott_name,
          'logo_url', o.logo_url
        )) FILTER (WHERE o.ott_id IS NOT NULL), '[]') AS ott_platforms
       FROM vip_plans vp
       LEFT JOIN plan_ott_platforms pop ON vp.id = pop.plan_id
       LEFT JOIN ott_platforms o ON pop.ott_id = o.ott_id
       WHERE vp.id = $1
       GROUP BY vp.id`,
      [id]
    );

    const finalPlan = planWithOtt[0];
    finalPlan.additional_benefits = safeParse(finalPlan.additional_benefits);
    res.json(finalPlan);
  } catch (err) {
    console.error("Error updating VIP plan:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   GET ALL VIP PLANS
========================= */
export const getVipPlans = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vp.*,
        COALESCE(json_agg(json_build_object(
          'ott_id', o.ott_id,
          'ott_name', o.ott_name,
          'logo_url', o.logo_url
        )) FILTER (WHERE o.ott_id IS NOT NULL), '[]') AS ott_platforms
       FROM vip_plans vp
       LEFT JOIN plan_ott_platforms pop ON vp.id = pop.plan_id
       LEFT JOIN ott_platforms o ON pop.ott_id = o.ott_id
       GROUP BY vp.id
       ORDER BY vp.created_at DESC`
    );

    rows.forEach((r) => (r.additional_benefits = safeParse(r.additional_benefits)));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching VIP plans:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   GET SINGLE VIP PLAN
========================= */
export const getVipPlanById = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT vp.*,
        COALESCE(json_agg(json_build_object(
          'ott_id', o.ott_id,
          'ott_name', o.ott_name,
          'logo_url', o.logo_url
        )) FILTER (WHERE o.ott_id IS NOT NULL), '[]') AS ott_platforms
       FROM vip_plans vp
       LEFT JOIN plan_ott_platforms pop ON vp.id = pop.plan_id
       LEFT JOIN ott_platforms o ON pop.ott_id = o.ott_id
       WHERE vp.id = $1
       GROUP BY vp.id`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "VIP plan not found" });

    const plan = rows[0];
    plan.additional_benefits = safeParse(plan.additional_benefits);
    res.json(plan);
  } catch (err) {
    console.error("Error fetching VIP plan:", err);
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   DELETE VIP PLAN
========================= */
export const deleteVipPlan = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query("SELECT image_url FROM vip_plans WHERE id = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "VIP plan not found" });

    if (rows[0].image_url) {
      const imgPath = path.join(__dirname, "..", rows[0].image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await pool.query("DELETE FROM plan_ott_platforms WHERE plan_id = $1", [id]);
    await pool.query("DELETE FROM vip_plans WHERE id = $1", [id]);

    res.json({ message: "VIP plan deleted successfully" });
  } catch (err) {
    console.error("Error deleting VIP plan:", err);
    res.status(500).json({ error: err.message });
  }
};
