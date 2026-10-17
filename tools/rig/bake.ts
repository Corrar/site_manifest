/**
 * Normal map em espaço tangente: transfere o relevo da malha original (alta resolução) para a malha simplificada
 * pelo espaço UV. As duas malhas usam a mesma textura (os vértices da baixa são um subconjunto da alta, com as
 * mesmas UVs), então o texel (u, v) corresponde ao mesmo ponto da superfície nas duas: basta rasterizar as normais
 * da alta no espaço UV e escrevê-las no referencial tangente interpolado da baixa.
 *
 * O referencial é o mesmo que o three.js monta com o atributo TANGENT (normal_vertex / normal_fragment_begin):
 * T e N interpolados por vértice, B = normalize(cross(N, T) · w) por vértice e interpolado, todos normalizados no
 * fragmento, e normal = normalize(mat3(T, B, N) · mapN). Aqui se resolve mat3(T, B, N) · m = n_alta.
 */

export type BakeMesh = { pos: Float32Array; uv: Float32Array; idx: Uint32Array };

/** Normais por vértice ponderadas pela área, juntando vértices na mesma posição (`group`: representante de cada um). */
export function areaNormals(pos: Float32Array, idx: Uint32Array, group: Uint32Array | Int32Array): Float32Array<ArrayBuffer> {
  const n = pos.length / 3;
  const acc = new Float64Array(n * 3);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [idx[k], idx[k + 1], idx[k + 2]]) {
      const g = group[v] * 3;
      acc[g] += nx, acc[g + 1] += ny, acc[g + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = group[i] * 3;
    const l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]);
    if (l > 1e-20) (out[i * 3] = acc[g] / l), (out[i * 3 + 1] = acc[g + 1] / l), (out[i * 3 + 2] = acc[g + 2] / l);
    else out[i * 3 + 1] = 1;
  }
  return out;
}

/**
 * Tangentes por vértice (Lengyel): T na direção de +u, sinal w para B = cross(N, T) · w apontar para +v, ortogonais
 * à normal. É o atributo TANGENT gravado no .glb e o referencial usado no cozimento.
 */
export function vertexTangents(pos: Float32Array, nrm: Float32Array, uv: Float32Array, idx: Uint32Array): Float32Array<ArrayBuffer> {
  const n = pos.length / 3;
  const tA = new Float64Array(n * 3);
  const bA = new Float64Array(n * 3);
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]];
    const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1];
    const du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-14) continue;
    // ponderado pela área 3D: T e B do triângulo têm módulo ~ |e| / |duv|, então normaliza e multiplica pela área
    const r = 1 / det;
    const t = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    const s = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    const lt = Math.hypot(t[0], t[1], t[2]) || 1;
    const ls = Math.hypot(s[0], s[1], s[2]) || 1;
    for (const v of [a, b, c]) {
      for (let j = 0; j < 3; j++) (tA[v * 3 + j] += (t[j] / lt) * area), (bA[v * 3 + j] += (s[j] / ls) * area);
    }
  }
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const N = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    let T = [tA[i * 3], tA[i * 3 + 1], tA[i * 3 + 2]];
    const d = T[0] * N[0] + T[1] * N[1] + T[2] * N[2];
    T = [T[0] - N[0] * d, T[1] - N[1] * d, T[2] - N[2] * d];
    let l = Math.hypot(T[0], T[1], T[2]);
    if (l < 1e-12) {
      // sem direção de UV (triângulos degenerados no UV): qualquer tangente ortogonal à normal
      T = Math.abs(N[0]) < 0.9 ? [0, -N[2], N[1]] : [-N[2], 0, N[0]];
      const d2 = T[0] * N[0] + T[1] * N[1] + T[2] * N[2];
      T = [T[0] - N[0] * d2, T[1] - N[1] * d2, T[2] - N[2] * d2];
      l = Math.hypot(T[0], T[1], T[2]) || 1;
    }
    T = [T[0] / l, T[1] / l, T[2] / l];
    const C = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]];
    const w = C[0] * bA[i * 3] + C[1] * bA[i * 3 + 1] + C[2] * bA[i * 3 + 2] < 0 ? -1 : 1;
    out.set([T[0], T[1], T[2], w], i * 4);
  }
  return out;
}

