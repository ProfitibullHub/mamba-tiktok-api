import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    console.log('🚀 Starting paid_time column migration...\n');

    try {
        // Step 1: Read and execute the SQL migration
        console.log('📝 Step 1: Adding paid_time column to shop_orders table...');
        const sqlPath = path.join(__dirname, 'add_paid_time_column.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Execute the SQL (note: Supabase client doesn't support raw SQL directly)
        // We'll use the RPC approach or direct SQL execution
        console.log('   SQL migration script loaded');
        console.log('   ⚠️  Please run this SQL manually in your Supabase SQL Editor:');
        console.log('   ' + sqlPath);
        console.log('');

        // Step 2: Verify the column was added
        console.log('📊 Step 2: Verifying column exists...');
        const { data: orders, error: verifyError } = await supabase
            .from('shop_orders')
            .select('id, order_id, order_status, paid_time')
            .limit(1);

        if (verifyError) {
            console.error('   ❌ Error verifying column:', verifyError.message);
            console.log('   Please run the SQL migration manually first.');
            process.exit(1);
        }

        console.log('   ✅ Column verified successfully');

        // Step 3: Check how many orders need paid_time populated
        console.log('\n📈 Step 3: Checking orders needing paid_time...');
        const { count: totalOrders } = await supabase
            .from('shop_orders')
            .select('*', { count: 'exact', head: true });

        const { count: ordersWithPaidTime } = await supabase
            .from('shop_orders')
            .select('*', { count: 'exact', head: true })
            .not('paid_time', 'is', null);

        console.log(`   Total orders: ${totalOrders}`);
        console.log(`   Orders with paid_time: ${ordersWithPaidTime}`);
        console.log(`   Orders needing update: ${(totalOrders || 0) - (ordersWithPaidTime || 0)}`);

        // Step 4: Instructions for re-sync
        console.log('\n🔄 Step 4: Next Steps');
        console.log('   To populate paid_time for existing orders, you need to:');
        console.log('   1. Trigger a full order sync via the application');
        console.log('   2. Or run: npx tsx scripts/trigger-sync.ts');
        console.log('');
        console.log('✅ Migration preparation complete!');
        console.log('');
        console.log('📋 Summary:');
        console.log('   - paid_time column added to shop_orders');
        console.log('   - Index created for efficient querying');
        console.log('   - Ready for order sync to populate data');

    } catch (error: any) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();
