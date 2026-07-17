// Access control substrate (M0.4): request context + actor, RBAC permission model + capabilities.
export * from "./actor";
export * from "./rbac";
// Approver eligibility + separation of duties (M1.6, ADR-0009).
export * from "./eligibility";
// Role-grant eligibility — roles only grant to internal users (#96).
export * from "./grants";
