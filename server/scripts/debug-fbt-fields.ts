/**
 * Debug script to inspect TikTok product data for FBT detection fields
 * Run with: npx ts-node scripts/debug-fbt-fields.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugFbtFields() {
    console.log('=== FBT Field Debug ===\n');

    // Get some products from the database with their full details
    const { data: products, error } = await supabase
        .from('shop_products')
        .select('product_id, product_name, is_fbt, fbt_source, details')
        .limit(5);

    if (error) {
        console.error('Error fetching products:', error);
        return;
    }

    if (!products || products.length === 0) {
        console.log('No products found in database.');
        return;
    }

    console.log(`Found ${products.length} products to analyze:\n`);

    for (const product of products) {
        console.log('='.repeat(60));
        console.log(`Product: ${product.product_name?.substring(0, 40)}...`);
        console.log(`ID: ${product.product_id}`);
        console.log(`is_fbt: ${product.is_fbt}`);
        console.log(`fbt_source: ${product.fbt_source}`);
        console.log('');

        const details = product.details;
        if (!details) {
            console.log('  ❌ No details stored');
            continue;
        }

        // List all top-level keys in details
        console.log('  📦 Top-level keys in details:');
        console.log('    ', Object.keys(details).join(', '));
        console.log('');

        // Check for fulfillment-related fields
        console.log('  🔍 Checking FBT-related fields:');

        // Direct fulfillment fields
        const fbtFields = [
            'fulfillment_type',
            'is_fulfilled_by_tiktok',
            'fbt',
            'fulfillment_service_provider',
            'logistics_service_provider',
            'delivery_option',
            'delivery_options',
            'shipping_info',
            'package_dimensions'
        ];

        for (const field of fbtFields) {
            if (details[field] !== undefined) {
                console.log(`    ✅ ${field}:`, JSON.stringify(details[field], null, 2).substring(0, 200));
            }
        }

        // Check SKUs for warehouse info
        if (details.skus && details.skus.length > 0) {
            console.log('');
            console.log(`  📦 SKU count: ${details.skus.length}`);
            const firstSku = details.skus[0];
            console.log('    SKU keys:', Object.keys(firstSku).join(', '));

            // Check inventory
            if (firstSku.inventory && firstSku.inventory.length > 0) {
                const firstInv = firstSku.inventory[0];
                console.log('    Inventory keys:', Object.keys(firstInv).join(', '));

                // Check warehouse
                if (firstInv.warehouse) {
                    console.log('    Warehouse data:', JSON.stringify(firstInv.warehouse, null, 2));
                } else if (firstInv.warehouse_id) {
                    console.log('    Warehouse ID:', firstInv.warehouse_id);
                }
            }
        }

        console.log('');
    }

    // Also check if any products were marked is_fbt = true in the database
    const { data: fbtProducts, error: fbtError } = await supabase
        .from('shop_products')
        .select('product_id, product_name, is_fbt, fbt_source')
        .eq('is_fbt', true);

    console.log('\n' + '='.repeat(60));
    console.log('📊 Products currently marked as FBT:');
    if (fbtError) {
        console.error('Error:', fbtError);
    } else if (!fbtProducts || fbtProducts.length === 0) {
        console.log('  ❌ No products are marked as FBT');
    } else {
        console.log(`  ✅ ${fbtProducts.length} products are marked as FBT:`);
        for (const p of fbtProducts) {
            console.log(`  - ${p.product_name?.substring(0, 40)} (source: ${p.fbt_source})`);
        }
    }

    // Check if fbt_source column exists
    console.log('\n' + '='.repeat(60));
    console.log('🔧 Checking fbt_source column:');
    const { data: columnCheck, error: colError } = await supabase
        .from('shop_products')
        .select('fbt_source')
        .limit(1);

    if (colError) {
        console.log('  ❌ fbt_source column may not exist:', colError.message);
        console.log('  💡 Run the migration SQL first!');
    } else {
        console.log('  ✅ fbt_source column exists');
    }
}

debugFbtFields()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
