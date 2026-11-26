'use strict';
/* Haunted Dorm - Real Multiplayer Server (Normal mode, fully server-authoritative)
   Serves the game files from ./public, Auth & Room APIs (/api/*), and WebSocket (/ws) on port 3000. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const GAME_URL = '/h5games/game/haunted-dorm/';
const MAP_FILE = path.join(PUBLIC, 'h5games/game/haunted-dorm/gameAssets/asset/data/mapsData.json');

function cleanName(raw) {
  return String(raw || '').replace(/[^\w .\-]/g, '').trim().slice(0, 12);
}

/* ===================== TUNABLE CONFIG (Original Normal Mode) ===================== */
const CFG = {
  TICK_HZ: 30,
  MAX_HUMANS: 6,
  SURVIVORS: 6,
  MAP: 'map0',
  START_COINS: 0,
  HUMAN_SPEED: 3.4,
  BOT_SPEED: 2.0,         // original bt._speed = 3 px/frame @60fps = 180 px/s = 2.0 tiles/s
  BODY_R: 0.3,
  SLEEP_REACH: 2.6,
  GHOST_SPAWN_AT: +process.env.GHOST_SPAWN_AT || 30,
  GHOST_SPEED0: 3.0,      // original nt._speed = 4.5 px/frame @60fps = 270 px/s = 3.0 tiles/s
  GHOST_ATK_INTERVAL: 1.0,
  GHOST_REACH: 1.55,      // original nt._atR = 1.5 tiles
  GHOST_SPOT_RANGE: 4.0,  // original nt._r = 4 tiles
  ESCAPE_AT: 0.3,         // original _eHpPro = 0.3
  HEAL_INTERVAL: 1.0,     // original HomeUpHandle 1s
  HEAL_STEP: 0.1,         // original +10% hpMax per 1s
  HEAL_TO: 1.0,           // original this._troll.hp >= 1
  BED_HP_BASE: 1,         // original Et.Build sets hpMax=1 for Bed
  TIME_LIMIT: +process.env.TIME_LIMIT || 1500,
  REPAIR_COOLDOWN: 20,
  REPAIR_HEAL_FRAC: 0.5,
  GHOST_DMG_MULT: +process.env.GHOST_DMG_MULT || 1
};

/* ===================== REAL GAME TABLES (from bundle.js & English.json) ===================== */
const BED = { cost: [0, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400], en: [0, 0, 0, 0, 0, 0, 16, 32, 64, 128], out: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512], reqDoor: [null, null, 1, null, 4, null, 7, 9, 10, 11] };
const DOOR = { cost: [0, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768], en: [0, 0, 0, 0, 0, 0, 16, 32, 64, 128, 256, 512, 1024], hp: [50, 80, 160, 200, 250, 320, 640, 1280, 2560, 5120, 10240, 20480, 40960] };
const AT = { cost: [8, 16, 32, 64, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536], en: [0, 0, 0, 0, 0, 0, 32, 64, 128, 256, 512, 1024, 2048], atk: [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384], range: [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10], reqGame: [null, null, null, null, 0, null, 1, null, 2, 3, 4, 5, null] };
const GAME = { cost: [200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400], en: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], out: [0.5, 2, 4, 6, 8, 10, 15, 20, 25, 30] };
const MINE = { cost: [0, 0, 0, 0], en: [128, 1024, 2048, 4096], out: [8, 32, 128, 512] };
const SPECIALS = {
  spell: 32, ice: 64, entrapment: 128, barb: 128, guillotine: 512,
  repair: 32, energyhood: 32, smoney: 64, longrange: 128, particlea: 512, solenoid: 512
};
const ROOM_BUILD_LIMIT = {
  spell: 1, ice: 1, entrapment: 1, barb: 1, guillotine: 1,
  repair: 4, energyhood: 1, smoney: 1, longrange: 1, particlea: 1, solenoid: 1
};
const GHOST = {
  power: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
  hp: [300, 400, 800, 1600, 3200, 6400, 12800, 12800, 51200, 51200, 204800, 204800, 819200, 819200, 3276800, 3276800, 13107200],
  up: [30, 50, 60, 60, 60, 65, 70, 75, 80, 85, 90, 95]
};
const bedHp = () => CFG.BED_HP_BASE;
const SPAWN_TILES = [[22.5, 21.5], [23.5, 21.5], [22.5, 22.5], [23.5, 22.5], [22.5, 23.5], [23.5, 23.5]];
const TROLL_SPAWNS = [[21, 35], [22, 1], [41, 23], [1, 23]]; // [row, col] from bundle.js _trollPos[0]

/* ===================== MAP ===================== */
const MAP = (() => {
  const all = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const raw = all[CFG.MAP];
  const rows = raw.length;
  const cols = Math.max(...raw.map((r) => r.length));
  const land = [];
  const floor = new Uint8Array(rows * cols);
  const beds = [], doors = new Map();
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const cell = raw[r][c] || '9_0_0_0';
      const [l, , inb] = cell.split('_').map(Number);
      line += l;
      if (l === 0 || l === 1) floor[r * cols + c] = 1;
      if (inb === 1) beds.push({ x: c, y: r });
      if (inb === 2) doors.set(r * cols + c, { x: c, y: r });
    }
    land.push(line);
  }
  const idx = (x, y) => y * cols + x;
  const rooms = [];
  for (const b of beds) {
    const seen = new Set([idx(b.x, b.y)]);
    const q = [b], tiles = [];
    let door = null;
    while (q.length) {
      const t = q.shift();
      tiles.push(t);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = t.x + dx, ny = t.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = idx(nx, ny);
        if (seen.has(k) || !floor[k]) continue;
        seen.add(k);
        if (doors.has(k)) { if (!door) door = { x: nx, y: ny, from: t }; continue; }
        q.push({ x: nx, y: ny });
      }
    }
    if (!door) continue;
    const dist = (t) => Math.abs(t.x - door.x) + Math.abs(t.y - door.y);
    const free = tiles.filter((t) => !(t.x === b.x && t.y === b.y)).sort((a, c) => dist(a) - dist(c));
    const inside = door.from;
    const outside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy }))
      .find((t) => floor[idx(t.x, t.y)] && !seen.has(idx(t.x, t.y)) && !doors.has(idx(t.x, t.y))) || { x: door.x, y: door.y };
    rooms.push({
      bed: b, door: { x: door.x, y: door.y }, inside, outside, tiles,
      turretPos: free[Math.min(1, free.length - 1)] || b,
      gamePos: free[free.length - 1] || b
    });
  }
  const spawns = TROLL_SPAWNS
    .map(([r, c]) => ({ x: c, y: r }))
    .filter((p) => floor[idx(p.x, p.y)]);
  return { rows, cols, land, floor, rooms, doors, spawns: spawns.length ? spawns : [{ x: rooms[0].outside.x, y: rooms[0].outside.y }], idx };
})();
const ROWS = MAP.rows, COLS = MAP.cols;
const isFloor = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && MAP.floor[y * COLS + x] === 1;

function bfs(sx, sy, tx, ty, sim) {
  if (!isFloor(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const n = ROWS * COLS, prev = new Int32Array(n).fill(-2);
  const s = sy * COLS + sx, t = ty * COLS + tx;
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur === t) break;
    const cx = cur % COLS, cy = (cur / COLS) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!isFloor(nx, ny)) continue;
      const k = ny * COLS + nx;
      if (prev[k] !== -2) continue;
      if (sim && k !== t) {
        const rm = sim.doorAt(nx, ny);
        if (rm && rm.closed && rm.doorHp > 0) continue;
      }
      prev[k] = cur;
      q.push(k);
    }
  }
  if (prev[t] === -2) return null;
  const out = [];
  for (let c = t; c !== s; c = prev[c]) out.push({ x: c % COLS, y: (c / COLS) | 0 });
  return out.reverse();
}

