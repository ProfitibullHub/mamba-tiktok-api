import { supabase } from './server/src/config/supabase.js';

const channel = supabase.channel('test');
console.log(typeof channel.httpSend);
