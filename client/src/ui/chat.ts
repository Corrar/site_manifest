import teams from '../../../shared/teams.json' with { type: 'json' };
import type { ChatEntry } from '../../../shared/protocol.ts';

const MAX_LINES = 100;

export class ChatPanel {
  private readonly panel = document.getElementById('chat') as HTMLElement;
  private readonly log = document.getElementById('chat-log') as HTMLOListElement;
  private readonly input = document.getElementById('chat-input') as HTMLInputElement;

  constructor(send: (text: string) => void) {
    (document.getElementById('chat-form') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      send(text);
      this.input.value = '';
    };
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== this.input && !this.panel.hidden && !this.input.disabled) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  show(on: boolean, canTalk: boolean): void {
    this.panel.hidden = !on;
    this.input.disabled = !canTalk;
    this.input.placeholder = canTalk ? 'Diga algo… (Enter)' : 'Entre com sua conta para conversar';
  }

  add(e: ChatEntry): void {
    const li = document.createElement('li');
    const who = document.createElement('b');
    who.textContent = e.nick; // texto puro, nunca HTML
    who.style.color = teams[e.team]?.color ?? '#cccccc';
    li.append(who, ' ', e.text);
    this.push(li);
  }

  system(text: string): void {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    this.push(li);
  }

  clear(): void {
    this.log.replaceChildren();
  }

  private push(li: HTMLLIElement): void {
    this.log.append(li);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
