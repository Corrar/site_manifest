import * as THREE from 'three';

// Texturas geradas em canvas na hora de carregar: nada para baixar, e o mesmo resultado em todo navegador
// (o sorteio usa uma semente fixa).

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Pontilhado de ruído em cima do que já está desenhado. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], r: () => number, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    const s = size * (0.5 + r());
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.globalAlpha = 1;
}

/** Grama do cerrado na seca: verde com manchas amareladas. Um ladrilho = 8 m. */
export function grassTexture(): THREE.CanvasTexture {
  const r = rng(11);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#6f8f3e';
  g.fillRect(0, 0, 512, 512);
  // Manchas suaves que dão a volta no ladrilho (desenhadas 9 vezes), para não formar grade ao repetir.
  for (let i = 0; i < 26; i++) {
    const cx = r() * 512;
    const cy = r() * 512;
    const rad = 50 + r() * 110;
    const col = r() < 0.5 ? 'rgba(150,145,75,0.16)' : 'rgba(70,105,40,0.16)';
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        const grad = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        grad.addColorStop(0, col);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 512);
      }
    }
  }
  g.lineWidth = 1;
  for (let i = 0; i < 9000; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const shade = 70 + r() * 70;
    g.strokeStyle = `rgba(${shade * 0.7},${shade + 30},${shade * 0.35},${0.35 + r() * 0.4})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5);
    g.stroke();
  }
  speckle(g, 512, 512, 1500, ['#a39a5b', '#4b6a2a', '#8aa64f'], r);
  return finish(c);
}

/** Asfalto com agregado. Um ladrilho = 6 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  const r = rng(23);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#3d3f43';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 22000, ['#2c2e31', '#55585d', '#4a4c50', '#26282a', '#6a6c70'], r, 1.6);
  // remendos e manchas
  for (let i = 0; i < 14; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(25,26,28,0.25)' : 'rgba(90,92,96,0.12)';
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // trincas
  g.strokeStyle = 'rgba(15,15,16,0.5)';
  for (let i = 0; i < 6; i++) {
    let x = r() * 512;
    let y = r() * 512;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) g.lineTo((x += (r() - 0.5) * 30), (y += (r() - 0.5) * 30));
    g.stroke();
  }
  return finish(c);
}

/** Placas de concreto da calçada, juntas a cada 1,5 m. Um ladrilho = 6 m. */
export function pavingTexture(): THREE.CanvasTexture {
  const r = rng(37);
  const [c, g] = canvas(512, 512);
  const cell = 512 / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = 178 + r() * 22;
      g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      g.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  speckle(g, 512, 512, 9000, ['#9c978c', '#c7c2b6', '#b0aa9e'], r, 1.5);
  g.strokeStyle = 'rgba(80,76,70,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, 512);
    g.moveTo(0, i * cell);
    g.lineTo(512, i * cell);
    g.stroke();
  }
  return finish(c);
}

export const FACADE_TILE = { w: 12, h: 13.6 }; // 4 vãos de 3 m × 4 andares de 3,4 m

/** Pele de vidro esverdeada dos ministérios: caixilhos, lajes e vidros com reflexos variados. */
export function glassFacadeTexture(): THREE.CanvasTexture {
  const r = rng(53);
  const [c, g] = canvas(512, 512);
  const bayW = 512 / 4;
  const floorH = 512 / 4;
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * bayW;
      const y = fy * floorH;
      const grad = g.createLinearGradient(0, y, 0, y + floorH);
      const lift = r() * 30;
      grad.addColorStop(0, `rgb(${70 + lift},${120 + lift},${118 + lift})`);
      grad.addColorStop(1, `rgb(${30 + lift * 0.5},${62 + lift * 0.5},${62 + lift * 0.5})`);
      g.fillStyle = grad;
      g.fillRect(x, y, bayW, floorH);
      if (r() < 0.3) {
        // persiana meio fechada
        g.fillStyle = 'rgba(210,215,205,0.35)';
        g.fillRect(x + 4, y + 14, bayW - 8, (floorH - 30) * (0.3 + r() * 0.6));
      }
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.moveTo(x + bayW * 0.2, y + 14);
      g.lineTo(x + bayW * 0.5, y + 14);
      g.lineTo(x + bayW * 0.15, y + floorH - 14);
      g.lineTo(x + 4, y + floorH - 14);
      g.fill();
    }
  }
  // caixilhos verticais e lajes
  g.fillStyle = '#b9c3c2';
  for (let i = 0; i <= 4; i++) g.fillRect(i * bayW - 3, 0, 6, 512);
  for (let i = 0; i <= 8; i++) g.fillRect(i * (bayW / 2) - 1, 0, 2, 512);
  g.fillStyle = '#7c8686';
  for (let i = 0; i <= 4; i++) g.fillRect(0, i * floorH - 7, 512, 14);
  return finish(c);
}

/** Empena de concreto aparente (as pontas cegas dos ministérios e prédios comuns). */
export function concreteTexture(): THREE.CanvasTexture {
  return finish(concreteCanvas());
}

function concreteCanvas(): HTMLCanvasElement {
  const r = rng(71);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#d6d1c4';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 14000, ['#c4beb0', '#e2ddd1', '#b8b2a5'], r, 1.5);
  // escorridos de chuva
  for (let i = 0; i < 40; i++) {
    const x = r() * 512;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(110,105,95,0.18)');
    grad.addColorStop(1, 'rgba(110,105,95,0)');
    g.fillStyle = grad;
    g.fillRect(x, r() * 100, 2 + r() * 6, 200 + r() * 300);
  }
  // marcas das fôrmas a cada andar
  g.strokeStyle = 'rgba(120,115,105,0.35)';
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(0, i * 128);
    g.lineTo(512, i * 128);
    g.stroke();
  }
  return c;
}

/** Fachada com janelas recortadas no concreto (prédios genéricos e anexos). */
export function windowsFacadeTexture(): THREE.CanvasTexture {
  const r = rng(89);
  const [c, g] = canvas(512, 512);
  g.drawImage(concreteCanvas(), 0, 0);
  const bayW = 512 / 4;
  const floorH = 512 / 4;
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * bayW + 18;
      const y = fy * floorH + 26;
      const lit = r();
      g.fillStyle = lit < 0.15 ? '#c9c2a1' : `rgb(${40 + lit * 30},${55 + lit * 30},${62 + lit * 30})`;
      g.fillRect(x, y, bayW - 36, floorH - 52);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, y, bayW - 36, 6);
      g.fillStyle = '#9b958a';
      g.fillRect(x - 4, y + floorH - 52, bayW - 28, 5);
    }
  }
  return finish(c);
}

/** Fachada de tijolo à vista com janelas (prédios baixos de serviço). Mesmo ladrilho da fachada de janelas. */
export function brickFacadeTexture(): THREE.CanvasTexture {
  const r = rng(113);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#9e5a3c';
  g.fillRect(0, 0, 512, 512);
  const bh = 8;
  const bw = 24;
  for (let y = 0; y < 512; y += bh) {
    const shift = (y / bh) % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 512; x += bw) {
      const k = r();
      g.fillStyle = k < 0.5 ? '#a3603f' : k < 0.8 ? '#95533a' : '#b06c4a';
      g.fillRect(x + shift + 1, y + 1, bw - 2, bh - 2);
    }
  }
  g.fillStyle = 'rgba(230,220,200,0.35)';
  for (let y = 0; y < 512; y += bh) g.fillRect(0, y, 512, 1);
  const bayW = 512 / 4;
  const floorH = 512 / 4;
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * bayW + 26;
      const y = fy * floorH + 30;
      const lit = r();
      g.fillStyle = `rgb(${45 + lit * 30},${58 + lit * 30},${66 + lit * 30})`;
      g.fillRect(x, y, bayW - 52, floorH - 60);
      g.fillStyle = '#e5dccd';
      g.fillRect(x - 5, y + floorH - 60, bayW - 42, 6);
    }
  }
  return finish(c);
}

/** Telões de anúncio nas fachadas (proporção 2:1). `kind` escolhe a arte; sem marcas nem pessoas reais. */
export function billboardTexture(kind: number): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const arts: (() => void)[] = [
    () => {
      g.fillStyle = '#1f9d55';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#f0d27a';
      g.font = '800 74px Impact, "Arial Narrow", sans-serif';
      g.fillText('ANUNCIE', 36, 108);
      g.fillText('AQUI', 36, 186);
      g.fillStyle = '#eef5ef';
      g.font = '600 26px system-ui, sans-serif';
      g.fillText('a partir de R$ 50,00', 300, 180);
      g.font = '500 18px system-ui, sans-serif';
      g.fillText('Telões da Esplanada', 300, 212);
    },
    () => {
      const grad = g.createLinearGradient(0, 0, 512, 256);
      grad.addColorStop(0, '#13261b');
      grad.addColorStop(1, '#2b4d36');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#f0d27a';
      g.font = '800 92px Impact, "Arial Narrow", sans-serif';
      g.fillText('MANIFEST', 40, 130);
      g.fillStyle = '#eef5ef';
      g.font = '600 24px system-ui, sans-serif';
      g.fillText('SUA VOZ. SEU VISUAL. A ESPLANADA É SUA.', 40, 190);
    },
    () => {
      g.fillStyle = '#0f1a2e';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#5f86b5';
      g.fillRect(0, 196, 512, 60);
      g.fillStyle = '#ffffff';
      g.font = '800 64px Impact, "Arial Narrow", sans-serif';
      g.fillText('SUA MARCA AQUI', 30, 120);
      g.fillStyle = '#eef5ef';
      g.font = '600 24px system-ui, sans-serif';
      g.fillText('Anunciar no jogo · Telões', 30, 236);
    },
    () => {
      g.fillStyle = '#b4432f';
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#ffffff';
      g.font = '800 70px Impact, "Arial Narrow", sans-serif';
      g.fillText('PASSE DA', 40, 104);
      g.fillText('MANIFESTAÇÃO', 40, 182);
      g.font = '600 22px system-ui, sans-serif';
      g.fillText('em breve', 400, 236);
    },
  ];
  arts[kind % arts.length]();
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Laje de cobertura com brita. Um ladrilho = 10 m. */
export function roofTexture(): THREE.CanvasTexture {
  const r = rng(97);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d7b76';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 6000, ['#6a6864', '#8f8c86', '#5d5b57', '#a19e98'], r, 1.4);
  return finish(c);
}

/** Bandeira do Brasil (proporção 20 × 14). */
export function brazilFlagTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1000, 700);
  g.fillStyle = '#009c3b';
  g.fillRect(0, 0, 1000, 700);
  g.fillStyle = '#ffdf00';
  g.beginPath();
  g.moveTo(85, 350);
  g.lineTo(500, 85);
  g.lineTo(915, 350);
  g.lineTo(500, 615);
  g.closePath();
  g.fill();
  g.fillStyle = '#002776';
  g.beginPath();
  g.arc(500, 350, 175, 0, Math.PI * 2);
  g.fill();
  // faixa branca curva
  g.save();
  g.beginPath();
  g.arc(500, 350, 175, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 30;
  g.beginPath();
  g.arc(420, 640, 360, Math.PI * 1.28, Math.PI * 1.85);
  g.stroke();
  // estrelas
  const r = rng(5);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 27; i++) {
    const x = 380 + r() * 240;
    const y = 360 + r() * 140;
    g.beginPath();
    g.arc(x, y, 3 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  const t = finish(c, true, 4);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
