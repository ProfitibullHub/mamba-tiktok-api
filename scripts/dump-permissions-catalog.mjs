#!/usr/bin/env node
/**
 * Lists public.permissions from Supabase (sorted by action) and flags known synonymous actions.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dump-permissions-catalog.mjs
 *
 * Optional: copy server/.env or export vars from your environment.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const SYNONYM_GROUPS = [
    ['roles.manage', 'manage_roles', 'assign_roles'],
    ['view_pnl', 'financials.view', 'financials.restricted'],
];

function main() {
    return supabase.from('permissions').select('action, description').order('action');
}

const { data, error } = await main();

if (error) {
    console.error(error.message);
    process.exit(1);
}

const rows = Array.isArray(data) ? data : [];
console.log('action\tdescription');
for (const row of rows) {
    const a = row?.action ?? '';
    const d = (row?.description ?? '').replace(/\s+/g, ' ').trim();
    console.log(`${a}\t${d}`);
}

const actions = new Set(rows.map((r) => r?.action).filter(Boolean));
console.log('\n--- Synonym / alias groups (present in catalog) ---');
for (const group of SYNONYM_GROUPS) {
    const present = group.filter((g) => actions.has(g));
    if (present.length > 1) {
        console.log(`overlap: ${present.join(', ')}`);
    } else if (present.length === 1) {
        console.log(`only one of [${group.join(', ')}] present: ${present[0]}`);
    }
}

console.log(`\nTotal: ${rows.length}`);
