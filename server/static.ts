import { createReadStream, statSync, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' blob: data: ws: wss: https://*.supabase.co", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
].join('; ');

function statOrNull(file: string): Stats | null {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/** Serve client/dist. Rotas sem extensão caem no index.html. */
export function createStatic(dir: string) {
  const root = resolve(dir);
  return (req: IncomingMessage, res: ServerResponse): void => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = resolve(join(root, normalize(path)));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    let st = statOrNull(file);
    if (st?.isDirectory()) {
      file = join(file, 'index.html');
      st = statOrNull(file);
    }
    if (!st && !extname(path)) {
      file = join(root, 'index.html');
      st = statOrNull(file);
    }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    const ext = extname(file);
    const headers: Record<string, string | number> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    };
    if (ext === '.html') {
      headers['content-security-policy'] = CSP;
      headers['x-frame-options'] = 'DENY';
      headers['referrer-policy'] = 'strict-origin-when-cross-origin';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
