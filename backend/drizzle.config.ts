import type { Config } from 'drizzle-kit';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, './data/database.db');

export default {
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        url: DB_PATH,
    },
} satisfies Config;
