import { Router, Request, Response } from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { supabase } from '../config/supabase.js';
import crypto from 'crypto';

const router = Router();

/**
 * POST /api/tiktok-shop/auth/start
 * Initiate OAuth flow - generate authorization URL
 */
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.body;

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: 'Account ID is required',
            });
        }

        // Generate random state for CSRF protection
        const state = crypto.randomBytes(32).toString('hex');

        // Store state temporarily (you might want to use Redis or session storage in production)
        // For now, we'll encode accountId in the state
        const stateData = Buffer.from(JSON.stringify({ accountId, random: state })).toString('base64');

        const authUrl = tiktokShopApi.generateAuthUrl(stateData);
        console.log('Generated Auth URL:', authUrl);

        res.json({
            success: true,
            authUrl,
        });
    } catch (error: any) {
        console.error('Error starting TikTok Shop auth:', error);
        // Log more details about the error
        if (error.message.includes('credentials not configured')) {
            console.error('Missing credentials. Check TIKTOK_SHOP_APP_KEY/SECRET.');
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Internal Server Error',
        });
    }
});

/**
 * POST /api/tiktok-shop/auth/partner/start
 * Start the OAuth flow for Partner (Agency)
 */
router.post('/partner/start', async (req: Request, res: Response) => {
    try {
        const { accountId, accountName } = req.body;

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: 'Account ID is required',
            });
        }

        // Generate state parameter to prevent CSRF and pass context
        const state = Buffer.from(JSON.stringify({
            accountId,
            accountName,
            nonce: Math.random().toString(36).substring(7),
            type: 'partner' // Mark as partner flow
        })).toString('base64');

        // Generate Partner Authorization URL
        const authUrl = tiktokShopApi.generateServiceAuthUrl(state);

        res.json({
            success: true,
            authUrl,
        });
    } catch (error: any) {
        console.error('Error starting partner auth:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/auth/callback
 * Handle OAuth callback from TikTok
 */
/**
 * Helper function to process auth code and save shop data
 */
async function processAuthCode(code: string, accountId: string) {
    // Exchange code for tokens
    const tokenData = await tiktokShopApi.exchangeCodeForTokens(code);

    // Get authorized shops
    const shops = await tiktokShopApi.getAuthorizedShops(tokenData.access_token);

    if (shops.length === 0) {
        throw new Error('No shops found');
    }

    // Calculate token expiration timestamps
    const now = new Date();
    const accessTokenExpiresAt = new Date(now.getTime() + tokenData.access_token_expire_in * 1000);
    const refreshTokenExpiresAt = new Date(now.getTime() + tokenData.refresh_token_expire_in * 1000);

    // Store shop data in database
    for (const shop of shops) {
        const { error } = await supabase
            .from('tiktok_shops')
            .upsert({
                account_id: accountId,
                shop_id: shop.id,
                shop_cipher: shop.cipher,
                shop_name: shop.name,
                region: shop.region,
                seller_type: shop.seller_type,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                token_expires_at: accessTokenExpiresAt.toISOString(),
                refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'account_id,shop_id',
            });

        if (error) {
            console.error('Error storing shop data:', error);
            throw error;
        }

        // Update the main account record with the shop name and handle
        const { error: updateError } = await supabase
            .from('accounts')
            .update({
                name: shop.name,
                tiktok_handle: shop.name.replace(/\s+/g, '').toLowerCase(),
                avatar_url: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', accountId);

        if (updateError) {
            console.error('Error updating account details:', updateError);
        }
    }

    return shops;
}

/**
 * GET /api/tiktok-shop/auth/callback
 * Handle OAuth callback from TikTok
 */
router.get('/callback', async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.redirect(
                `${process.env.FRONTEND_URL}?tiktok_error=${encodeURIComponent('Authorization failed - missing code')}`
            );
        }

        // If state is missing or invalid, redirect to frontend to finalize
        let accountId: string | null = null;
        if (state) {
            try {
                const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
                accountId = stateData.accountId;
            } catch (e) {
                console.warn('Failed to parse state:', e);
            }
        }

        if (!accountId) {
            // Redirect to frontend to let user select account
            return res.redirect(
                `${process.env.FRONTEND_URL}?tiktok_code=${code}&action=finalize_auth`
            );
        }

        // Process auth code
        await processAuthCode(code as string, accountId);

        // Redirect back to frontend with success
        res.redirect(`${process.env.FRONTEND_URL}?tiktok_connected=true&account_id=${accountId}`);
    } catch (error: any) {
        console.error('Error in TikTok Shop callback:', error);
        res.redirect(
            `${process.env.FRONTEND_URL}?tiktok_error=${encodeURIComponent(error.message)}`
        );
    }
});

/**
 * POST /api/tiktok-shop/auth/finalize
 * Exchange code for tokens and save shop data
 */
router.post('/finalize', async (req: Request, res: Response) => {
    try {
        const { code, accountId } = req.body;

        if (!code || !accountId) {
            return res.status(400).json({
                success: false,
                error: 'Code and Account ID are required',
            });
        }

        await processAuthCode(code, accountId);

        res.json({
            success: true,
            message: 'TikTok Shop connected successfully',
        });
    } catch (error: any) {
        console.error('Error finalizing TikTok Shop auth:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/auth/status/:accountId
 * Check if TikTok Shop is connected for an account
 */
router.get('/status/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('*')
            .eq('account_id', accountId);

        if (error) {
            throw error;
        }

        const connected = shops && shops.length > 0;
        const isExpired = connected && shops[0].token_expires_at
            ? new Date(shops[0].token_expires_at) < new Date()
            : false;

        res.json({
            success: true,
            connected,
            isExpired,
            shopCount: shops?.length || 0,
            shops: shops?.map(shop => ({
                id: shop.shop_id,
                name: shop.shop_name,
                region: shop.region,
            })) || [],
        });
    } catch (error: any) {
        console.error('Error checking TikTok Shop status:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * DELETE /api/tiktok-shop/auth/disconnect/:accountId
 * Disconnect TikTok Shop from account
 */
router.delete('/disconnect/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const { error } = await supabase
            .from('tiktok_shops')
            .delete()
            .eq('account_id', accountId);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            message: 'TikTok Shop disconnected successfully',
        });
    } catch (error: any) {
        console.error('Error disconnecting TikTok Shop:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * DELETE /api/tiktok-shop/auth/disconnect/:accountId/:shopId
 * Disconnect specific TikTok Shop
 */
router.delete('/disconnect/:accountId/:shopId', async (req: Request, res: Response) => {
    try {
        const { accountId, shopId } = req.params;

        const { error } = await supabase
            .from('tiktok_shops')
            .delete()
            .eq('account_id', accountId)
            .eq('shop_id', shopId);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            message: 'TikTok Shop disconnected successfully',
        });
    } catch (error: any) {
        console.error('Error disconnecting TikTok Shop:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

export default router;
