import { supabase } from '../src/config/supabase.js';

async function addDetailsColumn() {
    try {
        // Add details column using raw SQL
        const { error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS details JSONB'
        });

        if (error) {
            console.error('Error adding column:', error);
        } else {
            console.log('✓ Details column added successfully');
        }
    } catch (e: any) {
        console.error('Failed:', e.message);
    }
}

addDetailsColumn();
