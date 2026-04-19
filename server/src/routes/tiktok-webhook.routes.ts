import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { getShopWithToken, syncOrders, syncProducts, syncSingleOrder } from './tiktok-shop-data.routes.js';

const router = Router();

// TikTok webhook event types
const WEBHOOK_TYPE = {
    ORDER_STATUS_CHANGE: 1,
    REVERSE_STATUS_UPDATE: 2,
    RECIPIENT_ADDRESS_UPDATE: 3,
    PACKAGE_UPDATE: 4,
    PRODUCT_STATUS_CHANGE: 5,
    SELLER_DEAUTHORIZED: 6,
    CANCELLATION_STATUS_CHANGE: 11,
    ORDER_RETURN_STATUS: 12,
    NEW_CONVERSATION: 13,
    PRODUCT_INFORMATION_CHANGE: 15,
    PRODUCT_CREATION: 16,
} as const;

/**
 * Maps incoming webhook events to user-friendly notification summaries.
 */
function formatWebhookNotification(type: number, data: any): { category: string; title: string; message: string } | null {
    switch (type) {
        case WEBHOOK_TYPE.ORDER_STATUS_CHANGE:
            const status = data?.order_status || 'updated';
            // IMPORTANT: We no longer label "New Order Placed" purely by status.
            // The webhook handler will sync orders first and only label as new if the
            // order is newly present in our DB.
            return {
                category: 'Order',
                title: 'Order Status Changed',
                message: `Order ${data?.order_id || 'updated'} status changed to ${status}.`
            };
        case WEBHOOK_TYPE.REVERSE_STATUS_UPDATE:
            return { category: 'Reverse', title: 'Reverse Status Updated', message: `Customer request updated for order ${data?.order_id || ''}.` };
        case WEBHOOK_TYPE.RECIPIENT_ADDRESS_UPDATE:
            return { category: 'Order', title: 'Address Updated', message: `Recipient address changed for order ${data?.order_id || ''}.` };
        case WEBHOOK_TYPE.PACKAGE_UPDATE:
            return { category: 'Fulfillment', title: 'Package Updated', message: `Fulfillment package status updated.` };
        case WEBHOOK_TYPE.PRODUCT_STATUS_CHANGE:
            return { category: 'Product', title: 'Product Status Changed', message: `Product ${data?.product_id || ''} status updated.` };
        case WEBHOOK_TYPE.CANCELLATION_STATUS_CHANGE:
            return { category: 'Order', title: 'Cancellation Request', message: `Cancellation status changed for order ${data?.order_id || ''}.` };
        case WEBHOOK_TYPE.ORDER_RETURN_STATUS:
            return { category: 'Order', title: 'Return Request Update', message: `Return status changed for order ${data?.order_id || ''}.` };
        case WEBHOOK_TYPE.NEW_CONVERSATION:
            return { category: 'Customer Service', title: 'New Message', message: `New message received from customer.` };
        case WEBHOOK_TYPE.PRODUCT_INFORMATION_CHANGE:
            return { category: 'Product', title: 'Product Info Updated', message: `Information updated for product ${data?.product_id || ''}.` };
        case WEBHOOK_TYPE.PRODUCT_CREATION:
            return { category: 'Product', title: 'New Product Created', message: `A new product was created in the shop.` };
        default:
            return null;
    }
}

const BROADCAST_FAILURE_LOG_MS = 60_000;
const broadcastFailureLastLog = new Map<string, number>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyRealtimeTimeout(err: unknown): boolean {
    if (!err) return false;
    const name = err instanceof DOMException ? err.name : (err as Error)?.name;
    const message = err instanceof Error ? err.message : String(err);
    return (
        name === 'AbortError'
        || message.includes('AbortError')
        || message.includes('aborted')
        || message.includes('_fetchWithTimeout')
    );
}

/** Avoid spamming logs when Realtime is flaky under load. */
function logBroadcastFailureOnce(key: string, severity: 'warn' | 'error', message: string, err: unknown): void {
    const now = Date.now();
    const last = broadcastFailureLastLog.get(key) ?? 0;
    if (now - last < BROADCAST_FAILURE_LOG_MS) return;
    broadcastFailureLastLog.set(key, now);
    if (broadcastFailureLastLog.size > 500) {
        for (const [k, t] of broadcastFailureLastLog) {
            if (now - t > BROADCAST_FAILURE_LOG_MS * 2) broadcastFailureLastLog.delete(k);
        }
    }
    if (severity === 'warn') console.warn(message, err);
    else console.error(message, err);
}

