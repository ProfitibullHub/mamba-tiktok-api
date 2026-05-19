import { describe, it, expect } from 'vitest';
import {
    plDataKeyForRange,
    plDataMatchesShopDateRange,
    scopePlDataToDateRange,
    scopedPlDataFromCache,
} from './plDataRangeGuard';

describe('plDataKeyForRange', () => {
    it('returns empty string when shopId is missing', () => {
        expect(plDataKeyForRange('acc-1', undefined, '2026-01-01', '2026-01-31')).toBe('');
    });

    it('joins account, shop, and date range', () => {
        expect(plDataKeyForRange('acc-1', 'shop-x', '2026-01-01', '2026-01-31')).toBe('acc-1:shop-x:2026-01-01:2026-01-31');
    });
});

describe('plDataMatchesShopDateRange', () => {
    it('returns false when key or shop is missing', () => {
        expect(plDataMatchesShopDateRange('', 'acc', 's', 'a', 'b')).toBe(false);
        expect(plDataMatchesShopDateRange('acc:s:a:b', 'acc', undefined, 'a', 'b')).toBe(false);
    });

    it('returns true when key matches computed key', () => {
        const key = plDataKeyForRange('acc', 'shop', '2026-02-01', '2026-02-28');
        expect(plDataMatchesShopDateRange(key, 'acc', 'shop', '2026-02-01', '2026-02-28')).toBe(true);
    });
});

describe('scopePlDataToDateRange', () => {
    it('returns null when plData is nullish', () => {
        expect(scopePlDataToDateRange(null, 'k', 'a', 's', 'x', 'y')).toBeNull();
    });

    it('returns null when key does not match range', () => {
        expect(scopePlDataToDateRange({ x: 1 }, 'wrong', 'a', 's', '2026-01-01', '2026-01-02')).toBeNull();
    });

    it('returns data when key matches', () => {
        const data = { ok: true };
        const key = plDataKeyForRange('a', 's', '2026-01-01', '2026-01-02');
        expect(scopePlDataToDateRange(data, key, 'a', 's', '2026-01-01', '2026-01-02')).toBe(data);
    });
});

describe('scopedPlDataFromCache', () => {
    it('prefers cache entry for computed key', () => {
        const cached = { from: 'cache' };
        const cache = { 'a:s:2026-01-01:2026-01-02': cached };
        const out = scopedPlDataFromCache({ from: 'stale' }, 'old-key', cache, 'a', 's', '2026-01-01', '2026-01-02');
        expect(out).toBe(cached);
    });
});
