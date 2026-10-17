// Batucada sintetizada (sem arquivos de áudio) tocada pelos veículos de som.
// O volume acompanha o veículo mais próximo: alto colado nele, some no limite do alcance.

const BPM = 104;
const STEP = 60 / BPM / 4; // semicolcheia
// 16 passos: surdo, caixa, chocalho e agogô.
const SURDO = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const CAIXA = [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
const CHOC = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const AGOGO = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];

export class SoundSystem {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private step = 0;
  private nextAt = 0;
  private level = 0;

  /** Precisa de um gesto do usuário (clique/tecla) para o navegador liberar o áudio. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.3;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.nextAt = this.ctx.currentTime + 0.1;
  }

  /** `loudness` de 0 a 1 (0 = nenhum veículo por perto). Chamar a cada quadro. */
  update(loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const target = this.muted ? 0 : Math.max(0, Math.min(1, loudness)) * 0.5;
    this.level += (target - this.level) * 0.08;
    this.master.gain.setTargetAtTime(this.level, ctx.currentTime, 0.05);
    if (this.level < 0.002) {
      this.nextAt = ctx.currentTime + 0.05;
      return;
    }
    while (this.nextAt < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      if (SURDO[s]) this.surdo(this.nextAt, s % 8 === 6 ? 0.7 : 1);
      if (CAIXA[s]) this.hit(this.nextAt, 1800, 0.09, 0.35);
      if (CHOC[s]) this.hit(this.nextAt, 7000, 0.03, s % 4 === 0 ? 0.16 : 0.08);
      if (AGOGO[s]) this.bell(this.nextAt, s < 8 ? 880 : 660);
      this.step++;
      this.nextAt += STEP;
    }
  }

  private surdo(at: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(48, at + 0.25);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.4);
  }

  private hit(at: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private bell(at: number, freq: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.15);
  }
}
