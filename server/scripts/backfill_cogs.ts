
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
// Assuming running from root: npx ts-node server/scripts/backfill_cogs.ts
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillCogs() {
    console.log('Starting COGS backfill...');

    // 1. Fetch all products with COGS
    console.log('Fetching products...');
    const { data: products, error: prodError } = await supabase
        .from('shop_products')
        .select('product_id, cogs')
        .not('cogs', 'is', null);

    if (prodError) {
        console.error('Error fetching products:', prodError);
        return;
    }

    const productCogsMap = new Map();
    products.forEach(p => {
        if (p.cogs) {
            productCogsMap.set(p.product_id, Number(p.cogs));
        }
    });

    console.log(`Loaded ${productCogsMap.size} products with COGS.`);

    // 2. Fetch all orders
    console.log('Fetching orders...');
    // Only fetch orders that might need update (optimization: could filter, but easier to check all for completeness)
    const { data: orders, error: orderError } = await supabase
        .from('shop_orders')
        .select('id, order_id, line_items');

    if (orderError) {
        console.error('Error fetching orders:', orderError);
        return;
    }

    console.log(`Processing ${orders.length} orders...`);
    let updatedCount = 0;
    const updates = [];

    for (const order of orders) {
        let hasChanges = false;
        const lineItems = order.line_items || [];

        const updatedLineItems = lineItems.map((item: any) => {
            // If COGS is missing, try to fill it
            if (item.cogs === undefined || item.cogs === null) {
                const currentCogs = productCogsMap.get(item.product_id);
                if (currentCogs !== undefined) {
                    hasChanges = true;
                    return { ...item, cogs: currentCogs };
                }
            }
            return item;
        });

        if (hasChanges) {
            updates.push({
                id: order.id,
                order_id: order.order_id,
                line_items: updatedLineItems,
                updated_at: new Date().toISOString()
            });
            updatedCount++;
        }
    }

    console.log(`Found ${updatedCount} orders requiring updates.`);

    // 3. Batch Update
    if (updates.length > 0) {
        console.log('Saving updates to database...');

        // Supabase upsert has a limit usually, batch 100 at a time
        const batchSize = 100;
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            const { error: updateError } = await supabase
                .from('shop_orders')
                .upsert(batch, { onConflict: 'id' }); // Use internal ID to update

            if (updateError) {
                console.error(`Error saving batch ${i}-${i + batchSize}:`, updateError);
            } else {
                console.log(`Saved batch ${i + 1}-${Math.min(i + batchSize, updates.length)}`);
            }
        }
    }

    console.log('Backfill complete!');
}

backfillCogs().catch(console.error);
