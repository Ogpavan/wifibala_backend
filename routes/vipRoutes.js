import express from "express";
import upload from "../middlewares/upload.js";
import {
  createVipPlan,
  getVipPlans,
  getVipPlanById,
  updateVipPlan,
  deleteVipPlan,
} from "../controllers/vipPlansController.js";

const router = express.Router();

/* =========================
   CREATE VIP PLAN
   POST /api/vip-plans/create
========================= */
router.post(
  "/create",
  upload.single("image"), // Postman key MUST be "image"
  createVipPlan
);

/* =========================
   READ ALL VIP PLANS
   GET /api/vip-plans
========================= */
router.get("/", getVipPlans);

/* =========================
   READ SINGLE VIP PLAN
   GET /api/vip-plans/:id
========================= */
router.get("/:id", getVipPlanById);

/* =========================
   UPDATE VIP PLAN
   PUT /api/vip-plans/update/:id
========================= */
router.put(
  "/update/:id",
  upload.single("image"), // optional
  updateVipPlan
);

/* =========================
   DELETE VIP PLAN
   DELETE /api/vip-plans/delete/:id
========================= */
router.delete("/delete/:id", deleteVipPlan);

export default router;
