import { Router, Request, Response } from 'express';
import axios from 'axios';
import { tiktokShopApi, TikTokShopError } from '../services/tiktok-shop-api.service.js';
import { supabase } from '../config/supabase.js';
import { getTimezoneForRegion } from '../utils/timezoneMapping.js';
import { MAX_HISTORICAL_DAYS, getHistoricalStartTime, getHistoricalStartDate, getHistoricalWindowLabel } from '../config/dataRetention.js';
import {
    enforceRequestAccountAccess,
    verifyAccountIdParam,
} from '../middleware/account-access.middleware.js';

const router = Router();

router.use(enforceRequestAccountAccess);
router.param('accountId', verifyAccountIdParam);

// In-memory cache for shop tokens during sync operations (prevents repeated DB queries)
const shopTokenCache = new Map<string, { shop: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Retry helper for database queries to handle transient errors
 */
async function retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            if (attempt < maxRetries) {
                console.log(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                delayMs *= 2; // Exponential backoff
            }
        }
    }

    throw lastError;
}

/**
 * Helper function to get shop with valid token
 * Includes caching to prevent repeated DB queries during large syncs
 */
export const getShopWithToken = async (accountId: string, shopId?: string, forceRefresh: boolean = false) => {
    const cacheKey = `${accountId}-${shopId || 'default'}`;

    // Check cache first (unless forceRefresh is true)
    if (!forceRefresh) {
        const cached = shopTokenCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            // Verify token is still valid
            const tokenExpiresAt = new Date(cached.shop.token_expires_at);
            const fiveMinutes = 5 * 60 * 1000;
            if (tokenExpiresAt.getTime() - fiveMinutes > Date.now()) {
                return cached.shop;
            }
        }
    }

    // Wrap database queries in retry logic to handle transient errors
    const { shops, error } = await retryOperation(async () => {
        let query = supabase
            .from('tiktok_shops')
            .select('*')
            .eq('account_id', accountId);

        if (shopId) {
            query = query.eq('shop_id', shopId);
        }

        // Use maybeSingle() instead of single() to avoid "Cannot coerce" error
        let { data: shops, error } = await query.limit(1).maybeSingle();

        // If not found by shop_id, try by shop_name (frontend sometimes sends shop_name)
        if ((error || !shops) && shopId) {
            console.log(`[Data API] Shop not found by shop_id, trying by shop_name: ${shopId}`);
            const fallbackQuery = supabase
                .from('tiktok_shops')
                .select('*')
                .eq('account_id', accountId)
                .eq('shop_name', shopId);

            const fallbackResult = await fallbackQuery.limit(1).maybeSingle();
            shops = fallbackResult.data;
            error = fallbackResult.error;
        }

        return { shops, error };
    });

    if (error || !shops) {
        console.error(`[Data API] Shop not found for account ${accountId} and shop ${shopId || 'any'}. Error:`, error?.message);
        throw new Error(`Shop not found or not connected (Account: ${accountId}, Shop: ${shopId || 'any'})`);
    }

    // Check if refresh token is expired or nearing expiry
    // Proactive refresh: if refresh token expires within 7 days, force an access token refresh
    // (refreshing the access token also renews the refresh token, extending its life)
    if (shops.refresh_token_expires_at) {
        const refreshTokenExpiresAt = new Date(shops.refresh_token_expires_at);
        const sevenDayBuffer = 7 * 24 * 60 * 60 * 1000;

        if (refreshTokenExpiresAt.getTime() < Date.now()) {
            console.error(`[Data API] Refresh token has expired for shop ${shops.shop_name}`);

            // AUTO-FIX: Ensure DB reflects this state if it doesn't already
            if (!shops.token_expires_at || new Date(shops.token_expires_at).getTime() > Date.now()) {
                console.log(`[Data API] Marking shop ${shops.shop_name} as expired in DB`);
                await supabase
                    .from('tiktok_shops')
                    .update({
                        token_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
                        refresh_token_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', shops.id);
            }

            throw new TikTokShopError(
                'Authorization has expired. Please reconnect your TikTok Shop account.',
                105002,
                undefined,
                'REFRESH_TOKEN_EXPIRED'
            );
        } else if (refreshTokenExpiresAt.getTime() - sevenDayBuffer < Date.now()) {
            // Refresh token expires within 7 days — proactively force a token refresh
            // This extends the refresh token's life by getting a brand new one from TikTok
            const daysLeft = Math.floor((refreshTokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            console.warn(`[Proactive Refresh] Shop ${shops.shop_name}: refresh token expires in ${daysLeft} days. Forcing token refresh to extend its life.`);
            forceRefresh = true;
        }
    }

    // Check if access token is expired (with 5 minute buffer) OR if forceRefresh is requested
    const tokenExpiresAt = new Date(shops.token_expires_at);
    const fiveMinutes = 5 * 60 * 1000;

    if (forceRefresh || (tokenExpiresAt.getTime() - fiveMinutes < Date.now())) {
        console.log(`Refreshing token for shop ${shops.shop_name} (Force: ${forceRefresh})`);

        try {
            // Try to refresh token
            const tokenData = await tiktokShopApi.refreshAccessToken(shops.refresh_token);

            const now = new Date();
            const newAccessExpiresAt = new Date(now.getTime() + tokenData.access_token_expire_in * 1000);
            const newRefreshExpiresAt = new Date(now.getTime() + tokenData.refresh_token_expire_in * 1000);

            // Update token in database - IMPORTANT: also update refresh_token_expires_at!
            await supabase
                .from('tiktok_shops')
                .update({
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    token_expires_at: newAccessExpiresAt.toISOString(),
                    refresh_token_expires_at: newRefreshExpiresAt.toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', shops.id);

            shops.access_token = tokenData.access_token;
            shops.refresh_token_expires_at = newRefreshExpiresAt.toISOString();
            shops.shop_cipher = shops.shop_cipher; // Ensure cipher is passed along
            console.log(`[Data API] Token refreshed. New refresh token expires: ${newRefreshExpiresAt.toISOString()}`);
        } catch (error: any) {
            // If refresh fails with 105002, mark the shop as expired
            if (error instanceof TikTokShopError && error.code === 105002) {
                console.error(`[Token] Refresh token expired for shop ${shops.shop_name}. Marking as expired.`);

                // Mark the token as expired in the database
                await supabase
                    .from('tiktok_shops')
                    .update({
                        token_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', shops.id);
            }
            throw error;
        }
    }

    // Cache the shop data for subsequent calls (reduces DB load during large syncs)
    shopTokenCache.set(cacheKey, { shop: shops, timestamp: Date.now() });

    return shops;
}

/**
 * Helper to execute API calls with auto-refresh on 105002 error
 */
async function executeWithRefresh<T>(
    accountId: string,
    shopId: string | undefined,
    operation: (token: string, cipher: string) => Promise<T>
): Promise<T> {
    try {
        // First try with existing token (will refresh if close to expiry)
        const shop = await getShopWithToken(accountId, shopId);
        return await operation(shop.access_token, shop.shop_cipher);
    } catch (error: any) {
        // Check for Expired Credentials error (105002)
        if (error instanceof TikTokShopError && error.code === 105002) {
            console.log('Token expired (105002), forcing refresh and retrying...');
            try {
                // Force refresh token
                const shop = await getShopWithToken(accountId, shopId, true);
                // Retry operation with new token
                return await operation(shop.access_token, shop.shop_cipher);
            } catch (refreshError: any) {
                // If refresh also fails with 105002, mark the shop as expired
                if (refreshError instanceof TikTokShopError && refreshError.code === 105002) {
                    console.error(`[Token] Both access and refresh tokens expired for account ${accountId}. Marking as expired.`);

                    // Mark the token as expired in the database by setting token_expires_at to a past date
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            token_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
                            refresh_token_expires_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // Also mark refresh token as expired
                            updated_at: new Date().toISOString()
                        })
                        .eq('account_id', accountId); // TODO: Should probably be safer with shop_id if available, but for now account_level is okay

                    // If we have a specific shopId, try to update just that one to be safer? 
                    // Ideally we update based on the shop record we failed to fetch/refresh.
                    // But since getShopWithToken does the update internally too, this is a fallback.

                    throw new TikTokShopError(
                        'Authorization has expired. Please reconnect your TikTok Shop account.',
                        105002,
                        refreshError.requestId,
                        'REFRESH_TOKEN_EXPIRED'
                    );
                }
                throw refreshError;
            }
        }
        throw error;
    }
}


/**
 * GET /api/tiktok-shop/shops/:accountId
 * Get all authorized shops for an account
 */
router.get('/shops/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { refresh } = req.query;

        // If refresh is requested, sync with TikTok first
        if (refresh === 'true') {
            // Get any existing shop to get the access token
            const { data: existingShop } = await supabase
                .from('tiktok_shops')
                .select('*')
                .eq('account_id', accountId)
                .limit(1)
                .single();

            if (existingShop) {
                // Ensure token is valid
                let accessToken = existingShop.access_token;
                const tokenExpiresAt = new Date(existingShop.token_expires_at);
                if (tokenExpiresAt.getTime() - 5 * 60 * 1000 < Date.now()) {
                    const tokenData = await tiktokShopApi.refreshAccessToken(existingShop.refresh_token);
                    accessToken = tokenData.access_token;
                    const now = new Date();
                    // Update DB - IMPORTANT: also update refresh_token_expires_at!
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            token_expires_at: new Date(now.getTime() + tokenData.access_token_expire_in * 1000).toISOString(),
                            refresh_token_expires_at: new Date(now.getTime() + tokenData.refresh_token_expire_in * 1000).toISOString(),
                            updated_at: now.toISOString(),
                        })
                        .eq('id', existingShop.id);
                }

                // Fetch authorized shops from TikTok
                const authorizedShops = await tiktokShopApi.getAuthorizedShops(accessToken);

                // Update DB with fresh list
                for (const shop of authorizedShops) {
                    // Map region to IANA timezone
                    const timezone = getTimezoneForRegion(shop.region);

                    await supabase
                        .from('tiktok_shops')
                        .upsert({
                            account_id: accountId,
                            shop_id: shop.id,
                            shop_cipher: shop.cipher,
                            shop_name: shop.name,
                            region: shop.region,
                            timezone: timezone,  // Store IANA timezone
                            seller_type: shop.seller_type,
                            access_token: accessToken, // They share the token
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'account_id,shop_id',
                        });
                }
            }
        }

        // Fetch shops for this specific account with token expiration info
        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('id, shop_id, shop_name, region, timezone, seller_type, created_at, account_id, refresh_token_expires_at, token_expires_at, refresh_token')
            .eq('account_id', accountId);

        if (error) {
            throw error;
        }

        // ============================================================
        // PROACTIVE TOKEN REFRESH ON SHOP LIST LOAD
        // ============================================================
        // This runs every time the user loads the shop list.
        // It handles 3 scenarios per shop:
        //   1. Access token already expired → refresh it
        //   2. Refresh token expires within 7 days → proactively refresh to extend its life
        //   3. Refresh token already expired → mark shop as expired (unrecoverable)
        //
        // Why proactive? Refreshing the access token also gives us a brand new refresh
        // token from TikTok, resetting the refresh token's expiry clock. By refreshing
        // before the refresh token dies, we prevent the shop from ever going expired
        // as long as the user visits the dashboard at least once within the buffer window.
        // ============================================================
        const now = Date.now();
        const REFRESH_TOKEN_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        const ACCESS_TOKEN_BUFFER_MS = 60 * 60 * 1000; // 1 hour

        for (const shop of shops || []) {
            const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
            const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : 0;
            const isRefreshTokenExpired = refreshExpiry > 0 && refreshExpiry < now;

            // Determine if this shop needs a token refresh
            const isAccessTokenExpired = accessExpiry != null && accessExpiry < now;
            const isAccessTokenNearExpiry = accessExpiry != null && (accessExpiry - ACCESS_TOKEN_BUFFER_MS) < now;
            const isRefreshTokenNearExpiry = refreshExpiry > 0 && (refreshExpiry - REFRESH_TOKEN_BUFFER_MS) < now && !isRefreshTokenExpired;

            const needsRefresh = isAccessTokenExpired || isAccessTokenNearExpiry || isRefreshTokenNearExpiry;

            if (needsRefresh && shop.refresh_token) {
                if (isRefreshTokenExpired) {
                    // Refresh token is dead — cannot recover, mark as expired
                    console.log(`[Token Validation] Shop ${shop.shop_name} has expired refresh token. Marking as expired.`);
                    const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            token_expires_at: expiredTime,
                            refresh_token_expires_at: expiredTime,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', shop.id);
                    shop.token_expires_at = expiredTime;
                    shop.refresh_token_expires_at = expiredTime;
                } else {
                    // Refresh token is still valid — refresh now to extend its life
                    const reason = isAccessTokenExpired
                        ? 'access token expired'
                        : isAccessTokenNearExpiry
                            ? 'access token expires within 1 hour'
                            : `refresh token expires within ${Math.floor((refreshExpiry - now) / (1000 * 60 * 60 * 24))} days`;
                    console.log(`[Proactive Refresh] Shop ${shop.shop_name}: ${reason}. Refreshing tokens...`);

                    try {
                        const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
                        const refreshTime = new Date();
                        const newAccessExpiry = new Date(refreshTime.getTime() + tokenData.access_token_expire_in * 1000);
                        const newRefreshExpiry = new Date(refreshTime.getTime() + tokenData.refresh_token_expire_in * 1000);

                        await supabase
                            .from('tiktok_shops')
                            .update({
                                access_token: tokenData.access_token,
                                refresh_token: tokenData.refresh_token,
                                token_expires_at: newAccessExpiry.toISOString(),
                                refresh_token_expires_at: newRefreshExpiry.toISOString(),
                                updated_at: refreshTime.toISOString()
                            })
                            .eq('id', shop.id);

                        shop.token_expires_at = newAccessExpiry.toISOString();
                        shop.refresh_token_expires_at = newRefreshExpiry.toISOString();

                        console.log(`[Proactive Refresh] Successfully refreshed tokens for ${shop.shop_name}. New refresh token expires: ${newRefreshExpiry.toISOString()}`);
                    } catch (refreshError: any) {
                        if (refreshError instanceof TikTokShopError && refreshError.code === 105002) {
                            console.log(`[Proactive Refresh] TikTok rejected refresh for ${shop.shop_name} (105002). Marking as expired.`);
                            const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                            await supabase
                                .from('tiktok_shops')
                                .update({
                                    token_expires_at: expiredTime,
                                    refresh_token_expires_at: expiredTime,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', shop.id);
                            shop.token_expires_at = expiredTime;
                            shop.refresh_token_expires_at = expiredTime;
                        } else {
                            console.error(`[Proactive Refresh] Error refreshing token for ${shop.shop_name}:`, refreshError.message);
                        }
                    }
                }
            }

            // Catch any shops where refresh token is expired but DB is inconsistent
            if (isRefreshTokenExpired && (!accessExpiry || accessExpiry > now)) {
                console.log(`[Token Validation] Shop ${shop.shop_name}: refresh token expired but access token still shows valid. Fixing DB.`);
                const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                await supabase
                    .from('tiktok_shops')
                    .update({
                        token_expires_at: expiredTime,
                        refresh_token_expires_at: expiredTime,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', shop.id);
                shop.token_expires_at = expiredTime;
                shop.refresh_token_expires_at = expiredTime;
            }
        }

        // Calculate token health for each shop

        const shopsWithHealth = (shops || []).map(shop => {
            const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : null;
            const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
            const refreshTokenExpiresIn = refreshExpiry ? Math.max(0, Math.floor((refreshExpiry - now) / 1000)) : null;

            let tokenStatus: 'healthy' | 'warning' | 'critical' | 'expired' = 'healthy';
            let tokenMessage: string | null = null;
            let expiresAt: string | null = shop.refresh_token_expires_at || null;

            // Check refresh token expiry if available
            if (refreshExpiry) {
                const daysUntilExpiry = (refreshExpiry - now) / (1000 * 60 * 60 * 24);

                if (refreshExpiry < now) {
                    tokenStatus = 'expired';
                    tokenMessage = 'Authorization expired. Please reconnect this shop.';
                } else if (daysUntilExpiry <= 1) {
                    tokenStatus = 'critical';
                    tokenMessage = 'Expires within 24 hours!';
                } else if (daysUntilExpiry <= 7) {
                    tokenStatus = 'warning';
                    tokenMessage = `Expires in ${Math.floor(daysUntilExpiry)} days`;
                }
            } else if (accessExpiry) {
                // Fallback: No refresh_token_expires_at data (legacy shops)
                // If access token is expired, the shop is effectively expired
                // (the error handling now marks tokens as expired when refresh fails)
                if (accessExpiry < now) {
                    tokenStatus = 'expired';
                    tokenMessage = 'Authorization expired. Please reconnect this shop.';
                }
            }


            return {
                shop_id: shop.shop_id,
                shop_name: shop.shop_name,
                region: shop.region,
                timezone: shop.timezone || 'America/Los_Angeles',
                seller_type: shop.seller_type,
                created_at: shop.created_at,
                account_id: shop.account_id,
                tokenHealth: {
                    status: tokenStatus,
                    message: tokenMessage,
                    expiresAt,
                    refreshTokenExpiresIn
                }
            };
        });


        res.json({
            success: true,
            data: shopsWithHealth,

        });
    } catch (error: any) {
        console.error('Error fetching shops:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/shop/:accountId
 * Get shop details
 */
router.get('/shop/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const shopInfo = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.getShopInfo(token, cipher)
        );

        res.json({
            success: true,
            data: shopInfo,
        });
    } catch (error: any) {
        console.error('Error fetching shop info:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * PATCH /api/tiktok-shop/shops/:shopId/timezone
 * Update the timezone for a specific shop
 */
router.patch('/shops/:shopId/timezone', async (req: Request, res: Response) => {
    try {
        const { shopId } = req.params;
        const { timezone, accountId } = req.body;

        if (!timezone || !accountId) {
            return res.status(400).json({ success: false, error: 'timezone and accountId are required' });
        }

        // Validate IANA timezone string
        try {
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
        } catch {
            return res.status(400).json({ success: false, error: `Invalid timezone: ${timezone}` });
        }

        const { data, error } = await supabase
            .from('tiktok_shops')
            .update({ timezone, updated_at: new Date().toISOString() })
            .eq('shop_id', shopId)
            .eq('account_id', accountId)
            .select('shop_id, shop_name, timezone')
            .single();

        if (error) throw error;

        console.log(`[Timezone] Updated shop ${data.shop_name} (${shopId}) timezone to ${timezone}`);

        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error updating shop timezone:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/cache-status/:accountId
 * Check cache freshness for a shop
 * Returns staleness status based on 30-minute threshold
 */
router.get('/cache-status/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        let query = supabase
            .from('tiktok_shops')
            .select('orders_last_synced_at, products_last_synced_at, settlements_last_synced_at, performance_last_synced_at, shop_id, shop_name')
            .eq('account_id', accountId);

        if (shopId) {
            query = query.eq('shop_id', shopId);
        }

        const { data: shop, error } = await query.limit(1).single();

        if (error || !shop) {
            return res.status(404).json({
                success: false,
                error: 'Shop not found'
            });
        }

        const now = Date.now();
        const PROMPT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes - prompt user
        const AUTO_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - auto-sync

        const shouldPrompt = (lastSyncedAt: string | null): boolean => {
            if (!lastSyncedAt) return true; // Never synced = prompt
            const lastSyncTime = new Date(lastSyncedAt).getTime();
            return (now - lastSyncTime) > PROMPT_THRESHOLD_MS;
        };

        const shouldAutoSync = (lastSyncedAt: string | null): boolean => {
            if (!lastSyncedAt) return false; // Never synced = don't auto-sync, just prompt
            const lastSyncTime = new Date(lastSyncedAt).getTime();
            return (now - lastSyncTime) > AUTO_SYNC_THRESHOLD_MS;
        };

        const cacheStatus = {
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            // Individual staleness flags (>30 min = prompt user)
            orders_should_prompt: shouldPrompt(shop.orders_last_synced_at),
            products_should_prompt: shouldPrompt(shop.products_last_synced_at),
            settlements_should_prompt: shouldPrompt(shop.settlements_last_synced_at),
            performance_should_prompt: shouldPrompt(shop.performance_last_synced_at),
            // Auto-sync flags (>24 hours = auto-sync in background)
            orders_should_auto_sync: shouldAutoSync(shop.orders_last_synced_at),
            products_should_auto_sync: shouldAutoSync(shop.products_last_synced_at),
            settlements_should_auto_sync: shouldAutoSync(shop.settlements_last_synced_at),
            performance_should_auto_sync: shouldAutoSync(shop.performance_last_synced_at),
            last_synced_times: {
                orders: shop.orders_last_synced_at,
                products: shop.products_last_synced_at,
                settlements: shop.settlements_last_synced_at,
                performance: shop.performance_last_synced_at
            },
            // Summary flags
            should_prompt_user: shouldPrompt(shop.orders_last_synced_at) ||
                shouldPrompt(shop.products_last_synced_at) ||
                shouldPrompt(shop.settlements_last_synced_at),
            should_auto_sync: shouldAutoSync(shop.orders_last_synced_at) ||
                shouldAutoSync(shop.products_last_synced_at) ||
                shouldAutoSync(shop.settlements_last_synced_at)
        };

        res.json({
            success: true,
            data: cacheStatus
        });
    } catch (error: any) {
        console.error('Error checking cache status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tiktok-shop/shop-data/:accountId
 * ============================================================
 * OPTIMIZED: Single endpoint that returns shop data in one request.
 * Replaces 4 separate calls (cache-status + orders + products + settlements).
 *
 * Returns the first batch of orders (1000) instantly along with all products,
 * settlements, metrics, and cache status. If there are more orders, returns
 * hasMoreOrders=true so the frontend can progressively load the rest.
 * ============================================================
 */
router.get('/shop-data/:accountId', async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
        const { accountId } = req.params;
        const { shopId, startDate, endDate } = req.query;
        const INITIAL_ORDER_BATCH = 1000; // First batch size (Supabase single-query max)

        // 1. Single shop lookup (reused for everything)
        let shopQuery = supabase
            .from('tiktok_shops')
            .select('id, shop_id, shop_name, timezone, orders_last_synced_at, products_last_synced_at, settlements_last_synced_at, performance_last_synced_at')
            .eq('account_id', accountId);

        if (shopId) {
            shopQuery = shopQuery.eq('shop_id', shopId);
        }

        const { data: shops, error: shopError } = await shopQuery;

        if (shopError) throw shopError;
        if (!shops || shops.length === 0) {
            return res.json({
                success: true,
                data: {
                    orders: [], products: [], settlements: [],
                    metrics: { totalOrders: 0, totalRevenue: 0, totalProducts: 0, totalNet: 0, avgOrderValue: 0 },
                    cache_status: { should_prompt_user: true, last_synced_times: {} },
                    hasMoreOrders: false, totalOrders: 0, ordersLoaded: 0
                },
                timing: { total_ms: Date.now() - startTime }
            });
        }

        const internalShopIds = shops.map(s => s.id);
        const shop = shops[0];

        // Get shop timezone for date conversion
        const shopTimezone = shop.timezone || 'America/Los_Angeles';

        // Date range filtering - default to last 30 days if not provided
        let startTs: string; // ISO timestamp for PostgreSQL
        let endTs: string;

        if (startDate && endDate) {
            // Convert YYYY-MM-DD dates to ISO timestamps using shop timezone
            const { getShopDayStartTimestamp, getShopDayEndExclusiveTimestamp } = await import('../utils/dateUtils.js');
            const startUnix = getShopDayStartTimestamp(startDate as string, shopTimezone);
            const endUnix = getShopDayEndExclusiveTimestamp(endDate as string, shopTimezone); // Exclusive end (next shop midnight)

            // Convert to ISO timestamp strings for PostgreSQL
            startTs = new Date(startUnix * 1000).toISOString();
            endTs = new Date(endUnix * 1000).toISOString();
            console.log(`[Shop Data] Date range: ${startDate} to ${endDate} (${shopTimezone})`);
        } else {
            // Default to last 30 days
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 86400 * 1000));
            startTs = thirtyDaysAgo.toISOString();
            endTs = now.toISOString();
            console.log(`[Shop Data] Using default 30-day range`);
        }

        // 2. Run ALL queries in parallel with date filtering
        const [ordersResult, orderCountResult, productsResult, settlementsResult] = await Promise.all([
            // First batch of orders (1000, newest first) - FILTERED BY DATE RANGE
            // FILTER BY PAID_TIME: Only include orders that have been paid (paid_time IS NOT NULL)
            supabase
                .from('shop_orders')
                .select('order_id, order_status, total_amount, currency, create_time, update_time, paid_time, is_fbt, fulfillment_type, line_items, buyer_info, payment_info, fbt_fulfillment_fee, warehouse_id, payment_method_name, delivery_option_name, shipping_type, shipping_info, is_sample_order, cancel_reason, cancellation_initiator, seller_note, delivery_type, collection_time, shipping_due_time, is_cod, is_exchange_order, is_on_hold_order, is_replacement_order, tracking_number, shipping_provider, shipping_provider_id')
                .in('shop_id', internalShopIds)
                .not('paid_time', 'is', null) // Exclude UNPAID orders
                .gte('paid_time', startTs) // Date range filter by PAID TIME
                .lt('paid_time', endTs)
                .order('paid_time', { ascending: false }) // Sort by payment time
                .order('order_id', { ascending: false }) // Secondary sort
                .limit(INITIAL_ORDER_BATCH),

            // Exact total count (lightweight HEAD request) - only PAID orders in date range
            supabase
                .from('shop_orders')
                .select('order_id', { count: 'exact', head: true })
                .in('shop_id', internalShopIds)
                .not('paid_time', 'is', null) // Exclude UNPAID orders from count
                .gte('paid_time', startTs) // Date range filter by PAID TIME
                .lt('paid_time', endTs),

            // All products
            supabase
                .from('shop_products')
                .select('product_id, product_name, status, price, stock, sales_count, main_image_url, images, gmv, orders_count, click_through_rate, cogs, shipping_cost, is_fbt, fbt_source, details')
                .in('shop_id', internalShopIds),

            // All settlements in date range
            supabase
                .from('shop_settlements')
                .select('*')
                .in('shop_id', internalShopIds)
                .gte('settlement_time', startTs) // Date range filter
                .lt('settlement_time', endTs)
                .order('settlement_time', { ascending: false })
        ]);

        if (ordersResult.error) throw ordersResult.error;
        if (productsResult.error) throw productsResult.error;
        if (settlementsResult.error) throw settlementsResult.error;

        const orders = ordersResult.data || [];
        const products = productsResult.data || [];
        const settlements = settlementsResult.data || [];

        // Get the exact total order count. If the parallel count query returned null (e.g. Supabase
        // error or timeout), retry sequentially before giving up. Never use a sentinel value like
        // 9999999 — that causes the UI to show "Loading data: X/9999999..." which is incorrect.
        let totalOrderCount: number | null = orderCountResult.count ?? null;
        if (totalOrderCount === null) {
            console.warn(`[Shop Data] Parallel count query returned null (error: ${orderCountResult.error?.message}), retrying sequentially...`);
            const { count: retryCount, error: retryError } = await supabase
                .from('shop_orders')
                .select('order_id', { count: 'exact', head: true })
                .in('shop_id', internalShopIds)
                .not('paid_time', 'is', null)
                .gte('paid_time', startTs)
                .lt('paid_time', endTs);
            if (!retryError && retryCount !== null) {
                totalOrderCount = retryCount;
                console.log(`[Shop Data] Sequential count succeeded: ${totalOrderCount}`);
            } else {
                console.warn(`[Shop Data] Sequential count also failed (${retryError?.message}). Progressive loading will use batch pagination.`);
            }
        }

        // hasMoreOrders: if we have a real count, compare against loaded batch;
        // if count is still unknown, assume more exist when the initial batch was full.
        const hasMoreOrders = totalOrderCount !== null
            ? totalOrderCount > orders.length
            : orders.length === INITIAL_ORDER_BATCH;

        // 3. Compute metrics server-side (PAID ORDERS ONLY)
        // GMV = Sum of payment.total_amount for all PAID orders
        let totalRevenue = 0;
        for (const o of orders) {
            // Use payment.total_amount from payment_info for accurate GMV
            const paymentTotal = o.payment_info?.total_amount || o.total_amount;
            totalRevenue += parseFloat(paymentTotal?.toString() || '0');
        }
        const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
        const totalNet = settlements.reduce((sum: number, s: any) => sum + parseFloat(s.settlement_data?.settlement_amount || '0'), 0);

        // 4. Cache status
        const now = Date.now();
        const PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
        const shouldPrompt = (ts: string | null) => !ts || (now - new Date(ts).getTime()) > PROMPT_THRESHOLD_MS;

        const cacheStatus = {
            should_prompt_user: shouldPrompt(shop.orders_last_synced_at) ||
                shouldPrompt(shop.products_last_synced_at) ||
                shouldPrompt(shop.settlements_last_synced_at),
            last_synced_times: {
                orders: shop.orders_last_synced_at,
                products: shop.products_last_synced_at,
                settlements: shop.settlements_last_synced_at,
                performance: shop.performance_last_synced_at
            },
            isStale: shouldPrompt(shop.orders_last_synced_at) ||
                shouldPrompt(shop.products_last_synced_at) ||
                shouldPrompt(shop.settlements_last_synced_at)
        };

        const timing = Date.now() - startTime;
        console.log(`[Shop Data] Loaded in ${timing}ms — ${orders.length}/${totalOrderCount} orders, ${products.length} products, ${settlements.length} settlements${hasMoreOrders ? ' (more orders pending)' : ''}`);

        // Helper to map order rows
        const mapOrder = (o: any) => ({
            id: o.order_id,
            status: o.order_status,
            payment: {
                total_amount: o.total_amount?.toString() || '0',
                currency: o.currency || 'USD',
                sub_total: o.payment_info?.sub_total || o.total_amount?.toString() || '0',
                tax: o.payment_info?.tax || o.payment_info?.product_tax || '0',
                shipping_fee: o.payment_info?.shipping_fee || '0',
                original_shipping_fee: o.payment_info?.original_shipping_fee,
                original_total_product_price: o.payment_info?.original_total_product_price,
                platform_discount: o.payment_info?.platform_discount,
                product_tax: o.payment_info?.product_tax,
                seller_discount: o.payment_info?.seller_discount,
                shipping_fee_cofunded_discount: o.payment_info?.shipping_fee_cofunded_discount,
                shipping_fee_platform_discount: o.payment_info?.shipping_fee_platform_discount,
                shipping_fee_seller_discount: o.payment_info?.shipping_fee_seller_discount,
                shipping_fee_tax: o.payment_info?.shipping_fee_tax,
                item_insurance_tax: o.payment_info?.item_insurance_tax
            },
            create_time: Math.floor(new Date(o.create_time).getTime() / 1000),
            update_time: o.update_time ? Math.floor(new Date(o.update_time).getTime() / 1000) : undefined,
            paid_time: o.paid_time ? Math.floor(new Date(o.paid_time).getTime() / 1000) : undefined,
            paid_time_iso: o.paid_time,
            line_items: o.line_items || [],
            buyer_info: o.buyer_info,
            shipping_info: o.shipping_info,
            payment_info: o.payment_info,
            payment_method_name: o.payment_method_name,
            shipping_type: o.shipping_type,
            delivery_option_name: o.delivery_option_name,
            fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
            is_fbt: o.is_fbt || false,
            fbt_fulfillment_fee: o.fbt_fulfillment_fee || null,
            warehouse_id: o.warehouse_id || null,
            is_sample_order: o.is_sample_order || false,
            cancel_reason: o.cancel_reason || null,
            cancellation_initiator: o.cancellation_initiator || null,
            seller_note: o.seller_note || null,
            delivery_type: o.delivery_type || null,
            collection_time: o.collection_time ? Math.floor(new Date(o.collection_time).getTime() / 1000) : undefined,
            shipping_due_time: o.shipping_due_time ? Math.floor(new Date(o.shipping_due_time).getTime() / 1000) : undefined,
            is_cod: o.is_cod || false,
            is_exchange_order: o.is_exchange_order || false,
            is_on_hold_order: o.is_on_hold_order || false,
            is_replacement_order: o.is_replacement_order || false,
            tracking_number: o.tracking_number || null,
            shipping_provider: o.shipping_provider || null,
            shipping_provider_id: o.shipping_provider_id || null
        });

        res.json({
            success: true,
            data: {
                orders: orders.map(mapOrder),
                products: products.map(p => ({
                    product_id: p.product_id,
                    product_name: p.product_name,
                    status: p.status === 'active' ? 'ACTIVATE' : 'INACTIVE',
                    price: p.price,
                    currency: 'USD',
                    stock: p.stock,
                    sales_count: p.sales_count,
                    images: p.images || [],
                    main_image_url: p.main_image_url || (p.images && p.images[0]) || '',
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    cogs: p.cogs ?? null,
                    shipping_cost: p.shipping_cost ?? null,
                    is_fbt: p.is_fbt || false,
                    fbt_source: p.fbt_source || 'auto',
                    details: p.details || null
                })),
                settlements: (settlements || []).map((s: any) => ({
                    ...s.settlement_data,
                    id: s.settlement_id,
                    shop_id: s.shop_id,
                    order_id: s.order_id,
                    transaction_summary: s.transaction_summary || null
                })),
                metrics: {
                    totalOrders: totalOrderCount,
                    totalRevenue,
                    totalProducts: products.length,
                    totalNet,
                    avgOrderValue,
                    metricsPartial: hasMoreOrders // Frontend should recompute after progressive load
                },
                cache_status: cacheStatus,
                // Progressive loading info
                hasMoreOrders,
                nextCursor: orders.length > 0 ? `${orders[orders.length - 1].paid_time}|${orders[orders.length - 1].order_id}` : null,
                totalOrders: totalOrderCount,
                ordersLoaded: orders.length
            },
            timing: { total_ms: timing, orders_loaded: orders.length, total_orders: totalOrderCount }
        });
    } catch (error: any) {
        console.error('[Shop Data] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/orders/synced/:accountId/batch
 * Fetch a batch of orders with offset/limit for progressive loading.
 * Used by the frontend to load remaining orders after the initial /shop-data response.
 */
router.get('/orders/synced/:accountId/batch', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, limit = '1000', startDate, endDate, cursor } = req.query;
        const batchLimit = Math.min(parseInt(limit as string) || 1000, 1000);

        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id, timezone')
            .eq('account_id', accountId);
        if (shopId) shopsQuery = shopsQuery.eq('shop_id', shopId);

        const { data: shops } = await shopsQuery;
        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { orders: [], hasMore: false } });
        }

        const internalShopIds = shops.map(s => s.id);
        const shopTimezone = shops[0].timezone || 'America/Los_Angeles';

        // Build query with date filtering if provided
        let ordersQuery = supabase
            .from('shop_orders')
            .select('order_id, order_status, total_amount, currency, create_time, update_time, paid_time, is_fbt, fulfillment_type, line_items, buyer_info, payment_info, fbt_fulfillment_fee, warehouse_id, payment_method_name, delivery_option_name, shipping_type, shipping_info, is_sample_order, cancel_reason, cancellation_initiator, seller_note, delivery_type, collection_time, shipping_due_time, is_cod, is_exchange_order, is_on_hold_order, is_replacement_order, tracking_number, shipping_provider, shipping_provider_id')
            .in('shop_id', internalShopIds)
            .not('paid_time', 'is', null); // Exclude UNPAID orders

        // Apply date range filter (default to 30 days if not provided, matching /shop-data behavior)
        let startTs: string;
        let endTs: string;
        if (startDate && endDate) {
            const { getShopDayStartTimestamp, getShopDayEndExclusiveTimestamp } = await import('../utils/dateUtils.js');
            const startUnix = getShopDayStartTimestamp(startDate as string, shopTimezone);
            const endUnix = getShopDayEndExclusiveTimestamp(endDate as string, shopTimezone);
            startTs = new Date(startUnix * 1000).toISOString();
            endTs = new Date(endUnix * 1000).toISOString();
        } else {
            // Default to last 30 days (safety net — frontend should always pass dates)
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 86400 * 1000));
            startTs = thirtyDaysAgo.toISOString();
            endTs = now.toISOString();
            console.log(`[Batch Orders] No date range provided, defaulting to 30 days`);
        }

        ordersQuery = ordersQuery
            .gte('paid_time', startTs)
            .lt('paid_time', endTs);

        // CURSOR-BASED PAGINATION: Use paid_time cursor instead of OFFSET
        // This is O(1) regardless of how deep we paginate, unlike OFFSET which
        // degrades at high values (e.g. offset=21000 causes timeouts).
        if (cursor) {
            const cursorStr = cursor as string;
            if (cursorStr.includes('|')) {
                const [cursorTime, cursorId] = cursorStr.split('|');
                // (paid_time < cursorTime) OR (paid_time = cursorTime AND order_id < cursorId)
                ordersQuery = ordersQuery.or(`paid_time.lt.${cursorTime},and(paid_time.eq.${cursorTime},order_id.lt.${cursorId})`);
            } else {
                ordersQuery = ordersQuery.lt('paid_time', cursorStr);
            }
        }

        const { data: batch, error } = await ordersQuery
            .order('paid_time', { ascending: false }) // Sort by payment time (newest first)
            .order('order_id', { ascending: false }) // Secondary sort
            .limit(batchLimit);

        if (error) throw error;

        const orders = batch || [];
        const hasMore = orders.length === batchLimit;

        // Return the cursor for the next batch (paid_time|order_id of the last order in this batch)
        const nextCursor = orders.length > 0 ? `${orders[orders.length - 1].paid_time}|${orders[orders.length - 1].order_id}` : null;

        console.log(`[Batch Orders] cursor=${cursor || 'none'}, limit=${batchLimit}, returned=${orders.length}, hasMore=${hasMore}, nextCursor=${nextCursor}`);

        res.json({
            success: true,
            data: {
                orders: orders.map(o => ({
                    id: o.order_id,
                    status: o.order_status,
                    payment: {
                        total_amount: o.total_amount?.toString() || '0',
                        currency: o.currency || 'USD',
                        sub_total: o.payment_info?.sub_total || o.total_amount?.toString() || '0',
                        tax: o.payment_info?.tax || o.payment_info?.product_tax || '0',
                        shipping_fee: o.payment_info?.shipping_fee || '0',
                        original_shipping_fee: o.payment_info?.original_shipping_fee,
                        original_total_product_price: o.payment_info?.original_total_product_price,
                        platform_discount: o.payment_info?.platform_discount,
                        product_tax: o.payment_info?.product_tax,
                        seller_discount: o.payment_info?.seller_discount,
                        shipping_fee_cofunded_discount: o.payment_info?.shipping_fee_cofunded_discount,
                        shipping_fee_platform_discount: o.payment_info?.shipping_fee_platform_discount,
                        shipping_fee_seller_discount: o.payment_info?.shipping_fee_seller_discount,
                        shipping_fee_tax: o.payment_info?.shipping_fee_tax,
                        item_insurance_tax: o.payment_info?.item_insurance_tax
                    },
                    create_time: Math.floor(new Date(o.create_time).getTime() / 1000),
                    update_time: o.update_time ? Math.floor(new Date(o.update_time).getTime() / 1000) : undefined,
                    paid_time: o.paid_time ? Math.floor(new Date(o.paid_time).getTime() / 1000) : undefined,
                    paid_time_iso: o.paid_time, // Raw ISO timestamp for cursor pagination
                    line_items: o.line_items || [],
                    buyer_info: o.buyer_info,
                    shipping_info: o.shipping_info,
                    payment_info: o.payment_info,
                    payment_method_name: o.payment_method_name,
                    shipping_type: o.shipping_type,
                    delivery_option_name: o.delivery_option_name,
                    fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                    is_fbt: o.is_fbt || false,
                    fbt_fulfillment_fee: o.fbt_fulfillment_fee || null,
                    warehouse_id: o.warehouse_id || null,
                    is_sample_order: o.is_sample_order || false,
                    cancel_reason: o.cancel_reason || null,
                    cancellation_initiator: o.cancellation_initiator || null,
                    seller_note: o.seller_note || null,
                    delivery_type: o.delivery_type || null,
                    collection_time: o.collection_time ? Math.floor(new Date(o.collection_time).getTime() / 1000) : undefined,
                    shipping_due_time: o.shipping_due_time ? Math.floor(new Date(o.shipping_due_time).getTime() / 1000) : undefined,
                    is_cod: o.is_cod || false,
                    is_exchange_order: o.is_exchange_order || false,
                    is_on_hold_order: o.is_on_hold_order || false,
                    is_replacement_order: o.is_replacement_order || false,
                    tracking_number: o.tracking_number || null,
                    shipping_provider: o.shipping_provider || null,
                    shipping_provider_id: o.shipping_provider_id || null
                })),
                hasMore,
                nextCursor,
                loaded: orders.length
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/shop-data-delta/:accountId
 * ============================================================
 * LIGHTWEIGHT: Returns only data that changed since a given timestamp.
 * Used after sync to merge new/updated records into the existing store
 * instead of reloading all 23,000+ orders from scratch.
 *
 * Query params:
 *   - shopId: TikTok shop ID
 *   - since: ISO timestamp — only return records updated after this time
 * ============================================================
 */
router.get('/shop-data-delta/:accountId', async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
        const { accountId } = req.params;
        const { shopId, since, types } = req.query;

        if (!since) {
            return res.status(400).json({ success: false, error: 'Missing required query param: since' });
        }

        const sinceTime = new Date(since as string).toISOString();
        const requestedTypes = types ? (types as string).split(',') : ['orders', 'products', 'settlements'];
        const fetchOrders = requestedTypes.includes('orders');
        const fetchProducts = requestedTypes.includes('products');
        const fetchSettlements = requestedTypes.includes('settlements');

        // Shop lookup
        let shopQuery = supabase
            .from('tiktok_shops')
            .select('id, orders_last_synced_at, products_last_synced_at, settlements_last_synced_at')
            .eq('account_id', accountId);
        if (shopId) shopQuery = shopQuery.eq('shop_id', shopId);

        const { data: shops, error: shopError } = await shopQuery;
        if (shopError) throw shopError;
        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { newOrders: [], updatedOrders: [], products: [], settlements: [] } });
        }

        const internalShopIds = shops.map(s => s.id);

        // Fetch only requested types — skip unnecessary DB queries
        const emptyResult = { data: [], count: 0 };
        const [changedOrdersResult, productsResult, settlementsResult, orderCountResult] = await Promise.all([
            // Orders delta: only if requested
            fetchOrders
                ? supabase
                    .from('shop_orders')
                    .select('order_id, order_status, total_amount, currency, create_time, update_time, paid_time, is_fbt, fulfillment_type, line_items, buyer_info, payment_info, fbt_fulfillment_fee, warehouse_id, payment_method_name, delivery_option_name, shipping_type, shipping_info, is_sample_order, cancel_reason, cancellation_initiator, seller_note, delivery_type, collection_time, shipping_due_time, is_cod, is_exchange_order, is_on_hold_order, is_replacement_order, tracking_number, shipping_provider, shipping_provider_id, delivery_option_id, refund_amount, return_status, return_reason')
                    .in('shop_id', internalShopIds)
                    .not('paid_time', 'is', null)
                    .gt('updated_at', sinceTime)
                    .order('paid_time', { ascending: false })
                : Promise.resolve(emptyResult),

            // Products: only if requested
            fetchProducts
                ? supabase
                    .from('shop_products')
                    .select('product_id, product_name, status, price, stock, sales_count, main_image_url, images, gmv, orders_count, click_through_rate, cogs, shipping_cost, is_fbt, fbt_source, details')
                    .in('shop_id', internalShopIds)
                : Promise.resolve(emptyResult),

            // Settlements: only if requested
            fetchSettlements
                ? supabase
                    .from('shop_settlements')
                    .select('*')
                    .in('shop_id', internalShopIds)
                    .order('settlement_time', { ascending: false })
                : Promise.resolve(emptyResult),

            // Total order count: only if orders requested
            fetchOrders
                ? supabase
                    .from('shop_orders')
                    .select('order_id', { count: 'exact', head: true })
                    .in('shop_id', internalShopIds)
                    .not('paid_time', 'is', null)
                : Promise.resolve(emptyResult)
        ]);

        const mapOrder = (o: any) => ({
            id: o.order_id,
            status: o.order_status,
            payment: {
                total_amount: o.total_amount?.toString() || '0',
                currency: o.currency || 'USD',
                sub_total: o.payment_info?.sub_total || o.total_amount?.toString() || '0',
                tax: o.payment_info?.tax || o.payment_info?.product_tax || '0',
                shipping_fee: o.payment_info?.shipping_fee || '0',
                original_shipping_fee: o.payment_info?.original_shipping_fee,
                original_total_product_price: o.payment_info?.original_total_product_price,
                platform_discount: o.payment_info?.platform_discount,
                product_tax: o.payment_info?.product_tax,
                seller_discount: o.payment_info?.seller_discount,
                shipping_fee_cofunded_discount: o.payment_info?.shipping_fee_cofunded_discount,
                shipping_fee_platform_discount: o.payment_info?.shipping_fee_platform_discount,
                shipping_fee_seller_discount: o.payment_info?.shipping_fee_seller_discount,
                shipping_fee_tax: o.payment_info?.shipping_fee_tax,
                item_insurance_tax: o.payment_info?.item_insurance_tax
            },
            create_time: Math.floor(new Date(o.create_time).getTime() / 1000),
            update_time: o.update_time ? Math.floor(new Date(o.update_time).getTime() / 1000) : undefined,
            paid_time: o.paid_time ? Math.floor(new Date(o.paid_time).getTime() / 1000) : undefined,
            line_items: o.line_items || [],
            buyer_info: o.buyer_info,
            shipping_info: o.shipping_info,
            payment_info: o.payment_info,
            payment_method_name: o.payment_method_name,
            shipping_type: o.shipping_type,
            delivery_option_name: o.delivery_option_name,
            fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
            is_fbt: o.is_fbt || false,
            fbt_fulfillment_fee: o.fbt_fulfillment_fee || null,
            warehouse_id: o.warehouse_id || null,
            is_sample_order: o.is_sample_order || false,
            cancel_reason: o.cancel_reason || null,
            cancellation_initiator: o.cancellation_initiator || null,
            seller_note: o.seller_note || null,
            delivery_type: o.delivery_type || null,
            collection_time: o.collection_time ? Math.floor(new Date(o.collection_time).getTime() / 1000) : undefined,
            shipping_due_time: o.shipping_due_time ? Math.floor(new Date(o.shipping_due_time).getTime() / 1000) : undefined,
            is_cod: o.is_cod || false,
            is_exchange_order: o.is_exchange_order || false,
            is_on_hold_order: o.is_on_hold_order || false,
            is_replacement_order: o.is_replacement_order || false,
            tracking_number: o.tracking_number || null,
            shipping_provider: o.shipping_provider || null,
            shipping_provider_id: o.shipping_provider_id || null
        });

        const changedOrders = (changedOrdersResult.data || []).map(mapOrder);
        const totalOrderCount = orderCountResult.count ?? 0;

        const timing = Date.now() - startTime;
        console.log(`[Shop Data Delta] ${timing}ms — ${changedOrders.length} changed orders, ${(productsResult.data || []).length} products`);

        res.json({
            success: true,
            data: {
                newOrders: changedOrders,
                updatedOrders: [],
                products: (productsResult.data || []).map(p => ({
                    product_id: p.product_id,
                    product_name: p.product_name,
                    status: p.status === 'active' ? 'ACTIVATE' : 'INACTIVE',
                    price: p.price,
                    currency: 'USD',
                    stock: p.stock,
                    sales_count: p.sales_count,
                    images: p.images || [],
                    main_image_url: p.main_image_url || (p.images && p.images[0]) || '',
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    cogs: p.cogs ?? null,
                    shipping_cost: p.shipping_cost ?? null,
                    is_fbt: p.is_fbt || false,
                    fbt_source: p.fbt_source || 'auto',
                    details: p.details || null
                })),
                settlements: (settlementsResult.data || []).map((s: any) => ({
                    ...s.settlement_data,
                    id: s.settlement_id,
                    shop_id: s.shop_id,
                    transaction_summary: s.transaction_summary || null
                })),
                totalOrders: totalOrderCount
            },
            timing: { total_ms: timing }
        });
    } catch (error: any) {
        console.error('[Shop Data Delta] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/orders/synced/:accountId
 * Get all synced orders from the database
 */
router.get('/orders/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, startDate, endDate } = req.query;

        // Join with tiktok_shops to filter by account_id and get timezone
        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id, shop_id, timezone')
            .eq('account_id', accountId);

        // If shopId is provided, it's the TikTok shop_id, not the internal Supabase ID
        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            console.log(`[Orders Synced] No shops found for account ${accountId}${shopId ? ` and shop ${shopId}` : ''}`);
            return res.json({ success: true, data: { orders: [] } });
        }

        // Get shop timezone for date conversion (use first shop's timezone)
        const shopTimezone = shops[0].timezone || 'America/Los_Angeles';

        // Date range filtering - default to last 30 days if not provided
        let startTs: string; // ISO timestamp for PostgreSQL
        let endTs: string;

        if (startDate && endDate) {
            // Convert YYYY-MM-DD dates to ISO timestamps using shop timezone
            const { getShopDayStartTimestamp, getShopDayEndExclusiveTimestamp } = await import('../utils/dateUtils.js');
            const startUnix = getShopDayStartTimestamp(startDate as string, shopTimezone);
            const endUnix = getShopDayEndExclusiveTimestamp(endDate as string, shopTimezone);

            // Convert to ISO timestamp strings for PostgreSQL
            startTs = new Date(startUnix * 1000).toISOString();
            endTs = new Date(endUnix * 1000).toISOString();
            console.log(`[Orders Synced] Date range: ${startDate} to ${endDate} (${shopTimezone})`);
        } else {
            // Default to last 30 days
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 86400 * 1000));
            startTs = thirtyDaysAgo.toISOString();
            endTs = now.toISOString();
            console.log(`[Orders Synced] Using default 30-day range`);
        }

        // Get internal Supabase IDs to query shop_orders
        const internalShopIds = shops.map(s => s.id);

        // Paginated fetch with date filtering
        const BATCH_SIZE = 1000;
        let allOrders: any[] = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const { data: batch, error } = await supabase
                .from('shop_orders')
                .select('*')
                .in('shop_id', internalShopIds)
                .not('paid_time', 'is', null) // Only PAID orders
                .gte('paid_time', startTs) // Filter by PAID TIME
                .lt('paid_time', endTs)
                .order('paid_time', { ascending: false })
                .range(offset, offset + BATCH_SIZE - 1);

            if (error) throw error;

            if (batch && batch.length > 0) {
                allOrders = [...allOrders, ...batch];
                offset += BATCH_SIZE;
                hasMore = batch.length === BATCH_SIZE;
            } else {
                hasMore = false;
            }
        }

        const orders = allOrders;

        res.json({
            success: true,
            data: {
                orders: orders.map(o => {
                    const paymentInfo = o.payment_info || {};
                    return {
                        id: o.order_id,
                        status: o.order_status,
                        payment: {
                            total_amount: o.total_amount?.toString() || paymentInfo.total_amount || '0',
                            currency: o.currency || paymentInfo.currency || 'USD',
                            sub_total: paymentInfo.sub_total || o.total_amount?.toString() || '0',
                            tax: paymentInfo.tax || paymentInfo.product_tax || '0',
                            shipping_fee: o.shipping_fee?.toString() || paymentInfo.shipping_fee || '0',
                            // Extended payment breakdown
                            original_shipping_fee: paymentInfo.original_shipping_fee,
                            original_total_product_price: paymentInfo.original_total_product_price,
                            platform_discount: paymentInfo.platform_discount,
                            product_tax: paymentInfo.product_tax,
                            seller_discount: paymentInfo.seller_discount,
                            shipping_fee_cofunded_discount: paymentInfo.shipping_fee_cofunded_discount,
                            shipping_fee_platform_discount: paymentInfo.shipping_fee_platform_discount,
                            shipping_fee_seller_discount: paymentInfo.shipping_fee_seller_discount,
                            shipping_fee_tax: paymentInfo.shipping_fee_tax,
                            item_insurance_tax: paymentInfo.item_insurance_tax
                        },
                        create_time: Math.floor(new Date(o.create_time).getTime() / 1000),
                        update_time: o.update_time ? Math.floor(new Date(o.update_time).getTime() / 1000) : undefined,
                        line_items: o.line_items || [],
                        buyer_info: o.buyer_info,
                        shipping_info: o.shipping_info,
                        is_sample_order: (o as any).is_sample_order || false,
                        // Shipping & Delivery options
                        payment_method_name: (o as any).payment_method_name || paymentInfo.payment_method_name,
                        shipping_type: (o as any).shipping_type,
                        delivery_option_id: (o as any).delivery_option_id,
                        delivery_option_name: (o as any).delivery_option_name || o.shipping_info?.delivery_option_name,
                        // FBT tracking fields
                        fulfillment_type: o.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                        is_fbt: o.is_fbt || false,
                        fbt_fulfillment_fee: o.fbt_fulfillment_fee || null,
                        warehouse_id: o.warehouse_id || null,
                        // New order fields
                        collection_time: o.collection_time ? Math.floor(new Date(o.collection_time).getTime() / 1000) : undefined,
                        shipping_due_time: o.shipping_due_time ? Math.floor(new Date(o.shipping_due_time).getTime() / 1000) : undefined,
                        is_cod: o.is_cod || false,
                        is_exchange_order: o.is_exchange_order || false,
                        is_on_hold_order: o.is_on_hold_order || false,
                        is_replacement_order: o.is_replacement_order || false,
                        delivery_type: o.delivery_type,
                        seller_note: o.seller_note,
                        tracking_number: o.tracking_number,
                        shipping_provider: o.shipping_provider,
                        shipping_provider_id: o.shipping_provider_id
                    };
                })
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/orders/:accountId
 * Get orders for a shop
 */
router.get('/orders/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, status, page = '1', pageSize = '20' } = req.query;

        const params: any = {
            page_size: parseInt(pageSize as string),
            page_number: parseInt(page as string)
        };

        if (status) {
            params.order_status = status;
        }

        const orders = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.makeApiRequest(
                '/order/202309/orders/search', // Updated endpoint
                token,
                cipher,
                params,
                'POST'
            )
        );

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncOrders(shop)).catch(err => console.error('Background syncOrders error:', err));

        res.json({
            success: true,
            data: orders,
        });
    } catch (error: any) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/orders/:accountId/:orderId
 * Get single order details
 */
router.get('/orders/:accountId/:orderId', async (req: Request, res: Response) => {
    try {
        const { accountId, orderId } = req.params;
        const { shopId } = req.query;

        // API expects a list of IDs, we just send one
        const response = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.getOrderDetails(
                token,
                cipher,
                [orderId]
            )
        );

        const order = response.orders?.[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
            });
        }

        res.json({
            success: true,
            data: order,
        });
    } catch (error: any) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/products/:accountId
 * Get products for a shop
 */
router.get('/products/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, page = '1', pageSize = '20' } = req.query;

        const params = {
            page_size: parseInt(pageSize as string),
            page_number: parseInt(page as string)
        };

        const response = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.searchProducts(
                token,
                cipher,
                params
            )
        );

        // Transform the response to match frontend expectations
        const products = (response.products || []).map((p: any) => {
            const mainSku = p.skus?.[0] || {};
            const priceInfo = mainSku.price || {};
            const inventoryInfo = mainSku.inventory?.[0] || {};

            return {
                product_id: p.id,
                product_name: p.title, // 202502 uses 'title'
                price: parseFloat(priceInfo.tax_exclusive_price || '0'), // 202502 uses 'tax_exclusive_price'
                currency: priceInfo.currency || 'USD',
                stock: inventoryInfo.quantity || 0, // 202502 uses 'inventory' and 'quantity'
                sales_count: 0, // Sales count not directly available in this endpoint response structure
                status: p.status === 'ACTIVATE' ? 'active' : 'inactive', // 202502 uses 'ACTIVATE' string
                images: [], // Images not in the search response, would need detail call
                create_time: p.create_time
            };
        });

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncProducts(shop)).catch(err => console.error('Background syncProducts error:', err));

        res.json({
            success: true,
            data: {
                products,
                total: response.total
            },
        });
    } catch (error: any) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/settlements/synced/:accountId
 * Get synced settlement data from database
 */
router.get('/settlements/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        // Get shop IDs
        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const shopIds = shops.map(s => s.id);

        const { data: settlements, error } = await supabase
            .from('shop_settlements')
            .select('*')
            .in('shop_id', shopIds)
            .order('settlement_time', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            data: settlements.map(s => ({
                ...s.settlement_data,
                id: s.settlement_id,
                shop_id: s.shop_id,
                transaction_summary: s.transaction_summary || null
            })),
        });
    } catch (error: any) {
        console.error('Error fetching synced settlements:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/performance/:accountId
 * Get shop performance metrics
 */
router.get('/performance/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const performance = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.makeApiRequest(
                '/seller/202309/performance',
                token,
                cipher
            )
        );

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncPerformance(shop)).catch(err => console.error('Background syncPerformance error:', err));

        res.json({
            success: true,
            data: performance,
        });
    } catch (error: any) {
        console.error('Error fetching performance:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/overview/:accountId
 * Get consolidated overview data (Metrics, Orders, Products, Finance)
 * Optimized to reduce API calls.
 */
router.get('/overview/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, refresh, background } = req.query;

        console.log(`[Overview API] Fetching overview for account ${accountId}, shop ${shopId || 'all'}, refresh=${refresh}, background=${background}...`);

        // 1. If refresh=true, trigger sync
        if (refresh === 'true') {
            const shop = await getShopWithToken(accountId, shopId as string, true); // Force token refresh if needed

            if (background === 'true') {
                // Background mode: Start sync async, don't wait
                console.log('[Overview API] Starting background sync...');
                Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop),
                    syncPerformance(shop)
                ]).then(() => {
                    console.log('[Overview API] Background sync completed');
                }).catch(err => {
                    console.error('[Overview API] Background sync error:', err);
                });
                // Continue immediately to return cached data
            } else {
                // Foreground mode: Wait for sync to complete
                await Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop),
                    syncPerformance(shop)
                ]);
            }
        }

        // 2. Fetch Aggregated Data from Supabase
        let shopQuery = supabase
            .from('tiktok_shops')
            .select(`
                id,
                shop_id,
                shop_name,
                region,
                shop_orders (count),
                shop_products (count),
                shop_settlements (
                    total_amount,
                    net_amount,
                    settlement_time
                ),
                shop_performance (
                    shop_rating,
                    date
                )
            `)
            .eq('account_id', accountId);

        if (shopId) {
            shopQuery = shopQuery.eq('shop_id', shopId);
        }

        const { data: shops, error: shopError } = await shopQuery;

        if (shopError) throw shopError;

        // 3. Aggregate Metrics
        let totalOrders = 0;
        let totalProducts = 0;
        let totalRevenue = 0;
        let totalNet = 0;
        let recentOrders: any[] = []; // We could fetch recent orders here too if needed

        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const startSec = thirtyDaysAgo / 1000;

        shops?.forEach((shop: any) => {
            totalOrders += shop.shop_orders?.[0]?.count || 0;
            totalProducts += shop.shop_products?.[0]?.count || 0;

            // Filter settlements for 30d revenue
            const relevantSettlements = shop.shop_settlements?.filter((s: any) => {
                const time = new Date(s.settlement_time).getTime() / 1000;
                return time >= startSec;
            }) || [];

            totalRevenue += relevantSettlements.reduce((sum: number, s: any) => sum + (Number(s.total_amount) || 0), 0);
            totalNet += relevantSettlements.reduce((sum: number, s: any) => sum + (Number(s.net_amount) || 0), 0);
        });

        // 4. Fetch recent orders for the "Orders" card preview or just to ensure we have them
        // The user wants "result from orders... updated". We already synced them.
        // Let's return the latest 5 orders for preview if needed, or just the counts.
        // The OverviewView mainly needs metrics.

        res.json({
            success: true,
            data: {
                metrics: {
                    totalOrders,
                    totalProducts,
                    totalRevenue,
                    totalNet,
                    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                    conversionRate: 2.5, // Placeholder or fetch from performance
                    shopRating: (shops && shops.length > 0 && shops[0].shop_performance && shops[0].shop_performance.length > 0)
                        ? (shops[0].shop_performance[0].shop_rating || 0)
                        : 0
                },
                lastUpdated: new Date().toISOString()
            }
        });

    } catch (error: any) {
        console.error('[Overview API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});



/**
 * GET /api/tiktok-shop/products/synced/:accountId
 * Get all synced products from the database
 */
router.get('/products/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { products: [] } });
        }

        const shopIds = shops.map(s => s.id);
        const { data: products, error } = await supabase
            .from('shop_products')
            .select('*')
            .in('shop_id', shopIds);

        if (error) throw error;

        res.json({
            success: true,
            data: {
                products: products.map(p => ({
                    product_id: p.product_id,
                    product_name: p.product_name,
                    status: p.status === 'active' ? 'ACTIVATE' : 'INACTIVE',
                    price: p.price,
                    currency: 'USD', // Default or fetch from shop
                    stock: p.stock,
                    sales_count: p.sales_count,
                    images: p.images || [],
                    main_image_url: p.main_image_url || (p.images && p.images[0]) || '',
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    cogs: p.cogs ?? null, // Cost of Goods Sold (user-editable)
                    shipping_cost: p.shipping_cost ?? null, // Shipping cost per unit
                    is_fbt: p.is_fbt || false, // Fulfilled by TikTok
                    fbt_source: p.fbt_source || 'auto', // 'auto' (from API) or 'manual' (user override)
                    details: p.details || null
                }))
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/tiktok-shop/products/costs/:productId
 * Simple endpoint to update product costs by productId only
 */
router.put('/products/costs/:productId', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { cogs, shipping_cost } = req.body;

        // Validate cogs if provided
        if (cogs !== undefined && cogs !== null && (typeof cogs !== 'number' || cogs < 0)) {
            return res.status(400).json({
                success: false,
                error: 'COGS must be a non-negative number or null'
            });
        }

        // Validate shipping cost if provided
        if (shipping_cost !== undefined && shipping_cost !== null && (typeof shipping_cost !== 'number' || shipping_cost < 0)) {
            return res.status(400).json({
                success: false,
                error: 'Shipping cost must be a non-negative number or null'
            });
        }

        // Build update object
        const updateData: any = { updated_at: new Date().toISOString() };
        if (cogs !== undefined) updateData.cogs = cogs;
        if (shipping_cost !== undefined) updateData.shipping_cost = shipping_cost;

        // Update all records with this product_id (could be in multiple shops)
        const { data, error } = await supabase
            .from('shop_products')
            .update(updateData)
            .eq('product_id', productId)
            .select('id, product_id, cogs, shipping_cost');

        if (error) {
            console.error('[Product Costs] Update error:', error);
            throw error;
        }

        console.log(`[Product Costs] Updated product ${productId}: COGS=${cogs}, Shipping=${shipping_cost}`);

        res.json({
            success: true,
            data: data?.[0] || { product_id: productId, cogs, shipping_cost }
        });
    } catch (error: any) {
        console.error('[Product Costs] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/tiktok-shop/products/:productId/costs
 * Update product costs (COGS and/or shipping) with backdating support
 */
router.patch('/products/:productId/costs', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const {
            accountId,
            cogs,
            shipping_cost: shippingCost,
            is_fbt: isFbt,
            effectiveDate, // Optional: date from which this cost applies
            applyFrom // 'backdate' | 'today' | 'specific_date'
        } = req.body;

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: 'accountId is required'
            });
        }

        // Validate cogs if provided
        if (cogs !== undefined && cogs !== null && (typeof cogs !== 'number' || cogs < 0)) {
            return res.status(400).json({
                success: false,
                error: 'COGS must be a non-negative number or null'
            });
        }

        // Validate shipping cost if provided
        if (shippingCost !== undefined && shippingCost !== null && (typeof shippingCost !== 'number' || shippingCost < 0)) {
            return res.status(400).json({
                success: false,
                error: 'Shipping cost must be a non-negative number or null'
            });
        }

        // Get shop IDs for this account
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No shops found for this account'
            });
        }

        const shopIds = shops.map(s => s.id);
        const today = new Date().toISOString().split('T')[0];

        // Determine effective date based on applyFrom option
        let costEffectiveDate = today;
        if (applyFrom === 'specific_date' && effectiveDate) {
            costEffectiveDate = effectiveDate;
        } else if (applyFrom === 'backdate' && effectiveDate) {
            costEffectiveDate = effectiveDate;
        }
        // 'today' uses the default (today)

        // Build update object for current product record
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (cogs !== undefined) {
            updateData.cogs = cogs;
        }
        if (shippingCost !== undefined) {
            updateData.shipping_cost = shippingCost;
        }
        if (isFbt !== undefined) {
            updateData.is_fbt = isFbt;
            updateData.fbt_source = 'manual'; // Mark as manually set so auto-sync won't overwrite
        }

        // Update the current product record
        const { data, error } = await supabase
            .from('shop_products')
            .update(updateData)
            .eq('product_id', productId)
            .in('shop_id', shopIds)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        // If backdating is enabled, add to cost history
        if (applyFrom && applyFrom !== 'today') {
            const shopId = shopIds[0]; // Use primary shop

            // Close any existing open cost records for this product
            if (cogs !== undefined) {
                await supabase
                    .from('product_cost_history')
                    .update({ end_date: costEffectiveDate })
                    .eq('product_id', productId)
                    .eq('shop_id', shopId)
                    .eq('cost_type', 'cogs')
                    .is('end_date', null);

                // Insert new cost history record
                await supabase
                    .from('product_cost_history')
                    .insert({
                        shop_id: shopId,
                        product_id: productId,
                        cost_type: 'cogs',
                        amount: cogs || 0,
                        effective_date: costEffectiveDate,
                        end_date: null,
                        notes: `Cost updated via dashboard (${applyFrom})`
                    });
            }

            if (shippingCost !== undefined) {
                await supabase
                    .from('product_cost_history')
                    .update({ end_date: costEffectiveDate })
                    .eq('product_id', productId)
                    .eq('shop_id', shopId)
                    .eq('cost_type', 'shipping')
                    .is('end_date', null);

                await supabase
                    .from('product_cost_history')
                    .insert({
                        shop_id: shopId,
                        product_id: productId,
                        cost_type: 'shipping',
                        amount: shippingCost || 0,
                        effective_date: costEffectiveDate,
                        end_date: null,
                        notes: `Shipping cost updated via dashboard (${applyFrom})`
                    });
            }
        }

        console.log(`[Costs] Updated costs for product ${productId}: COGS=${cogs}, Shipping=${shippingCost}, FBT=${isFbt}, EffectiveDate=${costEffectiveDate}`);

        res.json({
            success: true,
            data: {
                product_id: productId,
                cogs: cogs,
                shipping_cost: shippingCost,
                is_fbt: isFbt,
                effective_date: costEffectiveDate
            }
        });
    } catch (error: any) {
        console.error('[Costs] Error updating costs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/tiktok-shop/products/:productId/sku-costs
 * Update COGS and/or shipping cost for a specific SKU variant, with optional backdating
 */
router.patch('/products/:productId/sku-costs', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, skuId, cogs, shipping_cost, applyFrom, effectiveDate } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }
        if (!skuId) {
            return res.status(400).json({ success: false, error: 'skuId is required' });
        }
        if (cogs !== undefined && cogs !== null && (typeof cogs !== 'number' || cogs < 0)) {
            return res.status(400).json({ success: false, error: 'COGS must be a non-negative number or null' });
        }
        if (shipping_cost !== undefined && shipping_cost !== null && (typeof shipping_cost !== 'number' || shipping_cost < 0)) {
            return res.status(400).json({ success: false, error: 'Shipping cost must be a non-negative number or null' });
        }

        // Get shop IDs for this account
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.status(404).json({ success: false, error: 'No shops found for this account' });
        }

        const shopIds = shops.map(s => s.id);

        // Fetch the product to get current details JSON
        const { data: productRows, error: fetchError } = await supabase
            .from('shop_products')
            .select('details')
            .eq('product_id', productId)
            .in('shop_id', shopIds);

        if (fetchError) throw fetchError;
        if (!productRows || productRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const details = productRows[0].details || {};
        const skus = details.skus || [];

        // Find and update the matching SKU
        const skuIndex = skus.findIndex((s: any) => s.id === skuId);
        if (skuIndex === -1) {
            return res.status(404).json({ success: false, error: `SKU ${skuId} not found in product` });
        }

        const skuUpdate: any = {};
        if (cogs !== undefined) skuUpdate.cogs = cogs;
        if (shipping_cost !== undefined) skuUpdate.shipping_cost = shipping_cost;
        skus[skuIndex] = { ...skus[skuIndex], ...skuUpdate };
        details.skus = skus;

        // Write back the updated details
        const { error: updateError } = await supabase
            .from('shop_products')
            .update({ details, updated_at: new Date().toISOString() })
            .eq('product_id', productId)
            .in('shop_id', shopIds);

        if (updateError) throw updateError;

        // If backdating, add to cost history with sku_id
        const today = new Date().toISOString().split('T')[0];
        let costEffectiveDate = today;
        if ((applyFrom === 'specific_date' || applyFrom === 'backdate') && effectiveDate) {
            costEffectiveDate = effectiveDate;
        }

        if (applyFrom && applyFrom !== 'today') {
            const shopId = shopIds[0];

            if (cogs !== undefined) {
                // Close existing open SKU COGS record
                await supabase
                    .from('product_cost_history')
                    .update({ end_date: costEffectiveDate })
                    .eq('product_id', productId)
                    .eq('shop_id', shopId)
                    .eq('sku_id', skuId)
                    .eq('cost_type', 'cogs')
                    .is('end_date', null);

                // Insert new record
                await supabase
                    .from('product_cost_history')
                    .insert({
                        shop_id: shopId,
                        product_id: productId,
                        sku_id: skuId,
                        cost_type: 'cogs',
                        amount: cogs || 0,
                        effective_date: costEffectiveDate,
                        end_date: null,
                        notes: `SKU COGS updated via dashboard (${applyFrom})`
                    });
            }

            if (shipping_cost !== undefined) {
                // Close existing open SKU shipping record
                await supabase
                    .from('product_cost_history')
                    .update({ end_date: costEffectiveDate })
                    .eq('product_id', productId)
                    .eq('shop_id', shopId)
                    .eq('sku_id', skuId)
                    .eq('cost_type', 'shipping')
                    .is('end_date', null);

                await supabase
                    .from('product_cost_history')
                    .insert({
                        shop_id: shopId,
                        product_id: productId,
                        sku_id: skuId,
                        cost_type: 'shipping',
                        amount: shipping_cost || 0,
                        effective_date: costEffectiveDate,
                        end_date: null,
                        notes: `SKU shipping cost updated via dashboard (${applyFrom})`
                    });
            }
        }

        console.log(`[SKU Costs] Updated costs for product ${productId}, SKU ${skuId}: COGS=${cogs}, Shipping=${shipping_cost}, EffectiveDate=${costEffectiveDate}`);

        res.json({
            success: true,
            data: { product_id: productId, sku_id: skuId, cogs, shipping_cost, effective_date: costEffectiveDate }
        });
    } catch (error: any) {
        console.error('[SKU Costs] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/products/:productId/cost-history
 * Get cost history for a product
 */
router.get('/products/:productId/cost-history', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, skuId } = req.query;

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: 'accountId is required'
            });
        }

        // Get shop IDs for this account
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const shopIds = shops.map(s => s.id);

        let query = supabase
            .from('product_cost_history')
            .select('*')
            .eq('product_id', productId)
            .in('shop_id', shopIds);

        if (skuId) {
            query = query.eq('sku_id', skuId);
        } else {
            query = query.is('sku_id', null);
        }

        const { data: history, error } = await query
            .order('effective_date', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            data: history || []
        });
    } catch (error: any) {
        console.error('[Cost History] Error fetching:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/products/:productId/cost-at-date
 * Get the effective cost for a product at a specific date (for P&L calculations)
 */
router.get('/products/:productId/cost-at-date', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, date, costType = 'cogs', skuId } = req.query;

        if (!accountId || !date) {
            return res.status(400).json({
                success: false,
                error: 'accountId and date are required'
            });
        }

        // Get shop IDs for this account
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { cost: null } });
        }

        const shopIds = shops.map(s => s.id);

        // Find the cost that was active on the given date
        let query = supabase
            .from('product_cost_history')
            .select('*')
            .eq('product_id', productId)
            .eq('cost_type', costType)
            .in('shop_id', shopIds)
            .lte('effective_date', date)
            .or(`end_date.is.null,end_date.gt.${date}`);

        if (skuId) {
            query = query.eq('sku_id', skuId);
        } else {
            query = query.is('sku_id', null);
        }

        const { data: costRecord, error } = await query
            .order('effective_date', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            throw error;
        }

        res.json({
            success: true,
            data: {
                cost: costRecord?.amount || null,
                effective_date: costRecord?.effective_date || null
            }
        });
    } catch (error: any) {
        console.error('[Cost At Date] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/tiktok-shop/products/:productId/cogs
 * Legacy endpoint - Update the COGS (Cost of Goods Sold) for a product
 * Kept for backward compatibility
 */
router.patch('/products/:productId/cogs', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { cogs, accountId }: { cogs: number | null; accountId: string } = req.body;

        if (cogs !== null && (typeof cogs !== 'number' || cogs < 0)) {
            return res.status(400).json({
                success: false,
                error: 'COGS must be a non-negative number or null'
            });
        }

        if (!accountId) {
            return res.status(400).json({
                success: false,
                error: 'accountId is required'
            });
        }

        // Get shop IDs for this account to verify ownership
        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No shops found for this account'
            });
        }

        const shopIds = shops.map(s => s.id);

        // Update COGS for the product (across all shop records)
        const { data, error } = await supabase
            .from('shop_products')
            .update({
                cogs: cogs,
                updated_at: new Date().toISOString()
            })
            .eq('product_id', productId)
            .in('shop_id', shopIds)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        console.log(`[COGS] Updated COGS for product ${productId} to ${cogs}`);

        res.json({
            success: true,
            data: {
                product_id: productId,
                cogs: cogs
            }
        });
    } catch (error: any) {
        console.error('[COGS] Error updating COGS:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PRODUCT MANAGEMENT ROUTES ====================

/**
 * GET /api/tiktok-shop/products/:productId/tiktok-details
 * Fetch fresh product details directly from TikTok API
 */
router.get('/products/:productId/tiktok-details', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId } = req.query;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        const shop = await getShopWithToken(accountId as string, undefined);
        const details = await tiktokShopApi.getProductDetails(shop.access_token, shop.shop_cipher, productId);

        res.json({ success: true, data: details });
    } catch (error: any) {
        console.error('[TikTok Details] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/tiktok-shop/products/:productId/tiktok-edit
 * Edit product on TikTok
 */
router.put('/products/:productId/tiktok-edit', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, updates } = req.body;

        if (!accountId || !updates) {
            return res.status(400).json({ success: false, error: 'accountId and updates are required' });
        }

        const shop = await getShopWithToken(accountId, undefined);
        const result = await tiktokShopApi.editProduct(shop.access_token, shop.shop_cipher, productId, updates);

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[TikTok Edit] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/products/tiktok-delete
 * Delete products on TikTok
 */
router.post('/products/tiktok-delete', async (req: Request, res: Response) => {
    try {
        const { accountId, productIds } = req.body;

        if (!accountId || !productIds || !Array.isArray(productIds)) {
            return res.status(400).json({ success: false, error: 'accountId and productIds array are required' });
        }

        const shop = await getShopWithToken(accountId, undefined);
        const result = await tiktokShopApi.deleteProducts(shop.access_token, shop.shop_cipher, productIds);

        // Also update local DB status
        await supabase
            .from('shop_products')
            .update({ status: 'DELETED' })
            .in('product_id', productIds);

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[TikTok Delete] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/products/tiktok-activate
 * Activate products on TikTok
 */
router.post('/products/tiktok-activate', async (req: Request, res: Response) => {
    try {
        const { accountId, productIds } = req.body;

        if (!accountId || !productIds || !Array.isArray(productIds)) {
            return res.status(400).json({ success: false, error: 'accountId and productIds array are required' });
        }

        const shop = await getShopWithToken(accountId, undefined);
        const result = await tiktokShopApi.activateProducts(shop.access_token, shop.shop_cipher, productIds);

        // Also update local DB status
        await supabase
            .from('shop_products')
            .update({ status: 'ACTIVATE' })
            .in('product_id', productIds);

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[TikTok Activate] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/products/tiktok-deactivate
 * Deactivate products on TikTok
 */
router.post('/products/tiktok-deactivate', async (req: Request, res: Response) => {
    try {
        const { accountId, productIds } = req.body;

        if (!accountId || !productIds || !Array.isArray(productIds)) {
            return res.status(400).json({ success: false, error: 'accountId and productIds array are required' });
        }

        const shop = await getShopWithToken(accountId, undefined);
        const result = await tiktokShopApi.deactivateProducts(shop.access_token, shop.shop_cipher, productIds);

        // Also update local DB status
        await supabase
            .from('shop_products')
            .update({ status: 'SELLER_DEACTIVATED' })
            .in('product_id', productIds);

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[TikTok Deactivate] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PRODUCT EDITING APIs ====================

/**
 * POST /api/tiktok-shop/products/:productId/partial-edit
 * Partial edit product on TikTok (title, description, images)
 * This is the preferred method for making changes as it doesn't trigger full product audit
 */
router.post('/products/:productId/partial-edit', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, title, description, main_images, skus } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        // Build updates object with only provided fields
        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (main_images !== undefined) updates.main_images = main_images;
        if (skus !== undefined) updates.skus = skus;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'At least one field to update is required' });
        }

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.partialEditProduct(token, cipher, productId, updates);
        });

        // Update local DB if title changed
        if (title) {
            await supabase
                .from('shop_products')
                .update({
                    name: title,
                    updated_at: new Date().toISOString()
                })
                .eq('product_id', productId);
        }

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Product Partial Edit] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            requestId: error.requestId
        });
    }
});

/**
 * POST /api/tiktok-shop/products/:productId/inventory
 * Update product inventory/stock on TikTok
 * Does NOT trigger product review - instant update
 */
router.post('/products/:productId/inventory', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, skus } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        if (!skus || !Array.isArray(skus) || skus.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'skus array is required. Format: [{ id: "sku_id", inventory: [{ warehouse_id: "...", quantity: 50 }] }]'
            });
        }

        // Validate SKU format
        for (const sku of skus) {
            if (!sku.id) {
                return res.status(400).json({ success: false, error: 'Each SKU must have an id' });
            }
            if (!sku.inventory || !Array.isArray(sku.inventory)) {
                return res.status(400).json({ success: false, error: 'Each SKU must have an inventory array' });
            }
            for (const inv of sku.inventory) {
                if (!inv.warehouse_id) {
                    return res.status(400).json({ success: false, error: 'Each inventory item must have a warehouse_id' });
                }
                if (typeof inv.quantity !== 'number' || inv.quantity < 0) {
                    return res.status(400).json({ success: false, error: 'Each inventory item must have a valid quantity >= 0' });
                }
            }
        }

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.updateProductInventory(token, cipher, productId, skus);
        });

        // Update local DB stock
        const totalQuantity = skus.reduce((sum, sku) => {
            return sum + sku.inventory.reduce((s: number, inv: any) => s + inv.quantity, 0);
        }, 0);

        await supabase
            .from('shop_products')
            .update({
                stock_quantity: totalQuantity,
                updated_at: new Date().toISOString()
            })
            .eq('product_id', productId);

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Product Inventory Update] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            requestId: error.requestId
        });
    }
});

