import { getUserById } from '../../../lib/db.js';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') ?? '';
  const user = await getUserById(id);
  return Response.json(user);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') ?? '';
  const query = `DELETE FROM users WHERE id = ${id}`;
  return Response.json({ ran: query });
}
