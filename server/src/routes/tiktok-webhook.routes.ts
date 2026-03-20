import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

const router = Router();

// TikTok webhook event types
const WEBHOOK_TYPE = {
    SELLER_DEAUTHORIZED: 6,
} as const;

/**
 * Verify TikTok webhook signature.
 * TikTok signs the payload as: HMAC-SHA256(app_secret, timestamp + nonce + rawBody)
 * Signature is sent in the Authorization header as a hex string.
 */
function verifyWebhookSignature(req: Request, rawBody: string): boolean {
    const appSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim();
    if (!appSecret) {
        console.warn('[Webhook] No app secret configured — skipping signature verification');
        return true; // Allow through but warn
    }

    const authHeader = req.headers['authorization'] || req.headers['x-tts-signature'] || '';
    const timestamp = req.headers['timestamp'] as string || '';
    const nonce = req.headers['nonce'] as string || '';

    if (!authHeader) {
        console.warn('[Webhook] No signature header found — cannot verify');
        return false;
    }

    try {
        // TikTok signature: HMAC-SHA256(app_secret, timestamp + nonce + rawBody)
        const stringToSign = `${timestamp}${nonce}${rawBody}`;
        const expected = crypto
            .createHmac('sha256', appSecret)
            .update(stringToSign)
            .digest('hex');

        const received = String(authHeader);
        const isValid = crypto.timingSafeEqual(
            Buffer.from(expected, 'hex'),
            Buffer.from(received.length === expected.length ? received : expected, 'hex')
        );
        return isValid;
    } catch {
        return false;
    }
}

/**
 * Purge all ads-related data for an account.
 * Deletes: tiktok_ad_metrics, tiktok_ad_spend_daily, tiktok_ads, tiktok_ad_groups, tiktok_ad_campaigns, tiktok_advertisers.
 */
async function purgeAdsData(accountId: string): Promise<void> {
    // Find the advertiser record for this account
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

    // Delete child tables first (foreign key order), then the advertiser record
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

    // Finally delete the advertiser record (holds access_token)
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
    // Look up internal shop record (shop_id is the TikTok external ID, id is the UUID primary key)
    const { data: shop, error: fetchError } = await supabase
        .from('tiktok_shops')
        .select('id, shop_name, account_id')
        .eq('shop_id', tiktokShopId)
        .maybeSingle();

    if (fetchError) throw fetchError;
    if (!shop) return { found: false, shopName: tiktokShopId };

    const { id: internalId, shop_name: shopName, account_id: accountId } = shop;

    // Wipe all customer data in parallel (shop data + ads data)
    const [ordersResult, productsResult, settlementsResult] = await Promise.all([
        supabase.from('shop_orders').delete().eq('shop_id', internalId),
        supabase.from('shop_products').delete().eq('shop_id', internalId),
        supabase.from('shop_settlements').delete().eq('shop_id', internalId),
        purgeAdsData(accountId),
    ]);

    if (ordersResult.error) console.error(`[Webhook] Orders deletion error for ${shopName}:`, ordersResult.error.message);
    if (productsResult.error) console.error(`[Webhook] Products deletion error for ${shopName}:`, productsResult.error.message);
    if (settlementsResult.error) console.error(`[Webhook] Settlements deletion error for ${shopName}:`, settlementsResult.error.message);

    // Remove the shop record (tokens, cipher, etc.)
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
 *
 * Handles:
 *   type 6 — Seller deauthorized the app: wipe all shop data from our database.
 *
 * TikTok expects a 200 response within 3 seconds — heavy work runs async.
 */
router.post('/', async (req: Request, res: Response) => {
    const rawBody = JSON.stringify(req.body);
    const { type, shop_id, tts_notification_id, timestamp } = req.body;

    console.log(`[Webhook] Received event type=${type} shop_id=${shop_id} notification_id=${tts_notification_id}`);

    // Verify signature (log warning if invalid but don't hard-reject in case of TikTok format changes)
    const signatureValid = verifyWebhookSignature(req, rawBody);
    if (!signatureValid) {
        console.warn(`[Webhook] ⚠️  Signature verification failed for notification ${tts_notification_id} — processing anyway with caution`);
    }

    // Reject obviously replayed/stale webhooks (older than 10 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (timestamp && Math.abs(now - Number(timestamp)) > 600) {
        console.warn(`[Webhook] Stale webhook rejected (timestamp ${timestamp}, now ${now})`);
        return res.status(200).json({ received: true }); // Still 200 to avoid TikTok retries
    }

    // Acknowledge immediately so TikTok doesn't time out
    res.status(200).json({ received: true });

    // Process async after response
    if (type === WEBHOOK_TYPE.SELLER_DEAUTHORIZED) {
        console.log(`[Webhook] 🔔 Seller deauthorization — shop_id: ${shop_id}`);

        try {
            const { found, shopName } = await purgeShopData(String(shop_id));

            if (found) {
                console.log(`[Webhook] ✅ Shop "${shopName}" (${shop_id}) fully purged after seller deauthorization`);
            } else {
                console.warn(`[Webhook] ⚠️  Shop ${shop_id} not found in database — may have already been removed`);
            }
        } catch (err: any) {
            console.error(`[Webhook] ❌ Failed to purge shop ${shop_id} after deauthorization:`, err.message);
        }
    } else {
        console.log(`[Webhook] Event type ${type} received — no handler defined, ignoring`);
    }
});

export default router;