/**
 * POST /api/tiktok-shop/products/:productId/prices
 * Update product prices on TikTok
 */
router.post('/products/:productId/prices', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { accountId, skus } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        if (!skus || !Array.isArray(skus) || skus.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'skus array is required. Format: [{ id: "sku_id", original_price: "29.99" }]'
            });
        }

        // Validate SKU format
        for (const sku of skus) {
            if (!sku.id) {
                return res.status(400).json({ success: false, error: 'Each SKU must have an id' });
            }
            if (!sku.original_price && !sku.sale_price) {
                return res.status(400).json({ success: false, error: 'Each SKU must have original_price or sale_price' });
            }
        }

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.updateProductPrices(token, cipher, productId, skus);
        });

        // Update local DB price (use first SKU price as main price)
        const mainPrice = parseFloat(skus[0].original_price || skus[0].sale_price || '0');
        if (mainPrice > 0) {
            await supabase
                .from('shop_products')
                .update({
                    price: mainPrice,
                    updated_at: new Date().toISOString()
                })
                .eq('product_id', productId);
        }

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Product Price Update] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            requestId: error.requestId
        });
    }
});

/**
 * GET /api/tiktok-shop/warehouses/:accountId
 * Get available warehouses for inventory management
 */
router.get('/warehouses/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.getWarehouses(token, cipher);
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Warehouses] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/images/upload
 * Upload an image to TikTok for use in products
 * Requires multipart/form-data with 'image' field
 */
