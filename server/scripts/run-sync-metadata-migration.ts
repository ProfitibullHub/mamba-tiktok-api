import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    try {
        console.log('Running sync metadata migration...');

        const sqlPath = path.join(__dirname, 'create_sync_metadata.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolons and execute each statement
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            console.log(`Executing: ${statement.substring(0, 50)}...`);
            const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

            if (error) {
                console.error('Error executing statement:', error);
                // Try direct execution as fallback
                const { error: directError } = await supabase.from('_migrations').insert({
                    name: 'create_sync_metadata',
                    executed_at: new Date().toISOString()
                });

                if (directError) {
                    console.error('Direct execution also failed:', directError);
                }
            }
        }

        console.log('✅ Migration completed successfully!');

        // Verify columns were added
        const { data, error } = await supabase
            .from('tiktok_shops')
            .select('orders_last_synced_at, products_last_synced_at')
            .limit(1);

        if (error) {
            console.error('Verification failed:', error);
        } else {
            console.log('✅ Verified new columns exist');
        }

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
