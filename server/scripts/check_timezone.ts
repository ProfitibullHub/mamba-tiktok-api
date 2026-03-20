
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || (!supabaseKey && !serviceKey)) {
    console.error('Missing Supabase credentials in .env file');
    process.exit(1);
}

// Use service role key if available for administrative access, otherwise anon key
const supabase = createClient(supabaseUrl, serviceKey || supabaseKey || '');

async function checkTimezone() {
    console.log('Checking tiktok_shops table for timezone column...');

    const { data, error } = await supabase
        .from('tiktok_shops')
        .select('id, shop_name, region, timezone')
        .limit(5);

    if (error) {
        console.error('Error fetching shops:', error.message);
        return;
    }

    if (data && data.length > 0) {
        console.table(data);
        const hasTimezone = data.some(shop => shop.timezone !== undefined && shop.timezone !== null);
        if (hasTimezone) {
            console.log('✅ SUCCESS: Timezone column exists and is populated!');
        } else {
            console.log('❌ FAILURE: Timezone column appears to be missing or empty.');
            console.log('Please run the migration script: server/scripts/add_shop_timezone.sql');
        }
    } else {
        console.log('No shops found in database.');
    }
}

checkTimezone();
