import { Router } from "express";
import createPlan from "../controllers/Plans/createPlans.js";
import updatePlan from "../controllers/Plans/updatePlans.js";
import deletePlan from "../controllers/Plans/deletePlans.js";
import getPlans from "../controllers/Plans/getPlans.js";
import { getPlanById } from "../controllers/Plans/planDetails.js";
import getOperators from "../controllers/Plans/operator.js";
import getOTTPlatforms from "../controllers/Plans/ott.js";
import {
  createSubscription,
  getAllSubscriptions,
  deleteSubscription,
} from "../controllers/Plans/subcription.js";

const router = Router();

// ✅ SPECIFIC ROUTES FIRST - MUST come before /:id
router.get("/operators", getOperators);
router.get("/ott-platforms", getOTTPlatforms);
router.get("/subscription/all", getAllSubscriptions);

// POST routes
router.post("/create", createPlan);
router.post("/subscription", createSubscription);

// ✅ PARAMETERIZED ROUTES LAST - /:id must come after specific routes
router.get("/:id", getPlanById);
router.put("/update/:id", updatePlan);
router.delete("/delete/:id", deletePlan);
router.delete("/subscription/:subscription_id", deleteSubscription);

// ✅ GENERAL ROUTE - this should be LAST
router.get("/", getPlans);

export default router;
