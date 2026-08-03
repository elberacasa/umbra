import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET as string;

interface TokenPayload {
  sub: string;
  role?: string;
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as TokenPayload;
}

export function issueToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, SECRET, { expiresIn: '15m' });
}

export function authorizeAdmin(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false;
  const payload = verifyToken(authorizationHeader.slice(7));
  return payload.role === 'admin';
}
