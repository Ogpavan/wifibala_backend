import express from "express";
import {
  signup,
  sendOtp,
  verifyOtp,
  sendForgotPasswordOtp,
  resetForgotPassword,
  createUserByAdmin,
  updateUserByAdmin,
  signin,
  getAllUsers,
  deleteUser,
  addMoneyToWallet,
  getUserWallet,
} from "../controllers/authController.js";

const router = express.Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/forgot-password/send-otp", sendForgotPasswordOtp);
router.post("/forgot-password/reset", resetForgotPassword);
router.post("/signup", signup);
router.post("/signin", signin);
router.post("/admin/users", createUserByAdmin);
router.get("/admin/users", getAllUsers);
router.put("/admin/users/:id", updateUserByAdmin);

// Soft delete user
router.delete("/admin/users/:id", deleteUser);

// Wallet routes
router.post("/wallet/add", addMoneyToWallet);
router.get("/wallet/:id", getUserWallet);

export default router;
