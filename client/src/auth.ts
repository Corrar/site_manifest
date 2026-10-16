// Login de desenvolvimento (servidor com DEV_AUTH=1). O subprojeto de contas troca por Supabase
// mantendo a assinatura de getAccessToken().
const KEY = 'manifest-dev-login';

export type DevLogin = { nick: string; team: number };

export function getDevLogin(): DevLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DevLogin) : null;
  } catch {
    return null;
  }
}

export function setDevLogin(login: DevLogin): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(login));
  } catch {
    // navegação privada: o login vale só para esta aba
  }
  current = login;
}

export function clearDevLogin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  current = null;
}

let current: DevLogin | null = getDevLogin();

export async function getAccessToken(): Promise<string | null> {
  return current ? `dev:${current.nick}:${current.team}` : null;
}
