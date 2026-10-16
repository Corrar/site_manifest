import teams from '../../../shared/teams.json' with { type: 'json' };
import { getDevLogin, setDevLogin } from '../auth.ts';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Lobby {
  private readonly el = byId<HTMLElement>('lobby');
  private readonly list = byId<HTMLUListElement>('lobby-teams');
  private readonly err = byId<HTMLParagraphElement>('lobby-error');

  constructor(actions: { play(): void; watch(): void }) {
    const form = byId<HTMLFormElement>('login-form');
    const nick = byId<HTMLInputElement>('login-nick');
    const fieldset = byId<HTMLFieldSetElement>('login-teams');
    teams.forEach((t, i) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'team';
      radio.value = String(i);
      radio.checked = i === 0;
      label.append(radio, ` ${t.name}`);
      fieldset.append(label);
    });
    byId<HTMLButtonElement>('btn-play').onclick = () => {
      this.error('');
      if (getDevLogin()) actions.play();
      else {
        form.hidden = false;
        nick.focus();
      }
    };
    byId<HTMLButtonElement>('btn-watch').onclick = () => {
      this.error('');
      actions.watch();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = nick.value.replace(/:/g, '').trim();
      const team = Number(form.querySelector<HTMLInputElement>('input[name=team]:checked')?.value ?? 0);
      if (name.length < 2) return;
      setDevLogin({ nick: name, team });
      form.hidden = true;
      actions.play();
    };
    this.stats(0, teams.map(() => 0));
  }

  stats(online: number, counts: number[]): void {
    this.list.replaceChildren(...teams.map((t, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--team', t.color);
      const name = document.createElement('span');
      name.textContent = t.name;
      const n = document.createElement('span');
      n.textContent = `${counts[i] ?? 0} online`;
      li.append(name, n);
      return li;
    }));
    this.list.title = `${online} pessoas na Esplanada`;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  error(msg: string): void {
    this.err.textContent = msg;
  }
}
