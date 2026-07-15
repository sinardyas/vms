import { relations } from "drizzle-orm";
import { users } from "./auth";
import { roles, rolePermissions, userRoles } from "./rbac";
import {
  approvalRoutes,
  approvalRouteSteps,
  categoryDocumentRequirements,
  documentMaster,
  vendorCategories,
} from "./master-data";
import {
  vendorBankCurrencies,
  vendorBanks,
  vendorSubUsers,
  vendors,
} from "./vendors";
import { documentSlots, documentVersions } from "./documents";
import { approvalRequestSteps, approvalRequests } from "./approvals";

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(vendorSubUsers),
  roles: many(userRoles),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  lead: one(users, { fields: [roles.leadUserId], references: [users.id] }),
  permissions: many(rolePermissions),
  members: many(userRoles),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  category: one(vendorCategories, {
    fields: [vendors.categoryId],
    references: [vendorCategories.id],
  }),
  subUsers: many(vendorSubUsers),
  banks: many(vendorBanks),
  documentSlots: many(documentSlots),
  approvalRequests: many(approvalRequests),
}));

export const vendorSubUsersRelations = relations(vendorSubUsers, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorSubUsers.vendorId], references: [vendors.id] }),
  user: one(users, { fields: [vendorSubUsers.userId], references: [users.id] }),
}));

export const vendorBanksRelations = relations(vendorBanks, ({ one, many }) => ({
  vendor: one(vendors, { fields: [vendorBanks.vendorId], references: [vendors.id] }),
  currencies: many(vendorBankCurrencies),
}));

export const vendorBankCurrenciesRelations = relations(vendorBankCurrencies, ({ one }) => ({
  vendorBank: one(vendorBanks, {
    fields: [vendorBankCurrencies.vendorBankId],
    references: [vendorBanks.id],
  }),
}));

export const documentSlotsRelations = relations(documentSlots, ({ one, many }) => ({
  vendor: one(vendors, { fields: [documentSlots.vendorId], references: [vendors.id] }),
  documentType: one(documentMaster, {
    fields: [documentSlots.documentMasterId],
    references: [documentMaster.id],
  }),
  versions: many(documentVersions),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  slot: one(documentSlots, {
    fields: [documentVersions.slotId],
    references: [documentSlots.id],
  }),
}));

export const documentMasterRelations = relations(documentMaster, ({ many }) => ({
  categoryRequirements: many(categoryDocumentRequirements),
}));

export const categoryDocumentRequirementsRelations = relations(
  categoryDocumentRequirements,
  ({ one }) => ({
    category: one(vendorCategories, {
      fields: [categoryDocumentRequirements.categoryId],
      references: [vendorCategories.id],
    }),
    documentType: one(documentMaster, {
      fields: [categoryDocumentRequirements.documentMasterId],
      references: [documentMaster.id],
    }),
  }),
);

export const approvalRoutesRelations = relations(approvalRoutes, ({ many }) => ({
  steps: many(approvalRouteSteps),
}));

export const approvalRouteStepsRelations = relations(approvalRouteSteps, ({ one }) => ({
  route: one(approvalRoutes, {
    fields: [approvalRouteSteps.routeId],
    references: [approvalRoutes.id],
  }),
  role: one(roles, { fields: [approvalRouteSteps.roleId], references: [roles.id] }),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [approvalRequests.subjectVendorId],
    references: [vendors.id],
  }),
  route: one(approvalRoutes, {
    fields: [approvalRequests.routeId],
    references: [approvalRoutes.id],
  }),
  steps: many(approvalRequestSteps),
}));

export const approvalRequestStepsRelations = relations(approvalRequestSteps, ({ one }) => ({
  request: one(approvalRequests, {
    fields: [approvalRequestSteps.requestId],
    references: [approvalRequests.id],
  }),
  role: one(roles, { fields: [approvalRequestSteps.roleId], references: [roles.id] }),
  assignee: one(users, {
    fields: [approvalRequestSteps.assigneeUserId],
    references: [users.id],
  }),
}));
