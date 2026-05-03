import express from "express";
import upload from "../middlewares/upload.js";
import {
  getAllSettings,
  getSettingsById,
  createSettings,
  updateSettings,
  deleteSettings
} from "../controllers/settingController.js";

const router = express.Router();

router.get("/", getAllSettings);
router.get("/:id", getSettingsById);
router.post("/", upload.single("logo"), createSettings);
router.put("/:id", upload.single("logo"), updateSettings);
router.delete("/:id", deleteSettings);

export default router;
