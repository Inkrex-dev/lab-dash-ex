import { eq } from 'drizzle-orm';

import { db } from '../db';
import { backupMetadata, dashboardConfig } from '../db/schema';
import { Config } from '../types';
import { loadConfig } from './config-lookup';

interface BackupMetadata {
    lastBackupTime: number;
    nextBackupTime: number;
    backupIntervalMs: number;
}

export class BackupService {
    private static instance: BackupService;
    private backupIntervalMs = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
    private intervalId: ReturnType<typeof setInterval> | null = null;

    private constructor() {}

    public static getInstance(): BackupService {
        if (!BackupService.instance) {
            BackupService.instance = new BackupService();
        }
        return BackupService.instance;
    }

    public async initialize(): Promise<void> {
        try {
            const shouldBackup = await this.shouldPerformBackup();
            if (shouldBackup) {
                await this.performBackup();
            }

            this.startBackupSchedule();

            console.log('Backup service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize backup service:', error);
        }
    }

    /**
     * Stop the backup service
     */
    public stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Backup service stopped');
        }
    }


    /**
     * Check if a backup should be performed based on the last backup time
     */
    private async shouldPerformBackup(): Promise<boolean> {
        try {
            const metadata = await this.loadBackupMetadata();
            const currentTime = Date.now();

            // If no previous backup or it's been more than a week, perform backup
            return !metadata.lastBackupTime || (currentTime >= metadata.nextBackupTime);
        } catch {
            // If metadata doesn't exist, we should perform a backup
            return true;
        }
    }

    private async loadBackupMetadata(): Promise<BackupMetadata> {
        const metadataRow = db.select().from(backupMetadata).limit(1).get();
        if (metadataRow) {
            return {
                lastBackupTime: metadataRow.lastBackupTime || 0,
                nextBackupTime: metadataRow.nextBackupTime || 0,
                backupIntervalMs: metadataRow.backupIntervalMs || this.backupIntervalMs,
            };
        }
        const currentTime = Date.now();
        return {
            lastBackupTime: 0,
            nextBackupTime: currentTime + this.backupIntervalMs,
            backupIntervalMs: this.backupIntervalMs,
        };
    }

    private async saveBackupMetadata(metadata: BackupMetadata): Promise<void> {
        const existing = db.select().from(backupMetadata).limit(1).get();
        if (existing) {
            db.update(backupMetadata)
                .set({
                    lastBackupTime: metadata.lastBackupTime,
                    nextBackupTime: metadata.nextBackupTime,
                    backupIntervalMs: metadata.backupIntervalMs,
                })
                .where(eq(backupMetadata.id, existing.id))
                .run();
        } else {
            db.insert(backupMetadata).values({
                lastBackupTime: metadata.lastBackupTime,
                nextBackupTime: metadata.nextBackupTime,
                backupIntervalMs: metadata.backupIntervalMs,
            }).run();
        }
    }

    public async performBackup(): Promise<void> {
        try {
            const configData = loadConfig();

            const backupData = {
                ...configData,
                _backupMetadata: {
                    createdAt: new Date().toISOString(),
                    backupVersion: '1.0',
                },
            };

            const backupKey = 'backup_weekly';
            const existingBackup = db.select().from(dashboardConfig).where(eq(dashboardConfig.key, backupKey)).get();

            if (existingBackup) {
                db.update(dashboardConfig)
                    .set({
                        value: JSON.stringify(backupData),
                        updatedAt: new Date(),
                    })
                    .where(eq(dashboardConfig.key, backupKey))
                    .run();
            } else {
                db.insert(dashboardConfig).values({
                    key: backupKey,
                    value: JSON.stringify(backupData),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }).run();
            }

            const currentTime = Date.now();
            const metadata: BackupMetadata = {
                lastBackupTime: currentTime,
                nextBackupTime: currentTime + this.backupIntervalMs,
                backupIntervalMs: this.backupIntervalMs,
            };
            await this.saveBackupMetadata(metadata);

            console.log(`Config backup created successfully at: ${new Date().toISOString()}`);
        } catch (error) {
            console.error('Failed to perform backup:', error);
            throw error;
        }
    }

    /**
     * Start the periodic backup schedule
     */
    private startBackupSchedule(): void {
        // Clear any existing interval
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        // Check every hour if a backup is needed
        this.intervalId = setInterval(async () => {
            try {
                const shouldBackup = await this.shouldPerformBackup();
                if (shouldBackup) {
                    await this.performBackup();
                }
            } catch (error) {
                console.error('Error during scheduled backup check:', error);
            }
        }, 60 * 60 * 1000); // Check every hour

        console.log('Backup schedule started');
    }

    public async getBackupStatus(): Promise<{
        lastBackupTime: string | null;
        nextBackupTime: string;
        backupExists: boolean;
    }> {
        try {
            const metadata = await this.loadBackupMetadata();
            const backupRow = db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'backup_weekly')).get();

            return {
                lastBackupTime: metadata.lastBackupTime ? new Date(metadata.lastBackupTime).toISOString() : null,
                nextBackupTime: new Date(metadata.nextBackupTime).toISOString(),
                backupExists: !!backupRow,
            };
        } catch (error) {
            console.error('Error getting backup status:', error);
            return {
                lastBackupTime: null,
                nextBackupTime: new Date(Date.now() + this.backupIntervalMs).toISOString(),
                backupExists: false,
            };
        }
    }

    public async triggerManualBackup(): Promise<void> {
        await this.performBackup();
    }

    public async restoreFromBackup(): Promise<void> {
        try {
            const backupRow = db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'backup_weekly')).get();

            if (!backupRow) {
                throw new Error('No backup found');
            }

            const backupData = JSON.parse(backupRow.value);
            const { _backupMetadata, ...configData } = backupData;

            const mainConfig = db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'main')).get();
            if (mainConfig) {
                db.update(dashboardConfig)
                    .set({
                        value: JSON.stringify(configData),
                        updatedAt: new Date(),
                    })
                    .where(eq(dashboardConfig.key, 'main'))
                    .run();
            } else {
                db.insert(dashboardConfig).values({
                    key: 'main',
                    value: JSON.stringify(configData),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }).run();
            }

            console.log('Config restored from backup successfully');
        } catch (error) {
            console.error('Failed to restore from backup:', error);
            throw error;
        }
    }
}

export default BackupService;
