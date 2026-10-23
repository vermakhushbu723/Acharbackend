import mongoose from 'mongoose';

export const ADMIN_ROLES = ['owner', 'order_manager', 'product_manager'];

const adminUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: 'order_manager' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const AdminUser = mongoose.model('AdminUser', adminUserSchema);
