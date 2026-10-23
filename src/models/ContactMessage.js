import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    contact: { type: String, required: true }, // phone or email
    orderNumber: { type: String, default: '' },
    subject: { type: String, default: '' },
    message: { type: String, required: true },
    status: { type: String, enum: ['new', 'in_progress', 'closed'], default: 'new' },
  },
  { timestamps: true },
);

export const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