/* ===================== GAME SIMULATION ===================== */
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

class Sim {
  constructor(members, botInfo) {
    botInfo = (botInfo || []).slice();
    this.t = 0;
    this.tick = 0;
    this.over = false;
    this.events = [];
    this.shots = [];
    this.shots2 = [];
    this.buildEv = [];
    this.roomsDirty = true;
    this.players = [];
    this.rooms = MAP.rooms.map((m, i) => ({
      i, owner: -1, bed: 0, door: 0, at: -1, game: -1, builds: [],
      doorHp: DOOR.hp[0], doorMax: DOOR.hp[0], bedHp: bedHp(), bedMax: bedHp(),
      closed: false, dead: false, repairCd: 0, doorOpenUntil: 0,
      regenT: 0, barbT: 0, shieldUntil: 0, shieldCdUntil: 0, guillotineUsed: false,
      paralysisDone: false, underAttack: false
    }));
    this.ghost = {
      x: 0, y: 0, hp: GHOST.hp[0], mhp: GHOST.hp[0], lv: 0, st: 0,
      mode: 'move', cd: 0, path: [], repath: 0,
      targetPlayer: -1, targetKind: 'none', targetRoom: -1,
      atkCount: 0, atkUpNeed: GHOST.up[0],
      atSpeedScale: 1, powerScale: 1, speedScale: 1,
      roomAtkStart: 0, lastRageAt: -99, rageUntil: 0, skillUntil: 0,
      stunUntil: 0, slowUntil: 0, aeTimer: 0, homeHealT: 0,
      turretStunUntil: 0
    };
    const survivorsH = members.slice(0, CFG.SURVIVORS);
    const slots = Math.max(CFG.SURVIVORS, survivorsH.length);
    const free = [...Array(this.rooms.length).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < slots && i < this.rooms.length; i++) {
      const m = survivorsH[i];
      const bi = botInfo[i - survivorsH.length] || {};
      const spTile = SPAWN_TILES[i % SPAWN_TILES.length];
      const p = {
        id: i,
        name: m ? m.name : (bi.name || 'Bot ' + (i + 1 - survivorsH.length)),
        skin: m ? Math.max(0, Math.min(7, m.skin | 0)) : Math.max(0, Math.min(7, bi.skin | 0)),
        human: !!m,
        conn: m ? m.conn : null,
        x: spTile[0], y: spTile[1], state: 0, room: -1, coins: CFG.START_COINS, en: 0,
        path: [], thinkT: rnd(0.8, 1.8), lastPos: 0, bedTickT: 0
      };
      if (!m) { p.room = free.pop(); this.rooms[p.room].owner = i; }
      this.players.push(p);
    }
    const sp = MAP.spawns[(Math.random() * MAP.spawns.length) | 0];
    this.ghost.x = sp.x + 0.5; this.ghost.y = sp.y + 0.5;
    this.spawn = sp;
    this.ev('Game started! Find a room and go to bed!');
  }
  ev(m) { this.events.push(m); }

