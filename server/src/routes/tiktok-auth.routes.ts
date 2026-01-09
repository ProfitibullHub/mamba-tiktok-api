import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { tiktokAPI } from '../services/tiktok-api.service';
import { supabase } from '../config/supabase';

const router = Router();

// Store CSRF tokens and code verifiers temporarily (in production, use Redis or similar)
const csrfTokens = new Map<string, { accountId?: string; codeVerifier: string; timestamp: number }>();

// Clean up old CSRF tokens every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of csrfTokens.entries()) {
        if (now - data.timestamp > 10 * 60 * 1000) {
            csrfTokens.delete(token);
        }
    }
}, 10 * 60 * 1000);

/**
 * POST /api/tiktok/auth/start
 * Generate OAuth URL to start authentication flow
 */
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.body;

        // Generate CSRF token
        const csrfToken = crypto.randomBytes(32).toString('hex');

        // Generate PKCE code verifier and challenge
        const { codeVerifier, codeChallenge } = tiktokAPI.generatePKCE();

        // Store both CSRF token and code verifier
        csrfTokens.set(csrfToken, { accountId, codeVerifier, timestamp: Date.now() });

        // Generate OAuth URL with code challenge
        const authUrl = tiktokAPI.generateAuthUrl(csrfToken, codeChallenge, accountId);

        res.json({
            success: true,
            authUrl,
            csrfToken,
        });
    } catch (error: any) {
        console.error('Error starting OAuth:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to start OAuth flow',
        });
    }
});

/**
 * GET /api/tiktok/auth/callback
 * Handle OAuth callback from TikTok
 */
router.get('/callback', async (req: Request, res: Response) => {
    try {
        const { code, state, error, error_description } = req.query;

        // Check for OAuth errors
        if (error) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            return res.redirect(`${frontendUrl}?tiktok_error=${encodeURIComponent(error_description as string || error as string)}`);
        }

        if (!code || !state) {
            throw new Error('Missing code or state parameter');
        }

        // Parse and validate state
        const stateData = JSON.parse(state as string);
        const { csrf, accountId } = stateData;

        // Validate CSRF token and get code verifier
        const storedData = csrfTokens.get(csrf);
        if (!storedData) {
            throw new Error('Invalid or expired CSRF token');
        }

        const { codeVerifier } = storedData;
        csrfTokens.delete(csrf);

        // Exchange code for tokens using code verifier
        const tokens = await tiktokAPI.getAccessToken(code as string, codeVerifier);

        // Calculate token expiry
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        // Save tokens to database
        const { error: dbError } = await supabase
            .from('tiktok_auth_tokens')
            .upsert({
                account_id: accountId,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_type: tokens.token_type,
                expires_at: expiresAt.toISOString(),
                scope: tokens.scope,
                open_id: tokens.open_id,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'account_id',
            });

        if (dbError) {
            console.error('Error saving tokens:', dbError);
            throw new Error('Failed to save authentication tokens');
        }

        // AUTO-SYNC: Fetch user data immediately after authentication
        try {
            console.log(`Auto-syncing TikTok data for account ${accountId}...`);

            // Import sync service dynamically to avoid circular dependencies
            const { tiktokSyncService } = await import('../services/tiktok-sync.service');

            // Sync user data and videos
            await tiktokSyncService.syncUserData(accountId);
            await tiktokSyncService.syncVideos(accountId);

            console.log(`Auto-sync completed for account ${accountId}`);
        } catch (syncError: any) {
            console.error('Error during auto-sync:', syncError);
            // Don't fail the OAuth flow if sync fails - user can manually sync later
        }

        // Redirect back to frontend with success
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}?tiktok_connected=true&account_id=${accountId}`);
    } catch (error: any) {
        console.error('Error in OAuth callback:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}?tiktok_error=${encodeURIComponent(error.message)}`);
    }
});

/**
 * POST /api/tiktok/auth/refresh
 * Manually refresh access token
 */
router.post('/refresh/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        // Get current tokens
        const { data: tokenData, error: fetchError } = await supabase
            .from('tiktok_auth_tokens')
            .select('refresh_token')
            .eq('account_id', accountId)
            .single();

        if (fetchError || !tokenData) {
            return res.status(404).json({
                success: false,
                error: 'No TikTok authentication found for this account',
            });
        }

        // Refresh token
        const newTokens = await tiktokAPI.refreshAccessToken(tokenData.refresh_token);
        const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

        // Update database
        const { error: updateError } = await supabase
            .from('tiktok_auth_tokens')
            .update({
                access_token: newTokens.access_token,
                refresh_token: newTokens.refresh_token,
                expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('account_id', accountId);

        if (updateError) {
            throw new Error('Failed to update tokens');
        }

        res.json({
            success: true,
            message: 'Token refreshed successfully',
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error: any) {
        console.error('Error refreshing token:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to refresh token',
        });
    }
});

/**
 * DELETE /api/tiktok/auth/disconnect/:accountId
 * Disconnect TikTok account
 */
router.delete('/disconnect/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        // Delete auth tokens
        const { error } = await supabase
            .from('tiktok_auth_tokens')
            .delete()
            .eq('account_id', accountId);

        if (error) {
            throw new Error('Failed to disconnect account');
        }

        res.json({
            success: true,
            message: 'TikTok account disconnected successfully',
        });
    } catch (error: any) {
        console.error('Error disconnecting account:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to disconnect account',
        });
    }
});

/**
 * GET /api/tiktok/auth/status/:accountId
 * Check if account is connected to TikTok
 */
router.get('/status/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const { data, error } = await supabase
            .from('tiktok_auth_tokens')
            .select('open_id, expires_at, scope')
            .eq('account_id', accountId)
            .single();

        if (error || !data) {
            return res.json({
                success: true,
                connected: false,
            });
        }

        const isExpired = new Date(data.expires_at) < new Date();

        res.json({
            success: true,
            connected: true,
            openId: data.open_id,
            expiresAt: data.expires_at,
            isExpired,
            scope: data.scope,
        });
    } catch (error: any) {
        console.error('Error checking auth status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check auth status',
        });
    }
});

export default router;
