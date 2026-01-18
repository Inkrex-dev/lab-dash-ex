import express, { Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { notes } from '../db/schema';
import { authenticateToken } from '../middleware/auth.middleware';
import { Note } from '../types';
import { loadConfig } from '../utils/config-lookup';

export const notesRoute = express.Router();

notesRoute.get('/', (req: Request, res: Response) => {
    try {
        const configData = loadConfig();
        const allNotes = db.select().from(notes).all();

        const globalDefaultFontSize = configData.defaultNoteFontSize || '16px';
        const migratedNotes = allNotes.map(note => {
            if (!note.fontSize) {
                db.update(notes)
                    .set({ fontSize: globalDefaultFontSize })
                    .where(eq(notes.id, note.id))
                    .run();
                return { ...note, fontSize: globalDefaultFontSize };
            }
            return note;
        });

        migratedNotes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        res.json(migratedNotes);
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

notesRoute.post('/', authenticateToken, (req: Request, res: Response) => {
    try {
        const { id, title, content, fontSize } = req.body;
        const configData = loadConfig();
        const globalDefaultFontSize = configData.defaultNoteFontSize || '16px';

        if (!id || typeof id !== 'string') {
            res.status(400).json({ error: 'ID is required and must be a string' });
            return;
        }

        if (!title || typeof title !== 'string') {
            res.status(400).json({ error: 'Title is required and must be a string' });
            return;
        }

        const existingNote = db.select().from(notes).where(eq(notes.id, id)).get();
        if (existingNote) {
            res.status(409).json({ error: 'Note with this ID already exists' });
            return;
        }

        const now = new Date();

        db.insert(notes).values({
            id,
            title: title.trim(),
            content: (content || '').trim(),
            createdAt: now,
            updatedAt: now,
            fontSize: fontSize || globalDefaultFontSize,
        }).run();

        const newNote: Note = {
            id,
            title: title.trim(),
            content: (content || '').trim(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            fontSize: fontSize || globalDefaultFontSize,
        };

        res.status(201).json(newNote);
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: 'Failed to create note' });
    }
});

notesRoute.put('/update-all-font-sizes', authenticateToken, (req: Request, res: Response) => {
    try {
        const { fontSize } = req.body;

        if (!fontSize || typeof fontSize !== 'string') {
            res.status(400).json({ error: 'Font size is required and must be a string' });
            return;
        }

        const allNotes = db.select().from(notes).all();
        let updatedCount = 0;

        for (const note of allNotes) {
            db.update(notes)
                .set({ fontSize })
                .where(eq(notes.id, note.id))
                .run();
            updatedCount++;
        }

        res.json({
            message: `Updated font size for ${updatedCount} notes`,
            updatedCount
        });
    } catch (error) {
        console.error('Error updating font sizes for all notes:', error);
        res.status(500).json({ error: 'Failed to update font sizes for all notes' });
    }
});

notesRoute.put('/:id', authenticateToken, (req: Request, res: Response) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { title, content, fontSize } = req.body;
        const configData = loadConfig();
        const globalDefaultFontSize = configData.defaultNoteFontSize || '16px';

        if (!title || typeof title !== 'string') {
            res.status(400).json({ error: 'Title is required and must be a string' });
            return;
        }

        const existingNote = db.select().from(notes).where(eq(notes.id, id)).get();

        if (!existingNote) {
            res.status(404).json({ error: 'Note not found' });
            return;
        }

        const updatedAt = new Date();
        db.update(notes)
            .set({
                title: title.trim(),
                content: (content || '').trim(),
                fontSize: fontSize || existingNote.fontSize || globalDefaultFontSize,
                updatedAt,
            })
            .where(eq(notes.id, id))
            .run();

        const updatedNote: Note = {
            id,
            title: title.trim(),
            content: (content || '').trim(),
            fontSize: fontSize || existingNote.fontSize || globalDefaultFontSize,
            createdAt: existingNote.createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        };

        res.json(updatedNote);
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

notesRoute.delete('/:id', authenticateToken, (req: Request, res: Response) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const existingNote = db.select().from(notes).where(eq(notes.id, id)).get();

        if (!existingNote) {
            res.status(404).json({ error: 'Note not found' });
            return;
        }

        db.delete(notes).where(eq(notes.id, id)).run();

        res.status(204).send();
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});