/**
 * Supabase Realtime `httpSend` can throw `AbortError` when its internal fetch times out.
 * Retries with short backoff; failures are throttled in logs (timeouts → warn).
 */
async function broadcastOrderUpdateWithRetry(params: {
    internalShopDbId: string;
    externalShopId: string;
    orderId: string;
    payload: unknown;
}): Promise<void> {
    const { internalShopDbId, externalShopId, orderId, payload } = params;
    const channelName = `shop-orders-realtime-${internalShopDbId}`;
    const channel = supabase.channel(channelName);
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await (channel as any).httpSend('broadcast', {
                event: 'order_update',
                payload,
            });
            return;
        } catch (e) {
            lastErr = e;
            if (attempt < maxAttempts) await sleep(150 * attempt);
        }
    }
    const throttleKey = `${channelName}:${orderId}`;
    const msg = `[Webhook] Broadcast failed after ${maxAttempts} attempts channel=${channelName} externalShopId=${externalShopId} orderId=${orderId}`;
    if (isLikelyRealtimeTimeout(lastErr)) {
        logBroadcastFailureOnce(throttleKey, 'warn', msg, lastErr);
    } else {
        logBroadcastFailureOnce(`${throttleKey}:non-abort`, 'error', msg, lastErr);
    }
}

/**
 * Verify TikTok webhook signature.
 * TikTok signs the payload as: HMAC-SHA256(app_secret, timestamp + nonce + rawBody)
 * Signature is sent in the Authorization header as a hex string.
 */
