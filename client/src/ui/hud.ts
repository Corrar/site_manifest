export class Hud {
  private readonly el = document.getElementById('hud') as HTMLElement;
  private readonly pingEl = document.getElementById('ping') as HTMLElement;
  private readonly bannerEl = document.getElementById('banner') as HTMLElement;
  private readonly locSub = document.getElementById('loc-sub') as HTMLElement;

  location(text: string): void {
    if (this.locSub.textContent !== text) this.locSub.textContent = text;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  ping(ms: number): void {
    this.pingEl.textContent = `${Math.round(ms)} ms`;
  }

  banner(text: string | null): void {
    this.bannerEl.hidden = text === null;
    this.bannerEl.textContent = text ?? '';
  }

  /** Erro que exige recarregar a página (ex.: placa de vídeo perdeu o contexto). */
  fatal(text: string): void {
    this.banner(text);
    const btn = document.createElement('button');
    btn.textContent = 'Recarregar';
    btn.onclick = () => location.reload();
    this.bannerEl.append(btn);
  }
}
