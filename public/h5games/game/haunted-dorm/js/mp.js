/* Haunted Dorm - Integrated Multiplayer & Account Layer (Normal Mode) */
(function () {
  'use strict';
  var H = window.__HD;
  if (!H) { console.warn('HDMP: __HD missing'); return; }
  var y = H.y, c = H.c, i = H.i, t = H.t, s = H.s, v = H.v, B = H.B, re = H.re, D = H.de.prototype;
  var Lt = H.Lt, It = H.It, tt = H.tt, dtc = H.dt, Wt = H.Wt, be = H.be, I = H.I, xe = H.xe, ve = H.ve, Be = H.Be;
  var TILE = 90;

  var MP = window.HDMP = {
    active: false,
    inGame: false,
    room: null,
    id: 0,
    ws: null,
    ui: null,
    startUI: null,
    mpBtn: null,
    init: null,
    snap: null,
    shown: {},
    launching: false,
    name: 'Player',
    pendingJoin: '',
    pendingBuilds: [],
    pendingDeaths: [],
    rooms: [],
    snaps: [],
    roomsDirty: false,
    ghostAttack: false,
    ents: null,
    ended: null,
    gameOverDone: false,
    atkUntil: 0,
    lastPosSent: 0,
    roomPoll: null,
    launchTimer: null,
    endTimer: null,
    doorHoldUntil: {},
    clockOffset: null,
    _ghostMoveHoldUntil: 0
  };

  var GHOST_NAMES = [
    'Dream Hunter',
    'Red Demon',
    'Vampire',
    'Skeleton King',
    'Grim Reaper',
    'Werewolf',
    'Ghost Bride',
    'Nightmare Demon',
    'Blood Nun',
    'Abyssal Wendigo'
  ];
  var GHOST_CYCLE = [-1, 8, 9, 7, 0, 1, 2, 3, 4, 5, 6];
  function ghostNameOf(sk) {
    return GHOST_NAMES[sk] || 'Dream Hunter';
  }

  try {
    var savedName = (localStorage.getItem('hd_name') || '').trim();
    if (savedName) MP.name = savedName.slice(0, 12);
  } catch (e) {}

  var qsJoin = '';
  var autoOpenMp = false;
  try {
    var usp = new URLSearchParams(location.search);
    qsJoin = (usp.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (qsJoin) MP.pendingJoin = qsJoin;
    autoOpenMp = usp.get('mp') === '1' || !!qsJoin;
  } catch (e) {}

  /* ---------------- helpers ---------------- */
  function mySkin() {
    try { return Math.max(0, Math.min(7, c.instance.player.playerSelectIndex | 0)); } catch (e) { return 7; }
  }
  function myName() {
    var raw = String(MP.name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 12);
    return raw || 'Player';
  }
  function saveName(nm) {
    var clean = String(nm || '').replace(/[^\w .\-]/g, '').trim().slice(0, 12) || 'Player';
    MP.name = clean;
    try { localStorage.setItem('hd_name', clean); } catch (e) {}
    return clean;
  }
  function toast(msg) {
    if (!msg) return;
    try {
      if (Laya && Laya.Dialog && H.u && H.u.assetRoot) {
        y.instance.Fire(y.instance.UIGM_TIPS, msg);
      }
    } catch (e) {}
    var old = document.getElementById('hdmpToast');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'hdmpToast';
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:100001;background:rgba(18,7,9,0.92);color:#f5e6d3;border:2px solid #9d1b22;box-shadow:0 6px 20px rgba(0,0,0,0.65);padding:9px 16px;border-radius:8px;font:600 14px system-ui,sans-serif;max-width:86vw;text-align:center;pointer-events:none';
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 3000);
  }
  function send(o) {
    if (MP.ws && MP.ws.readyState === 1) MP.ws.send(JSON.stringify(o));
  }
  MP.send = send;

  MP.onSkinChange = function (skinIdx) {
    if (MP.ws && MP.ws.readyState === 1) {
      send({ t: 'prof', name: myName(), skin: Math.max(0, Math.min(7, skinIdx | 0)) });
    }
  };

  /* ---------------- StartGameUI native Laya button ---------------- */
  MP.mountStartUI = function (startUI) {
    MP.startUI = startUI;
    try {
      if (!startUI.centerBox.getChildByName('mpBtn')) {
        var mpBtn = new Laya.Image();
        mpBtn.name = 'mpBtn';
        mpBtn.skin = 'StartGameUI/redBtn.png';
        mpBtn.width = 390;
        mpBtn.height = 106;
        mpBtn.pivot(195, 53);
        mpBtn.pos(320, 845);
        mpBtn.mouseEnabled = true;

        var lbl = new Laya.Label();
        lbl.text = 'MULTIPLAYER';
        lbl.width = 390;
        lbl.height = 106;
        lbl.align = 'center';
        lbl.valign = 'middle';
        lbl.fontSize = 36;
        lbl.bold = true;
        lbl.color = '#f5e6d3';
        lbl.stroke = 5;
        lbl.strokeColor = '#280404';
        mpBtn.addChild(lbl);

        v.instance.AddBtnEvent([mpBtn]);
        mpBtn.on(Laya.Event.CLICK, null, function () { MP.open(); });
        startUI.centerBox.addChild(mpBtn);
        MP.mpBtn = mpBtn;
      }

      if (autoOpenMp && !MP._autoJoinHandled) {
        MP._autoJoinHandled = true;
        setTimeout(function () {
          if (MP.pendingJoin) {
            var code = MP.pendingJoin;
            MP.pendingJoin = '';
            MP.open();
            var inp = document.getElementById('hdmpCode');
            if (inp) inp.value = code;
            connect(function () {
              send({ t: 'join', code: code, name: myName(), skin: mySkin() });
            });
          } else {
            MP.open();
          }
        }, 350);
      }
    } catch (e) {
      console.error('HDMP mountStartUI', e);
    }
  };

  /* ---------------- websocket ---------------- */
  function connect(cb) {
    if (MP.ws && MP.ws.readyState === 1) {
      send({ t: 'hello', name: myName(), skin: mySkin() });
      return cb && cb();
    }
    if (MP.ws && MP.ws.readyState === 0) {
      MP.ws.addEventListener('open', function onOpen() {
        MP.ws.removeEventListener('open', onOpen);
        cb && cb();
      });
      return;
    }
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var ws = MP.ws = new WebSocket(proto + location.host + '/ws');
    ws.onopen = function () {
      send({ t: 'hello', name: myName(), skin: mySkin() });
      cb && cb();
    };
    ws.onmessage = function (e) {
      try { onMsg(JSON.parse(e.data)); } catch (err) { console.error('HDMP msg', err); }
    };
    ws.onclose = function () {
      if (MP.ws === ws) MP.ws = null;
      if (MP.inGame && !MP.gameOverDone) toast('Connection lost');
      else if (MP.active && !MP.inGame) toast('Disconnected from lobby');
    };
    ws.onerror = function () { dlgErr('Unable to reach game server'); };
  }

  function onMsg(m) {
    handleExtra(m);
    switch (m.t) {
      case 'hello':
        MP.id = m.id;
        break;
      case 'room':
        MP.room = m;
        closeDialog();
        if (!MP.active) { MP.active = true; openMatching(); } else renderMatching();
        break;
      case 'err':
        dlgErr(m.m);
        if (MP.active) toast(m.m);
        break;
      case 'toast':
        toast(m.m);
        break;
      case 'left':
        MP.active = false;
        MP.room = null;
        break;
      case 'init':
        MP.init = m;
        onInit(m);
        break;
      case 's':
        MP.snap = m;
        if (MP.onSnap) MP.onSnap(m);
        break;
      case 'end':
        if (MP.onEnd) MP.onEnd(m);
        break;
    }
  }

  /* ---------------- In-Game Styled Room Modal (No Login Needed) ---------------- */
  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function dlgErr(msg) {
    var e = document.getElementById('hdmpErr');
    if (e) e.textContent = msg || '';
  }
  function closeDialog() {
    if (MP.roomPoll) { clearInterval(MP.roomPoll); MP.roomPoll = null; }
    var d = document.getElementById('hdmpDlg');
    if (d) d.remove();
  }

  function injectModalStyles() {
    if (document.getElementById('hdmpCss')) return;
    var st = document.createElement('style');
    st.id = 'hdmpCss';
    st.textContent = [
      '#hdmpDlg{position:fixed;inset:0;z-index:99999;background:rgba(6,3,5,0.82);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif;touch-action:manipulation}',
      '#hdmpCard{position:relative;width:min(92vw,370px);background:linear-gradient(180deg,#241014 0%,#12080a 100%);border:3px solid #8c191f;border-radius:16px;box-shadow:0 18px 46px rgba(0,0,0,0.85),inset 0 0 22px rgba(0,0,0,0.75);padding:20px 18px 18px;color:#f5e6d3;display:flex;flex-direction:column;gap:12px}',
      '#hdmpClose{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;background:url("UI/close.png") center/contain no-repeat;cursor:pointer;padding:0}',
      '.hdmp-title{margin:0;text-align:center;font-size:24px;font-weight:800;letter-spacing:1.5px;color:#ffd8a8;text-shadow:0 2px 0 #280404,0 0 12px rgba(210,35,45,0.55)}',
      '.hdmp-sub{text-align:center;font-size:12px;color:#b89b96;margin-top:-6px}',
      '.hdmp-avatar{display:flex;align-items:center;gap:10px;background:#0e0608;border:1px solid #4e171b;border-radius:12px;padding:8px 10px}',
      '.hdmp-avatar img{width:42px;height:42px;object-fit:contain;border-radius:8px;background:#1c0d10;border:1px solid #6b1d22;padding:2px;flex-shrink:0}',
      '.hdmp-in{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:2px solid #52181c;background:#0b0507;color:#fff;font:600 15px inherit;outline:none;user-select:text}',
      '.hdmp-in:focus{border-color:#c92a32}',
      '.hdmp-code{text-transform:uppercase;letter-spacing:6px;text-align:center;font-size:19px!important;font-weight:800!important}',
      '.hdmp-btn{width:100%;border:2px solid #c92a32;border-radius:11px;padding:12px 14px;font:800 16px inherit;letter-spacing:1.2px;color:#fff4e6;background:linear-gradient(180deg,#a81c24 0%,#650e13 100%);box-shadow:0 4px 12px rgba(0,0,0,0.5);cursor:pointer;text-shadow:0 2px 2px #1c0202}',
      '.hdmp-btn:active{transform:scale(0.98)}',
      '.hdmp-btn.sec{background:linear-gradient(180deg,#332024 0%,#1d1114 100%);border-color:#693439;font-size:14px;padding:10px 12px}',
      '.hdmp-row{display:flex;gap:8px;align-items:center}',
      '.hdmp-err{min-height:18px;text-align:center;font-size:13px;font-weight:600;color:#ff878b}',
      '.hdmp-rooms{max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}',
      '.hdmp-room-item{display:flex;align-items:center;justify-content:space-between;background:#0e0608;border:1px solid #4a171b;border-radius:9px;padding:8px 11px;font-size:13px}',
      '.hdmp-room-item button{border:1px solid #b5242b;background:#781318;color:#fff;border-radius:7px;padding:5px 11px;font:700 12px inherit;cursor:pointer}'
    ].join('');
    document.head.appendChild(st);
  }

  function showModal() {
    injectModalStyles();
    closeDialog();
    var wrap = document.createElement('div');
    wrap.id = 'hdmpDlg';
    wrap.innerHTML = '<div id="hdmpCard"><button id="hdmpClose" aria-label="Close"></button><div id="hdmpBody"></div></div>';
    document.body.appendChild(wrap);
    document.getElementById('hdmpClose').onclick = closeDialog;
    wrap.onclick = function (e) { if (e.target === wrap) closeDialog(); };
    renderRoomView();
  }

  function renderRoomView() {
    var body = document.getElementById('hdmpBody');
    if (!body) return;
    body.innerHTML = [
      '<div style="display:flex;flex-direction:column;gap:11px">',
      '  <h2 class="hdmp-title">MULTIPLAYER</h2>',
      '  <div class="hdmp-sub">Normal Mode · Remaining slots auto-fill with Bots</div>',
      '  <div class="hdmp-avatar">',
      '    <img src="StartGameUI/player_' + mySkin() + '.png" alt="avatar">',
      '    <div style="flex:1;min-width:0">',
      '      <input id="hdmpName" class="hdmp-in" type="text" maxlength="12" placeholder="Your Name" value="' + esc(myName()) + '" style="padding:7px 10px;font-size:14px">',
      '    </div>',
      '  </div>',
      '  <button id="hdmpCreate" class="hdmp-btn" type="button">CREATE ROOM</button>',
      '  <div class="hdmp-row">',
      '    <input id="hdmpCode" class="hdmp-in hdmp-code" type="text" maxlength="4" placeholder="CODE">',
      '    <button id="hdmpJoin" class="hdmp-btn sec" style="width:110px" type="button">JOIN</button>',
      '  </div>',
      '  <div style="font-size:12px;color:#b89b96;font-weight:700;letter-spacing:.6px">OPEN ROOMS</div>',
      '  <div id="hdmpRooms" class="hdmp-rooms"><div style="font-size:12px;color:#8c7470;text-align:center;padding:8px">Checking open rooms...</div></div>',
      '  <div id="hdmpErr" class="hdmp-err"></div>',
      '</div>'
    ].join('');

    var nameIn = document.getElementById('hdmpName');
    var codeIn = document.getElementById('hdmpCode');
    if (MP.pendingJoin) {
      codeIn.value = MP.pendingJoin;
      MP.pendingJoin = '';
    }
    nameIn.oninput = function () { saveName(nameIn.value); };

    document.getElementById('hdmpCreate').onclick = function () {
      var nm = saveName(nameIn.value);
      dlgErr('');
      connect(function () { send({ t: 'create', name: nm, skin: mySkin() }); });
    };
    document.getElementById('hdmpJoin').onclick = function () {
      var nm = saveName(nameIn.value);
      var code = (codeIn.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) { dlgErr('Enter 4-letter room code'); return; }
      dlgErr('');
      connect(function () { send({ t: 'join', code: code, name: nm, skin: mySkin() }); });
    };
    codeIn.onkeydown = function (e) { if (e.key === 'Enter') document.getElementById('hdmpJoin').click(); };

    function loadRooms() {
      fetch('/api/rooms', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var box = document.getElementById('hdmpRooms');
          if (!box) return;
          var list = (data && data.rooms) || [];
          if (!list.length) {
            box.innerHTML = '<div style="font-size:12px;color:#8c7470;text-align:center;padding:8px">No open rooms yet — Create one!</div>';
            return;
          }
          box.innerHTML = list.map(function (r) {
            return '<div class="hdmp-room-item"><span><b>' + esc(r.code) + '</b> · ' + esc(r.hostName) + ' (' + r.players + '/' + r.max + ')</span><button data-code="' + esc(r.code) + '" type="button">JOIN</button></div>';
          }).join('');
          box.querySelectorAll('button[data-code]').forEach(function (b) {
            b.onclick = function () {
              var nm = saveName(nameIn.value);
              var code = b.getAttribute('data-code');
              connect(function () { send({ t: 'join', code: code, name: nm, skin: mySkin() }); });
            };
          });
        }).catch(function () {});
    }
    loadRooms();
    MP.roomPoll = setInterval(loadRooms, 2500);
  }

  MP.open = function () {
    showModal();
  };

  /* ---------------- original MatchingUI, driven by the room ---------------- */
  function openMatching() {
    i.mode = t.Normal;
    y.instance.Fire(y.instance.GM_SELECTMAP, 0);
    var S = Be.instance.script;
    if (Be.instance.Show('macthingUI')) S.startGameUI.Hide();
  }

  var SLOTS = [2, 1, 3, 4, 5, 6]; // slot 2 = "Me", slot 0 = Dream Hunter
  function setHead(ui, slot, skin, name, animate) {
    var h = ui.heads.getChildAt(slot);
    if (!h) return;
    h.skin = skin;
    var nm = h.getChildByName('name');
    if (nm) nm.text = name;
    if (animate) {
      v.instance.Shake(h, .2);
      try { B.instance.PlaySound(B.instance.Other_sound.MP); } catch (e) {}
    }
  }
  function resetHeads(ui) {
    for (var k = 0; k < ui.heads.numChildren - 1; k++) setHead(ui, k, 'pipei/z20kb3.png', '????', false);
  }
  function renderMatching() {
    var ui = MP.ui, R = MP.room;
    if (!ui || !R || !ui.heads) return;
    resetHeads(ui);
    var list = R.players.slice();
    list.sort(function (a, b) { return (a.id === MP.id ? -1 : 0) - (b.id === MP.id ? -1 : 0); });
    var shown = {};
    list.forEach(function (p, idx) {
      if (idx < SLOTS.length) {
        setHead(ui, SLOTS[idx], 'StartGameUI/player_' + (p.skin | 0) + '.png', p.name, !MP.shown[p.id]);
        shown[p.id] = 1;
      }
    });
    var gSkin = R.ghostSkin != null ? R.ghostSkin : -1;
    var isHost = R.host === MP.id;
    var gHeadSkin = (gSkin >= 0 && gSkin <= 9) ? ('StartGameUI/mg_' + gSkin + '.png') : 'pipei/z20kb3.png';
    var gName = (gSkin >= 0 && gSkin <= 9 ? ghostNameOf(gSkin) : 'Random Demon') + (isHost ? ' (Tap)' : '');
    setHead(ui, 0, gHeadSkin, gName, false);
    var ghostHead = ui.heads.getChildAt(0);
    if (ghostHead && !ghostHead._mpGhostHook) {
      ghostHead._mpGhostHook = true;
      ghostHead.mouseEnabled = true;
      ghostHead.on(Laya.Event.CLICK, null, function () {
        if (!MP.active || !MP.room || MP.room.host !== MP.id) return;
        var curG = MP.room.ghostSkin != null ? MP.room.ghostSkin : -1;
        var idx = GHOST_CYCLE.indexOf(curG);
        var next = GHOST_CYCLE[(idx + 1) % GHOST_CYCLE.length];
        send({ t: 'ghost', skin: next });
      });
    }
    MP.shown = shown;
    if (ui.ModeTitle) ui.ModeTitle.text = 'NORMAL MODE';
    var botsCount = Math.max(0, 6 - R.players.length);
    ui.pp.text = 'CODE ' + R.code + '  ·  ' + R.players.length + '/' + R.max + (botsCount ? ' (+' + botsCount + ' BOTS)' : '');
    var iAmHost = R.host === MP.id;
    ui.startText.text = iAmHost ? 'START' : 'WAIT HOST';
    if (ui.black) ui.black.alpha = iAmHost ? 0 : 0.45;
    ui.skinBtn.visible = true;
    for (var q = 0; q < ui.skinBtn.numChildren; q++) {
      var ch = ui.skinBtn.getChildAt(q);
      if (ch.name === '') ch.visible = false; // hide video-ad icon
    }
    ui.skinText.text = 'INVITE LINK';
    ui.skinText.fontSize = 36;
  }

  var oShow = D._Show, oHide = D._Hide, oMatch = D.MatchEvent, oStart = D.StartBtnClick, oBack = D.BackBtnClickEvent, oSkin = D.changeSkin;
  D._Show = function () {
    oShow.apply(this, arguments);
    if (!MP.active) {
      if (this.skinBtn) {
        for (var q = 0; q < this.skinBtn.numChildren; q++) this.skinBtn.getChildAt(q).visible = true;
      }
      if (this.skinText) this.skinText.fontSize = 40;
      return;
    }
    MP.ui = this; MP.shown = {};
    renderMatching();
  };
  D._Hide = function () {
    var r = oHide.apply(this, arguments);
    if (this.skinBtn) {
      for (var q = 0; q < this.skinBtn.numChildren; q++) this.skinBtn.getChildAt(q).visible = true;
    }
    if (this.skinText) this.skinText.fontSize = 40;
    if (MP.ui === this) MP.ui = null;
    return r;
  };
  D.MatchEvent = function () {
    if (!MP.active) return oMatch.apply(this, arguments);
  };
  D.changeSkin = function () {
    if (!MP.active) return oSkin.apply(this, arguments);
    if (!MP.room) return;
    var url = location.origin + location.pathname + '?join=' + MP.room.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast('Invite link copied! Room Code: ' + MP.room.code);
      }).catch(function () {
        toast('Share Room Code: ' + MP.room.code);
      });
    } else {
      toast('Share Room Code: ' + MP.room.code);
    }
  };
  D.StartBtnClick = function () {
    if (!MP.active) return oStart.apply(this, arguments);
    v.instance.Shake(this.startGameBtn, .1);
    var R = MP.room;
    if (!R) return;
    if (R.host !== MP.id) { toast('Waiting for host to start'); return; }
    var humans = R.players.length;
    var bots = [];
    for (var k = humans; k < 6; k++) {
      var bName = '';
      try { bName = re.instance.name || ''; } catch (e) {}
      if (!bName || bName.indexOf('undefined') !== -1) bName = 'Bot ' + (k - humans + 1);
      bots.push({ name: bName, skin: Math.floor(Math.random() * 8) });
    }
    send({ t: 'start', bots: bots });
  };
  D.BackBtnClickEvent = function () {
    if (MP.launchTimer) { clearTimeout(MP.launchTimer); MP.launchTimer = null; }
    MP.launching = false;
    if (MP.active) { send({ t: 'leave' }); MP.active = false; MP.room = null; }
    return oBack.apply(this, arguments);
  };

  /* ---------------- game start (server says go) ---------------- */
  function onInit(m) {
    if (MP.launching) return;
    MP.launching = true;
    var gSkin = (m.ghostSkin != null && m.ghostSkin >= 0 && m.ghostSkin <= 9) ? m.ghostSkin : 0;
    var gName = ghostNameOf(gSkin);
    var ui = MP.ui || Be.instance.script.macthingUI;
    if (ui && ui.heads) {
      resetHeads(ui);
      var list = m.players.slice();
      list.sort(function (a, b) { return (a.id === m.you ? -1 : 0) - (b.id === m.you ? -1 : 0); });
      list.forEach(function (p, idx) {
        if (idx < SLOTS.length) setHead(ui, SLOTS[idx], 'StartGameUI/player_' + (p.skin | 0) + '.png', p.name, true);
      });
      setHead(ui, 0, 'StartGameUI/mg_' + gSkin + '.png', gName, false);
      ui.pp.text = 'GET READY!';
    }
    if (MP.launchTimer) clearTimeout(MP.launchTimer);
    MP.launchTimer = setTimeout(function () { MP.launchTimer = null; launch(m); }, 200);
  }
  function launch(m) {
    var G = c.instance.game;
    G.playerArr = [];
    m.players.forEach(function (p) { if (p.id !== m.you) G.playerArr.push({ name: p.name, index: p.skin | 0 }); });
    G.playerArr = G.playerArr.slice(0, 5);
    var gSkin = (m.ghostSkin != null && m.ghostSkin >= 0 && m.ghostSkin <= 9) ? m.ghostSkin : 0;
    var idxInSkin = c.instance.player.skin.indexOf(gSkin);
    c.instance.player.trollIndex = idxInSkin >= 0 ? idxInSkin : 0;
    G.trollName = ghostNameOf(gSkin);
    var ui = MP.ui || Be.instance.script.macthingUI;
    MP.launching = false;
    MP.inGame = true;
    MP.gameOverDone = false;
    if (MP.endTimer) { clearTimeout(MP.endTimer); MP.endTimer = null; }
    MP.ents = null;
    MP.ended = null;
    MP.pendingBuilds = [];
    MP.pendingDeaths = [];
    MP.rooms = [];
    MP.snaps = [];
    MP.clockOffset = null;
    MP._ghostMoveHoldUntil = 0;
    MP.roomsDirty = false;
    MP.ghostAttack = false;
    MP.atkUntil = 0;
    MP.lastPosSent = 0;
    MP.lastCountdown = -1;
    MP.countdownDone = false;
    MP.ve = null;
    MP.lastBed = null;
    MP.doorHoldUntil = {};
    ui.StartGame();
    startSync(m);
  }

  /* =====================================================================
     SERVER-DRIVEN NORMAL MODE SCENE SYNC
     ===================================================================== */
  var oBeStart = be.prototype.StartGame;
  be.prototype.StartGame = function () { if (MP.inGame) return; return oBeStart.apply(this, arguments); };
  var oDtUp = dtc.prototype.UpData;
  dtc.prototype.UpData = function () { if (MP.inGame) return; return oDtUp.apply(this, arguments); };
  var oDtHit = dtc.prototype.Hit;
  dtc.prototype.Hit = function () { if (MP.inGame) return; return oDtHit.apply(this, arguments); };
  var oDtStart = dtc.prototype.StartGame;
  dtc.prototype.StartGame = function () { MP.dt = this; return oDtStart.apply(this, arguments); };
  var oWtStart = Wt.prototype.StartGame;
  Wt.prototype.StartGame = function () {
    MP.wt = this;
    try {
      var dr = this._buildInfo && this._buildInfo.door;
      if (dr && dr.BloodReturn && !dr._mpPatched) {
        var oBR = dr.BloodReturn;
        dr._mpPatched = true;
        dr.BloodReturn = function () { if (MP.inGame) return; return oBR.apply(this, arguments); };
      }
    } catch (e) {}
    return oWtStart.apply(this, arguments);
  };
  var oGO = xe.prototype.GameOver;
  xe.prototype.GameOver = function () {
    MP.gameOverDone = true;
    MP.launching = false;
    if (MP.launchTimer) { clearTimeout(MP.launchTimer); MP.launchTimer = null; }
    if (MP.endTimer) { clearTimeout(MP.endTimer); MP.endTimer = null; }
    I.instance.removeListEvent('mpSync');
    var r = oGO.apply(this, arguments);
    if (MP.inGame || MP.active) {
      MP.inGame = false;
      MP.active = false;
      MP.room = null;
      MP.init = null;
      MP.ents = null;
      MP.snaps = [];
      MP.wt = null;
      MP.dt = null;
      MP.doorHoldUntil = {};
      send({ t: 'leave' });
    }
    return r;
  };

  /* --- building: ask the server --- */
  function tileOf(cb) { return { x: cb.y != null ? cb.y : -1, y: cb.x != null ? cb.x : -1 }; }
  var oBOU = Wt.prototype.BuildOrUp;
  Wt.prototype.BuildOrUp = function (name) {
    if (!MP.inGame) return oBOU.apply(this, arguments);
    var tl = tileOf(this.clickBlock);
    send({ t: 'build', name: name, x: tl.x, y: tl.y });
    try { this._buildMenu.MenuHide(); } catch (e) {}
  };
  var oBOUA = Wt.prototype.BuildOrUpADV;
  Wt.prototype.BuildOrUpADV = function (name) {
    if (!MP.inGame) return oBOUA.apply(this, arguments);
    var tl = tileOf(this.clickBlock);
    send({ t: 'build', name: name, x: tl.x, y: tl.y });
    try { this._buildMenu.MenuHide(); } catch (e) {}
  };
  var oDismantle = Wt.prototype.BuildDismantle;
  Wt.prototype.BuildDismantle = function () {
    if (!MP.inGame) return oDismantle.apply(this, arguments);
    var cb = this.clickBlock;
    var tl = tileOf(cb);
    if ((tl.x < 0 || tl.y < 0) && cb && cb.block && cb.block.pos) {
      tl = { x: cb.block.pos.y, y: cb.block.pos.x };
    }
    send({ t: 'dismantle', x: tl.x, y: tl.y });
    try { this._buildMenu.MenuHide(); } catch (e) {}
  };
  function applyBuild(ev) { // [room, type, levelIndex, col, row, isNew]
    var wt = MP.wt, init = MP.init; if (!wt || !init) return;
    var ri = ev[0], type = ev[1], n = ev[2], col = ev[3], row = ev[4], isNew = ev[5];
    var R = init.rooms[ri];
    if (type === 'bed') { col = R.bed.x; row = R.bed.y; } else if (type === 'door') { col = R.door.x; row = R.door.y; }
    var name = type + '_' + (n + 1), key = row + '_' + col;
    try {
      if (isNew === -1) {
        var dbi = wt._buildInfo[type];
        var dBlk = dbi ? dbi.FindBlockInfo_Pos(key) : wt.FindBlockPos(key, ri);
        if (dBlk) {
          if (!dbi && dBlk.room) {
            try { dBlk.room.RemoveBuff(dBlk.name); dBlk.room.BuildDismantle(dBlk); } catch (e) {}
          }
          var bx = dBlk.x, by = dBlk.y, bNode = dBlk.build;
          try { dBlk.GameOver(); } catch (e) {}
          y.instance.Fire(y.instance.MAP_BUILD_DISMANTLE, bNode, bx, by);
          try { B.instance.PlaySound(B.instance.TB_sound.build_up, 1, bx, by); } catch (e) {}
        }
        return;
      }
      if (isNew) { y.instance.Fire(y.instance.MAP_BUILD_NEW, row, col, name, false); return; }
      var bi = wt._buildInfo[type], info = bi && bi.FindBlockInfo_Pos(key);
      if (info) {
        y.instance.Fire(y.instance.MAP_UPBUILD, info.build, name);
        bi.BuildUp(key);
        try { B.instance.PlaySound(B.instance.TB_sound.build_up, 1, info.build.x, info.build.y); } catch (e) {}
        try { H.Y.instance.AddEffect(H.Y.instance.effectStr.buildDownEffect, info.build.x, info.build.y); } catch (e) {}
      }
    } catch (err) { console.error('HDMP applyBuild', err); }
  }

  /* --- repair button: ask server AND trigger wrench animation --- */
  var oFire = y.prototype.Fire;
  y.prototype.Fire = function (ev) {
    if (MP.inGame && ev === this.BUILD_SKILLEVENT && arguments[2] === 0) {
      send({ t: 'up', w: 'repair' });
    }
    return oFire.apply(this, arguments);
  };

  /* --- sleeping & doors --- */
  var oUp = ve.prototype.UpBed, oDown = ve.prototype.DownBen;
  var oOpenDoor = ve.prototype.OpenDoor, oOffDoor = ve.prototype.OffDoor;
  ve.prototype.UpBed = function (bed) {
    var r = oUp.apply(this, arguments);
    if (MP.inGame && bed && bed.room) {
      MP.ve = this; MP.lastBed = bed;
      var me = Lt.instance.player;
      send({ t: 'pos', x: me.x / TILE, y: me.y / TILE });
      send({ t: 'sleep', on: true, room: bed.room.roomIndex });
    }
    return r;
  };
  ve.prototype.DownBen = function () {
    var r = oDown.apply(this, arguments);
    if (MP.inGame) {
      var me = Lt.instance && Lt.instance.player;
      if (me) send({ t: 'pos', x: me.x / TILE, y: me.y / TILE });
      send({ t: 'sleep', on: false });
    }
    return r;
  };
  var oBlocked = ve.prototype._isDoorBlockedByPlayer;
  ve.prototype._isDoorBlockedByPlayer = function (door) {
    var blocked = oBlocked ? oBlocked.apply(this, arguments) : false;
    if (blocked && MP.inGame && door && door.room) {
      var ri = door.room.roomIndex;
      var now = performance.now();
      MP.doorHoldUntil[ri] = now + 1000;
      if (!MP.doorExtendSent || now - (MP.doorExtendSent[ri] || 0) > 400) {
        MP.doorExtendSent = MP.doorExtendSent || {};
        MP.doorExtendSent[ri] = now;
        send({ t: 'door', room: ri, open: true });
      }
    }
    return blocked;
  };
  ve.prototype.OpenDoor = function (door) {
    var r = oOpenDoor.apply(this, arguments);
    if (MP.inGame && door && door.room) {
      var me = Lt.instance && Lt.instance.player;
      if (me) send({ t: 'pos', x: me.x / TILE, y: me.y / TILE });
      MP.doorHoldUntil[door.room.roomIndex] = performance.now() + 2100;
      send({ t: 'door', room: door.room.roomIndex, open: true });
    }
    return r;
  };
  ve.prototype.OffDoor = function (door) {
    var r = oOffDoor.apply(this, arguments);
    if (MP.inGame && door && door.room) {
      var me = Lt.instance && Lt.instance.player;
      if (me) send({ t: 'pos', x: me.x / TILE, y: me.y / TILE });
      delete MP.doorHoldUntil[door.room.roomIndex];
      send({ t: 'door', room: door.room.roomIndex, open: false });
    }
    return r;
  };

  /* --- messages --- */
  MP.onSnap = function (snap) {
    snap.arr = performance.now();
    snap.srvMs = (snap.time || 0) * 1000;
    var sampleOff = snap.arr - snap.srvMs;
    if (MP.clockOffset == null) {
      MP.clockOffset = sampleOff;
    } else if (Math.abs(sampleOff - MP.clockOffset) > 300) {
      MP.clockOffset = sampleOff;
    } else {
      MP.clockOffset = MP.clockOffset * 0.92 + sampleOff * 0.08;
    }
    if (MP.snaps.length && snap.srvMs <= MP.snaps[MP.snaps.length - 1].srvMs) {
      MP.snaps[MP.snaps.length - 1] = snap;
    } else {
      MP.snaps.push(snap);
      if (MP.snaps.length > 12) MP.snaps.shift();
    }
    if (snap.b) snap.b.forEach(function (e) { MP.pendingBuilds.push(e); });
    if (snap.d) snap.d.forEach(function (id) { MP.pendingDeaths.push(id); });
    if (snap.ev) snap.ev.forEach(function (m) { try { y.instance.Fire(y.instance.UIGM_TIPS, m); } catch (e) {} });
    if (snap.ga) MP.ghostAttack = true;
    if (snap.r) { MP.rooms = snap.r; MP.roomsDirty = true; }
  };
  MP.onEnd = function (m) {
    MP.ended = m;
    if (MP.endTimer) clearTimeout(MP.endTimer);
    MP.endTimer = setTimeout(function () {
      MP.endTimer = null;
      if (MP.gameOverDone || !MP.inGame) return;
      var me = Lt.instance && Lt.instance.player;
      if (me && me.isDie) return;
      var won = m.winner === 'survivors';
      c.instance.game.isWin = won;
      if (won) {
        var mvpSkin = mySkin();
        if (MP.init && Array.isArray(MP.init.players) && Array.isArray(m.alive) && m.alive.length) {
          var surv = MP.init.players.filter(function (p) { return m.alive.indexOf(p.name) !== -1; })[0];
          if (surv) mvpSkin = Math.max(0, Math.min(7, surv.skin | 0));
        }
        c.instance.game.mvpIndex = mvpSkin;
      }
      y.instance.Fire(y.instance.GM_GAMEOVER, won ? true : undefined);
    }, 1000);
  };
  function handleExtra(m) {
    if (m.t === 'fix' && MP.inGame) {
      var me = Lt.instance.player;
      if (me && me.player) {
        var fx = m.x * TILE, fy = m.y * TILE;
        var dist = Math.hypot(fx - me.x, fy - me.y);
        if (dist > 28) { me.x = fx; me.y = fy; }
        else if (dist > 4) { me.x += (fx - me.x) * 0.3; me.y += (fy - me.y) * 0.3; }
      }
    }
    if (m.t === 'denied' && MP.inGame && m.what === 'sleep' && MP.ve && MP.lastBed) {
      try {
        oDown.call(MP.ve, MP.lastBed);
        if (Lt.instance && Lt.instance.player) Lt.instance.player.roomIndex = -1;
      } catch (e) {}
    }
  }

  /* --- per-frame sync --- */
  function bindEnts(init) {
    var E = Lt.instance, arr = E.playerArr;
    if (!arr || arr.length < 6) return null;
    var ents = {}, k = 1;
    init.players.forEach(function (p) {
      if (p.id === init.you) {
        ents[p.id] = arr[0];
        if (arr[0]) arr[0].name = p.name || myName();
      } else {
        ents[p.id] = arr[k++];
      }
    });
    return ents;
  }
  function lerp(a, b, tVal) { return a + (b - a) * tVal; }
  function startSync() {
    I.instance.removeListEvent('mpSync');
    MP.lastPosSent = 0;
    try {
      var bui = Be.instance && Be.instance.script && Be.instance.script.battleUI;
      var proto = bui && Object.getPrototypeOf(bui);
      if (proto && proto.StartTimer && !proto._mpTimerPatched) {
        var oST = proto.StartTimer;
        proto._mpTimerPatched = true;
        proto.StartTimer = function () { if (MP.inGame) return; return oST.apply(this, arguments); };
      }
    } catch (e) {}
    I.instance.AddUPEvent('mpSync', syncTick, MP);
  }
  function interpCoords(x0, y0, x1, y1, spanSec, extrapSec, alpha) {
    var vx = spanSec > 0.001 ? (x1 - x0) / spanSec : 0;
    var vy = spanSec > 0.001 ? (y1 - y0) / spanSec : 0;
    var tx = extrapSec > 0 ? (x1 + vx * extrapSec) : lerp(x0, x1, alpha);
    var ty = extrapSec > 0 ? (y1 + vy * extrapSec) : lerp(y0, y1, alpha);
    return { x: tx * TILE, y: ty * TILE, vx: vx, vy: vy };
  }

  function syncTick() {
    if (!MP.inGame || MP.gameOverDone) return;
    var snaps = MP.snaps;
    var init = MP.init, cur = snaps[snaps.length - 1];
    if (!init || !cur) return;
    if (!MP.ents) { MP.ents = bindEnts(init); if (!MP.ents) return; }
    var now = performance.now(), E = Lt.instance, me = E.player;

    /* buffered timestamp interpolation: evaluates continuously on server timeline minus 55ms jitter buffer */
    var INTERP_DELAY = 55;
    var offset = MP.clockOffset != null ? MP.clockOffset : (cur.arr - cur.srvMs);
    var renderSrvMs = (now - offset) - INTERP_DELAY;
    var s0 = cur, s1 = cur, alpha = 1, spanSec = 0, extrapSec = 0;
    if (snaps.length >= 2) {
      if (renderSrvMs <= snaps[0].srvMs) {
        s0 = s1 = snaps[0];
        alpha = 0;
      } else if (renderSrvMs >= snaps[snaps.length - 1].srvMs) {
        s0 = snaps[snaps.length - 2];
        s1 = snaps[snaps.length - 1];
        spanSec = Math.max(0.001, (s1.srvMs - s0.srvMs) / 1000);
        alpha = 1;
        extrapSec = Math.min(0.08, Math.max(0, (renderSrvMs - s1.srvMs) / 1000));
      } else {
        for (var si = 0; si < snaps.length - 1; si++) {
          if (snaps[si].srvMs <= renderSrvMs && renderSrvMs <= snaps[si + 1].srvMs) {
            s0 = snaps[si];
            s1 = snaps[si + 1];
            spanSec = Math.max(0.001, (s1.srvMs - s0.srvMs) / 1000);
            alpha = (renderSrvMs - s0.srvMs) / (spanSec * 1000);
            break;
          }
        }
      }
    }

    /* countdown timer sync (matches original BattleUI: 30..1 integer text, hides when Ghost spawns) */
    var g = s1.g, gLatest = cur.g;
    var bui = Be.instance && Be.instance.script && Be.instance.script.battleUI;
    if (bui && gLatest) {
      if (gLatest[5] === 0) {
        var left = Math.max(0, Math.ceil((init.spawnAt || 30) - (cur.time || 0)));
        if (bui.timepanel && left > 0 && !bui.timepanel.visible) bui.timepanel.visible = true;
        if (left !== MP.lastCountdown) {
          MP.lastCountdown = left;
          bui.timernum = left;
          if (bui.timer) bui.timer.text = String(left);
          if (left > 0 && left < 10) {
            try { B.instance.PlaySound(B.instance.Other_sound.timer); } catch (e) {}
          }
        }
      } else if (!MP.countdownDone) {
        MP.countdownDone = true;
        MP.lastCountdown = 0;
        bui.timernum = 0;
        try { H.f.instance.RemoveListLoopEvent('StartTimer'); } catch (e) {}
        if (bui.timepanel) bui.timepanel.visible = false;
        try { B.instance.PlaySound(B.instance.Other_sound.ermt_0); } catch (e) {}
      }
    }

    /* builds from server */
    if (MP.wt) while (MP.pendingBuilds.length) applyBuild(MP.pendingBuilds.shift());

    /* door/bed HP & open/close sync */
    if (MP.roomsDirty) { MP.roomsDirty = false; applyRooms(); }

    /* my position -> server (~30Hz cadence for crisp instant sync) */
    if (me && me.player && !me.isDie && now - MP.lastPosSent > 32) {
      MP.lastPosSent = now;
      send({ t: 'pos', x: me.x / TILE, y: me.y / TILE });
    }

    /* players (smoothed across s0..s1) */
    cur.p.forEach(function (latestP) {
      var pid = latestP[0];
      var ent = MP.ents[pid]; if (!ent) return;
      if (pid === init.you) { applyMyResources(latestP); return; }
      var sp = s1.p.filter(function (q) { return q[0] === pid; })[0] || latestP;
      var pp = s0.p.filter(function (q) { return q[0] === pid; })[0];
      if (sp[3] === 0) {
        if (ent.bed) wakeEnt(ent);
        var nx, ny, pvx = 0, pvy = 0;
        if (pp && pp[3] === 0 && s0 !== s1) {
          var pPos = interpCoords(pp[1], pp[2], sp[1], sp[2], spanSec, extrapSec, alpha);
          nx = pPos.x; ny = pPos.y; pvx = pPos.vx; pvy = pPos.vy;
        } else {
          nx = sp[1] * TILE; ny = sp[2] * TILE;
        }
        if (ent.player && !ent.isDie) {
          var dx = nx - ent.x, dy = ny - ent.y;
          if (Math.hypot(dx, dy) > 0.12 || Math.hypot(pvx, pvy) > 0.15) {
            ent._mpMoveHoldUntil = now + 130;
          }
          var moving = now < (ent._mpMoveHoldUntil || 0);
          if (Math.abs(dx) > 0.35) ent.direction = dx > 0 ? 1 : -1;
          ent.x = nx; ent.y = ny; ent.player.zOrder = ny;
          if (ent.skeleton) {
            var wantAnim = moving ? 1 : 0;
            if (ent._mpAnim !== wantAnim) {
              ent._mpAnim = wantAnim;
              try { ent.skeleton.play(wantAnim, true); } catch (e) {}
            }
          }
        }
      } else if (sp[3] === 1 && !ent.bed && sp[6] >= 0) {
        sleepEnt(ent, sp[6]);
      }
    });

    /* deaths */
    while (MP.pendingDeaths.length) {
      var id = MP.pendingDeaths.shift(), ent = MP.ents[id];
      if (ent && !ent._mpDead && !ent.isDie && MP.dt) {
        ent._mpDead = true;
        try { MP.dt.PlayerDie(ent); } catch (e) { console.error('HDMP die', e); }
      }
    }

    /* ghost (smoothed across s0..s1) */
    var T = It.instance.trollScript;
    if (T && T.troll && gLatest) {
      if (gLatest[5] === 0) {
        T.troll.visible = false;
      } else {
        var pg = s0.g, node = T.troll;
        var gx, gy, gvx = 0, gvy = 0;
        if (pg && pg[5] !== 0 && g && g[5] !== 0 && s0 !== s1) {
          var gPos = interpCoords(pg[0], pg[1], g[0], g[1], spanSec, extrapSec, alpha);
          gx = gPos.x; gy = gPos.y; gvx = gPos.vx; gvy = gPos.vy;
        } else {
          gx = gLatest[0] * TILE; gy = gLatest[1] * TILE;
        }
        var gdx = gx - node.x, gdy = gy - node.y;
        if (Math.hypot(gdx, gdy) > 0.15 || Math.hypot(gvx, gvy) > 0.15) {
          MP._ghostMoveHoldUntil = now + 130;
        }
        var moved = now < (MP._ghostMoveHoldUntil || 0);
        if (moved && Math.abs(gdx) > 0.35) T.direction = gdx > 0 ? 1 : -1;
        node.visible = true; node.x = gx; node.y = gy; node.zOrder = gy;
        if (T.hpMax !== gLatest[3]) T.hpMax = gLatest[3];
        if (T.hpCur !== gLatest[2]) T.hpCur = gLatest[2];
        if (T.level !== gLatest[4] + 1) T.level = gLatest[4] + 1;
        if (MP.ghostAttack) {
          MP.ghostAttack = false;
          try {
            T.setplay(tt.attack, false);
            B.instance.PlaySound(B.instance.TB_sound.troll_attack, 1, gx, gy);
            H.Y.instance.AddEffect(H.Y.instance.effectStr.trollAttackEffect, gx, gy);
          } catch (e) {}
          MP.atkUntil = now + 450;
        } else if (now > (MP.atkUntil || 0)) {
          var want = moved ? tt.move : tt.ide;
          if (!T.IsPlayIndex(want)) { try { T.setplay(want, true); } catch (e) {} }
        }
      }
    }
  }

  function syncHpBar(bld, cur, max) {
    if (!bld) return;
    var prevCur = bld.hpCur;
    if (bld.hpMax !== max) bld.hpMax = max;
    bld.hpCur = cur;
    if (cur > 0 && cur < max) {
      bld.hpStrip = bld.hp;
      if (bld._HPStrip) bld._HPStrip.visible = true;
    } else if (bld._HPStrip) {
      bld._HPStrip.visible = false;
    }
    if (prevCur != null && prevCur - cur > 0.5 && bld.build && bld.build.visible) {
      try {
        v.instance.Shake(bld.build, Math.min(0.25, (1 - (cur / max)) / 5 + 0.05));
        H.Y.instance.AddEffect(H.Y.instance.effectStr.trollAttackEffect, bld.x, bld.y);
      } catch (e) {}
    }
  }

  function applyRooms() {
    MP.rooms.forEach(function (r) {
      try {
        var bd = y.instance.FireReturn(y.instance.BUILD_FINDBEDANDDOOR, r[0]);
        if (!bd) return;
        var d = bd.door, b = bd.bed;
        if (d) {
          if (r[4] <= 0) {
            d.hpCur = 0;
            d.isUse = false;
            if (d._HPStrip) d._HPStrip.visible = false;
            if (d.build) d.build.visible = false;
            if (!d.isOpen) d.isOpen = true;
            y.instance.Fire(y.instance.MGM_SET_BLOCKDYNWALKABLE, d.x, d.y, true);
          } else {
            if (d.build && !d.build.visible) { d.build.visible = true; d.isUse = true; }
            syncHpBar(d, r[4], r[5]);
            var me = Lt.instance && Lt.instance.player;
            var meBlocking = !!(d.isOpen && me && !me.isDie && !me.bed && me.player && me.player.visible && Math.hypot(me.x - d.x, me.y - d.y) < 92);
            var hold = meBlocking || (MP.doorHoldUntil && MP.doorHoldUntil[r[0]] > performance.now());
            var closed = r[10] === 1 && !hold;
            if (closed && d.isOpen) {
              d.CloseDoor();
              y.instance.Fire(y.instance.MGM_SET_BLOCKDYNWALKABLE, d.x, d.y, false);
            } else if (!closed && !d.isOpen) {
              d.OpenDoor();
              y.instance.Fire(y.instance.MGM_SET_BLOCKDYNWALKABLE, d.x, d.y, true);
            }
          }
        }
        if (b) {
          syncHpBar(b, r[6], r[7]);
        }
      } catch (e) { console.error('HDMP applyRooms', e); }
    });
  }

  function sleepEnt(ent, roomIdx) {
    try {
      var bd = y.instance.FireReturn(y.instance.BUILD_FINDBEDANDDOOR, roomIdx);
      if (!bd || !bd.bed) return;
      ent.roomIndex = roomIdx; ent.curRoom = roomIdx; ent.isbed = true; ent.isRoom = true;
      ent.player.visible = false; ent.skeleton.stop(); ent.player.pos(bd.bed.x, bd.bed.y); ent.bed = bd.bed;
      ent._mpAnim = -1;
      y.instance.Fire(y.instance.BUILD_GOTOBED, bd.bed, ent.skinId);
    } catch (e) { console.error('HDMP sleepEnt', e); }
  }
  function wakeEnt(ent) {
    try {
      ent.player.visible = true;
      ent.skeleton.play(0, true);
      ent._mpAnim = 0;
      if (ent.bed) ent.bed.isOpen = false;
      ent.bed = null;
      ent.isbed = false;
    } catch (e) {}
  }
  function applyMyResources(sp) {
    var ri = sp[6];
    if (ri == null || ri < 0) return;
    var pr = c.instance.game.SetRoomPR(ri);
    pr.gold1 = sp[4]; pr.gold2 = sp[5];
  }
})();
