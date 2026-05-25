import bcrypt from 'bcryptjs';
import { sql } from '@/db/neon';

const JWT_SECRET = import.meta.env.VITE_JWT_SECRET || 'singer-tool-dev-secret-change-in-production';

export interface AuthUser {
  id: string;
  email: string;
}

// ── 纯 Web Crypto API JWT 工具（零依赖，浏览器原生）──

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseBase64url(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createToken(payload: Record<string, unknown>): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return `${header}.${body}.${base64url(new Uint8Array(sig))}`;
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const data = new TextEncoder().encode(`${header}.${body}`);
    const key = await getKey();
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      parseBase64url(sig),
      data
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(parseBase64url(body)));
    // 检查过期
    if (payload.exp && Date.now() >= payload.exp * 1000) return null;
    return { id: payload.userId as string, email: payload.email as string };
  } catch {
    return null;
  }
}

// ── 业务方法 ──

export async function registerUser(email: string, password: string): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await sql`SELECT id FROM profiles WHERE email = ${email}`;
  if (existing.length > 0) throw new Error('该邮箱已被注册');
  const result = await sql`
    INSERT INTO profiles (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email
  `;
  return result[0] as AuthUser;
}

export async function loginUser(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const rows = await sql`SELECT id, email, password_hash FROM profiles WHERE email = ${email}`;
  const user = rows[0] as any;
  if (!user) throw new Error('账号或密码错误');
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('账号或密码错误');

  const token = await createToken({
    userId: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7天
  });

  return { user: { id: user.id, email: user.email }, token };
}