function verifyWebhookSignature(req: Request, rawBody: string): boolean {
    const appSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim();
    const appKey = process.env.TIKTOK_SHOP_APP_KEY?.trim() || '';
    if (!appSecret) {
        console.warn('[Webhook] No app secret configured — skipping signature verification');
        return true; // Allow through but warn
    }

    const getHeader = (...names: string[]): string => {
        for (const name of names) {
            const value = req.headers[name.toLowerCase()];
            if (value) return String(Array.isArray(value) ? value[0] : value);
        }
        return '';
    };

    const authHeader = getHeader('authorization', 'x-tts-signature', 'x-tiktok-signature', 'tiktok-signature');
    const timestamp = getHeader('timestamp', 'x-tts-timestamp', 'x-tiktok-timestamp');
    const nonce = getHeader('nonce', 'x-tts-nonce', 'x-tiktok-nonce');

    if (!authHeader) {
        console.warn('[Webhook] No signature header found — cannot verify');
        return false;
    }

    try {
        const rawSignature = String(authHeader).trim();

        const safeEqualHex = (a: string, b: string): boolean => {
            if (!a || !b) return false;
            if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
            if (a.length !== b.length) return false;
            return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
        };

        // Parse k=v header styles commonly used in webhook signatures.
        const kv: Record<string, string> = {};
        rawSignature.split(',').forEach((part) => {
            const [k, ...rest] = part.split('=');
            if (!k || rest.length === 0) return;
            kv[k.trim().toLowerCase()] = rest.join('=').trim();
        });

        const tsCandidate = kv.t || kv.ts || kv.timestamp || timestamp;
        const sigCandidate = (kv.s || kv.v1 || kv.sign || kv.signature || '').replace(/^sha256=/i, '').toLowerCase();

        // Scheme 1: HMAC(rawBody + "." + timestamp) OR HMAC(timestamp + "." + rawBody)
        if (tsCandidate && sigCandidate) {
            const expectedA = crypto.createHmac('sha256', appSecret).update(`${rawBody}.${tsCandidate}`).digest('hex').toLowerCase();
            const expectedB = crypto.createHmac('sha256', appSecret).update(`${tsCandidate}.${rawBody}`).digest('hex').toLowerCase();
            if (safeEqualHex(sigCandidate, expectedA) || safeEqualHex(sigCandidate, expectedB)) {
                return true;
            }
        }

        // Scheme 2: raw hex signature in Authorization with timestamp/nonce headers
        const received = rawSignature
            .replace(/^Bearer\s+/i, '')
            .replace(/^sha256=/i, '')
            .trim()
            .toLowerCase();

        const expectedLegacy = crypto
            .createHmac('sha256', appSecret)
            .update(`${timestamp}${nonce}${rawBody}`)
            .digest('hex')
            .toLowerCase();

        if (safeEqualHex(received, expectedLegacy)) {
            return true;
        }

        // Additional fallback variants observed in some edge integrations.
        if (timestamp) {
            const expectedC = crypto.createHmac('sha256', appSecret).update(`${timestamp}${rawBody}`).digest('hex').toLowerCase();
            const expectedD = crypto.createHmac('sha256', appSecret).update(`${rawBody}${timestamp}`).digest('hex').toLowerCase();
            if (safeEqualHex(received, expectedC) || safeEqualHex(received, expectedD)) {
                return true;
            }
        }

        // Newer TikTok Webhooks often prepend the app_key to the payload before hashing
        if (appKey) {
            const expectedAppKeyPrepend = crypto.createHmac('sha256', appSecret).update(`${appKey}${rawBody}`).digest('hex').toLowerCase();
            if (safeEqualHex(received, expectedAppKeyPrepend)) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Purge all ads-related data for an account.
 * Deletes: tiktok_ad_metrics, tiktok_ad_spend_daily, tiktok_ads, tiktok_ad_groups, tiktok_ad_campaigns, tiktok_advertisers.
 */
async function purgeAdsData(accountId: string): Promise<void> {
    const { data: advertiser } = await supabase
        .from('tiktok_advertisers')
        .select('id')
        .eq('account_id', accountId)
        .maybeSingle();

    if (!advertiser) {
        console.log(`[Webhook] No ads data found for account ${accountId} — skipping ads cleanup`);
        return;
    }

    const advId = advertiser.id;
    console.log(`[Webhook] Purging ads data for advertiser UUID: ${advId}`);

    const results = await Promise.all([
        supabase.from('tiktok_ad_metrics').delete().eq('advertiser_id', advId),
        supabase.from('tiktok_ad_spend_daily').delete().eq('advertiser_id', advId),
        supabase.from('tiktok_ads').delete().eq('advertiser_id', advId),
        supabase.from('tiktok_ad_groups').delete().eq('advertiser_id', advId),
        supabase.from('tiktok_ad_campaigns').delete().eq('advertiser_id', advId),
    ]);

    const tableNames = ['tiktok_ad_metrics', 'tiktok_ad_spend_daily', 'tiktok_ads', 'tiktok_ad_groups', 'tiktok_ad_campaigns'];
    results.forEach((r, i) => {
        if (r.error) console.error(`[Webhook] ${tableNames[i]} deletion error:`, r.error.message);
    });

    const { error: advDeleteError } = await supabase
        .from('tiktok_advertisers')
        .delete()
        .eq('id', advId);

    if (advDeleteError) console.error(`[Webhook] tiktok_advertisers deletion error:`, advDeleteError.message);
    else console.log(`[Webhook] ✅ Ads data fully purged for advertiser ${advId}`);
}

/**
 * Purge all data for a shop by its TikTok shop_id.
 * Deletes: shop_orders, shop_products, shop_settlements, ads data, then tiktok_shops.
 */
async function purgeShopData(tiktokShopId: string): Promise<{ found: boolean; shopName: string }> {
    const { data: shop, error: fetchError } = await supabase
        .from('tiktok_shops')
        .select('id, shop_name, account_id')
        .eq('shop_id', tiktokShopId)
        .maybeSingle();

    if (fetchError) throw fetchError;
    if (!shop) return { found: false, shopName: tiktokShopId };

    const { id: internalId, shop_name: shopName, account_id: accountId } = shop;

    const [ordersResult, productsResult, settlementsResult] = await Promise.all([
        supabase.from('shop_orders').delete().eq('shop_id', internalId),
        supabase.from('shop_products').delete().eq('shop_id', internalId),
        supabase.from('shop_settlements').delete().eq('shop_id', internalId),
        purgeAdsData(accountId),
    ]);

    if (ordersResult.error) console.error(`[Webhook] Orders deletion error for ${shopName}:`, ordersResult.error.message);
    if (productsResult.error) console.error(`[Webhook] Products deletion error for ${shopName}:`, productsResult.error.message);
    if (settlementsResult.error) console.error(`[Webhook] Settlements deletion error for ${shopName}:`, settlementsResult.error.message);

    const { error: shopDeleteError } = await supabase
        .from('tiktok_shops')
        .delete()
        .eq('id', internalId);

    if (shopDeleteError) throw shopDeleteError;

    return { found: true, shopName };
}

/**
 * POST /api/tiktok-shop/webhook
 * Receives TikTok Shop event notifications.
 */
router.post('/', async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : JSON.stringify(req.body ?? {});

    let payload: any = null;
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        console.warn('[Webhook] Invalid JSON payload received — discarding');
        return res.status(200).json({ code: 0, message: "success" });
    }

    const { type, shop_id, tts_notification_id, timestamp } = payload;

    console.log(`[Webhook] Received event type=${type} shop_id=${shop_id} notification_id=${tts_notification_id}`);

    const signatureValid = verifyWebhookSignature(req, rawBody);
    const strictWebhookVerification = String(process.env.TIKTOK_WEBHOOK_STRICT_VERIFY || '').toLowerCase() === 'true';
    if (!signatureValid) {
        const headerSnapshot = {
            authorization: req.headers['authorization'] ? 'present' : 'missing',
            x_tts_signature: req.headers['x-tts-signature'] ? 'present' : 'missing',
            x_tiktok_signature: req.headers['x-tiktok-signature'] ? 'present' : 'missing',
            tiktok_signature: req.headers['tiktok-signature'] ? 'present' : 'missing',
            timestamp: req.headers['timestamp'] ? 'present' : 'missing',
            x_tts_timestamp: req.headers['x-tts-timestamp'] ? 'present' : 'missing',
            x_tiktok_timestamp: req.headers['x-tiktok-timestamp'] ? 'present' : 'missing',
            nonce: req.headers['nonce'] ? 'present' : 'missing',
            x_tts_nonce: req.headers['x-tts-nonce'] ? 'present' : 'missing',
            x_tiktok_nonce: req.headers['x-tiktok-nonce'] ? 'present' : 'missing'
        };
        // Respond success so TikTok doesn't keep retrying, but do not trust the payload.
        // Prevents fake notification spam when signatures are invalid.
        console.warn(
            strictWebhookVerification
                ? `[Webhook] ⚠️  Signature verification failed for notification ${tts_notification_id} — discarding`
                : `[Webhook] ⚠️  Signature verification failed for notification ${tts_notification_id} — continuing (strict mode disabled)`
        );
        console.warn('[Webhook] Signature header snapshot:', headerSnapshot);
        if (typeof req.headers['authorization'] === 'string') {
            const auth = req.headers['authorization'];
            console.warn('[Webhook] Authorization preview:', auth.slice(0, 120));
        }
        if (strictWebhookVerification) {
            res.status(200).json({ code: 0, message: "success" });
            return;
        }
        console.warn('[Webhook] STRICT mode OFF - continuing processing for delivery reliability');
    }

    const now = Math.floor(Date.now() / 1000);
    const headerTimestamp = Number(
        req.headers['x-tts-timestamp'] ||
        req.headers['x-tiktok-timestamp'] ||
        req.headers['timestamp'] ||
        ((typeof req.headers['authorization'] === 'string' && req.headers['authorization'].match(/(?:^|,)\s*t=(\d+)\s*(?:,|$)/i)?.[1]) || undefined) ||
        timestamp
    );
    if (headerTimestamp && Math.abs(now - headerTimestamp) > 600) {
        console.warn(`[Webhook] Stale webhook rejected (timestamp ${headerTimestamp}, now ${now})`);
        return res.status(200).json({ code: 0, message: "success" });
    }

    // -----------------------------------------------------
    // HARD PAUSE CHECK
    // If the shop is paused in the database, we discard the message immediately.
    // -----------------------------------------------------
    try {
        const { data: currentShop } = await supabase
            .from('tiktok_shops')
            .select('is_paused')
            .eq('shop_id', String(shop_id))
            .maybeSingle();

        if (currentShop?.is_paused) {
            console.log(`[Webhook] ⏸️  Shop ${shop_id} is HARD PAUSED — ignoring event type ${type}`);
            return res.status(200).json({ code: 0, message: "success" });
        }
    } catch (err: any) {
        console.error('[Webhook] Error checking pause state in database:', err.message);
    }

    // Process async after response
    if (type === WEBHOOK_TYPE.SELLER_DEAUTHORIZED) {
        console.log(`[Webhook] 🔔 Seller deauthorization — shop_id: ${shop_id}`);
        try {
            const { found, shopName } = await purgeShopData(String(shop_id));
            if (found) console.log(`[Webhook] ✅ Shop "${shopName}" (${shop_id}) fully purged`);
        } catch (err: any) {
            console.error(`[Webhook] ❌ Failed to purge shop ${shop_id}:`, err.message);
        }
        return res.status(200).json({ code: 0, message: "success" });
    } else {
        const payloadData = payload.data || payload;
        const notificationData = formatWebhookNotification(type, payloadData);

        if (!notificationData) return res.status(200).json({ code: 0, message: "success" });

        // -----------------------------------------------------
        // Deduping: if TikTok retries the *same* delivery, we
        // should not create additional "INSERT" notifications.
        // -----------------------------------------------------
        let shouldInsert = true;
        if (tts_notification_id) {
            try {
                const { data: existingNotif } = await supabase
                    .from('webhook_notifications')
                    .select('id')
                    .eq('shop_id', String(shop_id))
                    .eq('tts_notification_id', String(tts_notification_id))
                    .maybeSingle();

                shouldInsert = !existingNotif;
            } catch (dedupeErr: any) {
                // If dedupe fails (e.g. column not present yet), fall back to inserting.
                console.error('[Webhook] Dedupe check failed:', dedupeErr.message);
                shouldInsert = true;
            }
        }

        // -----------------------------------------------------
        // IMPORTANT RELIABILITY RULE:
        // Notification insertion must not depend on sync/token success.
        // We first try best-effort title refinement, then always insert.
        // Sync happens after insert and is non-blocking.
        // -----------------------------------------------------
        let dbShop: any = null;
        try {
            const { data } = await supabase
                .from('tiktok_shops')
                .select('id, account_id')
                .eq('shop_id', String(shop_id))
                .maybeSingle();
            dbShop = data;
        } catch (shopLookupErr: any) {
            console.error('[Webhook] Shop lookup failed (non-fatal):', shopLookupErr.message);
        }

        // Best-effort "new order" refinement. Sync orders for ALL status changes (so Realtime UI updates work),
        // but only create notifications for AWAITING_SHIPMENT (new orders), CANCELLED, and REVERSE events.
        if (dbShop && type === WEBHOOK_TYPE.ORDER_STATUS_CHANGE) {
            try {
                const status = payloadData?.order_status || 'updated';
                const shouldNotifyStatus = status === 'UNPAID' ||
                    status === 'AWAITING_SHIPMENT' ||
                    status === 'CANCELLED' ||
                    status.startsWith('REVERSE_') ||
                    status.includes('CANCEL');
                const orderId = payloadData?.order_id;

                // Always sync orders so that Realtime subscription picks up the DB change
                if (orderId) {
                    const { data: internalShops } = await supabase
                        .from('tiktok_shops')
                        .select('id')
                        .eq('shop_id', String(shop_id));

                    const internalIds = (internalShops || []).map(s => s.id);
                    if (internalIds.length > 0) {
                        // 1. Check if order already exists (fetch its status too) BEFORE sync
                        const { data: preExisting } = await supabase
                            .from('shop_orders')
                            .select('order_id, order_status')
                            .in('shop_id', internalIds)
                            .eq('order_id', String(orderId))
                            .maybeSingle();

                        const shop = await getShopWithToken(dbShop.account_id, String(shop_id));

                        // 2. Targeted Sync Logic to save massive API rate limits
                        const isOrderUnknown = !preExisting;
                        if (isOrderUnknown) {
                            // Fresh order: we absolutely need the full shipping/buyer info from TikTok API
                            await syncSingleOrder(shop, String(orderId));
                        } else {
                            // Status update (e.g. IN_TRANSIT, DELIVERED, CANCELLED): order should already exist!
                            // Skip the expensive API call entirely and update our DB directly.
                            await supabase
                                .from('shop_orders')
                                .update({
                                    order_status: status,
                                    update_time: payloadData?.update_time || Math.floor(Date.now() / 1000),
                                    updated_at: new Date().toISOString()
                                })
                                .in('shop_id', internalIds)
                                .eq('order_id', String(orderId));
                        }

                        // 3. Fetch the FULL order row after sync/update to broadcast
                        const { data: fullOrderRow } = await supabase
                            .from('shop_orders')
                            .select('*')
                            .in('shop_id', internalIds)
                            .eq('order_id', String(orderId))
                            .maybeSingle();

                        // 4. If we have the updated order, broadcast it to the Realtime UI
                        if (fullOrderRow) {
                            for (const internalId of internalIds) {
                                void broadcastOrderUpdateWithRetry({
                                    internalShopDbId: internalId,
                                    externalShopId: String(shop_id),
                                    orderId: String(orderId),
                                    payload: fullOrderRow,
                                });
                            }
                        }

                        // 5. Evaluate notification rules
                        if (shouldNotifyStatus && fullOrderRow) {
                            const prevStatus = preExisting ? preExisting.order_status : null;
                            const isBrandNew = !preExisting;

                            if (status === 'UNPAID') {
                                shouldInsert = isBrandNew || prevStatus !== 'UNPAID';
                                if (shouldInsert) {
                                    notificationData.title = 'New Order Placed';
                                    notificationData.message = `New order ${orderId} is awaiting payment.`;
                                }
                            } else if (status === 'AWAITING_SHIPMENT') {
                                shouldInsert = isBrandNew || prevStatus !== 'AWAITING_SHIPMENT';
                                if (shouldInsert) {
                                    if (prevStatus === 'UNPAID') {
                                        notificationData.title = 'Order Paid';
                                        notificationData.message = `Order ${orderId} has been paid and is ready to ship.`;
                                    } else {
                                        notificationData.title = 'New Order Placed';
                                        notificationData.message = `New order ${orderId} received and is ready to ship.`;
                                    }
                                }
                            } else {
                                // For Cancelled/Reverse, always notify
                                shouldInsert = true;
                                if (status === 'CANCELLED' || status.includes('CANCEL')) {
                                    notificationData.title = 'Order Cancelled';
                                } else {
                                    notificationData.title = 'Order Reversal/Return';
                                }
                                notificationData.message = `Order ${orderId} reached status ${status}.`;
                            }
                        } else {
                            // Non-notifiable status (e.g., IN_TRANSIT, DELIVERED)
                            shouldInsert = false;
                        }
                    } else {
                        shouldInsert = false;
                    }
                } else {
                    shouldInsert = false;
                }
            } catch (classifyErr: any) {
                console.error('[Webhook] New-order classification failed (non-fatal):', classifyErr.message);
            }
        }

        if (shouldInsert) {
            console.log(`[Webhook] Storing notification for type ${type} (${notificationData.title})`);
            try {
                const baseInsert = {
                    shop_id: String(shop_id),
                    type_id: type,
                    category: notificationData.category,
                    title: notificationData.title,
                    message: notificationData.message,
                    raw_payload: payload
                };

                const { error: insertError } = await supabase
                    .from('webhook_notifications')
                    .insert({
                        ...baseInsert,
                        tts_notification_id: tts_notification_id ? String(tts_notification_id) : null
                    });

                if (insertError) {
                    // Graceful fallback in case the column is not present yet in DB.
                    if (insertError.message?.includes('tts_notification_id')) {
                        const { error: fallbackError } = await supabase
                            .from('webhook_notifications')
                            .insert(baseInsert);

                        if (fallbackError) console.error('[Webhook] Failed to store notification (fallback):', fallbackError.message);
                    } else {
                        console.error('[Webhook] Failed to store notification:', insertError.message);
                    }
                }
            } catch (err: any) {
                console.error('[Webhook] Error writing notification:', err.message);
            }
        }

        // Critical Database and Realtime operations completed. Respond to TikTok safely.
        res.status(200).json({ code: 0, message: "success" });

        // Background task: Daily reset logic. Wipe yesterday's notifications, keep today's.
        (async () => {
            try {
                const shopTz = dbShop?.timezone || 'America/Los_Angeles';
                const now = new Date();
                const tzString = now.toLocaleString('en-US', { timeZone: shopTz });
                const localTzTime = new Date(tzString);
                const tzOffset = now.getTime() - localTzTime.getTime();
                
                localTzTime.setHours(0, 0, 0, 0);
                const todayStartUTC = new Date(localTzTime.getTime() + tzOffset).toISOString();

                const { data: deletedNodes, error } = await supabase
                    .from('webhook_notifications')
                    .delete()
                    .eq('shop_id', String(shop_id))
                    .lt('created_at', todayStartUTC)
                    .select('id');

                if (!error && deletedNodes && deletedNodes.length > 0) {
                    console.log(`[Webhook] Daily Reset: Cleaned up ${deletedNodes.length} notifications from previous days for shop ${shop_id}`);
                }
            } catch (err: any) {
                console.error('[Webhook] Daily cleanup error:', err.message);
            }
        })();

        // Fire-and-forget realtime sync after notification insert.
        if (dbShop) {
            getShopWithToken(dbShop.account_id, String(shop_id))
                .then((shop) => {
                    if (['Order', 'Reverse', 'Fulfillment'].includes(notificationData.category)) {
                        return syncOrders(shop, false);
                    }
                    if (notificationData.category === 'Product') {
                        return syncProducts(shop, false);
                    }
                })
                .catch((syncErr: any) => {
                    console.error('[Webhook] Post-insert sync failed (non-fatal):', syncErr.message);
                });
        }
    }
});

export default router;
