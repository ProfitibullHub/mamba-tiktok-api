import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { tiktokAPI } from '../services/tiktok-api.service';
import { supabase } from '../config/supabase';

const router = Router();


const csrfTokens = new Map<string, { accountId?: string; codeVerifier: string; timestamp: number }>();


setInterval(() => {
    const now = Date.now();
    for (const [token, data] of csrfTokens.entries()) {
        if (now - data.timestamp > 10 * 60 * 1000) {
            csrfTokens.delete(token);
        }
    }
}, 10 * 60 * 1000);



router.post('/start', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.body;


        const csrfToken = crypto.randomBytes(32).toString('hex');


        const { codeVerifier, codeChallenge } = tiktokAPI.generatePKCE();


        csrfTokens.set(csrfToken, { accountId, codeVerifier, timestamp: Date.now() });


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



router.get('/callback', async (req: Request, res: Response) => {
    try {
        const { code, state, error, error_description } = req.query;


        if (error) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            return res.redirect(`${frontendUrl}?tiktok_error=${encodeURIComponent(error_description as string || error as string)}`);
        }

        if (!code || !state) {
            throw new Error('Missing code or state parameter');
        }


        const stateData = JSON.parse(state as string);
        const { csrf, accountId } = stateData;


        const storedData = csrfTokens.get(csrf);
        if (!storedData) {
            throw new Error('Invalid or expired CSRF token');
        }

        const { codeVerifier } = storedData;
        csrfTokens.delete(csrf);


        const tokens = await tiktokAPI.getAccessToken(code as string, codeVerifier);


        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);


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


        try {
            console.log(`Auto-syncing TikTok data for account ${accountId}...`);


            const { tiktokSyncService } = await import('../services/tiktok-sync.service');


            await tiktokSyncService.syncUserData(accountId);
            await tiktokSyncService.syncVideos(accountId);

            console.log(`Auto-sync completed for account ${accountId}`);
        } catch (syncError: any) {
            console.error('Error during auto-sync:', syncError);

        }


        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}?tiktok_connected=true&account_id=${accountId}`);
    } catch (error: any) {
        console.error('Error in OAuth callback:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}?tiktok_error=${encodeURIComponent(error.message)}`);
    }
});



router.post('/refresh/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;


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


        const newTokens = await tiktokAPI.refreshAccessToken(tokenData.refresh_token);
        const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);


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



router.delete('/disconnect/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;


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