router.post('/images/upload', async (req: Request, res: Response) => {
    try {
        const { accountId, useCase = 'MAIN_IMAGE' } = req.body;

        if (!accountId) {
            return res.status(400).json({ success: false, error: 'accountId is required' });
        }

        // Check if image data is provided (base64 or URL)
        const { imageData, imageUrl, fileName = 'image.jpg' } = req.body;

        if (!imageData && !imageUrl) {
            return res.status(400).json({
                success: false,
                error: 'Either imageData (base64) or imageUrl is required'
            });
        }

        let buffer: Buffer;
        if (imageData) {
            // Convert base64 to buffer
            buffer = Buffer.from(imageData, 'base64');
        } else {
            // Fetch image from URL
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            buffer = Buffer.from(imageResponse.data);
        }

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.uploadProductImage(token, cipher, buffer, fileName, useCase);
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Image Upload] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});

/**
 * GET /api/tiktok-shop/categories/:accountId
 * Get product categories
 */
router.get('/categories/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const result = await executeWithRefresh(accountId, undefined, async (token, cipher) => {
            return tiktokShopApi.getCategories(token, cipher);
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Categories] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/sync/:accountId
 * Trigger data synchronization
 * Supports incremental sync - only fetches new data if shop has been synced before
 */
router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, syncType = 'all', startDate, endDate, forceFullSync = false } = req.body;

        const shop = await getShopWithToken(accountId, shopId);

        // If custom date range provided, this is an on-demand historical fetch
        const isHistoricalFetch = !!(startDate && endDate);

        // Detect if this is a first-time sync by checking if shop has any orders
        const { count: existingOrdersCount } = await supabase
            .from('shop_orders')
            .select('*', { count: 'exact', head: true })
            .eq('shop_id', shop.id);

        const isFirstSync = (existingOrdersCount || 0) === 0;

        if (forceFullSync) {
            console.log(`[Sync] ⚡ Force Full Sync requested for ${shop.shop_name} - will fetch all settlement data with transactions`);
        } else if (isHistoricalFetch) {
            console.log(`[Sync] Historical fetch for ${shop.shop_name}: ${startDate} to ${endDate}`);
        } else if (isFirstSync) {
            console.log(`[Sync] First-time sync detected for ${shop.shop_name} - will fetch all data`);
        } else {
            console.log(`[Sync] Incremental sync for ${shop.shop_name} - will fetch only new data`);
        }

        // Fetch and store data based on syncType
        const syncResults: { orders?: any; products?: any; settlements?: any; performance?: any } = {};

        if (syncType === 'all' || syncType === 'orders') {
            syncResults.orders = await syncOrders(shop, isFirstSync, isHistoricalFetch ? startDate : undefined, isHistoricalFetch ? endDate : undefined);
        }

        if (syncType === 'all' || syncType === 'products') {
            syncResults.products = await syncProducts(shop, isFirstSync);
        }

        if (syncType === 'all' || syncType === 'settlements' || syncType === 'finance') {
            // Force full sync for settlements when requested (bypasses Smart Stop)
            syncResults.settlements = await syncSettlements(shop, isFirstSync || forceFullSync);
        }

        if (syncType === 'all') {
            syncResults.performance = await syncPerformance(shop);
        }

        res.json({
            success: true,
            message: isFirstSync ? 'Initial sync completed' : 'Incremental sync completed',
            isFirstSync,
            stats: syncResults
        });
    } catch (error: any) {
        console.error('Error syncing data:', error);

        // Check for expired credentials error (105002)
        if (error.code === 105002 || (error.message && error.message.includes('105002'))) {
            console.log(`[Sync Error] Expired credentials detected for account ${req.params.accountId}. Marking shops as expired.`);
            try {
                const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                // Mark all shops for this account as expired since they share the token
                await supabase
                    .from('tiktok_shops')
                    .update({
                        token_expires_at: expiredTime,
                        refresh_token_expires_at: expiredTime,
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', req.params.accountId);
            } catch (dbError) {
                console.error('Error updating shop expiration in DB:', dbError);
            }
        }

        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Cron job endpoint for Vercel
router.get('/sync/cron', async (req: Request, res: Response) => {
    // Verify Vercel Cron signature (optional but recommended)
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // For now, allow open access or check a simple secret
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('Starting scheduled sync...');

        // Get all active shops
        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('*');

        if (error) throw error;

        if (!shops || shops.length === 0) {
            return res.json({ message: 'No shops to sync' });
        }

        console.log(`Found ${shops.length} shops to sync`);

        // Sync each shop
        const results = await Promise.allSettled(shops.map(async (shop) => {
            try {
                // Proactive token refresh before syncing
                // Refresh if: access token expired/near-expiry OR refresh token within 7 days of expiry
                const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : 0;
                const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : 0;
                const cronNow = Date.now();
                const ACCESS_BUFFER = 60 * 60 * 1000;             // 1 hour
                const REFRESH_BUFFER = 7 * 24 * 60 * 60 * 1000;   // 7 days

                const isRefreshTokenDead = refreshExpiry > 0 && refreshExpiry < cronNow;
                const needsTokenRefresh = (accessExpiry < cronNow) ||
                    (accessExpiry - ACCESS_BUFFER < cronNow) ||
                    (refreshExpiry > 0 && (refreshExpiry - REFRESH_BUFFER) < cronNow && !isRefreshTokenDead);

                if (isRefreshTokenDead) {
                    console.log(`[Cron Sync] Shop ${shop.shop_name}: refresh token expired. Skipping sync.`);
                    const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                    await supabase
                        .from('tiktok_shops')
                        .update({ token_expires_at: expiredTime, refresh_token_expires_at: expiredTime, updated_at: new Date().toISOString() })
                        .eq('id', shop.id);
                    return { shop_id: shop.shop_id, status: 'expired', error: 'Refresh token expired' };
                }

                if (needsTokenRefresh && shop.refresh_token) {
                    const reason = accessExpiry < cronNow ? 'access token expired' :
                        (accessExpiry - ACCESS_BUFFER) < cronNow ? 'access token near expiry' :
                            'refresh token near expiry (proactive renewal)';
                    console.log(`[Cron Sync] Refreshing tokens for ${shop.shop_name}: ${reason}`);

                    const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
                    const refreshTime = new Date();

                    await supabase
                        .from('tiktok_shops')
                        .update({
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            token_expires_at: new Date(refreshTime.getTime() + tokenData.access_token_expire_in * 1000).toISOString(),
                            refresh_token_expires_at: new Date(refreshTime.getTime() + tokenData.refresh_token_expire_in * 1000).toISOString(),
                            updated_at: refreshTime.toISOString()
                        })
                        .eq('id', shop.id);

                    shop.access_token = tokenData.access_token;
                    console.log(`[Cron Sync] Successfully refreshed tokens for ${shop.shop_name}`);
                }

                // Run syncs
                await Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop)
                ]);

                return { shop_id: shop.shop_id, status: 'success' };
            } catch (err: any) {
                console.error(`Failed to sync shop ${shop.shop_name}:`, err);

                // Handle expired credentials in Cron
                if (err.code === 105002 || (err.message && err.message.includes('105002'))) {
                    console.log(`[Cron Sync] Expired credentials for shop ${shop.shop_name} (ID: ${shop.id}). Marking as expired.`);
                    try {
                        const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                        await supabase
                            .from('tiktok_shops')
                            .update({
                                token_expires_at: expiredTime,
                                refresh_token_expires_at: expiredTime,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', shop.id);
                    } catch (dbError) {
                        console.error('[Cron Sync] Failed to update expiration:', dbError);
                    }
                }

                return { shop_id: shop.shop_id, status: 'failed', error: err.message };
            }
        }));

        res.json({
            success: true,
            results
        });
    } catch (error: any) {
        console.error('Cron sync failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/sync/cron-settlements
 *
 * Vercel Cron (Hobby: max once per day). Incremental settlement/statement sync only —
 * pulls new statement IDs + transaction summaries without full orders/products sync.
 *
 * Security: set CRON_SECRET in Vercel env; Vercel sends Authorization: Bearer <CRON_SECRET>.
 * Schedule: server/vercel.json (default 07:00 UTC — adjust for when TikTok posts daily statements).
 */
router.get('/sync/cron-settlements', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        console.log('[Cron Settlements] Starting incremental statement sync for all shops...');

        const { data: shops, error } = await supabase.from('tiktok_shops').select('*');
        if (error) throw error;

        if (!shops || shops.length === 0) {
            return res.json({ success: true, message: 'No shops to sync', results: [] });
        }

        const cronNow = Date.now();
        const ACCESS_BUFFER = 60 * 60 * 1000;
        const REFRESH_BUFFER = 7 * 24 * 60 * 60 * 1000;

        const results = await Promise.allSettled(
            shops.map(async (shop) => {
                try {
                    const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : 0;
                    const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : 0;
                    const isRefreshTokenDead = refreshExpiry > 0 && refreshExpiry < cronNow;
                    const needsTokenRefresh =
                        accessExpiry < cronNow ||
                        accessExpiry - ACCESS_BUFFER < cronNow ||
                        (refreshExpiry > 0 && refreshExpiry - REFRESH_BUFFER < cronNow && !isRefreshTokenDead);

                    if (isRefreshTokenDead) {
                        console.log(`[Cron Settlements] Shop ${shop.shop_name}: refresh token expired — skipping.`);
                        const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                        await supabase
                            .from('tiktok_shops')
                            .update({
                                token_expires_at: expiredTime,
                                refresh_token_expires_at: expiredTime,
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', shop.id);
                        return { shop_id: shop.shop_id, status: 'expired', error: 'Refresh token expired' };
                    }

                    if (needsTokenRefresh && shop.refresh_token) {
                        console.log(`[Cron Settlements] Refreshing tokens for ${shop.shop_name}`);
                        const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
                        const refreshTime = new Date();
                        await supabase
                            .from('tiktok_shops')
                            .update({
                                access_token: tokenData.access_token,
                                refresh_token: tokenData.refresh_token,
                                token_expires_at: new Date(
                                    refreshTime.getTime() + tokenData.access_token_expire_in * 1000
                                ).toISOString(),
                                refresh_token_expires_at: new Date(
                                    refreshTime.getTime() + tokenData.refresh_token_expire_in * 1000
                                ).toISOString(),
                                updated_at: refreshTime.toISOString(),
                            })
                            .eq('id', shop.id);
                        shop.access_token = tokenData.access_token;
                    }

                    const syncResult = await syncSettlements(shop, false);
                    return {
                        shop_id: shop.shop_id,
                        status: 'success',
                        fetched: syncResult.fetched,
                        stoppedEarly: syncResult.stoppedEarly,
                        partial: syncResult.partial,
                    };
                } catch (err: any) {
                    console.error(`[Cron Settlements] Shop ${shop.shop_name}:`, err.message);
                    if (err.code === 105002 || (err.message && err.message.includes('105002'))) {
                        const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                        await supabase
                            .from('tiktok_shops')
                            .update({
                                token_expires_at: expiredTime,
                                refresh_token_expires_at: expiredTime,
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', shop.id);
                    }
                    return { shop_id: shop.shop_id, status: 'failed', error: err.message };
                }
            })
        );

        const payload = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: 'failed', error: String(r.reason) }));
        res.json({ success: true, results: payload });
    } catch (error: any) {
        console.error('[Cron Settlements] Fatal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// PROACTIVE TOKEN REFRESH CRON
// ============================================================
// Lightweight endpoint that ONLY checks and refreshes tokens.
// Does NOT sync any data. Designed to run frequently (e.g., every 1-2 hours)
// to ensure no shop's tokens ever expire silently.
//
// This endpoint refreshes tokens for ALL shops where:
//   - Access token is expired or expires within 1 hour
//   - Refresh token expires within 7 days (proactive renewal)
//
// Call this via: GET /api/tiktok-shop/sync/refresh-tokens
// ============================================================
router.get('/sync/refresh-tokens', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('[Token Cron] Starting proactive token refresh check...');

        const { data: allShops, error } = await supabase
            .from('tiktok_shops')
            .select('id, shop_id, shop_name, access_token, refresh_token, token_expires_at, refresh_token_expires_at');

        if (error) throw error;
        if (!allShops || allShops.length === 0) {
            return res.json({ success: true, message: 'No shops found', results: [] });
        }

        const now = Date.now();
        const REFRESH_TOKEN_BUFFER = 7 * 24 * 60 * 60 * 1000;  // 7 days
        const ACCESS_TOKEN_BUFFER = 60 * 60 * 1000;              // 1 hour

        const results: { shop_id: string; shop_name: string; action: string; status: string; details?: string }[] = [];

        for (const shop of allShops) {
            const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
            const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : 0;

            // Skip shops without refresh tokens (can't do anything)
            if (!shop.refresh_token) {
                results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, action: 'skip', status: 'no_refresh_token' });
                continue;
            }

            // Check if refresh token is already dead
            if (refreshExpiry > 0 && refreshExpiry < now) {
                // Mark as expired if DB is inconsistent
                if (!accessExpiry || accessExpiry > now) {
                    const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                    await supabase
                        .from('tiktok_shops')
                        .update({ token_expires_at: expiredTime, refresh_token_expires_at: expiredTime, updated_at: new Date().toISOString() })
                        .eq('id', shop.id);
                }
                results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, action: 'mark_expired', status: 'refresh_token_dead' });
                continue;
            }

            // Determine if refresh is needed
            const isAccessExpired = accessExpiry != null && accessExpiry < now;
            const isAccessNearExpiry = accessExpiry != null && (accessExpiry - ACCESS_TOKEN_BUFFER) < now;
            const isRefreshNearExpiry = refreshExpiry > 0 && (refreshExpiry - REFRESH_TOKEN_BUFFER) < now;

            if (!isAccessExpired && !isAccessNearExpiry && !isRefreshNearExpiry) {
                const refreshDaysLeft = refreshExpiry > 0 ? Math.floor((refreshExpiry - now) / (1000 * 60 * 60 * 24)) : '?';
                results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, action: 'skip', status: 'healthy', details: `refresh token expires in ${refreshDaysLeft} days` });
                continue;
            }

            // Need to refresh — do it now
            const reason = isAccessExpired
                ? 'access token expired'
                : isAccessNearExpiry
                    ? 'access token expires within 1 hour'
                    : `refresh token expires within ${Math.floor((refreshExpiry - now) / (1000 * 60 * 60 * 24))} days`;

            console.log(`[Token Cron] ${shop.shop_name}: ${reason}. Refreshing...`);

            try {
                const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
                const refreshTime = new Date();
                const newAccessExpiry = new Date(refreshTime.getTime() + tokenData.access_token_expire_in * 1000);
                const newRefreshExpiry = new Date(refreshTime.getTime() + tokenData.refresh_token_expire_in * 1000);

                await supabase
                    .from('tiktok_shops')
                    .update({
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        token_expires_at: newAccessExpiry.toISOString(),
                        refresh_token_expires_at: newRefreshExpiry.toISOString(),
                        updated_at: refreshTime.toISOString()
                    })
                    .eq('id', shop.id);

                console.log(`[Token Cron] Successfully refreshed ${shop.shop_name}. New refresh token expires: ${newRefreshExpiry.toISOString()}`);
                results.push({
                    shop_id: shop.shop_id,
                    shop_name: shop.shop_name,
                    action: 'refreshed',
                    status: 'success',
                    details: `reason: ${reason}. New refresh token expires: ${newRefreshExpiry.toISOString()}`
                });
            } catch (refreshError: any) {
                if (refreshError instanceof TikTokShopError && refreshError.code === 105002) {
                    console.error(`[Token Cron] TikTok rejected refresh for ${shop.shop_name} (105002). Marking as expired.`);
                    const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                    await supabase
                        .from('tiktok_shops')
                        .update({ token_expires_at: expiredTime, refresh_token_expires_at: expiredTime, updated_at: new Date().toISOString() })
                        .eq('id', shop.id);
                    results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, action: 'mark_expired', status: 'tiktok_rejected', details: refreshError.message });
                } else {
                    console.error(`[Token Cron] Error refreshing ${shop.shop_name}:`, refreshError.message);
                    results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, action: 'error', status: 'refresh_failed', details: refreshError.message });
                }
            }
        }

        const refreshed = results.filter(r => r.action === 'refreshed').length;
        const expired = results.filter(r => r.action === 'mark_expired').length;
        const healthy = results.filter(r => r.status === 'healthy').length;

        console.log(`[Token Cron] Complete. ${refreshed} refreshed, ${expired} expired, ${healthy} healthy, ${allShops.length} total.`);

        res.json({
            success: true,
            summary: { total: allShops.length, refreshed, expired, healthy },
            results
        });
    } catch (error: any) {
        console.error('[Token Cron] Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Sync Orders from TikTok Shop API
 *
 * SMART STOP EARLY: Orders are sorted by create_time DESC (newest first).
 * For incremental sync, we load existing order IDs and stop pagination
 * as soon as we encounter an order that already exists in the database.
 * This prevents unnecessary API calls for historical data that's already synced.
 *
 * Order IDs are immutable - once an order is created, its ID never changes.
 * Order STATUS can change (e.g., UNPAID → PAID → SHIPPED → COMPLETED),
 * but the upsert handles status updates for orders received before stopping.
 * 
 * @param shop - Shop object with access credentials
 * @param isFirstSync - If true, fetch all historical data; if false, use Smart Stop
 * @returns Sync statistics including fetched count, upserted count, and mode
 */
/**
 * Helper function to upsert a batch of orders to database
 * Used for progressive writes during sync to prevent data loss on timeout
 */
async function upsertOrderBatch(
    orders: any[],
    shopIds: string[],
    productCogsMap: Map<string, number>
): Promise<number> {
    if (orders.length === 0) return 0;

    let upsertedCount = 0;
    // Process in batches of 20 orders (single write at end, not progressive)
    const chunkSize = 20;

    for (let i = 0; i < orders.length; i += chunkSize) {
        const chunk = orders.slice(i, i + chunkSize);

        for (const sId of shopIds) {
            const upsertData = chunk.map((order: any) => {
                const fulfillmentType = order.fulfillment_type || 'FULFILLMENT_BY_SELLER';
                const isFbt = fulfillmentType === 'FULFILLMENT_BY_TIKTOK';
                const payment = order.payment || order.payment_info || {};

                return {
                    shop_id: sId,
                    order_id: order.id,
                    order_status: order.status || order.order_status,
                    total_amount: parseFloat(payment.total_amount || '0'),
                    currency: payment.currency || 'USD',
                    create_time: new Date(Number(order.create_time) * 1000).toISOString(),
                    update_time: new Date(Number(order.update_time) * 1000).toISOString(),
                    // PAID TIME: Extract from API response (0 or missing means UNPAID)
                    paid_time: order.paid_time && Number(order.paid_time) > 0
                        ? new Date(Number(order.paid_time) * 1000).toISOString()
                        : null,
                    line_items: (order.line_items || []).map((item: any) => ({
                        ...item,
                        is_dangerous_good: item.is_dangerous_good || false,
                        is_gift: item.is_gift || false,
                        // SNAPSHOT COGS: Capture current product COGS at time of order sync
                        cogs: productCogsMap.get(item.product_id) || null
                    })),
                    payment_info: payment,
                    // FBT tracking fields
                    fulfillment_type: fulfillmentType,
                    is_fbt: isFbt,
                    shipping_fee: parseFloat(payment.shipping_fee || '0'),
                    shipping_fee_offset: parseFloat(payment.shipping_fee_seller_discount || payment.shipping_fee_platform_discount || '0'),
                    warehouse_id: order.warehouse_id || null,
                    // Shipping & Delivery options
                    payment_method_name: order.payment_method_name || null,
                    shipping_type: order.shipping_type || null,
                    delivery_option_id: order.delivery_option_id || null,
                    delivery_option_name: order.delivery_option_name || null,
                    // Note: fbt_fulfillment_fee will be populated from Finance API separately
                    buyer_info: order.buyer_info || {
                        buyer_email: order.buyer_email,
                        buyer_nickname: order.buyer_nickname,
                        buyer_avatar: order.buyer_avatar,
                        buyer_message: order.buyer_message
                    },
                    shipping_info: order.shipping_info || {
                        ...order.recipient_address,
                        tracking_number: order.tracking_number,
                        shipping_provider: order.shipping_provider,
                        shipping_provider_id: order.shipping_provider_id,
                        delivery_option_name: order.delivery_option_name
                    },
                    is_sample_order: order.is_sample_order || false,
                    // New Fields Mapping
                    collection_time: order.collection_time ? new Date(Number(order.collection_time) * 1000).toISOString() : null,
                    shipping_due_time: order.shipping_due_time ? new Date(Number(order.shipping_due_time) * 1000).toISOString() : null,
                    is_cod: order.is_cod || false,
                    is_exchange_order: order.is_exchange_order || false,
                    is_on_hold_order: order.is_on_hold_order || false,
                    is_replacement_order: order.is_replacement_order || false,
                    delivery_type: order.delivery_type || null,
                    seller_note: order.seller_note || null,
                    tracking_number: order.tracking_number || null,
                    shipping_provider: order.shipping_provider || null,
                    shipping_provider_id: order.shipping_provider_id || null,
                    // Cancellation/refund tracking
                    cancel_reason: order.cancel_reason || null,
                    cancellation_initiator: order.cancellation_initiator || null,
                    updated_at: new Date().toISOString()
                };
            });

            // Wrap upsert with retry logic to handle socket/connection errors
            await retryOperation(async () => {
                const { error: upsertError } = await supabase
                    .from('shop_orders')
                    .upsert(upsertData, {
                        onConflict: 'shop_id,order_id',
                        ignoreDuplicates: false,
                    });

                if (upsertError) {
                    console.error(`Error upserting order batch (chunk ${i}-${i + chunkSize}):`, upsertError.message);
                    throw upsertError;
                }
            }, 3, 2000); // Retry 3 times with 2s initial delay
        }

        upsertedCount += chunk.length;
    }

    return upsertedCount;
}

/**
 * Fetches a single order from TikTok by its orderId, and upserts it into the DB.
 * Used primarily by webhooks to handle NEW orders without exhausting rate limits.
 */
export async function syncSingleOrder(shop: any, orderId: string): Promise<any> {
    try {
        console.log(`[SingleOrderSync] Fetching details for new order ${orderId}...`);
        const response = await retryOperation(async () => {
            return await tiktokShopApi.getOrderDetails(shop.access_token, shop.shop_cipher, [orderId]);
        }, 3, 2000);
        
        const orders = response?.orders || response?.order_list || [];
        if (orders.length > 0) {
            const { data: allShops } = await supabase.from('tiktok_shops').select('id').eq('shop_id', shop.shop_id);
            const shopIds = allShops?.map(s => s.id) || [shop.id];
            
            // Re-use the existing batch upsert helper for our single order
            // Note: passing empty Map for productCogsMap is safe; COGS will just be null if missing
            await upsertOrderBatch([orders[0]], shopIds, new Map());
            console.log(`[SingleOrderSync] Successfully upserted order ${orderId}`);
            return orders[0];
        } else {
            console.warn(`[SingleOrderSync] TikTok API returned no data for order ${orderId}`);
        }
    } catch (err: any) {
        console.error(`[SingleOrderSync] Failed to sync order ${orderId}:`, err.message);
    }
    return null;
}

export async function syncOrders(shop: any, isFirstSync: boolean = true, customStartDate?: string, customEndDate?: string): Promise<{ fetched: number; upserted: number; isIncremental: boolean; stoppedEarly?: boolean; partial?: boolean; syncedOrders?: any[] }> {
    const isHistorical = !!(customStartDate && customEndDate);
    const syncMode = isHistorical ? 'HISTORICAL' : (isFirstSync ? 'FULL' : 'INCREMENTAL');
    console.log(`[${syncMode}] Syncing orders for shop ${shop.shop_name}...`);

    try {
        const now = Math.floor(Date.now() / 1000);
        let startTime: number;
        let endTime: number = now;

        if (isHistorical) {
            // On-demand historical fetch: use the exact date range provided
            startTime = Math.floor(new Date(customStartDate).getTime() / 1000);
            // End of the end date (23:59:59)
            endTime = Math.floor(new Date(customEndDate).getTime() / 1000) + 86400;
            console.log(`[${syncMode}] Fetching orders from ${customStartDate} to ${customEndDate}...`);
        } else if (isFirstSync) {
            // First sync: get data up to configured default limit (90 days)
            startTime = getHistoricalStartTime();
            console.log(`[${syncMode}] Fetching orders from last ${getHistoricalWindowLabel()}...`);
        } else {
            // Incremental: get latest CREATE_TIME from DB and fetch only NEWER orders
            // This is key - we use create_time not update_time to avoid re-fetching all orders
            const { data: latestOrder } = await supabase
                .from('shop_orders')
                .select('create_time')
                .eq('shop_id', shop.id)
                .order('create_time', { ascending: false })
                .limit(1)
                .single();

            if (latestOrder?.create_time) {
                // Use a small overlap window to avoid missing orders created at the
                // exact same second as the latest one we have.
                // Upserts + smart stop prevent duplicates from growing unbounded.
                const latestTs = Math.floor(new Date(latestOrder.create_time).getTime() / 1000);
                startTime = Math.max(0, latestTs - 60); // 60s overlap
                console.log(`[${syncMode}] Fetching orders CREATED after ${latestOrder.create_time}...`);
            } else {
                // Fallback to 7 days if no data found
                startTime = now - (7 * 24 * 60 * 60);
                console.log(`[${syncMode}] No existing orders found, falling back to 7 days`);
            }
        }

        // We will now store only a minimal list of synced IDs for the return value, 
        // OR we can return an empty list if preserving memory is priority.
        // For the UI "merge" feature, we likely need the recently synced orders.
        // Let's keep the last ~1000 orders in memory for the UI update, but not all 20k.
        let recentlySyncedOrders: any[] = [];

        // Total counters
        let totalFetched = 0;
        let totalUpserted = 0;

        let nextPageToken = '';
        let hasMore = true;
        let page = 1;
        let stoppedEarly = false; // Track if Smart Stop Early was triggered

        // Pre-fetch shop IDs and product COGS for batch write
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);
        const shopIds = allShops?.map(s => s.id) || [shop.id];

        const { data: dbProducts } = await supabase
            .from('shop_products')
            .select('product_id, cogs')
            .in('shop_id', shopIds);

        const productCogsMap = new Map();
        dbProducts?.forEach(p => {
            if (p.cogs !== null && p.cogs !== undefined) {
                productCogsMap.set(p.product_id, Number(p.cogs));
            }
        });

        // For incremental sync, load existing order IDs to implement Smart Stop Early
        let existingOrderIds = new Set<string>();
        if (!isFirstSync) {
            const { data: existingOrders } = await supabase
                .from('shop_orders')
                .select('order_id')
                .eq('shop_id', shop.id);
            if (existingOrders) {
                existingOrderIds = new Set(existingOrders.map(o => o.order_id));
            }
            console.log(`[${syncMode}] Loaded ${existingOrderIds.size} existing order IDs for Smart Stop`);
        }

        // Wrap fetching in try-catch to save partial data on error
        let fetchError: Error | null = null;

        try {
            while (hasMore) {
                console.log(`Fetching orders page ${page}... (Token: ${nextPageToken ? 'Yes' : 'No'})`);
                const params: any = {
                    page_size: '100', // Maximum allowed by API
                    create_time_from: startTime,
                    create_time_to: endTime,
                    // Sort by create_time DESC to get NEWEST pages first
                    sort_field: 'create_time',
                    sort_order: 'DESC'
                };

                if (nextPageToken) {
                    params.page_token = nextPageToken;
                } else {
                    params.page_number = page;
                }

                const response = await executeWithRefresh(
                    shop.account_id,
                    shop.shop_id,
                    (token, cipher) => tiktokShopApi.searchOrders(
                        token,
                        cipher,
                        params
                    )
                );

                const orders = response.orders || response.order_list || [];
                console.log(`Page ${page} returned ${orders.length} orders. Next Token: ${response.next_page_token ? 'Yes' : 'No'}`);

                let ordersToUpsert: any[] = [];

                // If we got orders, process them
                if (orders.length > 0) {
                    if (isFirstSync) {
                        // First sync: take all
                        ordersToUpsert = orders;
                    } else {
                        // INCREMENTAL SYNC with Smart Stop Early:
                        let newInPage = 0;
                        let existingInPage = 0;

                        for (const order of orders) {
                            const orderId = order.id || order.order_id;
                            if (existingOrderIds.has(orderId)) {
                                existingInPage++;
                            } else {
                                ordersToUpsert.push(order);
                                newInPage++;
                            }
                        }

                        console.log(`[${syncMode}] Page ${page}: ${newInPage} new orders, ${existingInPage} already in DB`);

                        // Smart Stop: If ANY order in this page already existed, we've caught up
                        // (Because we fetch in DESC order of create_time)
                        if (existingInPage > 0) {
                            console.log(`[${syncMode}] 🛑 Smart Stop Early: Found ${existingInPage} existing orders - we've caught up! Stopping.`);
                            stoppedEarly = true;
                            hasMore = false;
                            // Still upsert the new ones we found before stopping
                        }
                    }

                    // Store mapped orders for UI return (limit to first 1000 to save memory)
                    if (recentlySyncedOrders.length < 1000) {
                        recentlySyncedOrders = [...recentlySyncedOrders, ...ordersToUpsert];
                    }

                    // PROGRESSIVE BATCH UPSERT
                    if (ordersToUpsert.length > 0) {
                        console.log(`[${syncMode}] Upserting batch of ${ordersToUpsert.length} orders...`);
                        const upserted = await upsertOrderBatch(ordersToUpsert, shopIds, productCogsMap);
                        totalUpserted += upserted;
                        totalFetched += orders.length; // Count total raw fetched
                    }
                } else {
                    // Empty page
                    console.log(`[${syncMode}] Page ${page} was empty.`);
                }

                // CHECK PAGINATION LOGIC (FIXED)
                // Continue if we have a next_page_token, even if orders.length was 0
                // (Sometimes API returns empty pages but still has more data later, though rare with DESC sort,
                //  it's safer to follow the token).
                // However, if we hit Smart Stop, we already set hasMore = false above.

                if (hasMore) { // Only check token if we haven't already decided to stop
                    if (!response.next_page_token || response.next_page_token === nextPageToken) {
                        console.log(`[${syncMode}] No new next_page_token returned (current: ${nextPageToken ? 'exists' : 'none'}), stopping sync.`);
                        hasMore = false;
                    } else {
                        // We have a new token - continue
                        const oldTokenHash = nextPageToken ? nextPageToken.substring(0, 8) : 'none';
                        nextPageToken = response.next_page_token;
                        const newTokenHash = nextPageToken.substring(0, 8);
                        console.log(`[${syncMode}] Token changed: ${oldTokenHash}... → ${newTokenHash}... (continuing)`);
                        hasMore = true;
                    }
                }

                page++;

                // Safety limit on pages
                const MAX_PAGES = parseInt(process.env.MAX_SYNC_PAGES || '2000');
                if (page > MAX_PAGES) {
                    console.log(`[${syncMode}] ⚠️ Hit safety limit of ${MAX_PAGES} pages, stopping.`);
                    break;
                }
            }
        } catch (error: any) {
            fetchError = error;
            console.error(`[Orders] Fetch error at page ${page}:`, error.message);
            console.log(`[Orders] Saved ${totalUpserted} orders before error.`);
        }

        console.log(`Sync loop finished. Total upserted: ${totalUpserted}${fetchError ? ' (partial - fetch interrupted)' : ''}`);

        // Update sync timestamp (only if we actually synced something or it was a successful check)
        // If it failed completely (0 upserted and error), maybe don't update timestamp?
        // But for "Smart Stop" with 0 updates, we SHOULD update timestamp to say "we checked".
        if (!fetchError || totalUpserted > 0) {
            await supabase
                .from('tiktok_shops')
                .update({
                    orders_last_synced_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('shop_id', shop.shop_id);
        }

        const statusMsg = fetchError ? ' [⚠️ Partial - Fetch Interrupted]' : (stoppedEarly ? ' [Smart Stop Early ✓]' : '');
        console.log(`✅ Orders sync completed for ${shop.shop_name} (${totalUpserted} orders written)${statusMsg}`);

        // Map synced orders to frontend format for direct merge into UI
        // Note: This matches the old logic but uses our `recentlySyncedOrders` buffer
        const mappedOrders = recentlySyncedOrders.map((order: any) => {
            const payment = order.payment || order.payment_info || {};
            return {
                id: order.id || order.order_id, // Safety check for ID
                status: order.status || order.order_status,
                payment: {
                    total_amount: payment.total_amount?.toString() || '0',
                    currency: payment.currency || 'USD',
                    sub_total: payment.sub_total || payment.total_amount?.toString() || '0',
                    tax: payment.tax || payment.product_tax || '0',
                    shipping_fee: payment.shipping_fee || '0',
                    original_shipping_fee: payment.original_shipping_fee,
                    original_total_product_price: payment.original_total_product_price,
                    platform_discount: payment.platform_discount,
                    product_tax: payment.product_tax,
                    seller_discount: payment.seller_discount,
                    shipping_fee_cofunded_discount: payment.shipping_fee_cofunded_discount,
                    shipping_fee_platform_discount: payment.shipping_fee_platform_discount,
                    shipping_fee_seller_discount: payment.shipping_fee_seller_discount,
                    shipping_fee_tax: payment.shipping_fee_tax,
                    item_insurance_tax: payment.item_insurance_tax
                },
                create_time: Number(order.create_time),
                update_time: order.update_time ? Number(order.update_time) : undefined,
                paid_time: order.paid_time && Number(order.paid_time) > 0 ? Number(order.paid_time) : undefined,
                line_items: order.line_items || [],
                buyer_info: order.buyer_info || {
                    buyer_email: order.buyer_email,
                    buyer_nickname: order.buyer_nickname,
                    buyer_avatar: order.buyer_avatar,
                    buyer_message: order.buyer_message
                },
                shipping_info: order.shipping_info || {
                    ...order.recipient_address,
                    tracking_number: order.tracking_number,
                    shipping_provider: order.shipping_provider,
                    shipping_provider_id: order.shipping_provider_id,
                    delivery_option_name: order.delivery_option_name
                },
                payment_info: payment,
                payment_method_name: order.payment_method_name,
                shipping_type: order.shipping_type,
                delivery_option_name: order.delivery_option_name,
                fulfillment_type: order.fulfillment_type || 'FULFILLMENT_BY_SELLER',
                is_fbt: (order.fulfillment_type || '') === 'FULFILLMENT_BY_TIKTOK',
                fbt_fulfillment_fee: null,
                warehouse_id: order.warehouse_id || null,
                is_sample_order: order.is_sample_order || false,
                cancel_reason: order.cancel_reason || null,
                cancellation_initiator: order.cancellation_initiator || null,
                seller_note: order.seller_note || null,
                delivery_type: order.delivery_type || null,
                collection_time: order.collection_time ? Number(order.collection_time) : undefined,
                shipping_due_time: order.shipping_due_time ? Number(order.shipping_due_time) : undefined,
                is_cod: order.is_cod || false,
                is_exchange_order: order.is_exchange_order || false,
                is_on_hold_order: order.is_on_hold_order || false,
                is_replacement_order: order.is_replacement_order || false,
                tracking_number: order.tracking_number || null,
                shipping_provider: order.shipping_provider || null,
                shipping_provider_id: order.shipping_provider_id || null
            };
        });

        return {
            fetched: totalFetched,
            upserted: totalUpserted,
            isIncremental: !isFirstSync,
            stoppedEarly,
            partial: !!fetchError,
            syncedOrders: mappedOrders
        };
    } catch (error: any) {
        console.error(`Error in syncOrders for ${shop.shop_name}:`, error);
        throw error;
    }
}



/**
 * Detect if a product is Fulfilled by TikTok (FBT) based on API response data.
 * Checks multiple indicators:
 * 1. Warehouse ID matching against known FBT warehouses (most reliable)
 * 2. fulfillment_type field
 * 3. Fulfillment service provider
 * 4. Product attributes
 * 5. Shipping info
 */
function detectFbtStatus(fullDetails: any, basicProduct: any, fbtWarehouseIds: Set<string> = new Set()): boolean {
    try {
        const productTitle = (basicProduct.title || fullDetails.title || 'Unknown').substring(0, 30);

        // Check 0: Match warehouse IDs against known FBT warehouses (MOST RELIABLE)
        if (fbtWarehouseIds.size > 0) {
            const skus = fullDetails.skus || basicProduct.skus || [];
            for (const sku of skus) {
                const inventories = sku.inventory || sku.inventories || [];
                for (const inv of inventories) {
                    const warehouseId = inv.warehouse_id || inv.warehouse?.warehouse_id || inv.warehouse?.id || '';
                    if (warehouseId && fbtWarehouseIds.has(warehouseId)) {
                        console.log(`[FBT] Product "${productTitle}" is FBT (warehouse ID match: ${warehouseId})`);
                        return true;
                    }
                }
            }
        }

        // Debug: Log available fields to understand structure (only a few products)
        if (Math.random() < 0.05) { // Log 5% of products
            console.log(`[FBT Debug] Checking product: ${productTitle}`);
            console.log(`[FBT Debug] fullDetails keys:`, Object.keys(fullDetails || {}));
            if (fullDetails.skus?.[0]) {
                console.log(`[FBT Debug] SKU keys:`, Object.keys(fullDetails.skus[0]));
                if (fullDetails.skus[0].inventory?.[0]) {
                    console.log(`[FBT Debug] Inventory keys:`, Object.keys(fullDetails.skus[0].inventory[0]));
                }
            }
        }

        // Check 1: Direct fulfillment_type field (may be 'is_fulfilled_by_tiktok' or similar)
        const fulfillmentType = fullDetails.fulfillment_type ||
            basicProduct.fulfillment_type ||
            fullDetails.package_dimensions?.fulfillment_type;
        if (fulfillmentType) {
            const fbtTypes = ['FULFILLED_BY_TIKTOK', 'FBT', 'TIKTOK_FULFILLMENT', 'PLATFORM_FULFILLMENT', 'PLATFORM'];
            if (fbtTypes.some(t => fulfillmentType.toUpperCase().includes(t))) {
                console.log(`[FBT] Product "${productTitle}" is FBT (fulfillment_type: ${fulfillmentType})`);
                return true;
            }
        }

        // Check 1b: Boolean FBT indicator
        if (fullDetails.is_fulfilled_by_tiktok === true ||
            basicProduct.is_fulfilled_by_tiktok === true ||
            fullDetails.fbt === true ||
            basicProduct.fbt === true) {
            console.log(`[FBT] Product "${productTitle}" is FBT (boolean indicator)`);
            return true;
        }

        // Check 2: Warehouse type in SKU inventory
        const skus = fullDetails.skus || basicProduct.skus || [];
        for (const sku of skus) {
            const inventories = sku.inventory || sku.inventories || [];
            for (const inv of inventories) {
                const warehouse = inv.warehouse || {};
                const warehouseType = (warehouse.type || warehouse.warehouse_type || '').toUpperCase();
                const warehouseId = (warehouse.warehouse_id || warehouse.id || '').toUpperCase();
                const warehouseName = (warehouse.name || warehouse.warehouse_name || '').toUpperCase();

                // TikTok FBT warehouses typically have these identifiers
                if (warehouseType.includes('TIKTOK') ||
                    warehouseType.includes('FBT') ||
                    warehouseType.includes('PLATFORM') ||
                    warehouseType.includes('FULFILLMENT_CENTER')) {
                    console.log(`[FBT] Product "${productTitle}" is FBT (warehouse type: ${warehouseType})`);
                    return true;
                }

                // Check warehouse ID patterns (TikTok warehouses often have specific prefixes)
                if (warehouseId.startsWith('TT') || warehouseId.includes('TIKTOK')) {
                    console.log(`[FBT] Product "${productTitle}" is FBT (warehouse ID: ${warehouseId})`);
                    return true;
                }

                // Check warehouse name patterns
                if (warehouseName.includes('TIKTOK') || warehouseName.includes('FBT')) {
                    console.log(`[FBT] Product "${productTitle}" is FBT (warehouse name: ${warehouseName})`);
                    return true;
                }
            }
        }

        // Check 3: Fulfillment service provider / delivery_option
        const fulfillmentProvider = fullDetails.fulfillment_service_provider ||
            fullDetails.logistics_service_provider ||
            fullDetails.delivery_option_id ||
            basicProduct.fulfillment_service_provider;
        if (fulfillmentProvider && typeof fulfillmentProvider === 'string') {
            const providerUpper = fulfillmentProvider.toUpperCase();
            if (providerUpper.includes('TIKTOK') || providerUpper.includes('FBT') || providerUpper.includes('PLATFORM')) {
                console.log(`[FBT] Product "${productTitle}" is FBT (provider: ${fulfillmentProvider})`);
                return true;
            }
        }

        // Check 4: Product listing attributes / product_certifications
        const attributes = fullDetails.attributes || fullDetails.product_attributes ||
            fullDetails.certifications || fullDetails.product_certifications || [];
        for (const attr of attributes) {
            const attrName = (attr.name || attr.attribute_name || attr.id || '').toLowerCase();
            const attrValue = (attr.value || attr.attribute_value || attr.values?.[0] || '').toString().toLowerCase();

            if ((attrName.includes('fulfillment') || attrName.includes('shipping')) &&
                (attrValue.includes('tiktok') || attrValue.includes('fbt') || attrValue.includes('platform'))) {
                console.log(`[FBT] Product "${productTitle}" is FBT (attribute: ${attrName}=${attrValue})`);
                return true;
            }
        }

        // Check 5: Shipping info / delivery_options
        const shippingInfo = fullDetails.shipping_info || fullDetails.delivery_option ||
            fullDetails.delivery_options?.[0] || {};
        if (shippingInfo.shipper_type === 'PLATFORM' ||
            shippingInfo.delivery_type === 'FBT' ||
            shippingInfo.fulfillment_type === 'FBT' ||
            shippingInfo.is_fbt === true) {
            console.log(`[FBT] Product "${productTitle}" is FBT (shipping info)`);
            return true;
        }

        // Check 6: Package weight / dimensions often have fulfillment indicators
        const packageInfo = fullDetails.package_dimensions || fullDetails.package_weight || {};
        if (packageInfo.fulfillment_type?.toUpperCase?.()?.includes?.('FBT')) {
            console.log(`[FBT] Product "${productTitle}" is FBT (package info)`);
            return true;
        }

        return false;
    } catch (error) {
        console.warn(`[FBT Detection] Error detecting FBT status:`, error);
        return false;
    }
}

// Products are always fully refreshed since they can be updated anytime
// But we accept isFirstSync for consistency with the API
export async function syncProducts(shop: any, isFirstSync: boolean = true): Promise<{ fetched: number; upserted: number; isIncremental: boolean; syncedProducts?: any[] }> {
    // Products are always fully refreshed since they can be updated anytime
    // We accept isFirstSync for consistency but we always fetch all to update stock/price
    const syncMode = isFirstSync ? 'FULL' : 'REFRESH';
    console.log(`[${syncMode}] Syncing products for shop ${shop.shop_name}...`);
    try {
        let allProducts: any[] = [];
        let page = 1;
        let hasMore = true;
        let nextPageToken = '';
        let fetchError: Error | null = null;

        try {
            while (hasMore) {
                console.log(`Fetching products page ${page}...`);
                const params: any = {
                    page_size: '100', // Maximize batch size
                    status: 'ACTIVATE', // Active products
                    sort_field: 'create_time',
                    sort_order: 'DESC' // Newest first
                };

                if (nextPageToken) {
                    params.page_token = nextPageToken;
                } else {
                    params.page_number = page;
                }

                const response = await executeWithRefresh(
                    shop.account_id,
                    shop.shop_id,
                    (token, cipher) => tiktokShopApi.searchProducts(
                        token,
                        cipher,
                        params
                    )
                );

                const products = response.products || response.product_list || [];
                console.log(`Page ${page} returned ${products.length} products`);

                if (products.length > 0) {
                    allProducts = [...allProducts, ...products];
                }

                // Check if we need to fetch more
                // API might return next_page_token or we check count vs total
                if (response.next_page_token && response.next_page_token !== nextPageToken) {
                    nextPageToken = response.next_page_token;
                    page++;
                } else if (response.data?.next_page_token && response.data?.next_page_token !== nextPageToken) {
                    // Sometimes response structure varies
                    nextPageToken = response.data.next_page_token;
                    page++;
                } else if (products.length === 100) {
                    // Fallback: if we got full page, try next page by number if token not used
                    page++;
                } else {
                    hasMore = false;
                }

                // Safety limit: 500 pages × 100 products = 50,000 products max
                const MAX_PRODUCT_PAGES = parseInt(process.env.MAX_PRODUCT_SYNC_PAGES || '500');
                if (page > MAX_PRODUCT_PAGES) {
                    console.log(`[${syncMode}] ⚠️ Hit safety limit of ${MAX_PRODUCT_PAGES} pages (${MAX_PRODUCT_PAGES * 100}+ products), stopping.`);
                    console.log(`[${syncMode}] To increase this limit, set MAX_PRODUCT_SYNC_PAGES environment variable.`);
                    break;
                }

                // Warning when approaching limit
                if (page === MAX_PRODUCT_PAGES - 50) {
                    console.warn(`[${syncMode}] ⚠️ Approaching safety limit: ${page}/${MAX_PRODUCT_PAGES} pages. Consider increasing MAX_PRODUCT_SYNC_PAGES if needed.`);
                }

                // Progress logging every 10 pages
                if (page % 10 === 0) {
                    console.log(`[${syncMode}] Progress: ${page} pages fetched, ${allProducts.length} products collected so far...`);
                }
            }
        } catch (error: any) {
            fetchError = error;
            console.error(`[Products] Fetch error at page ${page}:`, error.message);
            console.log(`[Products] Saving ${allProducts.length} products fetched before error...`);
        }

        console.log(`Found total ${allProducts.length} products for shop ${shop.shop_name}${fetchError ? ' (partial - fetch interrupted)' : ''}`);

        if (allProducts.length === 0) {
            if (fetchError) {
                throw fetchError; // No data to save, throw the error
            }
            return { fetched: 0, upserted: 0, isIncremental: false };
        }

        // Find all records for this shop_id
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);

        const shopIds = allShops?.map(s => s.id) || [shop.id];

        // Fetch product details in parallel (concurrency-limited to avoid rate limits)
        const CONCURRENCY = 5;
        const productDetails = new Map<string, { images: string[]; details: any }>();

        for (let i = 0; i < allProducts.length; i += CONCURRENCY) {
            const batch = allProducts.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (product: any) => {
                    try {
                        const detailResponse = await tiktokShopApi.makeApiRequest(
                            `/product/202309/products/${product.id}`,
                            shop.access_token,
                            shop.shop_cipher,
                            {},
                            'GET'
                        );
                        let images = product.images || [];
                        if (detailResponse?.main_images) {
                            images = detailResponse.main_images.map((img: any) => img.urls[0]);
                        }
                        return { id: product.id, images, details: detailResponse || {} };
                    } catch {
                        return { id: product.id, images: product.images || [], details: {} };
                    }
                })
            );
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    productDetails.set(r.value.id, { images: r.value.images, details: r.value.details });
                }
            }
            if (i > 0 && i % 50 === 0) {
                console.log(`[SyncProducts] Fetched details for ${i}/${allProducts.length} products...`);
            }
        }

        console.log(`[SyncProducts] Fetched details for ${productDetails.size}/${allProducts.length} products`);

        // Batch upsert products (chunks of 20) — no per-product DB reads needed
        // FBT is determined at order level, not product level — preserve existing FBT values via onConflict
        const UPSERT_CHUNK = 20;
        const nowIso = new Date().toISOString();

        for (const sId of shopIds) {
            for (let i = 0; i < allProducts.length; i += UPSERT_CHUNK) {
                const chunk = allProducts.slice(i, i + UPSERT_CHUNK);
                const upsertData = chunk.map((product: any) => {
                    const detail = productDetails.get(product.id);
                    const images = detail?.images || product.images || [];
                    return {
                        shop_id: sId,
                        product_id: product.id,
                        product_name: product.title,
                        sku_list: product.skus,
                        status: product.status === 'ACTIVATE' ? 'active' : 'inactive',
                        price: product.skus?.[0]?.price?.tax_exclusive_price || 0,
                        stock: product.skus?.[0]?.inventory?.[0]?.quantity || 0,
                        sales_count: product.sales_regions?.[0]?.sales_count || 0,
                        images,
                        main_image_url: images[0] || product.main_image || '',
                        details: detail?.details || {},
                        updated_at: nowIso
                    };
                });

                await retryOperation(async () => {
                    const { error } = await supabase
                        .from('shop_products')
                        .upsert(upsertData, { onConflict: 'shop_id,product_id' });
                    if (error) throw error;
                }, 3, 2000);
            }
        }

        // Fetch Product Performance (Analytics) and batch-update
        try {
            console.log(`[SyncProducts] Fetching performance for ${shop.shop_name}...`);
            const today = new Date().toISOString().split('T')[0];
            // TikTok analytics API supports max ~30 day range
            const perfStart = new Date();
            perfStart.setDate(perfStart.getDate() - 30);
            const perfStartDate = perfStart.toISOString().split('T')[0];

            const perfResponse = await tiktokShopApi.makeApiRequest(
                '/analytics/202405/shop_products/performance',
                shop.access_token,
                shop.shop_cipher,
                { start_date_ge: perfStartDate, end_date_lt: today, page_size: 20, page_number: 1 },
                'GET',
                false,
                {
                    transformResponse: [(data: any) => {
                        if (typeof data === 'string') {
                            try {
                                const fixedData = data.replace(/"id":\s*(\d{15,})/g, '"id": "$1"');
                                return JSON.parse(fixedData);
                            } catch (e) {
                                return JSON.parse(data);
                            }
                        }
                        return data;
                    }]
                }
            );

            if (perfResponse?.products && Array.isArray(perfResponse.products)) {
                const perfProducts = perfResponse.products;
                console.log(`[SyncProducts] Found ${perfProducts.length} performance records`);

                // Update performance metrics on existing products only
                const perfMetrics = {
                    updated_at: nowIso
                } as Record<string, any>;

                for (const sId of shopIds) {
                    const productIds = perfProducts.map((perf: any) => String(perf.id));

                    // Build a map of product_id -> metrics for individual updates
                    for (const perf of perfProducts) {
                        const perfId = String(perf.id);
                        const { error: perfError } = await supabase
                            .from('shop_products')
                            .update({
                                click_through_rate: parseFloat(perf.click_through_rate || '0'),
                                gmv: parseFloat(perf.gmv?.amount || '0'),
                                orders_count: parseInt(perf.orders || '0', 10),
                                sales_count: parseInt(perf.units_sold || '0', 10),
                                updated_at: nowIso
                            })
                            .eq('shop_id', sId)
                            .eq('product_id', perfId);

                        if (perfError) {
                            console.error(`[SyncProducts] Performance update error for ${perfId}:`, perfError.message);
                        }
                    }
                    console.log(`[SyncProducts] Updated performance for ${perfProducts.length} products (shop ${sId})`);
                }
            }
        } catch (perfError: any) {
            console.error(`[SyncProducts] Failed to fetch performance: ${perfError.message}`);
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                products_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Products sync completed for ${shop.shop_name} (${allProducts.length} products)`);

        // Map synced products to frontend format for direct merge into UI
        const mappedProducts = allProducts.map((product: any) => {
            const detail = productDetails.get(product.id);
            const images = detail?.images || product.images || [];
            return {
                product_id: product.id,
                product_name: product.title,
                status: product.status === 'ACTIVATE' ? 'active' : (product.status || 'active'),
                price: product.skus?.[0]?.price?.tax_exclusive_price || 0,
                stock: product.skus?.[0]?.inventory?.[0]?.quantity || 0,
                sales_count: product.sales_regions?.[0]?.sales_count || 0,
                images,
                main_image_url: images[0] || product.main_image || '',
                sku_list: product.skus || [],
                details: detail?.details || {}
            };
        });

        return { fetched: allProducts.length, upserted: allProducts.length, isIncremental: false, syncedProducts: mappedProducts };

    } catch (error) {
        console.error(`Error in syncProducts for ${shop.shop_name}:`, error);
        throw error;
    }
}

/**
 * Sync Settlements (Statements) from TikTok Finance API
 * 
 * SMART STOP EARLY: Settlements are sorted by statement_time DESC (newest first).
 * For incremental sync, we load existing settlement IDs and stop pagination
 * as soon as we encounter a settlement that already exists in the database.
 * This prevents unnecessary API calls for historical data that's already synced.
 * 
 * Settlements are immutable - once finalized, a settlement's data never changes.
 * This makes them ideal candidates for Smart Stop Early optimization.
 * 
 * @param shop - Shop object with access credentials
 * @param isFirstSync - If true, fetch all historical data; if false, use Smart Stop
 * @returns Sync statistics including fetched count, upserted count, and mode
 */
export async function syncSettlements(shop: any, isFirstSync: boolean = true): Promise<{ fetched: number; upserted: number; isIncremental: boolean; stoppedEarly?: boolean; partial?: boolean; syncedSettlements?: any[] }> {
    const syncMode = isFirstSync ? 'FULL' : 'INCREMENTAL';
    console.log(`[${syncMode}] Syncing settlements for shop ${shop.shop_name}...`);
    try {
        const now = Math.floor(Date.now() / 1000);
        let startTime: number;
        let stoppedEarly = false; // Track if Smart Stop Early was triggered


        if (isFirstSync) {
            // First sync: get data with shorter window for settlements (90 days instead of 365)
            startTime = getHistoricalStartTime('settlements');
            console.log(`[${syncMode}] Fetching settlements from last 90 days (optimized for P&L)...`);
        } else {
            // Incremental: get latest settlement_time from DB
            const { data: latestSettlement } = await supabase
                .from('shop_settlements')
                .select('settlement_time')
                .eq('shop_id', shop.id)
                .order('settlement_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestSettlement && latestSettlement.settlement_time) {
                // Safely parse settlement_time (could be string or number)
                let lastTime = 0;
                if (typeof latestSettlement.settlement_time === 'string') {
                    // If it's an ISO string or similar
                    lastTime = Math.floor(new Date(latestSettlement.settlement_time).getTime() / 1000);
                } else {
                    // Assume number (seconds)
                    lastTime = Number(latestSettlement.settlement_time);
                }

                if (!isNaN(lastTime) && lastTime > 0) {
                    startTime = lastTime - (24 * 60 * 60);
                    console.log(`[${syncMode}] Fetching settlements after ${new Date(startTime * 1000).toISOString()} (with buffer)`);
                } else {
                    startTime = getHistoricalStartTime();
                    console.log(`[${syncMode}] Valid last settlement time not found, defaulting to ${getHistoricalWindowLabel()} ago`);
                }
            } else {
                // Fallback if no data found
                startTime = getHistoricalStartTime();
                console.log(`[${syncMode}] No prior settlements found, fetching last ${getHistoricalWindowLabel()}`);
            }
        }

        let allSettlements: any[] = [];
        let allSettlementsForResponse: any[] = []; // Track ALL settlements for frontend response (allSettlements gets cleared during progressive writes)
        let page = 1;
        let hasMore = true;
        let nextPageToken = '';
        let totalUpserted = 0; // Track total upserted across progressive writes

        // Pre-fetch shop IDs for progressive writes
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);
        const shopIds = allShops?.map(s => s.id) || [shop.id];

        // For incremental sync, load existing settlement IDs for Smart Stop
        let existingSettlementIds = new Set<string>();
        if (!isFirstSync) {
            const { data: existingSettlements } = await supabase
                .from('shop_settlements')
                .select('settlement_id')
                .eq('shop_id', shop.id);
            if (existingSettlements) {
                existingSettlementIds = new Set(existingSettlements.map(s => s.settlement_id));
            }
            console.log(`[${syncMode}] Loaded ${existingSettlementIds.size} existing settlement IDs for Smart Stop`);
        }

        // Progressive write settings (write every 5 pages = 500 settlements)
        const PROGRESSIVE_WRITE_BATCH = 5;
        let pagesSinceLastWrite = 0;
        let fetchError: Error | null = null;

        try {
            while (hasMore) {
                const params: any = {
                    start_time: startTime,
                    end_time: now,
                    page_size: '100', // Max page size
                    sort_field: 'statement_time',
                    sort_order: 'DESC' // Newest first
                };

                if (nextPageToken) {
                    params.page_token = nextPageToken;
                } else {
                    params.page_number = page;
                }

                const response = await executeWithRefresh(
                    shop.account_id,
                    shop.shop_id,
                    (token, cipher) => tiktokShopApi.getStatements(token, cipher, params)
                );

                const settlements = response.statements || response.statement_list || [];
                console.log(`Page ${page} returned ${settlements.length} settlements`);

                if (settlements.length === 0) {
                    if (response.next_page_token && response.next_page_token !== nextPageToken) {
                        nextPageToken = response.next_page_token;
                        page++;
                        continue;
                    }
                    hasMore = false;
                    break;
                }

                let currentBatch: any[] = [];
                let existingInPage = 0;

                if (isFirstSync) {
                    // First sync: add ALL settlements
                    currentBatch = settlements;
                    console.log(`[FULL] Processing all ${settlements.length} settlements from page ${page}`);
                } else {
                    // INCREMENTAL SYNC with Smart Stop Early:
                    let newInPage = 0;

                    for (const stmt of settlements) {
                        const stmtId = stmt.id || stmt.settlement_id;
                        if (existingSettlementIds.has(stmtId)) {
                            existingInPage++;
                        } else {
                            currentBatch.push(stmt);
                            newInPage++;
                        }
                    }

                    console.log(`[${syncMode}] Page ${page}: ${newInPage} new settlements, ${existingInPage} already in DB`);

                    // Smart Stop: If ANY settlement already existed, we've caught up
                    if (existingInPage > 0) {
                        console.log(`[${syncMode}] 🛑 Smart Stop Early: Found ${existingInPage} existing settlements - we've caught up! Stopping.`);
                        stoppedEarly = true;
                        hasMore = false;
                        // we'll still process currentBatch before breaking
                    }
                }

                // FETCH TRANSACTIONS FOR currentBatch inline
                // Process in chunks of 10 (up from 5) with 100ms inter-chunk delay (down from 300ms)
                if (currentBatch.length > 0) {
                    console.log(`[TransactionSync] Fetching transactions for ${currentBatch.length} settlements (chunks of 10)...`);
                    const TX_CHUNK = 10;
                    for (let i = 0; i < currentBatch.length; i += TX_CHUNK) {
                        const chunk = currentBatch.slice(i, i + TX_CHUNK);
                        await Promise.all(chunk.map(async (stmt) => {
                            try {
                                let allTx: any[] = [];
                                let txToken = '';
                                let txPage = 1;
                                const stmtId = stmt.id || stmt.settlement_id;

                                while (true) {
                                    const txParams: any = { page_size: '100', sort_field: 'order_create_time', sort_order: 'DESC' };
                                    if (txToken) txParams.page_token = txToken;

                                    const res = await executeWithRefresh(
                                        shop.account_id,
                                        shop.shop_id,
                                        (token, cipher) => tiktokShopApi.getStatementTransactions(token, cipher, stmtId, txParams)
                                    );
                                    const txs = res?.transactions || [];
                                    allTx = [...allTx, ...txs];

                                    if (!res?.next_page_token || res.next_page_token === txToken || txs.length === 0) break;
                                    txToken = res.next_page_token;
                                    txPage++;
                                    if (txPage > 20) break;
                                }
                                stmt.transaction_summary = allTx.length > 0 ? aggregateTransactions(allTx) : { transaction_count: 0 };
                            } catch (e: any) {
                                console.warn(`[TransactionSync] Failed for stmt ${stmt.id || stmt.settlement_id}: ${e.message}`);
                                stmt.transaction_summary = { transaction_count: 0, error: true };
                            }
                        }));
                        if (i + TX_CHUNK < currentBatch.length) await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    allSettlements.push(...currentBatch);
                }

                if (existingInPage > 0) {
                    break;
                }

                if (!response.next_page_token || response.next_page_token === nextPageToken) {
                    hasMore = false;
                } else {
                    nextPageToken = response.next_page_token;
                    page++;
                }

                pagesSinceLastWrite++;

                // Progressive write: Save to database every N pages to prevent data loss
                if (pagesSinceLastWrite >= PROGRESSIVE_WRITE_BATCH && allSettlements.length > 0) {
                    console.log(`[Progressive Write] Writing ${allSettlements.length} settlements to database (page ${page})...`);
                    try {
                        for (const sId of shopIds) {
                            const upsertData = allSettlements.map((settlement: any) => ({
                                shop_id: sId,
                                settlement_id: settlement.id,
                                order_id: settlement.order_id,
                                settlement_time: new Date(Number(settlement.statement_time) * 1000).toISOString(),
                                total_amount: parseFloat(settlement.revenue_amount || '0'),
                                net_amount: parseFloat(settlement.settlement_amount || '0'),
                                fee_amount: parseFloat(settlement.fee_amount || '0'),
                                adjustment_amount: parseFloat(settlement.adjustment_amount || '0'),
                                shipping_fee: parseFloat(settlement.shipping_cost_amount || '0'),
                                net_sales_amount: parseFloat(settlement.net_sales_amount || '0'),
                                currency: settlement.currency || 'USD',
                                transaction_summary: settlement.transaction_summary,
                                transactions_synced_at: new Date().toISOString(),
                                settlement_data: settlement,
                                updated_at: new Date().toISOString()
                            }));

                            await retryOperation(async () => {
                                const { error } = await supabase
                                    .from('shop_settlements')
                                    .upsert(upsertData, {
                                        onConflict: 'shop_id,settlement_id',
                                        ignoreDuplicates: false
                                    });
                                if (error) throw error;
                            }, 3, 2000);
                        }

                        totalUpserted += allSettlements.length;
                        console.log(`[Progressive Write] ✅ Wrote ${allSettlements.length} settlements. Total so far: ${totalUpserted}`);
                        allSettlementsForResponse = [...allSettlementsForResponse, ...allSettlements];
                        allSettlements = [];
                        pagesSinceLastWrite = 0;
                    } catch (writeError: any) {
                        console.error('[Progressive Write] Failed to write batch:', writeError.message);
                    }
                }

                // Safety limit: 200 pages × 100 settlements = 20,000 settlements max
                const MAX_SETTLEMENT_PAGES = parseInt(process.env.MAX_SETTLEMENT_SYNC_PAGES || '200');
                if (page > MAX_SETTLEMENT_PAGES) {
                    console.log(`[${syncMode}] ⚠️ Hit safety limit of ${MAX_SETTLEMENT_PAGES} pages (${MAX_SETTLEMENT_PAGES * 100}+ settlements), stopping.`);
                    console.log(`[${syncMode}] To increase this limit, set MAX_SETTLEMENT_SYNC_PAGES environment variable.`);
                    break;
                }

                // Warning when approaching limit
                if (page === MAX_SETTLEMENT_PAGES - 20) {
                    console.warn(`[${syncMode}] ⚠️ Approaching safety limit: ${page}/${MAX_SETTLEMENT_PAGES} pages. Consider increasing MAX_SETTLEMENT_SYNC_PAGES if needed.`);
                }

                // Progress logging every 10 pages
                if (page % 10 === 0) {
                    console.log(`[${syncMode}] Progress: ${page} pages fetched, ${allSettlements.length} settlements collected so far...`);
                }
            }
        } catch (error: any) {
            fetchError = error;
            console.error(`[Settlements] Fetch error at page ${page}:`, error.message);
            console.log(`[Settlements] Saving ${allSettlements.length} settlements fetched before error...`);
        }

        // Final write: Write any remaining settlements in buffer
        if (allSettlements.length > 0 || fetchError) {
            console.log(`[Final Write] Writing remaining ${allSettlements.length} settlements to database...`);
            try {
                for (const sId of shopIds) {
                    const upsertData = allSettlements.map((settlement: any) => ({
                        shop_id: sId,
                        settlement_id: settlement.id,
                        order_id: settlement.order_id,
                        settlement_time: new Date(Number(settlement.statement_time) * 1000).toISOString(),
                        total_amount: parseFloat(settlement.revenue_amount || '0'),
                        net_amount: parseFloat(settlement.settlement_amount || '0'),
                        fee_amount: parseFloat(settlement.fee_amount || '0'),
                        adjustment_amount: parseFloat(settlement.adjustment_amount || '0'),
                        shipping_fee: parseFloat(settlement.shipping_cost_amount || '0'),
                        net_sales_amount: parseFloat(settlement.net_sales_amount || '0'),
                        currency: settlement.currency || 'USD',
                        transaction_summary: settlement.transaction_summary,
                        transactions_synced_at: new Date().toISOString(),
                        settlement_data: settlement,
                        updated_at: new Date().toISOString()
                    }));

                    await retryOperation(async () => {
                        const { error } = await supabase
                            .from('shop_settlements')
                            .upsert(upsertData, {
                                onConflict: 'shop_id,settlement_id',
                                ignoreDuplicates: false
                            });
                        if (error) throw error;
                    }, 3, 2000);
                }

                totalUpserted += allSettlements.length;
                console.log(`[Final Write] ✅ Wrote ${allSettlements.length} settlements. Grand total: ${totalUpserted}`);
                allSettlementsForResponse = [...allSettlementsForResponse, ...allSettlements];
            } catch (writeError: any) {
                console.error('[Final Write] Failed:', writeError.message);
                throw writeError;
            }
        }

        // ==========================================
        // BACKFILL: Fix settlements with NULL transaction_summary
        // This catches settlements that were synced before the transaction-fetching
        // feature was added, or whose transaction fetch previously failed.
        // ==========================================
        let backfilledCount = 0;
        try {
            // Find settlements with NULL or empty transaction_summary for this shop
            const { data: missingTxSettlements, error: missingErr } = await supabase
                .from('shop_settlements')
                .select('settlement_id, settlement_data')
                .eq('shop_id', shop.id)
                .or('transaction_summary.is.null,transaction_summary->>transaction_count.eq.0')
                .limit(100); // Process up to 100 at a time to avoid timeout

            if (!missingErr && missingTxSettlements && missingTxSettlements.length > 0) {
                console.log(`[Backfill] Found ${missingTxSettlements.length} settlements with missing transaction_summary for ${shop.shop_name}. Backfilling...`);

                const TX_CHUNK = 10;
                for (let i = 0; i < missingTxSettlements.length; i += TX_CHUNK) {
                    const chunk = missingTxSettlements.slice(i, i + TX_CHUNK);
                    await Promise.all(chunk.map(async (settlement) => {
                        try {
                            let allTx: any[] = [];
                            let txToken = '';
                            let txPage = 1;
                            const stmtId = settlement.settlement_id;

                            while (true) {
                                const txParams: any = { page_size: '100', sort_field: 'order_create_time', sort_order: 'DESC' };
                                if (txToken) txParams.page_token = txToken;

                                const txRes = await executeWithRefresh(
                                    shop.account_id,
                                    shop.shop_id,
                                    (token, cipher) => tiktokShopApi.getStatementTransactions(token, cipher, stmtId, txParams)
                                );
                                const txs = txRes?.transactions || [];
                                allTx = [...allTx, ...txs];

                                if (!txRes?.next_page_token || txRes.next_page_token === txToken || txs.length === 0) break;
                                txToken = txRes.next_page_token;
                                txPage++;
                                if (txPage > 20) break;
                            }

                            const txSummary = allTx.length > 0 ? aggregateTransactions(allTx) : { transaction_count: 0 };

                            // Update the settlement in DB
                            await supabase
                                .from('shop_settlements')
                                .update({
                                    transaction_summary: txSummary,
                                    transactions_synced_at: new Date().toISOString()
                                })
                                .eq('shop_id', shop.id)
                                .eq('settlement_id', stmtId);

                            if (allTx.length > 0) backfilledCount++;
                        } catch (e: any) {
                            console.warn(`[Backfill] Failed for settlement ${settlement.settlement_id}: ${e.message}`);
                        }
                    }));
                    if (i + TX_CHUNK < missingTxSettlements.length) await new Promise(r => setTimeout(r, 100));
                }

                console.log(`[Backfill] ✅ Backfilled ${backfilledCount}/${missingTxSettlements.length} settlements with transaction data`);
            }
        } catch (backfillErr: any) {
            console.warn(`[Backfill] Error during backfill (non-fatal): ${backfillErr.message}`);
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                settlements_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        const statusMsg = fetchError ? ' [⚠️ Partial - Fetch Interrupted]' : (stoppedEarly ? ' [Smart Stop Early ✓]' : '');
        console.log(`✅ Settlements sync completed for ${shop.shop_name} (${totalUpserted} settlements)${statusMsg}`);

        if (fetchError) {
            console.warn(`[Settlements] Sync interrupted by error but saved ${totalUpserted} settlements successfully`);
        }

        // Map ALL synced settlements to frontend format for direct merge into UI
        const allSyncedRaw = [...allSettlementsForResponse]; // progressive writes already accumulated
        const mappedSettlements = allSyncedRaw.map((settlement: any) => ({
            settlement_id: settlement.id,
            order_id: settlement.order_id,
            settlement_time: settlement.statement_time ? new Date(Number(settlement.statement_time) * 1000).toISOString() : null,
            total_amount: parseFloat(settlement.revenue_amount || '0'),
            net_amount: parseFloat(settlement.settlement_amount || '0'),
            fee_amount: parseFloat(settlement.fee_amount || '0'),
            adjustment_amount: parseFloat(settlement.adjustment_amount || '0'),
            shipping_fee: parseFloat(settlement.shipping_cost_amount || '0'),
            net_sales_amount: parseFloat(settlement.net_sales_amount || '0'),
            currency: settlement.currency || 'USD',
            settlement_data: settlement
        }));

        return { fetched: totalUpserted, upserted: totalUpserted, isIncremental: !isFirstSync, stoppedEarly, partial: !!fetchError, syncedSettlements: mappedSettlements };

    } catch (error) {
        console.error(`Error in syncSettlements for ${shop.shop_name}:`, error);
        throw error;
    }
}



