// models/Plan.js
import { Schema, model } from 'mongoose';

const planSchema = new Schema(
  {
    providerName: { type: String, required: true, trim: true },
    speed: { type: String, required: true },
    price: { type: Number, required: true },
    validity: { type: String, required: true },
    data: { type: String, required: true },
  },
  { timestamps: true }
);

const Plan = model('Plan', planSchema);
export default Plan;
