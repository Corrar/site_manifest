import './style.css';
import { ANIM, FAR_HZ, INTERP_DELAY_MS, TICK_MS, VEHICLE_SPECS } from '../../shared/constants.ts';
import { Collider, type MapData } from '../../shared/map.ts';
import { wrapAngle } from '../../shared/movement.ts';
import mapJson from '../../shared/map.json' with { type: 'json' };
import teams from '../../shared/teams.json' with { type: 'json' };
import {
  NEAR_TYPE, unpackAnim, type FarSnapshot, type NearSnapshot, type ServerMessage,
} from '../../shared/protocol.ts';
import { SoundSystem } from './audio.ts';
import { clearDevLogin, getAccessToken } from './auth.ts';
import { Input } from './input.ts';
import { TickClock, Track } from './interp.ts';
import { GameConnection, type ConnStatus } from './net.ts';
import { Predictor } from './predict.ts';
import { Avatars, type AvatarPose } from './scene/avatars.ts';
import { CameraRig } from './scene/camera.ts';
import { Crowd } from './scene/crowd.ts';
import { buildLandmarks } from './scene/landmarks.ts';
import { buildMap } from './scene/map.ts';
import { createStage, followSun } from './scene/renderer.ts';
import { ChatPanel } from './ui/chat.ts';
import { Hud } from './ui/hud.ts';
import { Lobby } from './ui/lobby.ts';
import { Minimap } from './ui/minimap.ts';
import { Shop } from './ui/shop.ts';

const FAR_DELAY_MS = 1000 / FAR_HZ + INTERP_DELAY_MS;
const map = mapJson as unknown as MapData; // o tipo inferido do JSON não tem as tuplas [x, z]
const collider = Collider.fromMap(map);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

document.body.classList.add('in-lobby');
const hud = new Hud();
const stage = createStage(byId('stage'), () => hud.fatal('A placa de vídeo reiniciou.'));
buildMap(map, stage.scene, stage.mobile);
const animateLandmarks = buildLandmarks(stage.scene);
const avatars = new Avatars(stage.scene);
const crowd = new Crowd(stage.scene);
const rig = new CameraRig(stage.camera, stage.renderer.domElement);
const joystick = byId('joystick');
const input = new Input(stage.mobile ? joystick : null);
const clock = new TickClock();
const sound = new SoundSystem();
const minimap = new Minimap(byId<HTMLCanvasElement>('minimap'), map);

type Near = { track: Track; anim: number; vehicle: number; team: number };
const nearTracks = new Map<number, Near>();
const farTracks = new Map<number, { track: Track; team: number }>();
const names = new Map<number, { nick: string; team: number; look: number }>();
let nearIds = new Set<number>();
let joined = false;
let spectator = true;
let selfId = 0;
let myTeam = 0;
let myLook = 0;
let selfEmote = 0;
let aerial = false;
let predictor: Predictor | null = null;

// `vite build --mode demo` (deploy estático, ex.: Vercel): o servidor roda no próprio navegador, com bots.
const DEMO = import.meta.env.MODE === 'demo';
const localSocket = DEMO ? (await import('./demo/local-server.ts')).startLocalServer(collider, teams.length) : undefined;
if (DEMO) byId('demo-note').hidden = false;

const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const net = new GameConnection(
  wsUrl, { message: onMessage, snapshot: onSnapshot, status: onStatus }, getAccessToken, localSocket,
);
const lobby = new Lobby({
  play: () => void net.join(false),
  watch: () => void net.join(true),
  shop: () => shop.open(lobby.team),
});
const shop = new Shop((look) => lobby.setLook(look));
const chat = new ChatPanel((text) => net.send({ t: 'chat', text }));

// ---------- modais e barra de ferramentas ----------
const help = byId('help');
const openHelp = () => (help.hidden = false);
byId('btn-help').onclick = openHelp;
byId('tool-help').onclick = openHelp;
byId('help-close').onclick = () => (help.hidden = true);
help.onclick = (e) => {
  if (e.target === help) help.hidden = true;
};

function toggleMenu(id: string): void {
  for (const m of ['anim-menu', 'vehicle-menu']) byId(m).hidden = m === id ? !byId(m).hidden : true;
}
byId('tool-anim').onclick = () => toggleMenu('anim-menu');
byId('tool-vehicle').onclick = () => toggleMenu('vehicle-menu');
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-emote]')) {
  b.onclick = () => {
    emote(Number(b.dataset.emote));
    toggleMenu('');
  };
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-vehicle]')) {
  b.onclick = () => {
    setVehicle(Number(b.dataset.vehicle));
    toggleMenu('');
  };
}
const soundBtn = byId<HTMLButtonElement>('tool-sound');
soundBtn.onclick = () => {
  sound.muted = !sound.muted;
  soundBtn.textContent = sound.muted ? 'Som: desligado' : 'Som: ligado';
};
const cameraBtn = byId<HTMLButtonElement>('tool-camera');
cameraBtn.onclick = () => toggleAerial();
byId('tool-look').onclick = () => location.reload(); // volta para a tela inicial com o visual salvo

