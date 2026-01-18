import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

import { initializeDatabase, db } from './index';
import { users, dashboardConfig, notes, backupMetadata } from './schema';

const CONFIG_FILE = path.join(__dirname, '../config/config.json');
const USERS_FILE = path.join(__dirname, '../config/users.json');

// TODO: update accordingly when I make my mind up about the schema
export const migrateFromFiles = async () => {
    await initializeDatabase();

    const existingConfig = db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'main')).get();
    if (existingConfig) {
        console.log('Database already initialized, skipping migration');
        return;
    }

    if (fs.existsSync(CONFIG_FILE)) {
        const configData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        const notesData = configData.notes || [];
        delete configData.notes;

        db.insert(dashboardConfig).values({
            key: 'main',
            value: JSON.stringify(configData),
            createdAt: new Date(),
            updatedAt: new Date(),
        }).run();

        if (notesData.length > 0) {
            const notesToInsert = notesData.map((note: any) => ({
                id: note.id,
                title: note.title,
                content: note.content || '',
                fontSize: note.fontSize,
                createdAt: new Date(note.createdAt),
                updatedAt: new Date(note.updatedAt),
            }));

            for (const note of notesToInsert) {
                db.insert(notes).values(note).run();
            }
        }

        console.log('Migrated config and notes from JSON files');
    }

    if (fs.existsSync(USERS_FILE)) {
        const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));

        for (const user of usersData) {
            db.insert(users).values({
                username: user.username,
                passwordHash: user.passwordHash,
                role: user.role || 'user',
                refreshTokens: JSON.stringify(user.refreshTokens || []),
            }).run();
        }

        console.log('Migrated users from JSON files');
    }

    console.log('Migration complete');
};