  /* ---------- grid & collision helpers ---------- */
  doorAt(x, y) {
    if (!MAP.doors.has(y * COLS + x)) return null;
    const i = MAP.rooms.findIndex((r) => r.door.x === x && r.door.y === y);
    return i < 0 ? null : this.rooms[i];
  }
  roomHas(rm, type) {
    return rm.builds.some((b) => b.t === type);
  }
  roomCount(rm, type) {
    let n = 0;
    for (const b of rm.builds) if (b.t === type) n++;
    return n;
  }
  roomOfPoint(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let i = 0; i < MAP.rooms.length; i++) {
      if (MAP.rooms[i].tiles.some((t) => t.x === tx && t.y === ty)) return i;
    }
    return -1;
  }

  /* Tile-center path follower matching original ke.Move & at.Move */
  stepAlongPath(ent, speed, dt, isGhost) {
    let rem = speed * dt;
    while (ent.path.length && rem > 0.0001) {
      const n = ent.path[0];
      if (isGhost) {
        const dr = this.doorAt(n.x, n.y);
        if (dr && dr.closed && dr.doorHp > 0) return dr;
      }
      const cx = n.x + 0.5, cy = n.y + 0.5;
      const dx = cx - ent.x, dy = cy - ent.y;
      const d = Math.hypot(dx, dy);
      if (d <= rem) {
        ent.x = cx; ent.y = cy;
        rem -= d;
        ent.path.shift();
      } else {
        ent.x += (dx / d) * rem;
        ent.y += (dy / d) * rem;
        rem = 0;
      }
    }
    return null;
  }

  /* ---------- player actions ---------- */
  sleepReq(p, room) {
    if (p.state === 2) return 'You have been eliminated';
    if (p.state === 1) return null;
    if (room == null || room < 0) room = p.room;
    if (room == null || room < 0 || room >= this.rooms.length) return 'Select a room first';
    const rm = this.rooms[room];
    if (rm.dead) return 'Room has been destroyed';
    if (rm.owner !== -1 && rm.owner !== p.id) {
      const ownerP = this.players[rm.owner];
      if (p.human && ownerP && !ownerP.human && ownerP.state === 0) {
        const alt = this.rooms.find((r2) => !r2.dead && r2.owner === -1);
        if (!alt) return 'Room is already occupied';
        alt.owner = ownerP.id;
        ownerP.room = alt.i;
        ownerP.path = [];
        rm.owner = -1;
      } else {
        return 'Room is already occupied';
      }
    }
    const b = MAP.rooms[room].bed;
    if (Math.hypot(b.x + 0.5 - p.x, b.y + 0.5 - p.y) > CFG.SLEEP_REACH) return 'Move closer to the bed';
    if (p.room >= 0 && p.room !== room) this.rooms[p.room].owner = -1;
    rm.owner = p.id; p.room = room;
    p.state = 1; p.x = b.x + 0.5; p.y = b.y + 0.5; p.path = [];
    rm.closed = rm.doorHp > 0;
    rm.doorOpenUntil = 0;
    this.roomsDirty = true;
    return null;
  }
  doorReq(p, ri, open) {
    if (!p || p.state === 2) return;
    if (ri == null || ri < 0 || ri >= this.rooms.length) return;
    const rm = this.rooms[ri];
    if (!rm || rm.dead || rm.doorHp <= 0) return;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const dr = MAP.rooms[ri].door;
    const onDoor = tx === dr.x && ty === dr.y;
    if (open) {
      if (p.room !== ri && !this.inRoomIdx(p, ri) && !onDoor) return;
      rm.closed = false;
      rm.doorOpenUntil = this.t + 2.0;
      this.roomsDirty = true;
    } else {
      if (p.room !== ri && !this.inRoomIdx(p, ri) && !onDoor) return;
      const ownerP = rm.owner >= 0 ? this.players[rm.owner] : null;
      rm.doorOpenUntil = 0;
      rm.closed = !!(ownerP && ownerP.state === 1 && rm.doorHp > 0);
      this.roomsDirty = true;
    }
  }
  wake(p) {
    if (p.state !== 1) return;
    p.state = 0;
    if (p.room >= 0) {
      this.rooms[p.room].closed = false;
      this.rooms[p.room].doorOpenUntil = 0;
    }
    this.roomsDirty = true;
  }
  sleep(p) { if (p.state === 1) this.wake(p); else this.sleepReq(p, p.room); }
  inRoomIdx(p, ri) { const tx = Math.floor(p.x), ty = Math.floor(p.y); return MAP.rooms[ri].tiles.some((t) => t.x === tx && t.y === ty); }
  maxLvl(rm, t) { let m = -1; for (const b of rm.builds) if (b.t === t && b.lvl > m) m = b.lvl; return m; }
  freeTile(rm, prefer) {
    const R = MAP.rooms[rm.i];
    const used = new Set(rm.builds.map((b) => b.x + ',' + b.y));
    used.add(R.bed.x + ',' + R.bed.y); used.add(R.door.x + ',' + R.door.y);
    const c = R.tiles.filter((t) => !used.has(t.x + ',' + t.y));
    if (!c.length) return null;
    const d = (t) => Math.abs(t.x - R.door.x) + Math.abs(t.y - R.door.y);
    c.sort((a, b) => (prefer === 'near' ? d(a) - d(b) : d(b) - d(a)));
    return c[prefer === 'near' ? Math.min(1, c.length - 1) : 0];
  }
  quote(rm, type, n) {
    if (type === 'bed') {
      if (n >= BED.cost.length) return { err: 'Bed is at max level' };
      const rq = BED.reqDoor[n];
      if (rq !== null && rm.door < rq) return { err: 'Upgrade Door to LV' + (rq + 1) + ' first' };
      return { cost: BED.cost[n], en: BED.en[n] };
    }
    if (type === 'door') {
      if (n >= DOOR.cost.length) return { err: 'Door is at max level' };
      return { cost: DOOR.cost[n], en: DOOR.en[n] };
    }
    if (type === 'at') {
      if (n >= AT.cost.length) return { err: 'Turret is at max level' };
      const rq = AT.reqGame[n];
      if (rq !== null && rm.game < rq) return { err: 'Build Game Console LV' + (rq + 1) + ' first' };
      return { cost: AT.cost[n], en: AT.en[n] };
    }
    if (type === 'game') {
      if (n >= GAME.cost.length) return { err: 'Game Console is at max level' };
      return { cost: GAME.cost[n], en: GAME.en[n] };
    }
    if (type === 'mine') {
      if (n < 0 || n >= MINE.en.length) return { err: 'Invalid Mine level' };
      return { cost: MINE.cost[n], en: MINE.en[n] };
    }
    if (SPECIALS[type] != null) {
      if (n !== 0) return { err: 'Cannot upgrade this building' };
      return { cost: 0, en: SPECIALS[type], limit: ROOM_BUILD_LIMIT[type] || 1 };
    }
    return { err: 'Building not available' };
  }
  doBuild(p, rm, type, n, target, tile) {
    const q = this.quote(rm, type, n);
    if (q.err) return q.err;
    if (!target && q.limit != null && this.roomCount(rm, type) >= q.limit) return 'Max limit reached for this building';
    if (p.coins < q.cost) return 'Need ' + Math.ceil(q.cost) + ' Gold Coins';
    if (p.en < q.en) return 'Need ' + q.en + ' Lightning';
    p.coins -= q.cost; p.en -= q.en;
    if (type === 'bed') { rm.bed = n; }
    else if (type === 'door') { const old = rm.doorMax; rm.door = n; rm.doorMax = DOOR.hp[n]; rm.doorHp = rm.doorHp > 0 ? rm.doorHp + rm.doorMax - old : rm.doorMax; if (p.state === 1) rm.closed = true; }
    else if (target) { target.lvl = n; this.recalc(rm); }
    else { rm.builds.push({ t: type, lvl: n, x: tile.x, y: tile.y, cd: 0, acc: 0 }); this.recalc(rm); }
    this.buildEv.push([rm.i, type, n, target ? target.x : tile ? tile.x : -1, target ? target.y : tile ? tile.y : -1, target || type === 'bed' || type === 'door' ? 0 : 1]);
    this.roomsDirty = true;
    return null;
  }
  recalc(rm) { rm.at = this.maxLvl(rm, 'at'); rm.game = this.maxLvl(rm, 'game'); }
  dismantleReq(p, tx, ty) {
    if (p.state === 2) return 'You have been eliminated';
    if (p.room < 0) return 'Go to bed in a room first';
    const rm = this.rooms[p.room];
    const idx = rm.builds.findIndex((b) => b.x === tx && b.y === ty);
    if (idx < 0) return 'Nothing to dismantle here';
    const b = rm.builds[idx];
    const q = this.quote(rm, b.t, b.lvl);
    if (!q.err) {
      p.coins += Math.floor(q.cost / 2);
      p.en += Math.floor(q.en / 2);
    }
    rm.builds.splice(idx, 1);
    this.recalc(rm);
    this.buildEv.push([rm.i, b.t, b.lvl, b.x, b.y, -1]);
    this.roomsDirty = true;
    return null;
  }
  upgrade(p, what) {
    if (p.state === 2) return 'You have been eliminated';
    if (p.room < 0) return 'Go to bed in a room first';
    const rm = this.rooms[p.room];
    if (p.state !== 1 && !this.inRoomIdx(p, p.room)) return 'Enter your room first';
    if (what === 'repair') {
      if (rm.doorHp <= 0) return 'Door has been destroyed!';
      if (rm.repairCd > 0) return 'Repair recharging (' + Math.ceil(rm.repairCd) + 's)';
      if (rm.doorHp >= rm.doorMax) return 'Door is already at full HP';
      rm.doorHp = Math.min(rm.doorMax, rm.doorHp + Math.ceil(rm.doorMax * CFG.REPAIR_HEAL_FRAC));
      rm.repairCd = CFG.REPAIR_COOLDOWN;
      if (p.state === 1) rm.closed = true;
      this.roomsDirty = true; return null;
    }
    if (what === 'bed') return this.doBuild(p, rm, 'bed', rm.bed + 1);
    if (what === 'door') return this.doBuild(p, rm, 'door', rm.door + 1);
    if (what === 'at' || what === 'game') {
      const list = rm.builds.filter((b) => b.t === what).sort((a, b) => a.lvl - b.lvl);
      if (!list.length) { const tile = this.freeTile(rm, what === 'at' ? 'near' : 'far'); if (!tile) return 'No open tile in room'; return this.doBuild(p, rm, what, 0, null, tile); }
      return this.doBuild(p, rm, what, list[0].lvl + 1, list[0]);
    }
    if (what === 'mine' || SPECIALS[what] != null) {
      const tile = this.freeTile(rm, 'far');
      if (!tile) return 'No open tile in room';
      return this.doBuild(p, rm, what, 0, null, tile);
    }
    return 'Invalid action';
  }
  buildReq(p, name, tx, ty) {
    if (p.state === 2) return 'You have been eliminated';
    if (p.room < 0) return 'Go to bed in a room first';
    const rm = this.rooms[p.room];
    const m = /^([a-z]+)_(\d+)$/.exec(String(name));
    if (!m) return 'Building not available';
    const type = m[1], n = (+m[2]) - 1;
    if (type === 'bed') return n === rm.bed + 1 ? this.doBuild(p, rm, 'bed', n) : 'Already upgraded';
    if (type === 'door') return n === rm.door + 1 ? this.doBuild(p, rm, 'door', n) : 'Already upgraded';
    const ex = rm.builds.find((b) => b.t === type && b.x === tx && b.y === ty);
    if (ex) {
      if (type === 'at' || type === 'game') return n === ex.lvl + 1 ? this.doBuild(p, rm, type, n, ex) : 'Already upgraded';
      return 'Already built';
    }
    const R = MAP.rooms[rm.i];
    if (!R.tiles.some((t) => t.x === tx && t.y === ty) || (R.bed.x === tx && R.bed.y === ty) || (R.door.x === tx && R.door.y === ty)) return 'Cannot build here';
    if (rm.builds.some((b) => b.x === tx && b.y === ty)) return 'Tile is occupied';
    if (type === 'mine') return this.doBuild(p, rm, 'mine', n, null, { x: tx, y: ty });
    if (n !== 0) return 'Build level 1 first';
    return this.doBuild(p, rm, type, 0, null, { x: tx, y: ty });
  }

  /* ---------- bots (matching original class be + ke in bundle.js) ---------- */
  botThink(p) {
    let rm = p.room >= 0 ? this.rooms[p.room] : null;
    if (p.state === 0) {
      const humanInside = rm && this.players.some((o) => o.human && o.state !== 2 && o.room !== rm.i && this.inRoomIdx(o, rm.i));
      if (!rm || rm.dead || (rm.owner !== -1 && rm.owner !== p.id) || humanInside) {
        const alt = this.rooms.find((r2) => !r2.dead && r2.owner === -1 && !this.players.some((o) => o.human && o.state !== 2 && this.inRoomIdx(o, r2.i)));
        if (alt) {
          if (rm && rm.owner === p.id) rm.owner = -1;
          alt.owner = p.id;
          p.room = alt.i;
          p.path = [];
          rm = alt;
        } else if (!rm || rm.dead || (rm.owner !== -1 && rm.owner !== p.id)) {
          return;
        }
      }
      const bed = MAP.rooms[p.room].bed;
      const dist = Math.hypot(bed.x + 0.5 - p.x, bed.y + 0.5 - p.y);
      if (dist <= 1.2 || (dist <= CFG.SLEEP_REACH && this.inRoomIdx(p, p.room))) {
        this.sleep(p);
        return;
      }
      if (!p.path.length) {
        const path = bfs(Math.floor(p.x), Math.floor(p.y), bed.x, bed.y, this) || bfs(Math.floor(p.x), Math.floor(p.y), bed.x, bed.y, null);
        if (path) p.path = path;
      }
      return;
    }
    if (!rm || rm.dead) return;
    // Emergency defense when door is under attack and < 50% HP (original AttackedAIEventHandle)
    if (rm.underAttack && rm.doorHp < rm.doorMax * 0.5) {
      if (this.ghost.st === 1 && rm.repairCd <= 0 && !this.upgrade(p, 'repair')) return;
      if (!this.upgrade(p, 'door')) return;
    }
    // Original be UpOrBuild progression
    const atCount = this.roomCount(rm, 'at');
    const gameCount = this.roomCount(rm, 'game');
    const rqDoor = BED.reqDoor[rm.bed + 1];
    const order = [];
    if (atCount === 0) {
      order.push('at', 'bed', 'door');
    } else if (rm.underAttack && rm.doorHp < rm.doorMax * 0.35 && atCount < 3) {
      order.push('door', 'at', 'ice', 'barb', 'energyhood', 'bed');
    } else if (gameCount === 0 && rm.bed >= 2) {
      order.push('game', 'door', 'bed', 'at');
    } else if (rqDoor !== null && rqDoor !== undefined && rm.door < rqDoor) {
      order.push('door', 'at', 'bed', 'game');
    } else {
      const r = Math.random();
      if (r < 0.35) order.push('bed', 'door', 'at', 'game');
      else if (r < 0.65) order.push('door', 'at', 'bed', 'game');
      else if (r < 0.85) order.push('at', 'game', 'door', 'bed');
      else order.push('repair', 'ice', 'barb', 'energyhood', 'smoney', 'longrange', 'particlea', 'mine', 'at');
    }
    if (atCount > 0 && atCount < 3 && rm.bed >= 4 && Math.random() < 0.25) {
      const extraTile = this.freeTile(rm, 'near');
      if (extraTile && !this.doBuild(p, rm, 'at', 0, null, extraTile)) return;
    }
    for (const w of order) {
      const err = this.upgrade(p, w);
      if (!err) return;
      if (/Game Console/.test(err) && !this.upgrade(p, 'game')) return;
      if (/Door to LV/.test(err) && !this.upgrade(p, 'door')) return;
    }
  }

  /* ---------- ghost AI (matching original dt + yt + at in bundle.js) ---------- */
  ghostSpeed() { return CFG.GHOST_SPEED0 * this.ghost.speedScale * (this.t < this.ghost.slowUntil ? 0.7 : 1); }
  ghostPower() { return GHOST.power[Math.min(this.ghost.lv, GHOST.power.length - 1)] * this.ghost.powerScale * CFG.GHOST_DMG_MULT; }
  killPlayer(p, why) {
    if (p.state === 2) return;
    if (p.state === 0) this.ghostAtk = true;
    p.state = 2;
    if (p.room >= 0) {
      const rm = this.rooms[p.room];
      rm.closed = false; rm.dead = true; rm.bedHp = 0; rm.underAttack = false;
    }
    this.roomsDirty = true;
    this.deaths = (this.deaths || []).concat([p.id]);
    this.ev('Player: ' + p.name + ' has been eliminated' + (why ? ' (' + why + ')' : ''));
    if (this.ghost.st === 1) this.ghostPickTarget();
  }
  ghostLevelUp() {
    const g = this.ghost;
    if (g.lv >= GHOST.hp.length - 1) return;
    const oldMax = g.mhp;
    g.lv++;
    g.mhp = GHOST.hp[g.lv];
    g.hp = Math.min(g.mhp, g.hp + Math.max(0, g.mhp - oldMax));
    g.atkCount = 0;
    g.atkUpNeed = GHOST.up[Math.min(g.lv, GHOST.up.length - 1)];
    g.atSpeedScale = 1;
    g.powerScale = 1;
    this.ev('the Dream Hunter has upgraded: LV.' + (g.lv + 1));
  }
  hitDoor(rm) {
    const g = this.ghost;
    this.ghostAtk = true;
    rm.underAttack = true;
    // Energy hood: 3s invincible shield when door <= 30% HP
    if (this.roomHas(rm, 'energyhood') && rm.doorHp / rm.doorMax <= 0.3 && this.t >= rm.shieldCdUntil) {
      rm.shieldUntil = this.t + 3;
      rm.shieldCdUntil = this.t + 20;
    }
    if (this.t >= rm.shieldUntil) {
      rm.doorHp -= this.ghostPower();
      this.roomsDirty = true;
    }
    // Paralysis / Shock: when door <= 20%, 30% chance once per room to stun turrets in 4 tiles
    if (!rm.paralysisDone && rm.doorHp > 0 && rm.doorHp / rm.doorMax <= 0.2 && Math.random() <= 0.3) {
      rm.paralysisDone = true;
      g.turretStunUntil = Math.max(g.turretStunUntil, this.t + 4);
      this.ev('the Dream Hunter released Shock skill');
    }
    if (rm.doorHp <= 0) {
      rm.doorHp = 0;
      rm.closed = false;
      rm.underAttack = false;
      this.ev((this.players[rm.owner] ? this.players[rm.owner].name + "'s " : '') + 'Door has been destroyed!');
      // Immediately target the bed/survivor inside the room (original TrollAttack)
      if (rm.owner >= 0 && this.players[rm.owner] && this.players[rm.owner].state !== 2) {
        this.ghostTargetPlayer(this.players[rm.owner]);
      } else {
        this.ghostPickTarget();
      }
    }
  }
  hitBed(rm) {
    this.ghostAtk = true;
    rm.bedHp -= this.ghostPower();
    this.roomsDirty = true;
    if (rm.bedHp <= 0) {
      rm.bedHp = 0;
      const p = this.players[rm.owner];
      if (p) this.killPlayer(p, 'eliminated in room');
    }
  }
  ghostAroundExposedPlayer() {
    const g = this.ghost;
    const exposed = [];
    for (const p of this.players) {
      if (p.state === 2) continue;
      if (p.room >= 0 && this.rooms[p.room].closed && this.rooms[p.room].doorHp > 0) continue;
      const curRoom = p.room >= 0 ? p.room : this.roomOfPoint(p.x, p.y);
      if (curRoom >= 0 && this.rooms[curRoom].closed && this.rooms[curRoom].doorHp > 0) continue;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < CFG.GHOST_SPOT_RANGE) exposed.push({ p, d });
    }
    exposed.sort((a, b) => a.d - b.d);
    return exposed.length ? exposed[0].p : null;
  }
  ghostTargetPos() {
    const g = this.ghost;
    if (g.targetKind === 'door' && g.targetRoom >= 0) {
      const d = MAP.rooms[g.targetRoom].door;
      return { tx: d.x, ty: d.y, x: d.x + 0.5, y: d.y + 0.5 };
    }
    if (g.targetKind === 'bed' && g.targetRoom >= 0) {
      const b = MAP.rooms[g.targetRoom].bed;
      return { tx: b.x, ty: b.y, x: b.x + 0.5, y: b.y + 0.5 };
    }
    const tp = this.players[g.targetPlayer];
    if (tp && tp.state !== 2) {
      return { tx: Math.floor(tp.x), ty: Math.floor(tp.y), x: tp.x, y: tp.y };
    }
    return null;
  }
  ghostTargetPlayer(tp) {
    const g = this.ghost;
    for (const r of this.rooms) r.underAttack = false;
    g.targetPlayer = tp.id;
    g.mode = 'move';
    g.repath = 0;
    g.atSpeedScale = 1;
    g.roomAtkStart = 0;
    g.aeTimer = 0;
    const rm = tp.room >= 0 ? this.rooms[tp.room] : null;
    if (rm && rm.closed && rm.doorHp > 0) {
      g.targetKind = 'door';
      g.targetRoom = rm.i;
    } else if (tp.state === 1 && rm) {
      g.targetKind = 'bed';
      g.targetRoom = rm.i;
    } else {
      g.targetKind = 'player';
      g.targetRoom = -1;
    }
    const goal = this.ghostTargetPos();
    if (goal) {
      g.path = bfs(Math.floor(g.x), Math.floor(g.y), goal.tx, goal.ty, null) || [];
    }
  }
  ghostPickTarget() {
    const exposed = this.ghostAroundExposedPlayer();
    if (exposed) { this.ghostTargetPlayer(exposed); return; }
    const alive = this.players.filter((p) => p.state !== 2);
    if (!alive.length) return;
    const tp = alive[(Math.random() * alive.length) | 0];
    this.ghostTargetPlayer(tp);
  }
  ghostStartEscape() {
    const g = this.ghost;
    if (g.st === 2) return;
    for (const r of this.rooms) r.underAttack = false;
    g.st = 2;
    g.mode = 'escape';
    g.homeHealT = 0;
    g.path = bfs(Math.floor(g.x), Math.floor(g.y), this.spawn.x, this.spawn.y, this) || [];
    g.repath = 0.8;
    // Entrapment building slows fleeing ghost
    if (g.targetRoom >= 0 && this.roomHas(this.rooms[g.targetRoom], 'entrapment')) {
      g.slowUntil = this.t + 2.5;
    }
    this.ev('the Dream Hunter escaped');
  }
  ghostAttackTick() {
    const g = this.ghost;
    const rm = g.targetRoom >= 0 ? this.rooms[g.targetRoom] : null;
    // Ramp attack speed on consecutive hits like original yt._attack()
    if (g.atSpeedScale > 0.5) g.atSpeedScale = Math.max(0.5, g.atSpeedScale - 0.05);
    if (this.t < g.rageUntil) g.atSpeedScale = Math.max(0.35, g.atSpeedScale - 0.15);
    if (rm && this.roomHas(rm, 'ice')) g.atSpeedScale = Math.min(1.4, g.atSpeedScale + 0.2);

    g.atkCount++;
    if (g.atkCount > g.atkUpNeed) this.ghostLevelUp();

    // Rage / Berserk after 20s attacking same room
    if (!g.roomAtkStart) g.roomAtkStart = this.t;
    if (this.t - g.roomAtkStart >= 20 && this.t - g.lastRageAt >= 20) {
      g.lastRageAt = this.t;
      g.rageUntil = this.t + 8;
      this.ev('the Dream Hunter released Berserk skill');
      if (rm && this.roomHas(rm, 'spell') && Math.random() <= 0.3) {
        g.stunUntil = this.t + 3;
      }
    }

    if (g.targetKind === 'door' && rm) {
      if (!rm.closed || rm.doorHp <= 0) {
        const owner = rm.owner >= 0 ? this.players[rm.owner] : null;
        if (owner && owner.state !== 2) this.ghostTargetPlayer(owner);
        else this.ghostPickTarget();
        return;
      }
      this.hitDoor(rm);
      return;
    }
    if (g.targetKind === 'bed' && rm) {
      if (rm.closed && rm.doorHp > 0) {
        g.targetKind = 'door';
        return;
      }
      this.hitBed(rm);
      return;
    }
    const tp = this.players[g.targetPlayer];
    if (!tp || tp.state === 2) { this.ghostPickTarget(); return; }
    if (tp.state === 0 && Math.hypot(tp.x - g.x, tp.y - g.y) <= CFG.GHOST_REACH + 0.2) {
      this.killPlayer(tp, 'caught by Dream Hunter');
    } else {
      this.ghostTargetPlayer(tp);
    }
  }
  isGhostInHealZone() {
    const g = this.ghost;
    if (this.roomOfPoint(g.x, g.y) !== -1) return false;
    return MAP.spawns.some((sp) => Math.hypot(g.x - (sp.x + 0.5), g.y - (sp.y + 0.5)) <= 2.35);
  }
  ghostAI(dt) {
    const g = this.ghost;
    if (this.t < g.stunUntil) return;
    if (this.t >= g.skillUntil) g.powerScale = 1;

    // Escape & heal at spawn (10% hpMax every 1s until 100%)
    if (g.st === 2) {
      const hx = this.spawn.x + 0.5, hy = this.spawn.y + 0.5;
      const distHome = Math.hypot(g.x - hx, g.y - hy);
      const inHealZone = this.isGhostInHealZone() || distHome <= 2.35;

      // Move toward spawn center even if already on the spawn tile (avoids bfs(sameTile) === [] freeze)
      if (distHome > 0.15) {
        const gtx = Math.floor(g.x), gty = Math.floor(g.y);
        if (gtx === this.spawn.x && gty === this.spawn.y) {
          const step = Math.min(distHome, this.ghostSpeed() * dt);
          g.x += ((hx - g.x) / distHome) * step;
          g.y += ((hy - g.y) / distHome) * step;
          g.path = [];
        } else {
          g.repath -= dt;
          if (g.repath <= 0 || !g.path.length) {
            g.path = bfs(gtx, gty, this.spawn.x, this.spawn.y, this)
              || bfs(gtx, gty, this.spawn.x, this.spawn.y, null)
              || [];
            g.repath = 0.6;
          }
          const dr = this.stepAlongPath(g, this.ghostSpeed(), dt, true);
          if (dr) {
            g.cd -= dt;
            if (g.cd <= 0) {
              g.cd = CFG.GHOST_ATK_INTERVAL * g.atSpeedScale;
              this.hitDoor(dr);
            }
          }
        }
      }

      // Regenerate continuously anywhere inside the expanded spawn heal zone until 100% HP
      if (inHealZone) {
        g.homeHealT += dt;
        while (g.homeHealT >= CFG.HEAL_INTERVAL) {
          g.homeHealT -= CFG.HEAL_INTERVAL;
          g.hp = Math.min(g.mhp, g.hp + g.mhp * CFG.HEAL_STEP);
          if (g.hp >= g.mhp * CFG.HEAL_TO - 0.001) {
            g.hp = g.mhp;
            g.st = 1;
            g.mode = 'move';
            g.homeHealT = 0;
            g.targetPlayer = -1;
            this.ghostPickTarget();
            this.ev('The Dream Hunter is back on the hunt!');
            break;
          }
        }
      }
      return;
    }

    const tp = this.players[g.targetPlayer];
    if (!tp || tp.state === 2) { this.ghostPickTarget(); return; }

    // Keep targetKind in sync if player slept or woke up
    const tpRm = tp.room >= 0 ? this.rooms[tp.room] : null;
    if (g.targetKind !== 'door' && tpRm && tpRm.closed && tpRm.doorHp > 0) {
      g.targetKind = 'door';
      g.targetRoom = tpRm.i;
      g.repath = 0;
    }

    const goal = this.ghostTargetPos();
    if (!goal) { this.ghostPickTarget(); return; }
    const dist = Math.hypot(goal.x - g.x, goal.y - g.y);

    if (g.mode === 'move') {
      // Opportunistically spot nearby exposed players (original dt.GetTrollAroundPlayer)
      const exposed = this.ghostAroundExposedPlayer();
      if (exposed && exposed.id !== g.targetPlayer) {
        this.ghostTargetPlayer(exposed);
        return;
      }
      g.repath -= dt;
      if (g.repath <= 0 || !g.path.length) {
        g.path = bfs(Math.floor(g.x), Math.floor(g.y), goal.tx, goal.ty, null) || [];
        g.repath = 0.5;
      }
      // If close enough to target door/bed/player, stop moving & attack!
      if (dist <= CFG.GHOST_REACH) {
        g.mode = 'attack';
        g.path = [];
        g.cd = 0;
        g.aeTimer = 0;
        g.roomAtkStart = this.t;
        return;
      }
      // Tile-center step; if next tile is a closed door, immediately attack that door!
      const blocker = this.stepAlongPath(g, this.ghostSpeed(), dt, true);
      if (blocker) {
        g.mode = 'attack';
        g.targetKind = 'door';
        g.targetRoom = blocker.i;
        g.targetPlayer = blocker.owner >= 0 ? blocker.owner : g.targetPlayer;
        g.path = [];
        g.cd = 0;
        g.aeTimer = 0;
        g.roomAtkStart = this.t;
        return;
      }
      if (Math.hypot(goal.x - g.x, goal.y - g.y) <= CFG.GHOST_REACH) {
        g.mode = 'attack';
        g.path = [];
        g.cd = 0;
        g.aeTimer = 0;
        g.roomAtkStart = this.t;
      }
      return;
    }

    // Attack mode (original dt.AttackHandle)
    if (dist > CFG.GHOST_REACH + 0.25) {
      g.mode = 'move';
      g.repath = 0;
      for (const r of this.rooms) r.underAttack = false;
      return;
    }
    g.aeTimer += dt;
    const aeNeed = g.lv >= 4 ? 20 : 10;
    if (g.aeTimer >= aeNeed) {
      g.aeTimer = 0;
      if (Math.random() < 0.5) {
        if (g.hp / g.mhp <= 0.5) { this.ghostStartEscape(); return; }
        this.ghostPickTarget();
        return;
      }
    }
    g.cd -= dt;
    if (g.cd <= 0) {
      g.cd = CFG.GHOST_ATK_INTERVAL * g.atSpeedScale;
      this.ghostAttackTick();
    }
  }
  hurtGhost(dmg, rm) {
    const g = this.ghost;
    g.hp -= dmg;
    if (rm && g.hp > 0 && !rm.guillotineUsed && g.hp / g.mhp <= 0.2 && this.roomHas(rm, 'guillotine')) {
      rm.guillotineUsed = true;
      g.hp -= g.mhp * 0.1;
    }
    if (g.hp <= 0) { g.hp = 0; this.finish('survivors', 'Dream Hunter defeated!'); return; }
    if (g.st === 1 && g.hp <= g.mhp * CFG.ESCAPE_AT) {
      this.ghostStartEscape();
    }
  }

  /* ---------- main step ---------- */
  step(dt) {
    if (this.over) return;
    this.t += dt; this.tick++;
    for (const rm of this.rooms) {
      if (rm.repairCd > 0) rm.repairCd = Math.max(0, rm.repairCd - dt);
      if (rm.dead) continue;
      if (rm.doorOpenUntil && this.t >= rm.doorOpenUntil) {
        const R = MAP.rooms[rm.i];
        const blocked = this.players.some((pl) => {
          if (pl.state !== 0) return false;
          const d = Math.hypot(pl.x - (R.door.x + 0.5), pl.y - (R.door.y + 0.5));
          const tx = Math.floor(pl.x), ty = Math.floor(pl.y);
          const inOrOn = (tx === R.door.x && ty === R.door.y) || this.inRoomIdx(pl, rm.i);
          return d < (inOrOn ? 1.2 : 0.95);
        });
        if (blocked) {
          rm.doorOpenUntil = this.t + 0.5;
        } else {
          const ownerP = rm.owner >= 0 ? this.players[rm.owner] : null;
          rm.doorOpenUntil = 0;
          if (ownerP && ownerP.state === 1 && rm.doorHp > 0) {
            rm.closed = true;
            this.roomsDirty = true;
          }
        }
      }
      // Door passive regeneration (wt.BloodReturn) + Repair building passive heal
      if (rm.doorHp > 0 && rm.doorHp < rm.doorMax) {
        rm.regenT += dt;
        if (rm.regenT >= 1.0) {
          rm.regenT -= 1.0;
          const repairFrac = 0.01 * (rm.door + 1) + 0.02 * this.roomCount(rm, 'repair');
          rm.doorHp = Math.min(rm.doorMax, rm.doorHp + rm.doorMax * repairFrac);
          this.roomsDirty = true;
        }
      }
      // Barb building: 1% Ghost mhp damage per 1s while Ghost is attacking this room's door
      if (rm.underAttack && this.ghost.st === 1 && this.roomHas(rm, 'barb')) {
        rm.barbT += dt;
        if (rm.barbT >= 1.0) {
          rm.barbT -= 1.0;
          this.hurtGhost(this.ghost.mhp * 0.01, rm);
          if (this.over) return;
        }
      } else {
        rm.barbT = 0;
      }
    }

    const g = this.ghost;
    if (g.st === 0 && this.t >= CFG.GHOST_SPAWN_AT) {
      g.st = 1;
      this.ghostPickTarget();
      this.ev('The Dream Hunter entered the building!');
    }

    for (const p of this.players) {
      if (p.state === 2) continue;
      const rm = p.room >= 0 ? this.rooms[p.room] : null;
      if (p.state === 0) {
        if (!p.human) this.stepAlongPath(p, CFG.BOT_SPEED, dt, false);
      } else if (rm && !rm.dead) {
        p.coins += BED.out[rm.bed] * dt;
      }
      if (rm && !rm.dead) {
        for (const b of rm.builds) {
          if (b.t === 'game') p.en += GAME.out[b.lvl] * dt;
          else if (b.t === 'mine') p.coins += MINE.out[b.lvl] * dt;
        }
      }
      if (!p.human) {
        p.thinkT -= dt;
        if (p.thinkT <= 0) {
          p.thinkT = p.state === 0 ? 0.5 : rnd(0.9, 1.8);
          this.botThink(p);
        }
      }
    }

    if (g.st !== 0) this.ghostAI(dt);

    if (g.st !== 0 && !this.over && this.t >= g.turretStunUntil && !(g.st === 2 && this.isGhostInHealZone())) {
      for (const rm of this.rooms) {
        if (rm.dead) continue;
        const ownerP = rm.owner >= 0 ? this.players[rm.owner] : null;
        const rangeMult = this.roomHas(rm, 'longrange') ? Math.sqrt(1.3) : 1;
        const hasParticlea = this.roomHas(rm, 'particlea');
        const hasSolenoid = this.roomHas(rm, 'solenoid');
        const hasSmoney = this.roomHas(rm, 'smoney');
        for (const bl of rm.builds) {
          if (bl.t !== 'at') continue;
          bl.cd -= dt;
          if (bl.cd > 0) continue;
          const rng = AT.range[bl.lvl] * rangeMult;
          const dist = Math.hypot(bl.x + 0.5 - g.x, bl.y + 0.5 - g.y);
          if (dist <= rng) {
            const baseAtkSpd = 1 + (hasParticlea ? 1 : 0) + (hasSolenoid ? Math.max(0, 1 - dist / rng) * 2 : 0);
            bl.cd = 1.0 / baseAtkSpd;
            this.shots.push(rm.i); this.shots2.push([rm.i, bl.x, bl.y]);
            if (hasSmoney && ownerP && ownerP.state !== 2) {
              ownerP.coins += Math.max(1, Math.ceil((BED.out[rm.bed] / 200) * (bl.lvl + 1)));
            }
            this.hurtGhost(AT.atk[bl.lvl], rm);
            if (this.over) return;
          }
        }
      }
    }

    if (!this.players.some((p) => p.state !== 2)) this.finish('ghost', 'All survivors were eliminated');
    else if (this.t >= CFG.TIME_LIMIT) this.finish('survivors', 'Time survived! Survivors win!');
  }
  finish(winner, msg) {
    if (this.over) return;
    this.over = true;
    this.result = { winner, msg, time: Math.round(this.t), ghostLv: this.ghost.lv + 1, alive: this.players.filter((p) => p.state !== 2).map((p) => p.name) };
  }

  /* ---------- network payloads ---------- */
  initMsg(yourId, role) {
    return {
      t: 'init', role, you: yourId, rows: ROWS, cols: COLS, land: MAP.land,
      ghostSkin: this.ghostSkin != null ? this.ghostSkin : 7,
      players: this.players.map((p) => ({ id: p.id, name: p.name, skin: p.skin | 0, bot: !p.human })),
      rooms: MAP.rooms.map((r) => ({ bed: r.bed, door: r.door, tiles: r.tiles, turret: r.turretPos, game: r.gamePos })),
      tables: { BED, DOOR, AT, GAME, MINE, GHOST: { hp: GHOST.hp, power: GHOST.power }, bedHpBase: CFG.BED_HP_BASE },
      limit: CFG.TIME_LIMIT, spawnAt: CFG.GHOST_SPAWN_AT
    };
  }
  snapshot() {
    const g = this.ghost;
    const s = {
      t: 's', k: this.tick, time: r3(this.t),
      g: [r3(g.x), r3(g.y), Math.ceil(g.hp), g.mhp, g.lv, g.st],
      p: this.players.map((p) => [p.id, r3(p.x), r3(p.y), p.state, Math.floor(p.coins), Math.floor(p.en), p.room])
    };
    if (this.roomsDirty) {
      s.r = this.rooms.map((r) => [r.i, r.owner, r.bed, r.door, Math.ceil(r.doorHp), r.doorMax, Math.ceil(r.bedHp), r.bedMax, r.at, r.game, r.closed ? 1 : 0, r.dead ? 1 : 0, r.builds.map((b) => [b.t === 'at' ? 0 : 1, b.lvl, b.x, b.y])]);
      this.roomsDirty = false;
    }
    if (this.events.length) { s.ev = this.events; this.events = []; }
    if (this.shots.length) { s.f = this.shots; this.shots = []; s.sh = this.shots2; this.shots2 = []; }
    if (this.buildEv.length) { s.b = this.buildEv; this.buildEv = []; }
    if (this.ghostAtk) { s.ga = 1; this.ghostAtk = false; }
    if (this.deaths && this.deaths.length) { s.d = this.deaths; this.deaths = []; }
    return s;
  }
}

