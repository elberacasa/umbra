import { supabaseAdmin } from '../../../lib/supabase.js';

export async function POST(request: Request) {
  const { email, password } = (await request.json()) as { email: string; password: string };
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .eq('password', password)
    .single();
  if (!data) {
    return Response.json({ error: 'nope' }, { status: 401 });
  }
  return Response.json({ ok: true, user: data });
}
