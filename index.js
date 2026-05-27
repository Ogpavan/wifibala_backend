import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import planRoutes from "./routes/planRoutes.js";
import offerRoutes from "./routes/offerRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { ensureMobileOtpSchema } from "./controllers/authController.js";
import portChangeRoutes from "./routes/portChangeRoutes.js";
import { ensurePortChangeRequestsSchema } from "./controllers/portChangeController.js";
import referralRoutes from "./routes/referralRoutes.js";
import { ensureReferralSchema } from "./controllers/referralController.js";

import carouselRoute from "./routes/carouselRoute.js";
import vipPlanRoutes from "./routes/vipRoutes.js";
import settingsRoutes from "./routes/settingRoute.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* =========================
   GLOBAL MIDDLEWARE
========================= */
app.use(cors());

// ✅ JSON only (DO NOT add express.urlencoded globally)
app.use(express.json());

/* =========================
   STATIC FILES
========================= */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* =========================
   ROUTES
========================= */
app.use("/api/plans", planRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/carousel", carouselRoute);
app.use("/api/complaints", complaintRoutes);
app.use("/api/port-change-requests", portChangeRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/settings", settingsRoutes);

// 🔹 urlencoded ONLY where needed (auth forms etc.)
app.use("/api/auth", express.urlencoded({ extended: true }), authRoutes);


app.use("/api/vip-plans", vipPlanRoutes);

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend is working 🚀",
  });
});

const PORT = process.env.PORT || 5000;

await ensurePortChangeRequestsSchema();
await ensureReferralSchema();
await ensureMobileOtpSchema();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
