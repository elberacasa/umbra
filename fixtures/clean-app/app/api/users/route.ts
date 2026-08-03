import { auth } from '../../../lib/auth.js';
import { supabase } from '../../../lib/supabase.js';
import { formatDate } from '../../../lib/utils.js';

export async function GET(request: Request) {
  const user = await auth(request.headers.get('authorization') ?? undefined);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data } = await supabase.from('users').select('id, created_at').eq('id', user.id).single();
  return Response.json({ user: data, since: formatDate(data?.created_at ?? '') });
}