addEventListener('pointerdown', () => sound.unlock());
addEventListener('keydown', (e) => {
  sound.unlock();
  if (!joined || spectator) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Digit1') emote(ANIM.wave);
  else if (e.code === 'Digit2') emote(ANIM.dance);
  else if (e.code === 'KeyC') toggleAerial();
  else if (e.code === 'KeyF' && predictor?.state.vehicle) setVehicle(0);
});

function emote(anim: number): void {
  if (!predictor || spectator || predictor.state.vehicle) return;
  selfEmote = anim;
  net.send({ t: 'input', ...predictor.apply({ dx: 0, dz: 0, run: false }), emote: anim });
}

function setVehicle(kind: number): void {
  if (!predictor || spectator) return;
  predictor.setVehicle(kind);
  selfEmote = 0;
  net.send({ t: 'vehicle', kind });
  applyCamera();
}

function toggleAerial(): void {
  aerial = !aerial;
  cameraBtn.classList.toggle('on', aerial);
  applyCamera();
}

function applyCamera(): void {
  const v = predictor?.state.vehicle ?? 0;
  rig.distance = aerial ? 32 : [7, 11, 17][v] ?? 7;
  rig.pitch = aerial ? 1.0 : v ? 0.32 : 0.35;
}

let lastView = 0;
rig.onSpectatorMove = (x, z) => {
  const now = performance.now();
  if (now - lastView < 200) return; // no máximo 5/s
  lastView = now;
  net.send({ t: 'view', x, z });
};

// ---------- rede ----------
function onMessage(m: ServerMessage): void {
  switch (m.t) {
    case 'stats':
      lobby.stats(m.online, m.teams);
      break;
    case 'welcome':
      joined = true;
      selfId = m.id;
      spectator = m.spectator;
      myTeam = m.account?.team ?? 0;
      myLook = m.account?.look ?? 0;
      predictor = null;
      rig.spectator = m.spectator;
      rig.focus.set(0, 0, 0);
      input.enabled = !m.spectator;
      joystick.hidden = !(stage.mobile && !m.spectator);
      document.body.classList.replace('in-lobby', 'in-game');
      lobby.show(false);
      shop.close();
      hud.show(true);
      for (const id of ['tool-vehicle', 'tool-anim', 'tool-look']) byId(id).hidden = m.spectator;
      chat.show(true, !m.spectator);
      chat.clear();
      for (const e of m.history) chat.add(e);
      if (m.full) chat.system('A Esplanada está lotada: você está assistindo por enquanto.');
      else if (!m.spectator) chat.system('Você chegou à Esplanada. WASD anda, 1 acena, 2 dança, Veículos para dirigir.');
      break;
    case 'names':
      for (const p of m.people) names.set(p.id, { nick: p.nick, team: p.team, look: p.look });
      break;
    case 'chat':
      chat.add(m);
      break;
    case 'error':
      if (joined) {
        chat.system(m.message);
        break;
      }
      lobby.error(m.message);
      net.resetIntent();
      if (m.code === 'auth_invalid' || m.code === 'no_profile') clearDevLogin();
      break;
    case 'pong':
      hud.ping(Date.now() - m.at);
      break;
    case 'restarting':
      hud.banner('O servidor está reiniciando…');
      break;
  }
}

function onStatus(s: ConnStatus): void {
  if (s === 'open') hud.banner(null);
  if (s === 'closed') hud.banner('Reconectando…');
}

function onSnapshot(s: NearSnapshot | FarSnapshot, arrivedAt: number): void {
  clock.update(s.tick, arrivedAt);
  const t = clock.toLocal(s.tick);
  if (s.type === NEAR_TYPE) {
    nearIds = new Set();
    for (const a of s.actors) {
      nearIds.add(a.id);
      const { anim, vehicle } = unpackAnim(a.anim);
      if (a.id === selfId && !spectator) {
        if (!predictor) {
          predictor = new Predictor({ x: a.x, z: a.z, yaw: a.yaw, anim, vehicle }, collider, s.ackSeq);
          applyCamera();
        } else predictor.reconcile(a, s.ackSeq);
        continue;
      }
      let n = nearTracks.get(a.id);
      if (!n) nearTracks.set(a.id, (n = { track: new Track(), anim, vehicle, team: a.team }));
      n.track.push({ t, x: a.x, z: a.z, yaw: a.yaw });
      n.anim = anim;
      n.vehicle = vehicle;
      n.team = a.team;
    }
    return;
  }
  for (const a of s.actors) {
    let f = farTracks.get(a.id);
    if (!f) farTracks.set(a.id, (f = { track: new Track(), team: a.team }));
    f.track.push({ t, x: a.x, z: a.z, yaw: 0 });
    f.team = a.team;
  }
}

