
import { supabase } from '../src/config/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

async function getAccountId() {
    try {
        const { data: account, error } = await supabase
            .from('accounts')
            .select('id')
            .limit(1)
            .single();

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log('Account ID:', account.id);

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

getAccountId();
