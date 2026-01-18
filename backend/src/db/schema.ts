import { randomUUID } from 'crypto';
import { foreignKey, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// this table will be used for extra migration settings
// TODO 1:     incorporate into the migration process
// TODO 2:     after main work is done, add a way to switch DBs (if needed)
// TODO 2.1:   if I do the 2nd thing, create apropriate drizzle schemes, proccesses, etc.
export const exStatus = sqliteTable('infra_info', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    version: text('version').notNull(),
    commitHash: text('commit_hash').notNull(),
    lastDrizzleMigration: text('last_drizzle_migration'),
    databaseType: text('database_type').notNull().default('sqlite'),
});

export const users = sqliteTable('users', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('user'),
    refreshTokens: text('refresh_tokens'),
    defaultDashboardId: text('default_dashboard_id'),
});

export const dashboardConfig = sqliteTable('dashboard_config', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    key: text('key').notNull().unique(),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const notes = sqliteTable('notes', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content'),
    fontSize: text('font_size'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const backupMetadata = sqliteTable('backup_metadata', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    lastBackupTime: integer('last_backup_time'),
    nextBackupTime: integer('next_backup_time'),
    backupIntervalMs: integer('backup_interval_ms'),
});

export const dashboard = sqliteTable('dashboard', {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    title: text('title').notNull().default('Dashboard'),
    dashboardConfigId: text('dashboard_config_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
    foreignKey({
        columns: [table.dashboardConfigId],
        foreignColumns: [dashboardConfig.id],
    }),
    foreignKey({
        columns: [table.createdBy],
        foreignColumns: [users.id],
    }),
]);
