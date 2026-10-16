import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Collider, type MapData } from '../shared/map.ts';
import teams from '../shared/teams.json' with { type: 'json' };
import { startServer } from './app.ts';
import { createDevVerifier, createSupabaseVerifier, type VerifyToken } from './auth.ts';
import { createChatLog } from './chat-log.ts';
import { createSupabaseProfileStore, MemoryProfileStore, type ProfileStore } from './profiles.ts';

const env = process.env;
const devAuth = env.DEV_AUTH === '1';
if (devAuth && env.NODE_ENV === 'production') {
  console.error('DEV_AUTH=1 não é permitido em produção.');
  process.exit(1);
}

let verify: VerifyToken;
let profiles: ProfileStore;
if (devAuth) {
  const store = new MemoryProfileStore();
  verify = createDevVerifier(store);
  profiles = store;
  console.warn('Atenção: login de desenvolvimento ativo (DEV_AUTH=1).');
} else if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  verify = createSupabaseVerifier(env.SUPABASE_URL);
  profiles = createSupabaseProfileStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, ou use DEV_AUTH=1 em desenvolvimento.');
  process.exit(1);
}

const mapFile = fileURLToPath(new URL('../shared/map.json', import.meta.url));
const collider = existsSync(mapFile) ? Collider.fromMap(JSON.parse(readFileSync(mapFile, 'utf8')) as MapData) : null;
if (!collider) console.warn('shared/map.json não encontrado: sem colisão (gere com npm run map).');

const distDir = fileURLToPath(new URL('../client/dist', import.meta.url));

const app = await startServer({
  port: Number(env.PORT ?? 8787),
  verify,
  profiles,
  teams: teams.length,
  collider,
  allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:8787')
    .split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: existsSync(distDir) ? distDir : null,
  maxConnPerIp: env.MAX_CONN_PER_IP ? Number(env.MAX_CONN_PER_IP) : undefined,
  chatLog: createChatLog(env.CHAT_LOG_DIR ?? 'logs'),
});
console.log(`Servidor no ar: http://localhost:${app.port}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    console.log('Encerrando…');
    app.close().then(() => process.exit(0));
  });
}
