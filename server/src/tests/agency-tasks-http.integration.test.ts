import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';

/**
 * Optional: real Supabase password JWT + seeded `server/scripts/seed-role-test-users.ts` users.
 *
 * Requires: SUPABASE_URL, SUPABASE_ANON_KEY, server/.env service key already used by the app,
 * and `cd server && npm run seed:test-role-users` against that project.
 *
 * Run: `cd server && npm run test:tasks-http`
 */
process.env.VERCEL = '1';

const skipHttp = !(
    process.env.RUN_TASK_HTTP_E2E === '1' &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
);

const { default: app } = await import('../index.js');

test(
    'GET /api/tasks with real JWT (agencyadmin@test.com)',
    { skip: skipHttp, timeout: 45_000 },
    async () => {
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await supabase.auth.signInWithPassword({
            email: 'agencyadmin@test.com',
            password: 'test123',
        });
        if (error) {
            assert.fail(
                `signIn failed: ${error.message}. Seed users: cd server && npm run seed:test-role-users`,
            );
        }
        const token = data.session?.access_token;
        assert.ok(token);

        const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);

        assert.ok(
            res.status === 200 || res.status === 403,
            `unexpected status ${res.status}: ${JSON.stringify(res.body)}`,
        );
        if (res.status === 200) {
            assert.equal(res.body.success, true);
            assert.ok(Array.isArray(res.body.data));
        }
    },
);
