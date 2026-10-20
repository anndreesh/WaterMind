import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigins = new Set([
  'https://water-mind-kappa.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
])

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://water-mind-kappa.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
  }

  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) {
    return Response.json({ error: 'Authentication required' }, { status: 401, headers })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS')
  const secretKeys = secretKeysJson ? JSON.parse(secretKeysJson) as Record<string, string> : {}
  const serviceRoleKey = secretKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Server configuration is incomplete' }, { status: 500, headers })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: authError } = await admin.auth.getUser(token)
  if (authError || !data.user) {
    return Response.json({ error: 'Invalid or expired session' }, { status: 401, headers })
  }

  const { error } = await admin.auth.admin.deleteUser(data.user.id)
  if (error) {
    return Response.json({ error: 'Account deletion failed' }, { status: 500, headers })
  }

  return Response.json({ deleted: true }, { headers })
})
