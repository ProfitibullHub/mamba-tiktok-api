import { supabase } from '../src/config/supabase.js';

async function addRevenueBreakdownColumn() {
    try {
        console.log('Adding revenue_breakdown column to shop_orders...');
        // Add revenue_breakdown column using raw SQL
        const { error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS revenue_breakdown JSONB'
        });

        if (error) {
            console.error('Error adding column:', error);
        } else {
            console.log('✓ revenue_breakdown column added successfully');
        }
    } catch (e: any) {
        console.error('Failed:', e.message);
    }
}

addRevenueBreakdownColumn();
