export const PERMISSIONS = [
  "dashboard.view", "booking.view_all", "booking.view_own", "booking.create", "booking.edit",
  "booking.cancel", "booking.update_status", "payment.view_evidence", "payment.approve", "payment.record_balance",
  "payment.record_refund", "payment.settings", "customer.view", "customer.view_contact", "customer.edit", "customer.block",
  "customer.notes", "customer.export", "customer.import", "staff.manage", "staff.edit_own_availability",
  "service.manage", "content.manage", "review.moderate", "promotion.manage", "settings.business", "settings.booking_rules",
  "settings.notifications", "report.financial", "report.analytics", "audit.view", "role.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleName = "OWNER" | "MANAGER" | "STAFF" | "CUSTOMER";

/** Never grantable to anyone but OWNER, even if a role override tries. */
export const OWNER_ONLY: ReadonlySet<Permission> = new Set<Permission>(["payment.settings", "role.manage", "audit.view", "settings.notifications"]);

export const ROLE_DEFAULTS: Record<RoleName, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  MANAGER: ["dashboard.view","booking.view_all","booking.create","booking.edit","booking.cancel","booking.update_status",
    "payment.view_evidence","customer.view","customer.view_contact","customer.edit","customer.notes","staff.manage","service.manage",
    "content.manage","review.moderate","promotion.manage","report.analytics"],
  STAFF: ["dashboard.view", "booking.view_own", "booking.update_status"],
  CUSTOMER: [],
};

export function effectivePermissions(role: RoleName, grants: Permission[] = [], revokes: Permission[] = []): Set<Permission> {
  const set = new Set<Permission>(ROLE_DEFAULTS[role]);
  for (const g of grants) if (role === "OWNER" || !OWNER_ONLY.has(g)) set.add(g);
  if (role !== "OWNER") for (const r of revokes) set.delete(r);
  return set;
}
export const can = (perms: ReadonlySet<string>, p: Permission) => perms.has(p);

/** Throwing guard used at the top of every server action / route handler. */
export class ForbiddenError extends Error { constructor(p: string) { super(`Forbidden: ${p}`); this.name = "ForbiddenError"; } }
export function requirePermission(perms: ReadonlySet<string>, p: Permission): void { if (!perms.has(p)) throw new ForbiddenError(p); }
