import './style.css';
import { FAR_HZ, INTERP_DELAY_MS, TICK_MS } from '../../shared/constants.ts';
import { Collider, type MapData } from '../../shared/map.ts';
import mapJson from '../../shared/map.json' with { type: 'json' };
import teams from '../../shared/teams.json' with { type: 'json' };
import { NEAR_TYPE, type FarSnapshot, type NearSnapshot, type ServerMessage } from '../../shared/protocol.ts';
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

const FAR_DELAY_MS = 1000 / FAR_HZ + INTERP_DELAY_MS;
const map = mapJson as unknown as MapData; // o tipo inferido do JSON não tem as tuplas [x, z]
const collider = Collider.fromMap(map);

const hud = new Hud();
const stage = createStage(document.getElementById('stage')!, () => hud.fatal('A placa de vídeo reiniciou.'));
buildMap(map, stage.scene);
buildLandmarks(stage.scene);
const avatars = new Avatars(stage.scene);
avatars.load('/models/robot.glb').catch((err) => {
  console.error(err);
  hud.banner('Não foi possível carregar os personagens.');
});
const crowd = new Crowd(stage.scene);
const rig = new CameraRig(stage.camera, stage.renderer.domElement);
const joystick = document.getElementById('joystick')!;
const input = new Input(stage.mobile ? joystick : null);
const clock = new TickClock();

const nearTracks = new Map<number, { track: Track; anim: number; team: number }>();
const farTracks = new Map<number, { track: Track; team: number }>();
const names = new Map<number, { nick: string; team: number }>();
let nearIds = new Set<number>();
let joined = false;
let spectator = true;
let selfId = 0;
let myTeam = 0;
let predictor: Predictor | null = null;

// `vite build --mode demo` (deploy estático, ex.: Vercel): o servidor roda no próprio navegador, com bots.
const DEMO = import.meta.env.MODE === 'demo';
const localSocket = DEMO ? (await import('./demo/local-server.ts')).startLocalServer(collider, teams.length) : undefined;
if (DEMO) document.getElementById('demo-note')!.hidden = false;

const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const net = new GameConnection(
  wsUrl, { message: onMessage, snapshot: onSnapshot, status: onStatus }, getAccessToken, localSocket,
);
const lobby = new Lobby({ play: () => void net.join(false), watch: () => void net.join(true) });
const chat = new ChatPanel((text) => net.send({ t: 'chat', text }));

let lastView = 0;
rig.onSpectatorMove = (x, z) => {
  const now = performance.now();
  if (now - lastView < 200) return; // no máximo 5/s
  lastView = now;
  net.send({ t: 'view', x, z });
};

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
      predictor = null;
      rig.spectator = m.spectator;
      input.enabled = !m.spectator;
      joystick.hidden = !(stage.mobile && !m.spectator);
      lobby.show(false);
      hud.show(true);
      chat.show(true, !m.spectator);
      chat.clear();
      for (const e of m.history) chat.add(e);
      if (m.full) chat.system('A Esplanada está lotada: você está assistindo por enquanto.');
      break;
    case 'names':
      for (const p of m.people) names.set(p.id, { nick: p.nick, team: p.team });
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
      if (a.id === selfId && !spectator) {
        if (!predictor) predictor = new Predictor({ x: a.x, z: a.z, yaw: a.yaw, anim: a.anim }, collider, s.ackSeq);
        else predictor.reconcile(a, s.ackSeq);
        continue;
      }
      let n = nearTracks.get(a.id);
      if (!n) nearTracks.set(a.id, (n = { track: new Track(), anim: a.anim, team: a.team }));
      n.track.push({ t, x: a.x, z: a.z, yaw: a.yaw });
      n.anim = a.anim;
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

let last = performance.now();
let acc = 0;
let wasMoving = false;

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
      if (moving || wasMoving) net.send({ t: 'input', ...predictor.apply(mv) });
      wasMoving = moving;
    }
  }

  const visible = new Map<number, AvatarPose>();
  for (const [id, n] of nearTracks) {
    if (!nearIds.has(id)) {
      if (now - n.track.lastTime > 1000) nearTracks.delete(id);
      continue;
    }
    const p = n.track.sample(now - INTERP_DELAY_MS);
    if (p) visible.set(id, { ...p, anim: n.anim, team: n.team });
  }
  let self: { x: number; z: number } | null = null;
  if (predictor && !spectator) {
    self = predictor.render(dtMs);
    visible.set(selfId, { ...self, yaw: predictor.state.yaw, anim: predictor.state.anim, team: myTeam });
  }
  avatars.sync(visible, names, dtMs / 1000, selfId);

  const people: { x: number; z: number; team: number }[] = [];
  for (const [id, f] of farTracks) {
    if (now - f.track.lastTime > 2500) {
      farTracks.delete(id);
      continue;
    }
    if (nearIds.has(id) || id === selfId) continue;
    const p = f.track.sample(now - FAR_DELAY_MS);
    if (p) people.push({ x: p.x, z: p.z, team: f.team });
  }
  crowd.update(people);

  rig.update(self);
  followSun(stage, self?.x ?? rig.focus.x, self?.z ?? rig.focus.z);
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}

net.connect();
requestAnimationFrame(frame);
