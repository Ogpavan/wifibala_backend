import express from "express";
import {
  getNativeNotificationStats,
  listNativeNotificationUsers,
  listNativeNotifications,
  listUserNativeNotifications,
  registerNativePushToken,
  sendNativeNotification,
  unregisterNativePushToken,
} from "../controllers/nativeNotificationController.js";
import upload from "../middlewares/upload.js";
import saveNotificationMedia from "../middlewares/saveNotificationMedia.js";

const router = express.Router();

router.post("/register-token", registerNativePushToken);
router.delete("/register-token", unregisterNativePushToken);
router.get("/stats", getNativeNotificationStats);
router.get("/users", listNativeNotificationUsers);
router.get("/history", listNativeNotifications);
router.get("/user/:user_id", listUserNativeNotifications);
router.post("/send", upload.single("media"), saveNotificationMedia, sendNativeNotification);

export default router;
