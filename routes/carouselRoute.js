import express from "express";
import upload from "../middlewares/upload.js";
import compressImage from "../middlewares/compressImage.js";

import {
  createSlide,
  getSlide,
  updateSlide,
  deleteSlide,
  listSlides,
} from "../controllers/carousel/carouselController.js";

const router = express.Router();

router.post("/", upload.single("image"), compressImage, createSlide);

router.get("/", listSlides);
router.get("/:position", getSlide);

router.put("/:position", upload.single("image"), compressImage, updateSlide);

router.delete("/:position", deleteSlide);

export default router;
