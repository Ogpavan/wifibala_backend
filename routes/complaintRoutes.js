import express from "express";
import {
  submitComplaint,
  getUserComplaints,
  getAllComplaints,
  updateComplaintStatus,
  deleteComplaint,
  getComplaintStats,
} from "../controllers/complaintController.js";

const router = express.Router();

// User routes
router.post("/submit", submitComplaint);
router.get("/user/:userId", getUserComplaints);

// Admin routes
router.get("/admin/all", getAllComplaints);
router.get("/admin/stats", getComplaintStats);
router.put("/:id/status", updateComplaintStatus);
router.delete("/:id", deleteComplaint);

export default router;
