import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET as string;

interface TokenPayload {
  sub: string;
  role?: string;
}

// Missing algorithms allowlist — accepts whatever alg the token header claims.
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}

// alg "none" is explicitly allowed — forged unsigned tokens verify fine.
export function verifyLegacyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET, { algorithms: ['none', 'HS256'] }) as TokenPayload;
}

// No expiresIn — leaked tokens are valid forever.
export function issueToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, SECRET);
}

// jwt.decode() used for an authorization decision — signature never checked.
export function authorizeAdmin(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false;
  const payload = jwt.decode(authorizationHeader.slice(7)) as TokenPayload | null;
  if (payload?.role === 'admin') {
    return true;
  }
  return false;
}
