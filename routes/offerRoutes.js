import { Router } from "express";

import createOffer from "../controllers/Offers/createOffer.js";
import getAllOffers from "../controllers/Offers/getOffers.js";
import getUserOffers from "../controllers/Offers/getUserOffers.js";
import getOfferById from "../controllers/Offers/offerDetails.js";
import updateOffer from "../controllers/Offers/updateOffers.js";
import deleteOffer from "../controllers/Offers/deleteOffers.js";

const router = Router();

// Create offer
router.post("/create", createOffer);

// Get offers for users (only active and currently valid offers)
router.get("/user", getUserOffers);

// Get all offers (supports query params: ?is_active=true&plan_id=1)
router.get("/", getAllOffers);

// Get active offers only
router.get(
  "/active",
  (req, res, next) => {
    req.query.is_active = "true";
    next();
  },
  getAllOffers,
);

// Get offers by plan ID
router.get(
  "/plan/:planId",
  (req, res, next) => {
    req.query.plan_id = req.params.planId;
    next();
  },
  getAllOffers,
);

// Get offer details by ID
router.get("/:id", getOfferById);

// Update offer
router.put("/:id", updateOffer);

// Toggle offer status (activate/deactivate)
router.patch("/:id/toggle-status", async (req, res) => {
  try {
    const { id } = req.params;

    // Get current status
    const currentOffer = await import("../config/db.js").then((module) =>
      module.default.query("SELECT is_active FROM offers WHERE offer_id = $1", [
        id,
      ]),
    );

    if (!currentOffer.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    const newStatus = !currentOffer.rows[0].is_active;

    // Update status
    const result = await import("../config/db.js").then((module) =>
      module.default.query(
        "UPDATE offers SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE offer_id = $2 RETURNING *",
        [newStatus, id],
      ),
    );

    res.json({
      success: true,
      message: `Offer ${newStatus ? "activated" : "deactivated"} successfully`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("TOGGLE OFFER STATUS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling offer status",
      error: error.message,
    });
  }
});

// Delete offer
router.delete("/:id", deleteOffer);

export default router;
