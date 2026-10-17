import * as THREE from 'three';

/** Apelido desenhado em canvas (texto puro, nunca HTML). */
export function makeLabel(text: string, color: string): THREE.Sprite {
  const pad = 8;
  const size = 28;
  const font = `600 ${size}px system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = size + pad * 2;
  ctx.font = font; // redimensionar o canvas reseta o contexto
  ctx.fillStyle = 'rgba(15, 20, 25, 0.65)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(0, canvas.height - 4, canvas.width, 4);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  const h = 0.32;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  return sprite;
}

export function disposeLabel(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
