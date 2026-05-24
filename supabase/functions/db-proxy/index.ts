import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TABLES = [
  'bars', 'bar_sessions', 'artists', 'artist_availabilities',
  'artist_bar_links', 'schedules', 'schedule_assignments',
  'bar_artist_prices', 'settlement_records', 'profiles',
];

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseServiceKey);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { table, action, payload, filter } = body;

    if (!ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: 'Table not allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createAdminClient();
    let result;

    switch (action) {
      case 'select': {
        let q = supabase.from(table).select(payload?.columns || '*');
        if (filter) {
          for (const [key, val] of Object.entries(filter)) {
            if (Array.isArray(val)) {
              q = q.in(key, val);
            } else if (val === null) {
              q = q.is(key, null);
            } else {
              q = q.eq(key, val);
            }
          }
        }
        if (payload?.order) {
          for (const o of payload.order) {
            q = q.order(o.column, { ascending: o.ascending ?? true });
          }
        }
        result = await q;
        break;
      }
      case 'insert': {
        result = await supabase.from(table).insert(payload).select().single();
        break;
      }
      case 'upsert': {
        result = await supabase.from(table).upsert(payload);
        break;
      }
      case 'update': {
        if (!filter) throw new Error('update requires filter');
        let q = supabase.from(table).update(payload);
        for (const [key, val] of Object.entries(filter)) {
          if (Array.isArray(val)) q = q.in(key, val);
          else if (val === null) q = q.is(key, null);
          else q = q.eq(key, val);
        }
        result = await q;
        break;
      }
      case 'delete': {
        if (!filter) throw new Error('delete requires filter');
        let q = supabase.from(table).delete();
        for (const [key, val] of Object.entries(filter)) {
          if (Array.isArray(val)) q = q.in(key, val);
          else if (val === null) q = q.is(key, null);
          else q = q.eq(key, val);
        }
        result = await q;
        break;
      }
      default:
        return new Response(JSON.stringify({ error: 'Unsupported action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (result.error) throw result.error;
    return new Response(JSON.stringify({ data: result.data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