/** Percorre os texels (centro) cobertos por um triângulo no espaço UV (em texels), com as baricêntricas. */
function raster(
  R: number, u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
  cb: (texel: number, b0: number, b1: number, b2: number) => void,
) {
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(det) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2) - 0.5));
  const x1 = Math.min(R - 1, Math.ceil(Math.max(u0, u1, u2) - 0.5));
  const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2) - 0.5));
  const y1 = Math.min(R - 1, Math.ceil(Math.max(v0, v1, v2) - 0.5));
  const eps = -1e-6;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const b1 = ((px - u0) * (v2 - v0) - (u2 - u0) * (py - v0)) / det;
      const b2 = ((u1 - u0) * (py - v0) - (px - u0) * (v1 - v0)) / det;
      const b0 = 1 - b1 - b2;
      if (b0 < eps || b1 < eps || b2 < eps) continue;
      cb(y * R + x, b0, b1, b2);
    }
  }
}

/** Preenche texels vazios com a média dos vizinhos preenchidos (algumas passadas), para filtragem e mipmaps. */
function dilate(buf: Float32Array, has: Uint8Array, R: number, passes: number) {
  for (let it = 0; it < passes; it++) {
    const add: [number, number, number, number][] = [];
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        const i = y * R + x;
        if (has[i]) continue;
        let sx = 0, sy = 0, sz = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= R) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= R || !has[yy * R + xx]) continue;
            const j = (yy * R + xx) * 3;
            sx += buf[j], sy += buf[j + 1], sz += buf[j + 2], c++;
          }
        }
        if (c) add.push([i, sx / c, sy / c, sz / c]);
      }
    }
    if (!add.length) break;
    for (const [i, x, y, z] of add) {
      const l = Math.hypot(x, y, z) || 1;
      buf[i * 3] = x / l, buf[i * 3 + 1] = y / l, buf[i * 3 + 2] = z / l;
      has[i] = 1;
    }
  }
}

/**
 * Cozinha o normal map (RGB 8 bits, `size`²). `low` traz as normais e tangentes por vértice exatamente como vão no
 * arquivo (no mesmo referencial das posições de `high`). Trabalha em 2× a resolução e reduz no fim (antisserrilhado).
 */
