import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

/**
 * Loads the full Express app (same module graph as production).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (e.g. from `.env`) like other server tests.
 * Sets VERCEL=1 so the dev HTTP listener is not started.
 */
process.env.VERCEL = '1';

const { default: app } = await import('../index.js');

test('GET /health returns ok JSON', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.timestamp, 'string');
    assert.match(res.body.service, /Mamba/);
});