/* ===================== LOBBY / NETWORK ===================== */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function lobbyState(room) {
  return {
    t: 'room', code: room.code, host: room.host.id, max: CFG.MAX_HUMANS, playing: !!room.sim,
    ghostSkin: room.ghostSkin != null ? room.ghostSkin : -1,
    players: room.members.map((m) => ({ id: m.id, name: m.name, skin: m.skin | 0 }))
  };
}
const broadcast = (room, o) => room.members.forEach((m) => send(m.ws, o));
const pushLobby = (room) => broadcast(room, lobbyState(room));

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.members = room.members.filter((m) => m !== c);
  if (room.sim) {
    const p = room.sim.players.find((x) => x.conn === c);
    if (p) {
      p.human = false; p.conn = null; p.ix = p.iy = 0;
      if (p.state !== 2) room.sim.ev(p.name + ' disconnected (Bot took over)');
    }
  }
  if (!room.members.length) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.host === c) room.host = room.members[0];
  pushLobby(room);
}

function startGame(room, bots) {
  const members = room.members.map((m) => ({ name: m.name, skin: m.skin, conn: m }));
  const needBots = Math.max(0, CFG.SURVIVORS - members.length);
  const botList = [];
  for (let i = 0; i < needBots; i++) {
    const b = (Array.isArray(bots) && bots[i]) || {};
    botList.push({
      name: cleanName(b.name) || ('Bot ' + (i + 1)),
      skin: Math.max(0, Math.min(7, (b.skin != null ? b.skin : Math.floor(Math.random() * 8)) | 0))
    });
  }
  const sim = new Sim(members, botList);
  const rawGhost = room.ghostSkin != null ? room.ghostSkin : -1;
  sim.ghostSkin = (rawGhost >= 0 && rawGhost <= 9) ? rawGhost : Math.floor(Math.random() * 10);
  room.sim = sim;
  room.last = Date.now() + 1200;
  room.acc = 0;
  for (const m of room.members) {
    const p = sim.players.find((x) => x.conn === m);
    send(m.ws, sim.initMsg(p ? p.id : -1, 'survivor'));
  }
  const initSnap = JSON.stringify(sim.snapshot());
  for (const m of room.members) if (m.ws.readyState === 1) m.ws.send(initSnap);
  pushLobby(room);
  room.timer = setInterval(() => {
    const now = Date.now();
    if (now < room.last) return;
    room.acc += Math.min(0.25, (now - room.last) / 1000);
    room.last = now;
    const dt = 1 / CFG.TICK_HZ;
    let stepped = false;
    while (room.acc >= dt) { sim.step(dt); room.acc -= dt; stepped = true; }
    if (!stepped) return;
    const snap = JSON.stringify(sim.snapshot());
    for (const m of room.members) if (m.ws.readyState === 1) m.ws.send(snap);
    if (sim.over) {
      clearInterval(room.timer);
      broadcast(room, { t: 'end', ...sim.result });
      room.sim = null;
      pushLobby(room);
    }
  }, 1000 / CFG.TICK_HZ / 2);
}

