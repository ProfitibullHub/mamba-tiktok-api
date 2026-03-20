import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env') });

import { tiktokBusinessApi as api } from './tiktok-business-api.service';

async function test() {
    // Need a valid access token and advertiser ID. Let's pull from the DB.
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

    // Pull the specific advertiser from the logs: 7517362935593959441
    const { data: adv } = await supabase
        .from('tiktok_advertisers')
        .select('*')
        .eq('advertiser_id', '7517362935593959441')
        .single();

    if (!adv) {
        console.log('No advertiser found');
        return;
    }

    console.log('Testing getCampaignMetrics...');
    const standard = await api.getCampaignMetrics(
        adv.access_token,
        adv.advertiser_id,
        '2026-02-13',
        '2026-03-13'
    );
    console.log(`getCampaignMetrics returned ${standard.length} rows`);
    if (standard.length > 0) {
        console.log('Sample standard row:', standard[0]);
    }
}

test().catch(console.error);
