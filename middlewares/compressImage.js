import sharp from "sharp";
import fs from "fs";
import path from "path";

const compressImage = async (req, res, next) => {
  if (!req.file) return next();

  const outputDir = "uploads/carousel";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName =
    Date.now() + "-" + Math.round(Math.random() * 1e9) + ".webp";

  const outputPath = path.join(outputDir, fileName);

  try {
    await sharp(req.file.buffer) // ✅ FIX: buffer, NOT path
      .resize(1200, 600, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 70 })
      .toFile(outputPath);

    req.compressedImagePath = `/uploads/carousel/${fileName}`;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Image compression failed",
    });
  }
};

export default compressImage;
