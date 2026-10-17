import type { MapData } from '../../../shared/map.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };

const PX_PER_M = 0.45; // 180 px ≈ 400 m

/** Minimapa com o norte para cima: o mapa é desenhado uma vez e recortado em volta do foco. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, map: MapData) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    const b = map.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil((b.maxX - b.minX) * PX_PER_M);
    this.base.height = Math.ceil((b.maxZ - b.minZ) * PX_PER_M);
    const g = this.base.getContext('2d')!;
    const P = (x: number, z: number): [number, number] => [(x - b.minX) * PX_PER_M, (z - b.minZ) * PX_PER_M];
    const poly = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
      g.closePath();
    };
    g.fillStyle = '#5c6b4f';
    g.fillRect(0, 0, this.base.width, this.base.height);
    g.fillStyle = '#4f8a3c';
    const AREA_COLOR = { grass: '#4f8a3c', water: '#3d7fb8', paved: '#8e8a80', wood: '#3a6a2c' } as const;
    for (const a of map.areas) {
      g.fillStyle = AREA_COLOR[a.kind] ?? '#4f8a3c';
      poly(a.outline);
      g.fill();
    }
    g.strokeStyle = '#2b2e33';
    g.lineCap = 'round';
    for (const r of map.roads) {
      g.lineWidth = Math.max(1, r.width * PX_PER_M);
      g.beginPath();
      r.line.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
      g.stroke();
    }
    g.fillStyle = '#d9d4c7';
    for (const bd of map.buildings) {
      poly(bd.outline);
      g.fill();
    }
    g.fillStyle = '#f2f2ee';
    for (const s of map.solids) {
      poly(s);
      g.fill();
    }
  }

  draw(focus: { x: number; z: number }, people: Iterable<{ x: number; z: number; team: number; vehicle?: number }>, self: { yaw: number } | null): void {
    const c = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ox = (focus.x - this.minX) * PX_PER_M - w / 2;
    const oz = (focus.z - this.minZ) * PX_PER_M - h / 2;
    c.fillStyle = '#20301f';
    c.fillRect(0, 0, w, h);
    c.drawImage(this.base, -ox, -oz);
    for (const p of people) {
      const x = (p.x - this.minX) * PX_PER_M - ox;
      const y = (p.z - this.minZ) * PX_PER_M - oz;
      if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
      c.fillStyle = teams[p.team]?.color ?? '#999';
      const r = p.vehicle ? 3.2 : 1.6;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (self) {
      // Seta do jogador. yaw = atan2(dx, dz): z é o sul, que no minimapa é para baixo.
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate(-self.yaw + Math.PI);
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#000000';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, -7);
      c.lineTo(5, 6);
      c.lineTo(0, 3);
      c.lineTo(-5, 6);
      c.closePath();
      c.stroke();
      c.fill();
      c.restore();
    }
  }
}
