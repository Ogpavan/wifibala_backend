import express from "express";
import {
  getReferralConfig,
  getReferralOverview,
  getUserReferralInfo,
  getUserReferralRewards,
  saveReferralConfig,
} from "../controllers/referralController.js";

const router = express.Router();

router.get("/settings", getReferralConfig);
router.put("/settings", saveReferralConfig);
router.get("/admin/overview", getReferralOverview);
router.get("/user/:userId", getUserReferralInfo);
router.get("/user/:userId/rewards", getUserReferralRewards);

export default router;
