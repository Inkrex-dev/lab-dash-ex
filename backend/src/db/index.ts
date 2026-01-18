import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';

import * as schema from './schema';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/database.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/*
 To the eagle eyed reader, yes I am aware that the schema is not being used.
 That is simply because I don't want migrations for something that might be heavily changed during development.

 As soon as I am sure of the database structure (or at least partly), I will switch to using the schema migration approach ofc.
 
 P.S. Drizzle my beloved 🙏
*/
export const initializeDatabase = async () => {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS infra_info (
            id TEXT PRIMARY KEY,
            date INTEGER NOT NULL,
            version TEXT NOT NULL,
            commit_hash TEXT NOT NULL,
            last_drizzle_migration TEXT,
            database_type TEXT NOT NULL DEFAULT 'sqlite'
        );
        
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            refresh_tokens TEXT,
            default_dashboard_id TEXT
        );
        
        CREATE TABLE IF NOT EXISTS dashboard_config (
            id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );
        
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            font_size TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS backup_metadata (
            id TEXT PRIMARY KEY,
            last_backup_time INTEGER,
            next_backup_time INTEGER,
            backup_interval_ms INTEGER
        );
        
        CREATE TABLE IF NOT EXISTS dashboard (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Dashboard',
            config_id TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (config_id) REFERENCES config(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
    `);
};
