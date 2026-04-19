import { Router, Request, Response } from 'express';
import { tiktokShopApi } from '../services/tiktok-shop-api.service.js';
import { supabase } from '../config/supabase.js';
import { getTimezoneForRegion } from '../utils/timezoneMapping.js';
import crypto from 'crypto';
import {
    enforceBodyAccountAccess,
    enforceFinalizeAccountAccess,
    resolveRequestUserId,
    verifyAccountIdParam,
} from '../middleware/account-access.middleware.js';
import { requireAuthorization } from '../middleware/authorize.middleware.js';
import { auditLog } from '../services/audit-logger.js';
import { ACTION_TIKTOK_AUTH, FEATURE_TIKTOK_SHOP } from '../constants/tiktok-entitlements.js';

const router = Router();
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

router.param('accountId', verifyAccountIdParam);

async function createOauthState(params: {
    provider: string;
    accountId: string;
    actorUserId: string;
    returnUrl?: string | null;
    metadata?: Record<string, unknown>;
}) {
    const stateToken = crypto.randomBytes(32).toString('hex');
    const { error } = await supabase.from('oauth_request_states').insert({
        state_token: stateToken,
        provider: params.provider,
        actor_user_id: params.actorUserId,
        account_id: params.accountId,
        return_url: params.returnUrl ?? null,
        metadata: params.metadata ?? {},
    });
    if (error) throw error;
    return stateToken;
}

async function consumeOauthState(stateToken: string, provider: string) {
    const { data, error } = await supabase
        .from('oauth_request_states')
        .select('id, account_id, actor_user_id, return_url, expires_at, consumed_at, metadata')
        .eq('state_token', stateToken)
        .eq('provider', provider)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('OAuth state not found');
    if (data.consumed_at) throw new Error('OAuth state already used');
    if (new Date(data.expires_at).getTime() < Date.now()) throw new Error('OAuth state expired');

    const { error: consumeError } = await supabase
        .from('oauth_request_states')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', data.id)
        .is('consumed_at', null);

    if (consumeError) throw consumeError;
    return data;
}

/**
 * POST /api/tiktok-shop/auth/start
 * Initiate OAuth flow - generate authorization URL
 */
router.post(
    '/start',
    enforceBodyAccountAccess,
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId: typeof req.body?.accountId === 'string' ? req.body.accountId : undefined,
    })),
    async (req: Request, res: Response) => {
    try {
        const { accountId } = req.body;
        const actorId = await resolveRequestUserId(req);

        if (!accountId || !actorId) {
            return res.status(400).json({
                success: false,
                error: 'Account ID and authenticated user are required',
            });
        }

        const stateToken = await createOauthState({
            provider: 'tiktok_shop',
            accountId,
            actorUserId: actorId,
        });

        const authUrl = tiktokShopApi.generateAuthUrl(stateToken);

        // Audit: record that the user initiated a TikTok Shop OAuth flow
        auditLog(req, {
            action: 'shop.auth_start',
            resourceType: 'shop',
            accountId,
            metadata: { flow: 'standard' },
        }).catch(() => undefined);

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
    },
);

/**
 * POST /api/tiktok-shop/auth/partner/start
 * Start the OAuth flow for Partner (Agency)
 */