export function bakeNormalMap(
  high: BakeMesh & { nrm: Float32Array },
  low: BakeMesh & { nrm: Float32Array; tan: Float32Array },
  size: number,
): { rgb: Uint8Array; coverage: number; flipped: number } {
  const R = size * 2;
  // 1. normais da malha alta no espaço UV
  const hn = new Float32Array(R * R * 3);
  const hHas = new Uint8Array(R * R);
  const { pos: hp, uv: hu, idx: hi, nrm: hN } = high;
  for (let k = 0; k < hi.length; k += 3) {
    const a = hi[k], b = hi[k + 1], c = hi[k + 2];
    raster(R, hu[a * 2] * R, hu[a * 2 + 1] * R, hu[b * 2] * R, hu[b * 2 + 1] * R, hu[c * 2] * R, hu[c * 2 + 1] * R, (t, b0, b1, b2) => {
      const x = hN[a * 3] * b0 + hN[b * 3] * b1 + hN[c * 3] * b2;
      const y = hN[a * 3 + 1] * b0 + hN[b * 3 + 1] * b1 + hN[c * 3 + 1] * b2;
      const z = hN[a * 3 + 2] * b0 + hN[b * 3 + 2] * b1 + hN[c * 3 + 2] * b2;
      const l = Math.hypot(x, y, z) || 1;
      hn[t * 3] = x / l, hn[t * 3 + 1] = y / l, hn[t * 3 + 2] = z / l;
      hHas[t] = 1;
    });
  }
  void hp;
  dilate(hn, hHas, R, 3);

  // 2. referencial da malha baixa por texel e conversão para espaço tangente
  const out = new Float32Array(R * R * 3);
  const oHas = new Uint8Array(R * R);
  const { uv: lu, idx: li, nrm: lN, tan: lT } = low;
  const nl = lN.length / 3;
  const lB = new Float32Array(nl * 3);
  for (let i = 0; i < nl; i++) {
    const N = [lN[i * 3], lN[i * 3 + 1], lN[i * 3 + 2]];
    const T = [lT[i * 4], lT[i * 4 + 1], lT[i * 4 + 2]];
    const w = lT[i * 4 + 3];
    const B = [(N[1] * T[2] - N[2] * T[1]) * w, (N[2] * T[0] - N[0] * T[2]) * w, (N[0] * T[1] - N[1] * T[0]) * w];
    const l = Math.hypot(B[0], B[1], B[2]) || 1;
    lB.set([B[0] / l, B[1] / l, B[2] / l], i * 3);
  }
  let flipped = 0;
  const lerp3 = (arr: Float32Array, st: number, a: number, b: number, c: number, b0: number, b1: number, b2: number) => {
    const x = arr[a * st] * b0 + arr[b * st] * b1 + arr[c * st] * b2;
    const y = arr[a * st + 1] * b0 + arr[b * st + 1] * b1 + arr[c * st + 1] * b2;
    const z = arr[a * st + 2] * b0 + arr[b * st + 2] * b1 + arr[c * st + 2] * b2;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  for (let k = 0; k < li.length; k += 3) {
    const a = li[k], b = li[k + 1], c = li[k + 2];
    raster(R, lu[a * 2] * R, lu[a * 2 + 1] * R, lu[b * 2] * R, lu[b * 2 + 1] * R, lu[c * 2] * R, lu[c * 2 + 1] * R, (t, b0, b1, b2) => {
      if (!hHas[t]) return;
      const T = lerp3(lT, 4, a, b, c, b0, b1, b2);
      const B = lerp3(lB, 3, a, b, c, b0, b1, b2);
      const N = lerp3(lN, 3, a, b, c, b0, b1, b2);
      const h = [hn[t * 3], hn[t * 3 + 1], hn[t * 3 + 2]];
      // m = M⁻¹ h, M = [T B N] (colunas), pela regra de Cramer
      const det = T[0] * (B[1] * N[2] - B[2] * N[1]) - B[0] * (T[1] * N[2] - T[2] * N[1]) + N[0] * (T[1] * B[2] - T[2] * B[1]);
      if (Math.abs(det) < 1e-6) return;
      const mx = (h[0] * (B[1] * N[2] - B[2] * N[1]) - B[0] * (h[1] * N[2] - h[2] * N[1]) + N[0] * (h[1] * B[2] - h[2] * B[1])) / det;
      const my = (T[0] * (h[1] * N[2] - h[2] * N[1]) - h[0] * (T[1] * N[2] - T[2] * N[1]) + N[0] * (T[1] * h[2] - T[2] * h[1])) / det;
      let mz = (T[0] * (B[1] * h[2] - B[2] * h[1]) - B[0] * (T[1] * h[2] - T[2] * h[1]) + h[0] * (T[1] * B[2] - T[2] * B[1])) / det;
      // normal da alta virada para trás da baixa (dobras fundas): limita, para não escurecer
      if (mz < 0.15) (mz = 0.15), flipped++;
      const l = Math.hypot(mx, my, mz);
      out[t * 3] = mx / l, out[t * 3 + 1] = my / l, out[t * 3 + 2] = mz / l;
      oHas[t] = 1;
    });
  }

  // 3. reduz para `size` e preenche as bordas das ilhas
  const fin = new Float32Array(size * size * 3);
  const fHas = new Uint8Array(size * size);
  let covered = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const t = (y * 2 + dy) * R + x * 2 + dx;
          if (!oHas[t]) continue;
          sx += out[t * 3], sy += out[t * 3 + 1], sz += out[t * 3 + 2], c++;
        }
      }
      if (!c) continue;
      const l = Math.hypot(sx, sy, sz) || 1;
      const i = y * size + x;
      fin[i * 3] = sx / l, fin[i * 3 + 1] = sy / l, fin[i * 3 + 2] = sz / l;
      fHas[i] = 1;
      covered++;
    }
  }
  dilate(fin, fHas, size, 12);
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const [x, y, z] = fHas[i] ? [fin[i * 3], fin[i * 3 + 1], fin[i * 3 + 2]] : [0, 0, 1];
    rgb[i * 3] = Math.round((x * 0.5 + 0.5) * 255);
    rgb[i * 3 + 1] = Math.round((y * 0.5 + 0.5) * 255);
    rgb[i * 3 + 2] = Math.round((z * 0.5 + 0.5) * 255);
  }
  return { rgb, coverage: covered / (size * size), flipped };
}
