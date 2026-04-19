import type { NextFunction, Request, Response } from 'express';
import { requireAuthorization } from './authorize.middleware.js';
import { ACTION_TIKTOK_AUTH, FEATURE_TIKTOK_ADS, FEATURE_TIKTOK_SHOP } from '../constants/tiktok-entitlements.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * After account access checks, enforce TikTok Shop plan + RBAC for any route with `:accountId`.
 */
export function requireTikTokShopEntitlementParam(req: Request, res: Response, next: NextFunction, accountId: string) {
    if (!UUID_RE.test(accountId)) return next();
    return requireAuthorization({
        action: ACTION_TIKTOK_AUTH,
        featureKey: FEATURE_TIKTOK_SHOP,
        accountId,
    })(req, res, next);
}

/**
 * After account access checks, enforce TikTok Ads plan + RBAC for any route with `:accountId`.
 */
export function requireTikTokAdsEntitlementParam(req: Request, res: Response, next: NextFunction, accountId: string) {
    if (!UUID_RE.test(accountId)) return next();
    return requireAuthorization({
        action: ACTION_TIKTOK_AUTH,
        featureKey: FEATURE_TIKTOK_ADS,
        accountId,
    })(req, res, next);
}
