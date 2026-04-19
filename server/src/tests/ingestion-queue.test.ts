import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdempotencyKey, computeBackoffSeconds } from '../services/ingestion-queue.service.js';

test('computeBackoffSeconds grows exponentially and caps', () => {
    assert.equal(computeBackoffSeconds(1), 30);
    assert.equal(computeBackoffSeconds(2), 60);
    assert.equal(computeBackoffSeconds(3), 120);
    assert.equal(computeBackoffSeconds(9), 900);
    assert.equal(computeBackoffSeconds(25), 900);
});

test('buildIdempotencyKey is stable for equal inputs', () => {
    const input = {
        stream: 'shop' as const,
        accountId: '00000000-0000-0000-0000-000000000001',
        shopDbId: '00000000-0000-0000-0000-000000000002',
        syncType: 'orders',
        payload: {
            accountId: '00000000-0000-0000-0000-000000000001',
            shopId: 'test-shop',
            syncType: 'orders',
            startDate: '2026-04-01',
            endDate: '2026-04-10',
            forceFullSync: false,
        },
        idempotencyWindowMinutes: 60,
    };

    const a = buildIdempotencyKey(input);
    const b = buildIdempotencyKey(input);
    assert.equal(a, b);
});

test('buildIdempotencyKey changes when payload dimensions change', () => {
    const base = {
        stream: 'shop' as const,
        accountId: '00000000-0000-0000-0000-000000000001',
        syncType: 'orders',
        payload: {
            accountId: '00000000-0000-0000-0000-000000000001',
            shopId: 'test-shop',
            syncType: 'orders',
        },
        idempotencyWindowMinutes: 60,
    };

    const keyA = buildIdempotencyKey(base);
    const keyB = buildIdempotencyKey({
        ...base,
        syncType: 'products',
        payload: { ...base.payload, syncType: 'products' },
    });

    assert.notEqual(keyA, keyB);
});
