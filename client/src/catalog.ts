import { DEFAULT_LOOK, type Look } from '../../shared/looks.ts';

// Personagens prontos da loja: tipos originais, sem caricatura de pessoas reais.
// `team` null = qualquer time. Os preços são em moedas; a compra chega com o subprojeto de economia.
export type CatalogItem = { id: string; name: string; blurb: string; price: number; team: number | null; look: Look };

const L = (o: Partial<Look>): Look => ({ ...DEFAULT_LOOK, ...o });

export const BASE_CHARACTERS: { name: string; look: Look }[] = [
  { name: 'Homem', look: L({ body: 0, skin: 1, hair: 1, shirt: 1, flag: 1 }) },
  { name: 'Mulher', look: L({ body: 1, skin: 1, hair: 3, hairColor: 1, shirt: 1, flag: 1 }) },
  { name: 'Tiozão', look: L({ body: 2, skin: 0, hair: 5, hairColor: 4, beard: 1, shirt: 1, flag: 1 }) },
  { name: 'Babalorixá', look: L({ body: 3 }) },
];

export const CATALOG: CatalogItem[] = [
  { id: 'babalorixa', name: 'Babalorixá', price: 500, team: null,
    blurb: 'Turbante, bata bordada e guias no pescoço. Leva o axé para a Esplanada. Personagem realista.',
    look: L({ body: 3 }) },
  { id: 'tiozao-zap', name: 'Tiozão do Zap', price: 300, team: null,
    blurb: 'Óculos na ponta do nariz, bigode e a camisa da seleção. Chegou com áudio de 7 minutos.',
    look: L({ body: 2, skin: 1, hair: 5, hairColor: 4, beard: 1, shirt: 1, extra: 1, flag: 1 }) },
  { id: 'vovo-feira', name: 'Vovó da Feira', price: 300, team: null,
    blurb: 'Chapéu de palha, camiseta branca e disposição para andar o Eixo inteiro.',
    look: L({ body: 1, skin: 0, hair: 4, hairColor: 4, shirt: 2, extra: 5, flag: 3 }) },
  { id: 'ambulante', name: 'Ambulante do Eixo', price: 250, team: null,
    blurb: 'Boné, regata e bermuda. Vende água, bandeira e cadeira de praia.',
    look: L({ body: 0, skin: 3, hair: 1, shirt: 3, legs: 1, extra: 3, pants: 2 }) },
  { id: 'estudante', name: 'Estudante de Humanas', price: 250, team: null,
    blurb: 'Moletom, fone no pescoço e um cartaz escrito à mão.',
    look: L({ body: 1, skin: 2, hair: 3, hairColor: 2, shirt: 6, extra: 4, flag: 3, pants: 1 }) },
  { id: 'executivo', name: 'Executivo de Brasília', price: 400, team: null,
    blurb: 'Terno escuro, óculos escuros e topete impecável, mesmo no sol do meio-dia.',
    look: L({ body: 0, skin: 0, hair: 2, hairColor: 1, shirt: 4, extra: 2, pants: 1 }) },
  { id: 'surfista', name: 'Surfista do Paranoá', price: 250, team: null,
    blurb: 'Cabelão loiro, regata e chinelo. Jura que tem onda no lago.',
    look: L({ body: 0, skin: 1, hair: 3, hairColor: 3, shirt: 3, legs: 1, pants: 3 }) },
  { id: 'professora', name: 'Professora', price: 300, team: null,
    blurb: 'Camisa social, óculos e a voz que a Esplanada inteira escuta.',
    look: L({ body: 1, skin: 3, hair: 1, hairColor: 0, shirt: 5, extra: 1, flag: 3, pants: 2 }) },
  { id: 'barbudo', name: 'Barbudo do Churrasco', price: 300, team: null,
    blurb: 'Barba cheia, regata e bandeira na mão. Trouxe o isopor.',
    look: L({ body: 2, skin: 2, hair: 0, hairColor: 0, beard: 4, shirt: 3, flag: 1, legs: 1 }) },
  { id: 'fiscal', name: 'Fiscal de Calçada', price: 200, team: null,
    blurb: 'Boné, camisa social e opinião sobre cada obra do caminho.',
    look: L({ body: 2, skin: 1, hair: 1, hairColor: 4, beard: 2, shirt: 5, extra: 3, pants: 3 }) },
  { id: 'torcedora', name: 'Torcedora Raiz', price: 250, team: null,
    blurb: 'Rabo de cavalo, camisa da seleção e a bandeira maior que ela.',
    look: L({ body: 1, skin: 2, hair: 4, hairColor: 0, shirt: 1, flag: 1, pants: 1 }) },
  { id: 'militante-time', name: 'Militante do Time', price: 350, team: null,
    blurb: 'Camisa e boné nas cores do time, bandeira do time no alto.',
    look: L({ body: 0, skin: 4, hair: 1, beard: 3, shirt: 0, extra: 3, flag: 2 }) },
  { id: 'jornalista', name: 'Repórter de Rua', price: 300, team: null,
    blurb: 'Camisa social, fone e o melhor ângulo da multidão.',
    look: L({ body: 1, skin: 1, hair: 2, hairColor: 1, shirt: 5, extra: 4, pants: 1 }) },
];
