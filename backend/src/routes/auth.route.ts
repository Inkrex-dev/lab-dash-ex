import bcrypt from 'bcrypt';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users } from '../db/schema';
import { authenticateToken } from '../middleware/auth.middleware';

export const authRoute = Router();
const JWT_SECRET = process.env.SECRET || false;
const REFRESH_TOKEN_SECRET = process.env.SECRET || false;
const ACCESS_TOKEN_EXPIRY = '3d';
const REFRESH_TOKEN_EXPIRY = '7d';

if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_SECRET or REFRESH_TOKEN_SECRET is not set');
}

// Generate access token
const generateAccessToken = (username: string, role: string): string => {
    return jwt.sign({ username, role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
};

// Generate refresh token
const generateRefreshToken = (username: string): string => {
    return jwt.sign({ username }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
};

// Helper to get refresh token expiration date
const getTokenExpiration = (token: string): Date | null => {
    try {
        const decoded = jwt.decode(token) as { exp: number } | null;
        if (decoded && decoded.exp) {
            return new Date(decoded.exp * 1000);
        }
        return null;
    } catch (err) {
        console.error('Failed to decode token for expiration check:', err);
        return null;
    }
};

// Signup route
authRoute.post('/signup', async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            res.status(400).json({ message: 'Username and password are required' });
            return;
        }

        const existingUser = db.select().from(users).where(eq(users.username, username)).get();
        if (existingUser) {
            res.status(409).json({ message: 'Username already exists' });
            return;
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const allUsers = db.select().from(users).all();
        const role = allUsers.length === 0 ? 'admin' : 'user';

        db.insert(users).values({
            username,
            passwordHash,
            role,
            refreshTokens: JSON.stringify([]),
        }).run();

        // Return success response
        res.status(201).json({ message: 'User created successfully', username });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login route
authRoute.post('/login', async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            res.status(400).json({ message: 'Username and password are required' });
            return;
        }

        const user = db.select().from(users).where(eq(users.username, username)).get();

        if (!user) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);

        if (!passwordMatch) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        const token = generateAccessToken(username, user.role);
        const refreshToken = generateRefreshToken(username);

        const refreshTokens = user.refreshTokens ? JSON.parse(user.refreshTokens) : [];
        refreshTokens.push(refreshToken);

        db.update(users)
            .set({ refreshTokens: JSON.stringify(refreshTokens) })
            .where(eq(users.id, user.id))
            .run();

        // Set secure HTTP-only cookies
        res.cookie('access_token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
        });

        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
        });

        res.json({
            message: 'Login successful',
            username: username,
            isAdmin: user.role === 'admin'
        });
        console.log('login successful');
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Refresh token route
authRoute.post('/refresh', async (req: Request, res: Response) => {
    try {
        console.log('Refresh token request received');

        // Get refresh token from cookie
        const refreshToken = req.cookies?.refresh_token;

        if (!refreshToken) {
            console.log('No refresh token in cookies');
            // Don't send a 400 error, just indicate no refresh needed
            res.status(204).end(); // 204 No Content - request processed but no content to return
            return;
        }

        // Check token expiration date
        const expirationDate = getTokenExpiration(refreshToken);
        if (expirationDate) {
            const now = new Date();
            const timeLeft = expirationDate.getTime() - now.getTime();
            const minutesLeft = Math.floor(timeLeft / (1000 * 60));
            console.log(`Token expiration date: ${expirationDate.toISOString()}, ${minutesLeft} minutes left`);
        }

        // Verify refresh token
        let decoded: any;
        let tokenExpired = false;

        try {
            decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { username: string };
            console.log('Refresh token verified for username');
        } catch (err: any) {
            tokenExpired = err.name === 'TokenExpiredError';
            console.log('Token verification failed:', err.name, err.message);

            if (tokenExpired) {
                console.log('Refresh token expired, clearing cookies');
                // Clear the cookies with all necessary options
                res.clearCookie('access_token', {
                    httpOnly: true,
                    secure: false,
                    sameSite: 'lax',
                    path: '/'
                });

                res.clearCookie('refresh_token', {
                    httpOnly: true,
                    secure: false,
                    sameSite: 'lax',
                    path: '/'
                });

                console.log('Cookies cleared on server due to expired token');
                res.status(401).json({ message: 'Refresh token expired' });
            } else {
                res.status(401).json({ message: 'Invalid refresh token' });
            }
            return;
        }

        const user = db.select().from(users).where(eq(users.username, decoded.username)).get();

        if (!user) {
            console.log('User does not exist in database');
            res.clearCookie('access_token', {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/'
            });
            res.clearCookie('refresh_token', {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/'
            });
            res.status(401).json({ message: 'User not found' });
            return;
        }

        const userRefreshTokens = user.refreshTokens ? JSON.parse(user.refreshTokens) : [];
        const tokenIndex = userRefreshTokens.indexOf(refreshToken);

        if (tokenIndex === -1) {
            console.log('Refresh token not found in user record');

            const allUsers = db.select().from(users).all();
            for (const u of allUsers) {
                if (u.refreshTokens) {
                    const tokens = JSON.parse(u.refreshTokens);
                    const filtered = tokens.filter((t: string) => t !== refreshToken);
                    if (filtered.length !== tokens.length) {
                        db.update(users)
                            .set({ refreshTokens: JSON.stringify(filtered) })
                            .where(eq(users.id, u.id))
                            .run();
                    }
                }
            }

            // Clear the cookies with all necessary options
            res.clearCookie('access_token', {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/'
            });

            res.clearCookie('refresh_token', {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                path: '/'
            });

            console.log('Cookies cleared on server due to token not found in user record');

            // Send response AFTER clearing cookies, not before
            res.status(401).json({ message: 'Refresh token not found' });
            return;
        }

        console.log('Found valid refresh token for user');

        const newAccessToken = generateAccessToken(decoded.username, user.role);

        // Set the new access token cookie
        res.cookie('access_token', newAccessToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        // Generate and set new refresh token
        const newRefreshToken = generateRefreshToken(decoded.username);
        res.cookie('refresh_token', newRefreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        userRefreshTokens.splice(tokenIndex, 1);
        userRefreshTokens.push(newRefreshToken);

        db.update(users)
            .set({ refreshTokens: JSON.stringify(userRefreshTokens) })
            .where(eq(users.id, user.id))
            .run();

        console.log('New access token set successfully for user');

        res.json({
            message: 'Token refreshed successfully',
            isAdmin: user.role === 'admin'
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Logout route
authRoute.post('/logout', (req: Request, res: Response) => {
    try {
        // Get refresh token from cookie
        const refreshToken = req.cookies?.refresh_token;

        if (refreshToken) {
            console.log('Logout request with valid refresh token');

            const allUsers = db.select().from(users).all();
            for (const user of allUsers) {
                if (user.refreshTokens) {
                    const tokens = JSON.parse(user.refreshTokens);
                    if (tokens.includes(refreshToken)) {
                        console.log('Removing refresh token from user:', user.username);
                        const filtered = tokens.filter((t: string) => t !== refreshToken);
                        db.update(users)
                            .set({ refreshTokens: JSON.stringify(filtered) })
                            .where(eq(users.id, user.id))
                            .run();
                        break;
                    }
                }
            }
        } else {
            // If no refresh token is provided, it might be a request from a service
            // Don't clear cookies in this case to avoid disrupting service auth
            console.log('Logout request without refresh token - not clearing cookies');
            res.json({ message: 'No session to logout' });
            return;
        }

        // Clear cookies with identical settings to how they were set
        res.clearCookie('access_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/'
        });

        res.clearCookie('refresh_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/'
        });

        // Additionally clear without httpOnly for client-side cookies
        res.clearCookie('access_token', {
            secure: false,
            path: '/'
        });

        res.clearCookie('refresh_token', {
            secure: false,
            path: '/'
        });

        console.log('Auth cookies cleared by server');
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

authRoute.get('/check-users', (req: Request, res: Response) => {
    try {
        const allUsers = db.select().from(users).all();
        res.json({ hasUsers: allUsers.length > 0 });
    } catch (error) {
        console.error('Error checking users:', error);
        res.status(500).json({ message: 'Failed to check if users exist' });
    }
});

// Check if the current user is an admin
authRoute.get('/check-admin', [authenticateToken], (req: Request, res: Response) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        res.json({ isAdmin });
    } catch (error) {
        console.error('Error checking admin status:', error);
        res.status(500).json({ message: 'Failed to check admin status' });
    }
});

authRoute.get('/check-cookies', (req: Request, res: Response) => {
    // console.log('Cookies received:', req.cookies);
    res.json({
        cookies: req.cookies,
        hasAccessToken: !!req.cookies.access_token,
        hasRefreshToken: !!req.cookies.refresh_token
    });
});
