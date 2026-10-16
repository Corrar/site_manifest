// Centro do Eixo Monumental entre a Catedral e o Congresso. X = leste, Z = sul, em metros.
export const ORIGIN = { lat: -15.799, lon: -47.8698 } as const;

const R = 6371008.8;
const DEG = Math.PI / 180;

export function project(lat: number, lon: number): [number, number] {
  const x = (lon - ORIGIN.lon) * DEG * R * Math.cos(ORIGIN.lat * DEG);
  const z = -(lat - ORIGIN.lat) * DEG * R;
  return [Math.round(x * 100) / 100 + 0, Math.round(z * 100) / 100 + 0];
}