// ---------- laço principal ----------
let last = performance.now();
let acc = 0;
let wasMoving = false;
let lastMinimap = 0;

function frame(now: number): void {
  const dtMs = Math.min(250, now - last);
  last = now;

  // Inputs em passo fixo de 20 Hz, iguais ao servidor. Ao parar, manda um último input zerado.
  if (predictor && !spectator) {
    acc += dtMs;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      const mv = input.read(rig.yaw);
      const moving = Math.hypot(mv.dx, mv.dz) >= 0.05;
      if (moving) selfEmote = 0;
      if (moving || wasMoving) net.send({ t: 'input', ...predictor.apply(mv) });
      wasMoving = moving;
    }
  }

  const visible = new Map<number, AvatarPose>();
  const vehicles: { x: number; z: number; range: number }[] = [];
  const dots: { x: number; z: number; team: number; vehicle?: number }[] = [];
  for (const [id, n] of nearTracks) {
    if (!nearIds.has(id)) {
      if (now - n.track.lastTime > 1000) nearTracks.delete(id);
      continue;
    }
    const p = n.track.sample(now - INTERP_DELAY_MS);
    if (!p) continue;
    visible.set(id, { ...p, anim: n.anim, team: n.team, look: names.get(id)?.look ?? 0, vehicle: n.vehicle });
    dots.push({ x: p.x, z: p.z, team: n.team, vehicle: n.vehicle });
    if (n.vehicle) vehicles.push({ x: p.x, z: p.z, range: VEHICLE_SPECS[n.vehicle]?.soundRange ?? 50 });
  }
  let self: { x: number; z: number } | null = null;
  if (predictor && !spectator) {
    self = predictor.render(dtMs);
    const st = predictor.state;
    const anim = st.anim === ANIM.idle && selfEmote && !st.vehicle ? selfEmote : st.anim;
    visible.set(selfId, { ...self, yaw: st.yaw, anim, team: myTeam, look: myLook, vehicle: st.vehicle ?? 0 });
    if (st.vehicle) {
      vehicles.push({ ...self, range: VEHICLE_SPECS[st.vehicle]?.soundRange ?? 50 });
      // Dirigindo, a câmera volta devagar para trás do veículo (estilo GTA).
      if (st.anim !== ANIM.idle && !aerial) rig.yaw += wrapAngle(st.yaw - rig.yaw) * Math.min(1, (dtMs / 1000) * 1.5);
    }
  }
  avatars.sync(visible, names, dtMs / 1000, selfId);

  const people: { id: number; x: number; z: number; team: number }[] = [];
  for (const [id, f] of farTracks) {
    if (now - f.track.lastTime > 2500) {
      farTracks.delete(id);
      continue;
    }
    if (nearIds.has(id) || id === selfId) continue;
    const p = f.track.sample(now - FAR_DELAY_MS);
    if (p) people.push({ id, x: p.x, z: p.z, team: f.team });
  }
  crowd.update(people);

  // Som: o veículo mais "alto" para quem escuta (volume cai com a distância até o alcance dele).
  const ear = self ?? { x: rig.focus.x, z: rig.focus.z };
  let loud = 0;
  for (const v of vehicles) loud = Math.max(loud, (1 - Math.hypot(v.x - ear.x, v.z - ear.z) / v.range) ** 2);
  sound.update(joined ? loud : 0);

  if (!joined) {
    // Tela inicial: a Esplanada vista do alto, girando devagar.
    const a = now / 1000 * 0.04;
    stage.camera.position.set(Math.cos(a) * 320, 170, Math.sin(a) * 320);
    stage.camera.lookAt(60, 0, 0);
  } else {
    rig.update(self);
  }
  followSun(stage, self?.x ?? rig.focus.x, self?.z ?? rig.focus.z);
  animateLandmarks(now / 1000);
  stage.renderer.render(stage.scene, stage.camera);

  if (joined && now - lastMinimap > 100) {
    lastMinimap = now;
    minimap.draw(self ?? rig.focus, [...dots, ...people], self && predictor ? { yaw: predictor.state.yaw } : null);
    const total = visible.size + people.length - (self ? 1 : 0);
    hud.location(spectator ? `Assistindo do alto · ${total} pessoas na tela` : `Você está na manifestação · ${total} por perto`);
  }
  requestAnimationFrame(frame);
}

net.connect();
requestAnimationFrame(frame);
