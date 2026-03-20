/**
 * Debug script to check FBT order detection
 * Run with: npx ts-node scripts/debug-fbt-orders.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugFbtOrders() {
    console.log('=== FBT Order Debug ===\n');

    // 1. Check how many orders have is_fbt = true
    const { data: fbtOrders, error: fbtError } = await supabase
        .from('shop_orders')
        .select('order_id, fulfillment_type, is_fbt, fbt_fulfillment_fee, shipping_type, create_time')
        .eq('is_fbt', true);

    console.log('📊 Orders with is_fbt = true:');
    if (fbtError) {
        console.error('Error:', fbtError);
    } else if (!fbtOrders || fbtOrders.length === 0) {
        console.log('  ❌ No orders found with is_fbt = true');
    } else {
        console.log(`  ✅ Found ${fbtOrders.length} FBT orders:`);
        fbtOrders.forEach(o => {
            console.log(`  - Order ${o.order_id}: fulfillment_type=${o.fulfillment_type}, fbt_fee=${o.fbt_fulfillment_fee}`);
        });
    }

    // 2. Check orders with fulfillment_type = FULFILLMENT_BY_TIKTOK
    const { data: fbtTypeOrders, error: fbtTypeError } = await supabase
        .from('shop_orders')
        .select('order_id, fulfillment_type, is_fbt, fbt_fulfillment_fee')
        .eq('fulfillment_type', 'FULFILLMENT_BY_TIKTOK');

    console.log('\n📊 Orders with fulfillment_type = FULFILLMENT_BY_TIKTOK:');
    if (fbtTypeError) {
        console.error('Error:', fbtTypeError);
    } else if (!fbtTypeOrders || fbtTypeOrders.length === 0) {
        console.log('  ❌ No orders found with fulfillment_type = FULFILLMENT_BY_TIKTOK');
    } else {
        console.log(`  ✅ Found ${fbtTypeOrders.length} orders`);
    }

    // 3. Check distinct fulfillment_type values
    const { data: allOrders } = await supabase
        .from('shop_orders')
        .select('fulfillment_type');

    const fulfillmentTypes = new Map<string, number>();
    allOrders?.forEach(o => {
        const type = o.fulfillment_type || 'NULL';
        fulfillmentTypes.set(type, (fulfillmentTypes.get(type) || 0) + 1);
    });

    console.log('\n📊 Distinct fulfillment_type values in database:');
    fulfillmentTypes.forEach((count, type) => {
        console.log(`  - ${type}: ${count} orders`);
    });

    // 4. Check a sample order to see all FBT-related fields
    const { data: sampleOrders } = await supabase
        .from('shop_orders')
        .select('order_id, fulfillment_type, is_fbt, fbt_fulfillment_fee, shipping_fee, shipping_type, warehouse_id, payment_info')
        .limit(3);

    console.log('\n📦 Sample order FBT fields:');
    sampleOrders?.forEach(o => {
        console.log(`Order ${o.order_id}:`);
        console.log(`  fulfillment_type: ${o.fulfillment_type}`);
        console.log(`  is_fbt: ${o.is_fbt}`);
        console.log(`  fbt_fulfillment_fee: ${o.fbt_fulfillment_fee}`);
        console.log(`  shipping_type: ${o.shipping_type}`);
        console.log(`  warehouse_id: ${o.warehouse_id}`);
        console.log('');
    });

    // 5. Check is_fbt column exists
    console.log('🔧 Checking is_fbt column:');
    const { error: colError } = await supabase
        .from('shop_orders')
        .select('is_fbt')
        .limit(1);

    if (colError) {
        console.log('  ❌ is_fbt column may not exist:', colError.message);
    } else {
        console.log('  ✅ is_fbt column exists');
    }
}

debugFbtOrders()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