router.post(
    '/partner/start',
    enforceBodyAccountAccess,
    requireAuthorization((req) => ({
        action: ACTION_TIKTOK_AUTH,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId: typeof req.body?.accountId === 'string' ? req.body.accountId : undefined,
    })),
    async (req: Request, res: Response) => {
    try {
        const { accountId, accountName } = req.body;
        const actorId = await resolveRequestUserId(req);

        if (!accountId || !actorId) {
            return res.status(400).json({
                success: false,
                error: 'Account ID and authenticated user are required',
            });
        }

        const stateToken = await createOauthState({
            provider: 'tiktok_shop',
            accountId,
            actorUserId: actorId,
            metadata: { accountName, type: 'partner' },
        });

        // Generate Partner Authorization URL
        const authUrl = tiktokShopApi.generateServiceAuthUrl(stateToken);

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
    },
);

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
        // Map region to IANA timezone
        const timezone = getTimezoneForRegion(shop.region);
        console.log(`[Shop Auth] Mapping region "${shop.region}" to timezone "${timezone}"`);

        const { error } = await supabase
            .from('tiktok_shops')
            .upsert({
                account_id: accountId,
                shop_id: shop.id,
                shop_cipher: shop.cipher,
                shop_name: shop.name,
                region: shop.region,
                timezone: timezone,  // Store IANA timezone
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

        // Update the account name and its parent tenant name to match the real shop
        const { data: accountRow, error: updateError } = await supabase
            .from('accounts')
            .update({
                name: shop.name,
                tiktok_handle: shop.name.replace(/\s+/g, '').toLowerCase(),
                avatar_url: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', accountId)
            .select('tenant_id')
            .single();

        if (updateError) {
            console.error('Error updating account details:', updateError);
        }

        if (accountRow?.tenant_id) {
            const { error: tenantErr } = await supabase
                .from('tenants')
                .update({ name: shop.name, updated_at: new Date().toISOString() })
                .eq('id', accountRow.tenant_id);
            if (tenantErr) {
                console.error('Error updating tenant name:', tenantErr);
            }
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

        if (!state || typeof state !== 'string') {
            return res.redirect(`${FRONTEND_URL}?tiktok_error=${encodeURIComponent('Authorization failed - missing state')}`);
        }

        const oauthState = await consumeOauthState(state, 'tiktok_shop');
        const accountId = oauthState.account_id as string;

        // Process auth code
        await processAuthCode(code as string, accountId);

        // Redirect back to frontend with success
        res.redirect(`${FRONTEND_URL}?tiktok_connected=true&account_id=${accountId}`);
    } catch (error: any) {
        console.error('Error in TikTok Shop callback:', error);
        res.redirect(
            `${FRONTEND_URL}?tiktok_error=${encodeURIComponent(error.message)}`
        );
    }
});

/**
 * POST /api/tiktok-shop/auth/finalize
 * Exchange code for tokens and save shop data
 */
router.post('/finalize', enforceFinalizeAccountAccess, async (req: Request, res: Response) => {
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
        const now = Date.now();

        // Calculate token health for the first shop (they share tokens)
        let tokenHealth: {
            accessTokenExpiresIn: number | null;
            refreshTokenExpiresIn: number | null;
            status: 'healthy' | 'warning' | 'critical' | 'expired';
            message: string | null;
        } = {
            accessTokenExpiresIn: null,
            refreshTokenExpiresIn: null,
            status: 'healthy',
            message: null
        };

        if (connected && shops[0]) {
            const shop = shops[0];

            // Calculate expiration times in seconds
            const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
            const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : null;

            tokenHealth.accessTokenExpiresIn = accessExpiry ? Math.max(0, Math.floor((accessExpiry - now) / 1000)) : null;
            tokenHealth.refreshTokenExpiresIn = refreshExpiry ? Math.max(0, Math.floor((refreshExpiry - now) / 1000)) : null;

            // Determine health status based on refresh token (the critical one)
            if (refreshExpiry) {
                const daysUntilRefreshExpires = (refreshExpiry - now) / (1000 * 60 * 60 * 24);

                if (refreshExpiry < now) {
                    tokenHealth.status = 'expired';
                    tokenHealth.message = 'Authorization has expired. Please reconnect your TikTok Shop to continue.';
                } else if (daysUntilRefreshExpires <= 1) {
                    tokenHealth.status = 'critical';
                    tokenHealth.message = 'Authorization expires within 24 hours! Click to refresh your connection.';
                } else if (daysUntilRefreshExpires <= 7) {
                    tokenHealth.status = 'warning';
                    tokenHealth.message = `Authorization expires in ${Math.floor(daysUntilRefreshExpires)} days. Sync data to extend.`;
                }
                // else: healthy, no message needed
            }
        }

        const isExpired = tokenHealth.status === 'expired';

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
            tokenHealth
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
 * Remove a shop and all associated customer data from Supabase.
 * Deletes: shop_orders, shop_products, shop_settlements, then tiktok_shops.
 */
router.delete('/disconnect/:accountId/:shopId', async (req: Request, res: Response) => {
    try {
        const { accountId, shopId } = req.params;

        // Fetch internal shop ID (UUID) and name — needed to clean data tables
        const { data: shop, error: fetchError } = await supabase
            .from('tiktok_shops')
            .select('id, shop_name')
            .eq('account_id', accountId)
            .eq('shop_id', shopId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!shop) {
            return res.status(404).json({ success: false, error: 'Shop not found' });
        }

        const { id: internalId, shop_name: shopName } = shop;

        // Delete all customer data in parallel, then remove the shop record
        const [ordersResult, productsResult, settlementsResult] = await Promise.all([
            supabase.from('shop_orders').delete().eq('shop_id', internalId),
            supabase.from('shop_products').delete().eq('shop_id', internalId),
            supabase.from('shop_settlements').delete().eq('shop_id', internalId),
        ]);

        if (ordersResult.error) console.error(`[Disconnect] Orders deletion error:`, ordersResult.error);
        if (productsResult.error) console.error(`[Disconnect] Products deletion error:`, productsResult.error);
        if (settlementsResult.error) console.error(`[Disconnect] Settlements deletion error:`, settlementsResult.error);

        // Remove the shop record itself (tokens, cipher, etc.)
        const { error: shopDeleteError } = await supabase
            .from('tiktok_shops')
            .delete()
            .eq('id', internalId);

        if (shopDeleteError) throw shopDeleteError;

        // Audit: billing-sensitive — shop data and tokens irrevocably wiped
        auditLog(req, {
            action: 'shop.disconnect',
            resourceType: 'shop',
            resourceId: shopId,
            accountId,
            beforeState: { shop_name: shopName, shop_id: shopId, internal_id: internalId },
            metadata: { dataWiped: true },
        }).catch(() => undefined);

        res.json({
            success: true,
            message: 'TikTok Shop and all associated data removed successfully',
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
