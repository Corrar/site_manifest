import { ANIM } from '../../../shared/constants.ts';
import {
  BEARDS, EXTRAS, FLAGS, HAIR_COLORS, HAIRS, LEGS, PANTS, PANTS_NAMES, SHIRTS, SKINS,
  packLook, unpackLook, type Look,
} from '../../../shared/looks.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { getDevLogin, setDevLogin } from '../auth.ts';
import { BASE_CHARACTERS } from '../catalog.ts';
import { CharacterPreview } from './preview.ts';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Group = { key: keyof Look; title: string; names?: readonly string[]; colors?: readonly string[] };
const GROUPS: Group[] = [
  { key: 'skin', title: 'Tom de pele', colors: SKINS },
  { key: 'hair', title: 'Cabelo', names: HAIRS },
  { key: 'hairColor', title: 'Cor do cabelo', colors: HAIR_COLORS },
  { key: 'beard', title: 'Barba', names: BEARDS },
  { key: 'shirt', title: 'Roupa', names: SHIRTS },
  { key: 'legs', title: 'Pernas', names: LEGS },
  { key: 'pants', title: 'Cor da calça', names: PANTS_NAMES, colors: PANTS },
  { key: 'extra', title: 'Acessório', names: EXTRAS },
  { key: 'flag', title: 'Na mão', names: FLAGS },
];

/** Tela inicial: time, visual (com prévia 3D) e apelido. */
export class Lobby {
  readonly preview: CharacterPreview;
  team = 0;
  look: Look;
  private readonly el = byId<HTMLElement>('lobby');
  private readonly err = byId<HTMLParagraphElement>('lobby-error');
  private readonly nick = byId<HTMLInputElement>('login-nick');
  private readonly teamCards = byId<HTMLDivElement>('team-cards');
  private readonly bodyCards = byId<HTMLDivElement>('body-cards');
  private readonly groups = byId<HTMLDivElement>('option-groups');
  private readonly online = byId<HTMLDivElement>('online-pills');
  private counts: number[] = teams.map(() => 0);

  constructor(actions: { play(): void; watch(): void; shop(): void }) {
    const saved = getDevLogin();
    this.team = saved && saved.team < teams.length ? saved.team : 0;
    this.look = unpackLook(saved?.look ?? packLook(BASE_CHARACTERS[0].look));
    this.nick.value = saved?.nick ?? '';
    this.preview = new CharacterPreview(byId('preview'));

    for (const b of document.querySelectorAll<HTMLButtonElement>('.anim-bar button')) {
      b.onclick = () => {
        if (b.dataset.rot) return this.preview.rotate(Number(b.dataset.rot) * 0.8);
        this.preview.setAnim(Number(b.dataset.anim ?? ANIM.idle));
        for (const o of document.querySelectorAll('.anim-bar [data-anim]')) o.classList.toggle('on', o === b);
      };
    }
    byId<HTMLButtonElement>('btn-play').onclick = () => {
      const name = this.nick.value.replace(/:/g, '').replace(/\s+/g, ' ').trim();
      if (name.length < 2) {
        this.error('Escolha um apelido com pelo menos 2 letras.');
        this.nick.focus();
        return;
      }
      this.error('');
      setDevLogin({ nick: name, team: this.team, look: packLook(this.look) });
      actions.play();
    };
    byId<HTMLButtonElement>('btn-watch').onclick = () => {
      this.error('');
      actions.watch();
    };
    byId<HTMLButtonElement>('btn-shop').onclick = actions.shop;
    this.nick.onkeydown = (e) => {
      if (e.key === 'Enter') byId<HTMLButtonElement>('btn-play').click();
    };
    this.renderBodies(actions.shop);
    this.render();
  }

  /** Aplica um visual (ex.: vindo da loja) e atualiza tudo. */
  setLook(look: Look): void {
    this.look = { ...look };
    this.render();
  }

  stats(online: number, counts: number[]): void {
    this.counts = counts;
    this.renderTeams();
    this.online.replaceChildren(...teams.map((t, i) => {
      const s = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.setProperty('--c', t.color);
      s.append(dot, String(counts[i] ?? 0));
      return s;
    }));
    this.online.title = `${online} pessoas na Esplanada agora`;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    this.preview.setVisible(on);
  }

  error(msg: string): void {
    this.err.textContent = msg;
  }

  private render(): void {
    this.preview.setLook(this.look, this.team);
    this.renderTeams();
    this.renderGroups();
    for (const c of this.bodyCards.querySelectorAll<HTMLElement>('[data-body]')) {
      c.classList.toggle('on', Number(c.dataset.body) === this.look.body);
    }
  }

  private renderTeams(): void {
    this.teamCards.replaceChildren(...teams.map((t, i) => {
      const b = document.createElement('button');
      b.className = `team-card${i === this.team ? ' on' : ''}`;
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.style.setProperty('--c', t.color);
      flag.style.setProperty('--a', t.accent);
      const txt = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = t.name;
      const n = document.createElement('small');
      n.textContent = `${(this.counts[i] ?? 0).toLocaleString('pt-BR')} online`;
      txt.append(name, n);
      b.append(flag, txt);
      b.onclick = () => {
        this.team = i;
        this.render();
      };
      return b;
    }));
  }

  private renderBodies(openShop: () => void): void {
    const cards = BASE_CHARACTERS.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'char-card';
      b.dataset.body = String(i);
      const img = document.createElement('img');
      img.alt = '';
      img.src = this.preview.portrait(c.look, this.team);
      const name = document.createElement('span');
      name.textContent = c.name;
      b.append(img, name);
      b.onclick = () => this.setLook({ ...c.look, flag: this.look.flag });
      return b;
    });
    const more = document.createElement('button');
    more.className = 'char-card more';
    const plus = document.createElement('b');
    plus.textContent = '+';
    const label = document.createElement('span');
    label.textContent = 'Ver mais personagens';
    const sub = document.createElement('small');
    sub.textContent = 'Abrir loja';
    more.append(plus, label, sub);
    more.onclick = openShop;
    this.bodyCards.replaceChildren(...cards, more);
  }

  private renderGroups(): void {
    this.groups.replaceChildren(...GROUPS.map((g) => {
      const wrap = document.createElement('div');
      wrap.className = 'opt-group';
      const title = document.createElement('p');
      title.textContent = g.title;
      const chips = document.createElement('div');
      chips.className = 'chips';
      const count = (g.colors ?? g.names)!.length;
      for (let i = 0; i < count; i++) {
        const b = document.createElement('button');
        const on = this.look[g.key] === i;
        if (g.colors) {
          b.className = `swatch${on ? ' on' : ''}`;
          b.style.setProperty('--c', g.colors[i]);
          b.title = g.names?.[i] ?? '';
          b.setAttribute('aria-label', `${g.title} ${i + 1}`);
        } else {
          b.className = `chip${on ? ' on' : ''}`;
          b.textContent = g.names![i];
        }
        b.onclick = () => {
          this.look = { ...this.look, [g.key]: i };
          this.render();
        };
        chips.append(b);
      }
      wrap.append(title, chips);
      return wrap;
    }));
  }
}
