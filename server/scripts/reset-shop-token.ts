
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetShopTokens() {
    const shopName = 'WS Nutrition'; // Or pass as arg

    console.log(`Searching for shop: ${shopName}...`);

    const { data: shops, error } = await supabase
        .from('tiktok_shops')
        .select('*')
        .ilike('shop_name', `%${shopName}%`);

    if (error) {
        console.error('Error finding shop:', error);
        return;
    }

    if (!shops || shops.length === 0) {
        console.log('No shops found.');
        return;
    }

    const shop = shops[0];
    console.log(`Found shop: ${shop.shop_name} (ID: ${shop.id})`);

    // Set to "Access Expired" but "Refresh Valid"
    // Access Token: Expired yesterday
    // Refresh Token: Valid for 1 year
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    console.log(`Resetting tokens...`);
    console.log(`Access Exec: ${yesterday.toISOString()}`);
    console.log(`Refresh Exec: ${nextYear.toISOString()}`);

    const { error: updateError } = await supabase
        .from('tiktok_shops')
        .update({
            token_expires_at: yesterday.toISOString(),
            refresh_token_expires_at: nextYear.toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', shop.id);

    if (updateError) {
        console.error('Error updating shop:', updateError);
    } else {
        console.log('✅ Shop tokens reset successfully!');
        console.log('Now try running "Sync" - it should:');
        console.log('1. Detect access expired');
        console.log('2. Auto-refresh successfully');
        console.log('3. Complete sync');
        console.log('4. Shop should stay ACTIVE (Green)');
    }
}

resetShopTokens();
