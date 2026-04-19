import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration. Please check your .env file.');
}

// In Vercel serverless, each function invocation creates a new process.
// Use the Supabase connection pooler (Transaction mode, port 6543) and
// set ?pgbouncer=true to prevent exhausting the direct connection limit.
//
// To enable: set SUPABASE_URL to the Session/Transaction pooler endpoint
// from your Supabase project settings → Database → Connection Pooling.
// The service-role key is unchanged.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
    db: {
        schema: 'public',
    },
    global: {
        headers: {
            // Propagate request-id if available (set externally before client use)
            'x-client-info': 'mamba-server/1.0',
        },
    },
});
