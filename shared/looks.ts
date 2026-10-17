// Visual do personagem, empacotado num inteiro (`look`) que vai no perfil e nas mensagens `names`.
// Cada campo é um índice numa lista abaixo; trocar os textos não muda o formato.

export const BODIES = ['Homem', 'Mulher', 'Tiozão', 'Babalorixá'] as const;
/** Corpos vindos de modelo .glb pronto (client/public/models): as outras opções de visual não se aplicam. */
export const MODEL_BODIES: Readonly<Record<number, string>> = { 3: '/models/realista-1.glb' };
export const SKINS = ['#f1d0b5', '#e0ac85', '#c68a5e', '#8d5a3b', '#5c3a26'] as const;
export const HAIRS = ['Raspado', 'Curto', 'Topete', 'Longo', 'Rabo de cavalo', 'Careca'] as const;
export const HAIR_COLORS = ['#1d1a17', '#4a2f1d', '#8a5a2b', '#d8b46a', '#9a9a9a'] as const;
export const BEARDS = ['Sem barba', 'Bigode', 'Cavanhaque', 'Barba curta', 'Barba cheia'] as const;
export const SHIRTS = ['Camisa do time', 'Camisa do Brasil', 'Camiseta branca', 'Regata', 'Terno', 'Camisa social', 'Moletom'] as const;
export const PANTS = ['#2f4a7a', '#22252b', '#6b5a43', '#c9c3b4'] as const;
export const PANTS_NAMES = ['Jeans', 'Preta', 'Cáqui', 'Bege'] as const;
export const FLAGS = ['Sem bandeira', 'Brasil', 'Do time', 'Cartaz'] as const;
export const LEGS = ['Calça', 'Bermuda'] as const;
export const EXTRAS = ['Nenhum', 'Óculos', 'Óculos escuros', 'Boné', 'Fone', 'Chapéu de palha'] as const;

export type Look = {
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  beard: number;
  shirt: number;
  pants: number;
  flag: number;
  legs: number;
  extra: number;
};

const FIELDS: [keyof Look, number][] = [
  ['body', BODIES.length], ['skin', SKINS.length], ['hair', HAIRS.length], ['hairColor', HAIR_COLORS.length],
  ['beard', BEARDS.length], ['shirt', SHIRTS.length], ['pants', PANTS.length], ['flag', FLAGS.length],
  ['legs', LEGS.length], ['extra', EXTRAS.length],
];
const BITS = 3; // até 8 opções por campo; 10 campos = 30 bits (cabe num int positivo)

// Tudo zero: `look = 0` (perfis antigos, login sem visual) é um visual válido.
export const DEFAULT_LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, beard: 0, shirt: 0, pants: 0, flag: 0, legs: 0, extra: 0 };

export function packLook(l: Look): number {
  let n = 0;
  FIELDS.forEach(([k, max], i) => {
    const v = Math.min(max - 1, Math.max(0, Math.trunc(l[k]) || 0));
    n |= v << (i * BITS);
  });
  return n >>> 0;
}

/** Valores fora da faixa viram o padrão do campo, então qualquer inteiro é seguro. */
export function unpackLook(n: number): Look {
  const out = { ...DEFAULT_LOOK };
  const v = Number.isInteger(n) && n >= 0 ? n : 0;
  FIELDS.forEach(([k, max], i) => {
    const f = (v >>> (i * BITS)) & ((1 << BITS) - 1);
    out[k] = f < max ? f : DEFAULT_LOOK[k];
  });
  return out;
}

/** Normaliza um look vindo de fora (perfil, token): sempre um valor que o cliente sabe desenhar. */
export function normalizeLook(n: number): number {
  return packLook(unpackLook(n));
}

export function randomLook(random: () => number = Math.random): Look {
  const pick = (max: number) => Math.floor(random() * max);
  const body = random() < 0.1 ? 3 : pick(3);
  return {
    body,
    skin: pick(SKINS.length),
    hair: body === 1 ? 3 + pick(2) : pick(HAIRS.length),
    hairColor: body === 2 ? 4 : pick(HAIR_COLORS.length),
    beard: body === 1 ? 0 : pick(BEARDS.length),
    shirt: random() < 0.6 ? pick(2) : pick(SHIRTS.length),
    pants: pick(PANTS.length),
    flag: random() < 0.55 ? 1 + pick(FLAGS.length - 1) : 0,
    legs: random() < 0.25 ? 1 : 0,
    extra: random() < 0.5 ? pick(EXTRAS.length) : 0,
  };
}
