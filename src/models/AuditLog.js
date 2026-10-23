import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: String, required: true }, // admin email or "system"
    action: { type: String, required: true }, // e.g. order.status, stock.adjust
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export const audit = (actor, action, entity, entityId, details) =>
  AuditLog.create({ actor, action, entity, entityId: String(entityId), details }).catch((err) =>
    console.error('audit log failed', err),
  );
