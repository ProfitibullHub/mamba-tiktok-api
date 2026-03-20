/**
 * Quick diagnostic: check all TikTok advertiser IDs available for the stored access token
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TIKTOK_APP_ID = process.env.TIKTOK_BUSINESS_APP_ID;
const TIKTOK_SECRET = process.env.TIKTOK_BUSINESS_SECRET;
const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3';

// 1. Get stored advertiser record from Supabase
async function getStoredAdvertiser() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tiktok_advertisers?is_active=eq.true&select=*`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
    });
    const rows = await res.json();
    return rows;
}

// 2. Call TikTok to get ALL advertiser IDs for the access token
async function getAllAdvertiserIds(accessToken) {
    const url = new URL(`${TIKTOK_API}/oauth2/advertiser/get/`);
    url.searchParams.append('app_id', TIKTOK_APP_ID);
    url.searchParams.append('secret', TIKTOK_SECRET);

    const res = await fetch(url.toString(), {
        headers: { 'Access-Token': accessToken }
    });
    const data = await res.json();
    return data;
}

// 3. Get info for each advertiser ID
async function getAdvertiserInfo(accessToken, advertiserIds) {
    const url = new URL(`${TIKTOK_API}/advertiser/info/`);
    url.searchParams.append('advertiser_ids', JSON.stringify(advertiserIds));
    url.searchParams.append('fields', JSON.stringify([
        'advertiser_id', 'name', 'currency', 'timezone', 'balance', 'status',
        'create_time', 'role'
    ]));

    const res = await fetch(url.toString(), {
        headers: { 'Access-Token': accessToken }
    });
    const data = await res.json();
    return data;
}

async function main() {
    console.log('=== TikTok Advertiser ID Diagnostic ===\n');

    // Step 1: What's stored in our DB?
    const stored = await getStoredAdvertiser();
    console.log(`Found ${stored.length} advertiser record(s) in Supabase:\n`);
    for (const row of stored) {
        console.log(`  DB Record:`);
        console.log(`    advertiser_id: ${row.advertiser_id}`);
        console.log(`    advertiser_name: ${row.advertiser_name || '(none)'}`);
        console.log(`    account_id: ${row.account_id}`);
        console.log(`    is_active: ${row.is_active}`);
        console.log(`    created_at: ${row.created_at}`);
        console.log();
    }

    if (stored.length === 0) {
        console.log('No active advertiser records found. Cannot proceed.');
        return;
    }

    // Check EACH stored advertiser's token for multiple IDs
    for (const row of stored) {
        console.log(`\n========================================`);
        console.log(`Checking: ${row.advertiser_name} (${row.advertiser_id})`);
        console.log(`Account: ${row.account_id}`);
        console.log(`========================================\n`);

        const accessToken = row.access_token;

        // Step 2: What advertiser IDs does TikTok return for this token?
        const allIds = await getAllAdvertiserIds(accessToken);

        if (allIds.code !== 0) {
            console.log(`  TikTok API error: ${allIds.message} (code: ${allIds.code})`);
            continue;
        }

        const advertiserIds = allIds.data?.list || [];
        console.log(`  TikTok returned ${advertiserIds.length} advertiser ID(s):\n`);
        for (const item of advertiserIds) {
            const id = item.advertiser_id || item;
            const match = String(id) === row.advertiser_id;
            console.log(`    ${id} ${match ? '<-- STORED' : '<-- NOT STORED (DIFFERENT ID!)'}`);
        }

        // Step 3: Get detailed info for all advertiser IDs
        const allIdsFlat = advertiserIds.map(item => String(item.advertiser_id || item));
        if (allIdsFlat.length > 0) {
            console.log(`\n  Detailed info:`);
            const info = await getAdvertiserInfo(accessToken, allIdsFlat);

            if (info.code !== 0) {
                console.log(`  Info API error: ${info.message} (code: ${info.code})`);
                continue;
            }

            const list = info.data?.list || [];
            for (const adv of list) {
                const match = String(adv.advertiser_id) === row.advertiser_id;
                console.log(`\n    ${adv.name || '(unnamed)'} — ${adv.advertiser_id} ${match ? '(STORED)' : '(NOT STORED!)'}`);
                console.log(`      Status: ${adv.status} | Currency: ${adv.currency} | Balance: ${adv.balance}`);
                console.log(`      Timezone: ${adv.timezone} | Role: ${adv.role}`);
            }
        }

        // Summary for this record
        if (allIdsFlat.length > 1) {
            console.log(`\n  ⚠️  MULTIPLE IDs! DB stores ${row.advertiser_id} but TikTok has ${allIdsFlat.length} IDs.`);
        } else if (allIdsFlat.length === 1 && allIdsFlat[0] === row.advertiser_id) {
            console.log(`\n  ✅ Single ID, matches stored.`);
        } else if (allIdsFlat.length === 1 && allIdsFlat[0] !== row.advertiser_id) {
            console.log(`\n  ⚠️  MISMATCH! Stored: ${row.advertiser_id}, TikTok returns: ${allIdsFlat[0]}`);
        }
        console.log();
    }
}

main().catch(console.error);