/**
 * Helper: Parse a numeric string value, handling null/undefined/empty/whitespace
 */
function parseAmount(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const str = String(value).trim();
    if (str === '') return 0;
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

/**
 * Aggregate an array of statement transactions into a P&L summary.
 * Sums all breakdown fields across transactions.
 */
function aggregateTransactions(transactions: any[]): any {
    const summary = {
        transaction_count: transactions.length,
        total_revenue: 0,
        total_settlement: 0,
        total_shipping_cost: 0,
        total_fee_tax: 0,
        total_adjustment: 0,
        revenue: {
            subtotal_before_discount: 0,
            refund_subtotal_before_discount: 0,
            seller_discount: 0,
            seller_discount_refund: 0,
            cod_service_fee: 0,
            refund_cod_service_fee: 0,
        },
        fees: {
            platform_commission: 0,
            referral_fee: 0,
            transaction_fee: 0,
            refund_administration_fee: 0,
            credit_card_handling_fee: 0,
            affiliate_commission: 0,
            affiliate_partner_commission: 0,
            affiliate_commission_amount_before_pit: 0,
            affiliate_ads_commission: 0,
            sfp_service_fee: 0,
            live_specials_fee: 0,
            bonus_cashback_service_fee: 0,
            mall_service_fee: 0,
            voucher_xtra_service_fee: 0,
            flash_sales_service_fee: 0,
            cofunded_promotion_service_fee: 0,
            pre_order_service_fee: 0,
            tsp_commission: 0,
            dt_handling_fee: 0,
            epr_pob_service_fee: 0,
            seller_paylater_handling_fee: 0,
            fee_per_item_sold: 0,
            cofunded_creator_bonus: 0,
            dynamic_commission: 0,
            external_affiliate_marketing_fee: 0,
            tap_shop_ads_commission: 0,
            shipping_fee_guarantee_service_fee: 0,
            installation_service_fee: 0,
            campaign_resource_fee: 0,
        },
        shipping: {
            actual_shipping_fee: 0,
            shipping_fee_discount: 0,
            customer_paid_shipping_fee: 0,
            return_shipping_fee: 0,
            replacement_shipping_fee: 0,
            exchange_shipping_fee: 0,
            signature_confirmation_fee: 0,
            shipping_insurance_fee: 0,
            fbt_fulfillment_fee_reimbursement: 0,
            return_shipping_label_fee: 0,
            seller_self_shipping_service_fee: 0,
            return_shipping_fee_paid_buyer: 0,
            failed_delivery_subsidy: 0,
            shipping_fee_guarantee_reimbursement: 0,
            fbt_free_shipping_fee: 0,
            free_return_subsidy: 0,
            // Supplementary shipping components
            platform_shipping_fee_discount: 0,
            promo_shipping_incentive: 0,
            shipping_fee_subsidy: 0,
            seller_shipping_fee_discount: 0,
            customer_shipping_fee_offset: 0,
            fbm_shipping_cost: 0,
            fbt_shipping_cost: 0,
            fbt_fulfillment_fee: 0,
            return_refund_subsidy: 0,
            refunded_customer_shipping_fee: 0,
            customer_shipping_fee: 0,
            refund_customer_shipping_fee: 0,
        },
        taxes: {
            vat: 0,
            import_vat: 0,
            customs_duty: 0,
            customs_clearance: 0,
            sst: 0,
            gst: 0,
            iva: 0,
            isr: 0,
            anti_dumping_duty: 0,
            local_vat: 0,
            pit: 0,
        },
        supplementary: {
            customer_payment: 0,
            customer_refund: 0,
            platform_discount: 0,
            platform_discount_refund: 0,
            seller_cofunded_discount: 0,
            seller_cofunded_discount_refund: 0,
            platform_cofunded_discount: 0,
            platform_cofunded_discount_refund: 0,
            retail_delivery_fee: 0,
            retail_delivery_fee_payment: 0,
            retail_delivery_fee_refund: 0,
            sales_tax: 0,
            sales_tax_payment: 0,
            sales_tax_refund: 0,
        },
    };

    for (const tx of transactions) {
        // Top-level totals
        summary.total_revenue += parseAmount(tx.revenue_amount);
        summary.total_settlement += parseAmount(tx.settlement_amount);
        summary.total_shipping_cost += parseAmount(tx.shipping_cost_amount);
        summary.total_fee_tax += parseAmount(tx.fee_tax_amount);
        summary.total_adjustment += parseAmount(tx.adjustment_amount);

        // Revenue breakdown
        const rev = tx.revenue_breakdown || {};
        summary.revenue.subtotal_before_discount += parseAmount(rev.subtotal_before_discount_amount);
        summary.revenue.refund_subtotal_before_discount += parseAmount(rev.refund_subtotal_before_discount_amount);
        summary.revenue.seller_discount += parseAmount(rev.seller_discount_amount);
        summary.revenue.seller_discount_refund += parseAmount(rev.seller_discount_refund_amount);
        summary.revenue.cod_service_fee += parseAmount(rev.cod_service_fee_amount);
        summary.revenue.refund_cod_service_fee += parseAmount(rev.refund_cod_service_fee_amount);

        // Fee breakdown
        const fee = tx.fee_tax_breakdown?.fee || {};
        summary.fees.platform_commission += parseAmount(fee.platform_commission_amount);
        summary.fees.referral_fee += parseAmount(fee.referral_fee_amount);
        summary.fees.transaction_fee += parseAmount(fee.transaction_fee_amount);
        summary.fees.refund_administration_fee += parseAmount(fee.refund_administration_fee_amount);
        summary.fees.credit_card_handling_fee += parseAmount(fee.credit_card_handling_fee_amount);
        summary.fees.affiliate_commission += parseAmount(
            fee.affiliate_commission_amount ?? fee.affiliate_commission
        );
        summary.fees.affiliate_partner_commission += parseAmount(
            fee.affiliate_partner_commission_amount ?? fee.affiliate_partner_commission
        );
        summary.fees.affiliate_commission_amount_before_pit += parseAmount(
            fee.affiliate_commission_amount_before_pit
        );
        summary.fees.affiliate_ads_commission += parseAmount(fee.affiliate_ads_commission_amount);
        summary.fees.sfp_service_fee += parseAmount(fee.sfp_service_fee_amount);
        summary.fees.live_specials_fee += parseAmount(fee.live_specials_fee_amount);
        summary.fees.bonus_cashback_service_fee += parseAmount(fee.bonus_cashback_service_fee_amount);
        summary.fees.mall_service_fee += parseAmount(fee.mall_service_fee_amount);
        summary.fees.voucher_xtra_service_fee += parseAmount(fee.voucher_xtra_service_fee_amount);
        summary.fees.flash_sales_service_fee += parseAmount(fee.flash_sales_service_fee_amount);
        summary.fees.cofunded_promotion_service_fee += parseAmount(fee.cofunded_promotion_service_fee_amount);
        summary.fees.pre_order_service_fee += parseAmount(fee.pre_order_service_fee_amount);
        summary.fees.tsp_commission += parseAmount(fee.tsp_commission_amount);
        summary.fees.dt_handling_fee += parseAmount(fee.dt_handling_fee_amount);
        summary.fees.epr_pob_service_fee += parseAmount(fee.epr_pob_service_fee_amount);
        summary.fees.seller_paylater_handling_fee += parseAmount(fee.seller_paylater_handling_fee_amount);
        summary.fees.fee_per_item_sold += parseAmount(fee.fee_per_item_sold_amount);
        summary.fees.cofunded_creator_bonus += parseAmount(
            fee.cofunded_creator_bonus_amount ?? fee.cofunded_creator_bonus
        );
        summary.fees.dynamic_commission += parseAmount(fee.dynamic_commission_amount);
        summary.fees.external_affiliate_marketing_fee += parseAmount(fee.external_affiliate_marketing_fee_amount);
        summary.fees.tap_shop_ads_commission += parseAmount(
            fee.tap_shop_ads_commission_amount ?? fee.tap_shop_ads_commission
        );
        summary.fees.shipping_fee_guarantee_service_fee += parseAmount(fee.shipping_fee_guarantee_service_fee);
        summary.fees.installation_service_fee += parseAmount(fee.installation_service_fee);
        summary.fees.campaign_resource_fee += parseAmount(fee.campaign_resource_fee);

        // Tax breakdown
        const tax = tx.fee_tax_breakdown?.tax || {};
        summary.taxes.vat += parseAmount(tax.vat_amount);
        summary.taxes.import_vat += parseAmount(tax.import_vat_amount);
        summary.taxes.customs_duty += parseAmount(tax.customs_duty_amount);
        summary.taxes.customs_clearance += parseAmount(tax.customs_clearance_amount);
        summary.taxes.sst += parseAmount(tax.sst_amount);
        summary.taxes.gst += parseAmount(tax.gst_amount);
        summary.taxes.iva += parseAmount(tax.iva_amount);
        summary.taxes.isr += parseAmount(tax.isr_amount);
        summary.taxes.anti_dumping_duty += parseAmount(tax.anti_dumping_duty_amount);
        summary.taxes.local_vat += parseAmount(tax.local_vat_amount);
        summary.taxes.pit += parseAmount(tax.pit_amount);

        // Shipping cost breakdown
        const ship = tx.shipping_cost_breakdown || {};
        summary.shipping.actual_shipping_fee += parseAmount(ship.actual_shipping_fee_amount);
        summary.shipping.shipping_fee_discount += parseAmount(ship.shipping_fee_discount_amount);
        summary.shipping.customer_paid_shipping_fee += parseAmount(ship.customer_paid_shipping_fee_amount);
        summary.shipping.return_shipping_fee += parseAmount(ship.return_shipping_fee_amount);
        summary.shipping.replacement_shipping_fee += parseAmount(ship.replacement_shipping_fee_amount);
        summary.shipping.exchange_shipping_fee += parseAmount(ship.exchange_shipping_fee_amount);
        summary.shipping.signature_confirmation_fee += parseAmount(ship.signature_confirmation_fee_amount);
        summary.shipping.shipping_insurance_fee += parseAmount(ship.shipping_insurance_fee_amount);
        summary.shipping.fbt_fulfillment_fee_reimbursement += parseAmount(ship.fbt_fulfillment_fee_reimbursement_amount);
        summary.shipping.return_shipping_label_fee += parseAmount(ship.return_shipping_label_fee_amount);
        summary.shipping.seller_self_shipping_service_fee += parseAmount(ship.seller_self_shipping_service_fee_amount);
        summary.shipping.return_shipping_fee_paid_buyer += parseAmount(ship.return_shipping_fee_paid_buyer_amount);
        summary.shipping.failed_delivery_subsidy += parseAmount(ship.failed_delivery_subsidy_amount);
        summary.shipping.shipping_fee_guarantee_reimbursement += parseAmount(ship.shipping_fee_guarantee_reimbursement);
        summary.shipping.fbt_free_shipping_fee += parseAmount(ship.fbt_free_shipping_fee_amount);
        summary.shipping.free_return_subsidy += parseAmount(ship.free_return_subsidy_amount);

        // Shipping supplementary components
        const shipSupp = ship.supplementary_component || {};
        summary.shipping.platform_shipping_fee_discount += parseAmount(shipSupp.platform_shipping_fee_discount_amount);
        summary.shipping.promo_shipping_incentive += parseAmount(shipSupp.promo_shipping_incentive_amount);
        summary.shipping.shipping_fee_subsidy += parseAmount(shipSupp.shipping_fee_subsidy_amount);
        summary.shipping.seller_shipping_fee_discount += parseAmount(shipSupp.seller_shipping_fee_discount_amount);
        summary.shipping.customer_shipping_fee_offset += parseAmount(shipSupp.customer_shipping_fee_offset_amount);
        summary.shipping.fbm_shipping_cost += parseAmount(shipSupp.fbm_shipping_cost_amount);
        summary.shipping.fbt_shipping_cost += parseAmount(shipSupp.fbt_shipping_cost_amount);
        summary.shipping.fbt_fulfillment_fee += parseAmount(shipSupp.fbt_fulfillment_fee_amount);
        summary.shipping.return_refund_subsidy += parseAmount(shipSupp.return_refund_subsidy_amount);
        summary.shipping.refunded_customer_shipping_fee += parseAmount(shipSupp.refunded_customer_shipping_fee_amount);
        summary.shipping.customer_shipping_fee += parseAmount(shipSupp.customer_shipping_fee);
        summary.shipping.refund_customer_shipping_fee += parseAmount(shipSupp.refund_customer_shipping_fee);

        // Supplementary component (order-level)
        const supp = tx.supplementary_component || {};
        summary.supplementary.customer_payment += parseAmount(supp.customer_payment_amount);
        summary.supplementary.customer_refund += parseAmount(supp.customer_refund_amount);
        summary.supplementary.platform_discount += parseAmount(supp.platform_discount_amount);
        summary.supplementary.platform_discount_refund += parseAmount(supp.platform_discount_refund_amount);
        summary.supplementary.seller_cofunded_discount += parseAmount(supp.seller_cofunded_discount_amount);
        summary.supplementary.seller_cofunded_discount_refund += parseAmount(supp.seller_cofunded_discount_refund_amount);
        summary.supplementary.platform_cofunded_discount += parseAmount(supp.platform_cofunded_discount_amount);
        summary.supplementary.platform_cofunded_discount_refund += parseAmount(supp.platform_cofunded_discount_refund_amount);
        summary.supplementary.retail_delivery_fee += parseAmount(supp.retail_delivery_fee_amount);
        summary.supplementary.retail_delivery_fee_payment += parseAmount(supp.retail_delivery_fee_payment_amount);
        summary.supplementary.retail_delivery_fee_refund += parseAmount(supp.retail_delivery_fee_refund_amount);
        summary.supplementary.sales_tax += parseAmount(supp.sales_tax_amount);
        summary.supplementary.sales_tax_payment += parseAmount(supp.sales_tax_payment_amount);
        summary.supplementary.sales_tax_refund += parseAmount(supp.sales_tax_refund_amount);
    }

    return summary;
}

async function syncPerformance(shop: any) {
    console.log(`Syncing performance for shop ${shop.shop_name}...`);
    try {
        // Format: YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        const params = {
            start_date_ge: yesterday,
            end_date_lt: today
        };

        // 1. Fetch Performance Data
        const performance = await tiktokShopApi.makeApiRequest(
            '/analytics/202405/shop/performance',
            shop.access_token,
            shop.shop_cipher,
            params,
            'GET'
        );



        if (!performance || !performance.performance || !performance.performance.intervals) {
            console.log('[SyncPerformance] No performance intervals found in response');
            return;
        }

        const data = performance.performance.intervals;
        console.log(`[SyncPerformance] Found ${data.length} performance intervals`);

        console.log('[SyncPerformance] Response data sample:', JSON.stringify(data[0] || {}, null, 2));

        for (const record of data) {
            const { error } = await supabase
                .from('shop_performance')
                .upsert({
                    shop_id: shop.id,
                    date: record.date || new Date().toISOString().split('T')[0],
                    total_orders: record.total_orders || 0,
                    total_revenue: record.total_revenue || 0,
                    total_items_sold: record.total_items_sold || 0,
                    avg_order_value: record.avg_order_value || 0,
                    conversion_rate: record.conversion_rate || 0,
                    shop_rating: record.shop_rating || record.performance_score || null,
                    review_count: record.review_count || record.shop_review_count || 0,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'shop_id,date'
                });

            if (error) {
                console.error(`Error syncing performance for ${shop.shop_name}:`, error);
            }
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                performance_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Performance sync completed for ${shop.shop_name}`);

    } catch (error) {
        console.error(`Error in syncPerformance for ${shop.shop_name}:`, error);
        throw error;
    }
}

// ============================================================
// DELETE /api/tiktok-shop/shop-data/:accountId/clear
// Clear all data for a specific shop (orders, products, settlements)
// Used for hard-resetting data when sync issues occur
// ============================================================
router.delete('/shop-data/:accountId/clear', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query; // This is the TikTok Shop ID (string), e.g. "749..."

        if (!shopId) {
            return res.status(400).json({ success: false, error: 'shopId is required' });
        }

        console.log(`[ClearData] Request to clear data for TikTok Shop ID: ${shopId} (Account: ${accountId})`);

        // 1. Resolve internal UUID (tiktok_shops.id) from the TikTok Shop ID
        const { data: shop, error: shopError } = await supabase
            .from('tiktok_shops')
            .select('id, shop_name')
            .eq('shop_id', shopId)
            //.eq('account_id', accountId) // Optional: enforce account ownership
            .limit(1)
            .single();

        if (shopError || !shop) {
            console.error('[ClearData] Shop not found or error resolving UUID:', shopError);
            return res.status(404).json({ success: false, error: 'Shop not found' });
        }

        const internalShopId = shop.id; // This is the UUID
        console.log(`[ClearData] Resolved internal UUID: ${internalShopId} for shop: ${shop.shop_name}`);

        // 2. Delete Orders (references internal UUID)
        const { error: ordersError } = await supabase
            .from('shop_orders')
            .delete()
            .eq('shop_id', internalShopId);

        if (ordersError) throw ordersError;

        // 3. Delete Products (references internal UUID)
        const { error: productsError } = await supabase
            .from('shop_products')
            .delete()
            .eq('shop_id', internalShopId);

        if (productsError) throw productsError;

        // 4. Delete Settlements (references internal UUID)
        const { error: settlementsError } = await supabase
            .from('shop_settlements')
            .delete()
            .eq('shop_id', internalShopId);

        if (settlementsError) throw settlementsError;

        // 5. Reset Sync Timestamps on the main shop record
        const { error: updateError } = await supabase
            .from('tiktok_shops')
            .update({
                orders_last_synced_at: null,
                products_last_synced_at: null,
                settlements_last_synced_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', internalShopId);

        if (updateError) throw updateError;

        console.log(`[ClearData] Successfully cleared all data for shop ${shopId} (UUID: ${internalShopId})`);
        res.json({ success: true });

    } catch (error: any) {
        console.error('[ClearData] Error clearing shop data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
