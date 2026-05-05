import type { NextFunction, Request, Response } from 'express';
import { requireAuthorization } from './authorize.middleware.js';
import {
    ACTION_TIKTOK_ADS_DATA,
    ACTION_TIKTOK_AUTH,
    ACTION_TIKTOK_SHOP_DATA,
    FEATURE_TIKTOK_ADS,
    FEATURE_TIKTOK_SHOP,
} from '../constants/tiktok-entitlements.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * After account access checks, enforce TikTok Shop plan + RBAC for any route with `:accountId`.
 * GET/HEAD use `tiktok.shop.data` (includes Seller User); mutating routes use `tiktok.auth`.
 */
export function requireTikTokShopEntitlementParam(req: Request, res: Response, next: NextFunction, accountId: string) {
    if (!UUID_RE.test(accountId)) return next();
    const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const action = read ? ACTION_TIKTOK_SHOP_DATA : ACTION_TIKTOK_AUTH;
    return requireAuthorization({
        action,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId,
    })(req, res, next);
}

/**
 * After account access checks, enforce TikTok Ads plan + RBAC for any route with `:accountId`.
 * GET/HEAD use `tiktok.ads.data` (includes Seller User); mutating routes use `tiktok.auth`.
 */
export function requireTikTokAdsEntitlementParam(req: Request, res: Response, next: NextFunction, accountId: string) {
    if (!UUID_RE.test(accountId)) return next();
    const read = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const action = read ? ACTION_TIKTOK_ADS_DATA : ACTION_TIKTOK_AUTH;
    return requireAuthorization({
        action,
        featureKey: FEATURE_TIKTOK_ADS,
        accountId,
    })(req, res, next);
}
