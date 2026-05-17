import express from "express";
import {
  deletePortChangeRequest,
  getAllPortChangeRequests,
  getLatestPortChangeRequest,
  submitPortChangeRequest,
  updatePortChangeRequestStatus,
} from "../controllers/portChangeController.js";

const router = express.Router();

router.post("/submit", submitPortChangeRequest);
router.get("/user/:userId/latest", getLatestPortChangeRequest);
router.get("/admin/all", getAllPortChangeRequests);
router.put("/:id/status", updatePortChangeRequestStatus);
router.delete("/:id", deletePortChangeRequest);

export default router;
