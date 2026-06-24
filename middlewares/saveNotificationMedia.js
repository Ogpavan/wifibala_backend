import fs from "fs";
import path from "path";
import sharp from "sharp";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const saveNotificationMedia = async (req, res, next) => {
  if (!req.file) return next();

  if (!ALLOWED_IMAGE_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: "Notification media must be a JPG, PNG or WebP image",
    });
  }

  const outputDir = "uploads/notifications";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
  const outputPath = path.join(outputDir, fileName);

  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize(1200, 1200, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toFile(outputPath);

    req.notificationMediaPath = `/uploads/notifications/${fileName}`;
    next();
  } catch (err) {
    console.error("Notification media processing failed:", err);
    return res.status(500).json({
      success: false,
      message: "Notification media processing failed",
    });
  }
};

export default saveNotificationMedia;
