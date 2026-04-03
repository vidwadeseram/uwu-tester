import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  gitUrl: text("git_url"),
  defaultBranch: text("default_branch").default("main"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  worktrees: many(worktrees),
  spaceProjects: many(spaceProjects),
  scripts: many(scripts),
  codingSessions: many(codingSessions),
}));

export const worktrees = sqliteTable("worktrees", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  branch: text("branch").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, {
    fields: [worktrees.projectId],
    references: [projects.id],
  }),
  connections: many(connections),
}));

export const codingSessions = sqliteTable("coding_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  worktreeId: text("worktree_id").references(() => worktrees.id, {
    onDelete: "set null",
  }),
  tool: text("tool").notNull(),
  status: text("status").notNull(),
  task: text("task").notNull(),
  result: text("result"),
  durationSeconds: integer("duration_seconds"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const codingSessionsRelations = relations(codingSessions, ({ one }) => ({
  project: one(projects, {
    fields: [codingSessions.projectId],
    references: [projects.id],
  }),
  worktree: one(worktrees, {
    fields: [codingSessions.worktreeId],
    references: [worktrees.id],
  }),
}));

export const kanbanTickets = sqliteTable("kanban_tickets", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  column: text("column").notNull(),
  position: real("position").notNull(),
  priority: text("priority").default("medium"),
  assignee: text("assignee"),
  labels: text("labels"),
  dueDate: integer("due_date", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  sourceWorktreeId: text("source_worktree_id")
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  targetWorktreeId: text("target_worktree_id")
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const connectionsRelations = relations(connections, ({ one }) => ({
  sourceWorktree: one(worktrees, {
    fields: [connections.sourceWorktreeId],
    references: [worktrees.id],
    relationName: "sourceConnection",
  }),
  targetWorktree: one(worktrees, {
    fields: [connections.targetWorktreeId],
    references: [worktrees.id],
    relationName: "targetConnection",
  }),
}));

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#6366f1"),
  position: real("position").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const spacesRelations = relations(spaces, ({ many }) => ({
  spaceProjects: many(spaceProjects),
}));

export const spaceProjects = sqliteTable("space_projects", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  position: real("position").notNull(),
});

export const spaceProjectsRelations = relations(spaceProjects, ({ one }) => ({
  space: one(spaces, {
    fields: [spaceProjects.spaceId],
    references: [spaces.id],
  }),
  project: one(projects, {
    fields: [spaceProjects.projectId],
    references: [projects.id],
  }),
}));

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const ticketProviderConfigs = sqliteTable("ticket_provider_configs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  config: text("config").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  isFavorite: integer("is_favorite", { mode: "boolean" }).default(false),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  runCount: integer("run_count").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const scriptsRelations = relations(scripts, ({ one }) => ({
  project: one(projects, {
    fields: [scripts.projectId],
    references: [projects.id],
  }),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Worktree = typeof worktrees.$inferSelect;
export type NewWorktree = typeof worktrees.$inferInsert;
export type CodingSession = typeof codingSessions.$inferSelect;
export type NewCodingSession = typeof codingSessions.$inferInsert;
export type KanbanTicket = typeof kanbanTickets.$inferSelect;
export type NewKanbanTicket = typeof kanbanTickets.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;
export type SpaceProject = typeof spaceProjects.$inferSelect;
export type NewSpaceProject = typeof spaceProjects.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type TicketProviderConfig = typeof ticketProviderConfigs.$inferSelect;
export type NewTicketProviderConfig = typeof ticketProviderConfigs.$inferInsert;
export type Script = typeof scripts.$inferSelect;
export type NewScript = typeof scripts.$inferInsert;