function applyIdentity(c, msg) {
  if (msg && msg.name != null) {
    const nm = cleanName(msg.name);
    if (nm) c.name = nm;
  }
  if (msg && msg.skin != null) {
    c.skin = Math.max(0, Math.min(7, msg.skin | 0));
  }
}

function onMessage(c, msg) {
  const room = c.room;
  switch (msg.t) {
    case 'hello':
    case 'prof': {
      applyIdentity(c, msg);
      send(c.ws, { t: 'hello', id: c.id, name: c.name, skin: c.skin });
      if (room) pushLobby(room);
      break;
    }
    case 'create': {
      applyIdentity(c, msg);
      if (room) return;
      if (rooms.size > 300) return send(c.ws, { t: 'err', m: 'Server full, please try again shortly' });
      const code = newCode();
      if (!code) return;
      const r = { code, members: [c], host: c, sim: null, timer: null, ghostSkin: -1 };
      rooms.set(code, r); c.room = r;
      pushLobby(r);
      break;
    }
    case 'ghost': {
      if (!room || room.sim || room.host !== c) return;
      const sk = msg.skin | 0;
      room.ghostSkin = (sk === -1 || (sk >= 0 && sk <= 9)) ? sk : -1;
      pushLobby(room);
      break;
    }
    case 'join': {
      applyIdentity(c, msg);
      if (room) return;
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
      const r = rooms.get(code);
      if (!r) return send(c.ws, { t: 'err', m: 'Room "' + code + '" not found' });
      if (r.sim) return send(c.ws, { t: 'err', m: 'Match already in progress' });
      if (r.members.length >= CFG.MAX_HUMANS) return send(c.ws, { t: 'err', m: 'Room is full (max ' + CFG.MAX_HUMANS + ')' });
      r.members.push(c); c.room = r;
      pushLobby(r);
      break;
    }
    case 'leave': leaveRoom(c); send(c.ws, { t: 'left' }); break;
    case 'start': {
      if (!room || room.sim || room.host !== c) return;
      const bots = Array.isArray(msg.bots) ? msg.bots.slice(0, 6).map((b, idx) => ({
        name: cleanName(b && b.name) || ('Bot ' + (idx + 1)),
        skin: Math.max(0, Math.min(7, (b && b.skin) | 0))
      })) : [];
      startGame(room, bots);
      break;
    }
    case 'pos': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p || p.state !== 0) return;
      const x = +msg.x, y = +msg.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const now = Date.now();
      const first = !p.lastPos;
      const dtp = Math.min(1.5, Math.max(0.05, (now - (p.lastPos || now - 100)) / 1000));
      p.lastPos = now;
      const tx = Math.floor(x), ty = Math.floor(y);
      const dr = sim.doorAt(tx, ty);
      const maxJump = first ? 4.0 : CFG.HUMAN_SPEED * 2.5 * dtp + 0.8;
      if (isFloor(tx, ty) && !(dr && dr.closed && dr.doorHp > 0) && Math.hypot(x - p.x, y - p.y) <= maxJump) { p.x = x; p.y = y; }
      else send(c.ws, { t: 'fix', x: p.x, y: p.y });
      break;
    }
    case 'sleep': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p) return;
      let err = null;
      if (msg.on === false) sim.wake(p);
      else if (p.state !== 1) err = sim.sleepReq(p, Number.isInteger(msg.room) ? msg.room : -1);
      if (err) { send(c.ws, { t: 'toast', m: err }); send(c.ws, { t: 'denied', what: 'sleep' }); }
      break;
    }
    case 'door': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p) return;
      sim.doorReq(p, Number.isInteger(msg.room) ? msg.room : -1, !!msg.open);
      break;
    }
    case 'build': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p) return;
      const err = sim.buildReq(p, msg.name, msg.x | 0, msg.y | 0);
      if (err) { send(c.ws, { t: 'toast', m: err }); send(c.ws, { t: 'denied', what: 'build', name: String(msg.name) }); }
      break;
    }
    case 'dismantle': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p) return;
      const err = sim.dismantleReq(p, msg.x | 0, msg.y | 0);
      if (err) send(c.ws, { t: 'toast', m: err });
      break;
    }
    case 'up': {
      const sim = room && room.sim; const p = sim && sim.players.find((x) => x.conn === c);
      if (!p) return;
      const err = sim.upgrade(p, String(msg.w));
      if (err) send(c.ws, { t: 'toast', m: err });
      break;
    }
    default: break;
  }
}

