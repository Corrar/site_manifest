import type { Look } from '../../../shared/looks.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { CATALOG, type CatalogItem } from '../catalog.ts';
import { CharacterPreview } from './preview.ts';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const OWNED_KEY = 'manifest-owned';

function loadOwned(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OWNED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Loja de personagens: catálogo com filtros, busca e prévia 3D. */
export class Shop {
  private readonly el = byId<HTMLDivElement>('shop');
  private readonly grid = byId<HTMLDivElement>('shop-grid');
  private readonly search = byId<HTMLInputElement>('shop-search');
  private preview: CharacterPreview | null = null;
  private readonly portraits = new Map<string, string>();
  private readonly owned = loadOwned();
  private tab = 'all';
  private selected: CatalogItem = CATALOG[0];
  private team = 0;
  private readonly onUse: (look: Look) => void;

  constructor(onUse: (look: Look) => void) {
    this.onUse = onUse;
    byId<HTMLButtonElement>('shop-close').onclick = () => this.close();
    this.el.onclick = (e) => {
      if (e.target === this.el) this.close();
    };
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
    for (const b of byId('shop-tabs').querySelectorAll<HTMLButtonElement>('button')) {
      b.onclick = () => {
        this.tab = b.dataset.tab ?? 'all';
        for (const o of byId('shop-tabs').querySelectorAll('button')) o.classList.toggle('on', o === b);
        this.renderGrid();
      };
    }
    this.search.oninput = () => this.renderGrid();
    byId<HTMLButtonElement>('shop-use').onclick = () => {
      this.owned.add(this.selected.id);
      try {
        localStorage.setItem(OWNED_KEY, JSON.stringify([...this.owned]));
      } catch {
        // navegação privada: vale só nesta aba
      }
      this.onUse(this.selected.look);
      this.close();
    };
  }

  /** Um modelo .glb terminou de carregar: refaz retratos e prévia. */
  modelsReady(): void {
    this.portraits.clear();
    this.preview?.refresh();
    if (!this.el.hidden) this.renderGrid();
  }

  open(team: number): void {
    this.team = team;
    this.el.hidden = false;
    // O palco 3D da loja só nasce quando ela abre pela primeira vez (já com tamanho na tela).
    if (!this.preview) this.preview = new CharacterPreview(byId('shop-preview'));
    this.preview.setVisible(true);
    this.renderGrid();
    this.select(this.selected);
  }

  close(): void {
    this.el.hidden = true;
    this.preview?.setVisible(false);
  }

  private items(): CatalogItem[] {
    const q = this.search.value.trim().toLowerCase();
    return CATALOG.filter((c) => {
      if (this.tab === 'any' && c.team !== null) return false;
      if (this.tab === 'team' && c.team !== this.team) return false;
      if (this.tab === 'mine' && !this.owned.has(c.id)) return false;
      return !q || c.name.toLowerCase().includes(q);
    });
  }

  private portrait(c: CatalogItem): string {
    const key = `${c.id}|${this.team}`;
    let url = this.portraits.get(key);
    if (!url) {
      url = this.preview!.portrait(c.look, this.team, 180);
      this.portraits.set(key, url);
    }
    return url;
  }

  private renderGrid(): void {
    const list = this.items();
    byId('shop-count').textContent = `${list.length} personagens · ${this.tabName()}`;
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'shop-empty';
      empty.textContent = this.tab === 'mine'
        ? 'Você ainda não escolheu nenhum personagem da loja.'
        : this.tab === 'team' ? `Ainda não há personagens exclusivos de ${teams[this.team]?.name ?? 'seu time'}.` : 'Nada encontrado.';
      this.grid.replaceChildren(empty);
      return;
    }
    this.grid.replaceChildren(...list.map((c) => {
      const b = document.createElement('button');
      b.className = `char-card${c.id === this.selected.id ? ' on' : ''}`;
      const img = document.createElement('img');
      img.alt = '';
      img.src = this.portrait(c);
      const name = document.createElement('span');
      name.textContent = c.name;
      const who = document.createElement('em');
      who.textContent = c.team === null ? 'Todos os times' : teams[c.team]?.name ?? '';
      const price = document.createElement('small');
      price.textContent = this.owned.has(c.id) ? 'Seu' : `${c.price.toLocaleString('pt-BR')} moedas`;
      b.append(img, name, who, price);
      b.onclick = () => this.select(c);
      return b;
    }));
  }

  private select(c: CatalogItem): void {
    this.selected = c;
    this.preview?.setLook(c.look, c.team ?? this.team);
    byId('shop-kicker').textContent = c.team === null ? 'TODOS OS TIMES' : `EXCLUSIVO · ${teams[c.team]?.name.toUpperCase()}`;
    byId('shop-name').textContent = c.name;
    byId('shop-blurb').textContent = c.blurb;
    byId('shop-price').textContent = `${c.price.toLocaleString('pt-BR')} moedas`;
    byId('shop-use').textContent = this.owned.has(c.id) ? 'Usar de novo' : 'Usar personagem';
    for (const card of this.grid.querySelectorAll('.char-card')) card.classList.remove('on');
    this.renderGrid();
  }

  private tabName(): string {
    return { all: 'no catálogo', any: 'para todos os times', team: 'do seu time', mine: 'seus' }[this.tab] ?? '';
  }
}

