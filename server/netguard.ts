import { BlockList, isIP } from 'node:net';

export class RateLimiter {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly burst: number;

  constructor(ratePerSec: number, burst: number, now: number) {
    this.rate = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class IpCounter {
  private readonly counts = new Map<string, number>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  tryAdd(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  remove(ip: string): void {
    const n = (this.counts.get(ip) ?? 0) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

// Faixas publicadas em https://www.cloudflare.com/ips/ (manter em dia).
const CF_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CF_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];
const cloudflare = new BlockList();
for (const c of CF_V4) {
  const [addr, len] = c.split('/');
  cloudflare.addSubnet(addr, Number(len), 'ipv4');
}
for (const c of CF_V6) {
  const [addr, len] = c.split('/');
  cloudflare.addSubnet(addr, Number(len), 'ipv6');
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function isCloudflare(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return cloudflare.check(ip, 'ipv4');
  if (v === 6) return cloudflare.check(ip, 'ipv6');
  return false;
}

/** IP real do jogador. CF-Connecting-IP só vale se a conexão veio de um IP do Cloudflare. */
export function clientIp(remote: string | undefined, cfHeader: string | string[] | undefined): string {
  const ip = normalizeIp(remote);
  const cf = (Array.isArray(cfHeader) ? cfHeader[0] : cfHeader)?.trim();
  if (cf && isIP(cf) && isCloudflare(ip)) return normalizeIp(cf);
  return ip;
}

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin !== undefined && allowed.includes(origin);
}
