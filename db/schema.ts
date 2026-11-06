import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import type { Loja, VisitGeometry, Visit } from "../app/lib/types";

export const lojas = sqliteTable("lojas", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  code: text("code").notNull().unique(),
  plateNumber: integer("plate_number").unique(),
  legacyCode: text("legacy_code").unique(),
  name: text("name").notNull(),
  targetUrl: text("target_url").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  scans: integer("scans").notNull().default(0),
  lastAccess: text("last_access"),
  joinedAt: text("joined_at"),
  initialReviews: integer("initial_reviews"),
  currentReviews: integer("current_reviews"),
  reviewsUpdatedAt: text("reviews_updated_at"),
  ownerName: text("owner_name").notNull().default(""),
  ownerPhone: text("owner_phone").notNull().default(""),
  address: text("address").notNull().default(""),
  neighborhood: text("neighborhood").notNull().default(""),
  notes: text("notes").notNull().default(""),
  nextContactAt: text("next_contact_at"),
  googlePlaceId: text("google_place_id"),
  googleProfileUrl: text("google_profile_url"),
  googleRating: real("google_rating"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  googleSyncedAt: text("google_synced_at"),
  businessPhone: text("business_phone").notNull().default(""),
  reviewSource: text("review_source").$type<Loja["reviewSource"]>().notNull().default("manual"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("lojas_owner_idx").on(table.ownerId)]);

export const adminSessions = sqliteTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  credentialVersion: text("credential_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("admin_sessions_expiry_idx").on(table.expiresAt)]);

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("login_attempts_expiry_idx").on(table.expiresAt)]);

export const plateSequence = sqliteTable("plate_sequence", {
  id: integer("id").primaryKey(),
  value: integer("value").notNull(),
});

export const plateHistory = sqliteTable("plate_history", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  plateId: text("plate_id").notNull().references(() => lojas.id),
  snapshot: text("snapshot", { mode: "json" }).$type<Loja>().notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("plate_history_owner_plate_idx").on(table.ownerId, table.plateId)]);

export const plateCodeAliases = sqliteTable("plate_code_aliases", {
  code: text("code").primaryKey(),
  plateId: text("plate_id").notNull().references(() => lojas.id),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("plate_code_aliases_owner_plate_idx").on(table.ownerId, table.plateId)]);

export const visitas = sqliteTable("visitas", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  geometry: text("geometry", { mode: "json" }).$type<VisitGeometry>().notNull(),
  status: text("status").$type<Visit["status"]>().notNull(),
  visitedAt: text("visited_at").notNull(),
  notes: text("notes").notNull().default(""),
  address: text("address").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("visitas_owner_idx").on(table.ownerId)]);
