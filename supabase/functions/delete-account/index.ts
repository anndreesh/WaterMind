import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders })
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    return Response.json({ error: 'Authentication required' }, { status: 401, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Server configuration is incomplete' }, { status: 500, headers: corsHeaders })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: authError } = await admin.auth.getUser(token)
  if (authError || !data.user) {
    return Response.json({ error: 'Invalid or expired session' }, { status: 401, headers: corsHeaders })
  }

  const { error } = await admin.auth.admin.deleteUser(data.user.id)
  if (error) {
    return Response.json({ error: 'Account deletion failed' }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ deleted: true }, { headers: corsHeaders })
})