/* ===================== HTTP (API + static) + WS ===================== */
function jsonRes(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleApi(req, res, p) {
  if (p === '/api/rooms' && req.method === 'GET') {
    const list = [];
    for (const r of rooms.values()) {
      if (r.sim || r.members.length >= CFG.MAX_HUMANS) continue;
      list.push({ code: r.code, hostName: r.host ? r.host.name : 'Host', players: r.members.length, max: CFG.MAX_HUMANS });
    }
    return jsonRes(res, 200, { ok: true, rooms: list });
  }
  return jsonRes(res, 404, { ok: false, error: 'Not found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.atlas': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.sk': 'application/octet-stream', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p.startsWith('/api/')) return handleApi(req, res, p);
  if (p === '/') { res.writeHead(302, { Location: GAME_URL }); return res.end(); }
  if (p === '/multiplayer.html' || p === GAME_URL + 'multiplayer.html') {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { Location: GAME_URL + (q ? q + '&mp=1' : '?mp=1') });
    return res.end();
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, must-revalidate' });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
let nextId = 1;
const perIp = new Map();
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const n = (perIp.get(ip) || 0) + 1;
  if (n > 12) { ws.close(1013, 'too many connections'); return; }
  perIp.set(ip, n);
  const c = { ws, id: nextId++, name: 'Player', skin: 0, user: null, room: null, alive: true, tokens: 60, tt: Date.now() };
  ws.isAlive = true;
  send(ws, { t: 'hello', id: c.id, name: c.name });
  ws.on('pong', () => { c.alive = true; ws.isAlive = true; });
  ws.on('message', (data) => {
    const now = Date.now();
    c.tokens = Math.min(80, c.tokens + ((now - c.tt) / 1000) * 50); c.tt = now;
    if (--c.tokens < 0) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { onMessage(c, msg); } catch (e) { console.error('msg error', e); }
  });
  ws.on('close', () => { leaveRoom(c); perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); });
  ws.on('error', () => {});
});

if (require.main === module) {
  setInterval(() => {
    wss.clients.forEach((ws) => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  }, 30000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Haunted Dorm MP server on 0.0.0.0:' + PORT + ' | rooms in map: ' + MAP.rooms.length);
    startKeepAlive();
  });
}

/* ===================== KEEP-ALIVE (self ping) =====================
   Render free plan sleeps after 15 min without inbound traffic. We ping our own PUBLIC url
   (goes through Render's proxy = counts as traffic) every KEEPALIVE_MIN minutes.
   URL: KEEPALIVE_URL, else RENDER_EXTERNAL_URL (auto-set by Render). Set KEEPALIVE=0 to disable. */
function startKeepAlive() {
  if (process.env.KEEPALIVE === '0') return;
  const base = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (!base) return console.log('[keepalive] off (no KEEPALIVE_URL / RENDER_EXTERNAL_URL - fine on localhost)');
  const every = Math.max(1, +process.env.KEEPALIVE_MIN || 10) * 60 * 1000;
  const ping = async () => {
    try {
      const r = await fetch(base + '/health', { signal: AbortSignal.timeout(15000) });
      console.log('[keepalive] ping ' + r.status);
    } catch (e) { console.log('[keepalive] ping failed: ' + (e && e.message)); }
  };
  setInterval(ping, every);
  setTimeout(ping, 60 * 1000);
  console.log('[keepalive] on -> ' + base + '/health every ' + (every / 60000) + ' min');
}
module.exports = { server, Sim, CFG, MAP, bfs };
