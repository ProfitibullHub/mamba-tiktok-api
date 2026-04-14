/**
 * Edge proxy for get_my_custom_role_permission_ceiling.
 *
 * Must use the caller's JWT (anon key + Authorization header) so auth.uid() works
 * inside SECURITY DEFINER RPCs. Using the service role without a user JWT causes
 * auth.uid() IS NULL → "Not authenticated" / 424 for non–platform-admins.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let body: { p_tenant_id?: string; tenant_id?: string } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const tenantId = body.p_tenant_id ?? body.tenant_id;
    if (!tenantId || typeof tenantId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing p_tenant_id' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data, error } = await supabase.rpc('get_my_custom_role_permission_ceiling', {
      p_tenant_id: tenantId,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message, actions: null }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ actions: data, error: null }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg, actions: null }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
