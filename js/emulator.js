/**
 * emulator.js — GAMECA
 * Ponte de gamepad via simulateInput (RetroArch API) com fallback de teclado.
 */

;(function(){
const { saves, recents, stats, prefs, requestPersistentStorage, events } = window.GRStorage;

const EJS_CDN        = 'https://cdn.emulatorjs.org/stable/data/';
const EJS_SCRIPT_URL = `${EJS_CDN}loader.js`;
const LOAD_TIMEOUT_MS = 60_000;

const CORE_MAP = {
  'atari2600':   'atari2600',
  'nes':         'nes',
  'snes':        'snes',
  'gb':          'gb',
  'gbc':         'gb',
  'gba':         'gba',
  'segaMD':      'segaMD',
  'megadrive':   'segaMD',
  'genesis':     'segaMD',
  'sms':         'sms',
  'mastersystem':'sms',
  'gamegear':    'segaGG',
  'c64':         'vice_x64',
  'commodore64': 'vice_x64'
};

const EJS_GLOBALS = [
  'EJS_player', 'EJS_core', 'EJS_gameUrl', 'EJS_gameName',
  'EJS_pathtodata', 'EJS_startOnLoaded', 'EJS_volume', 'EJS_color',
  'EJS_backgroundColor', 'EJS_language', 'EJS_disableDatabases',
  'EJS_threads', 'EJS_onGameStart', 'EJS_onReady', 'EJS_ready',
  'EJS_onLoadState', 'EJS_onSaveState', 'EJS_onExit',
  'EJS_emulator', 'EJS_DEBUG_XX'
];

const PAD_TO_RETRO = {
  0:  0, 1:  8, 2:  1, 3:  9,
  4:  10, 5:  11, 6:  12, 7:  13,
  8:  2, 9:  3,
  12: 4, 13: 5, 14: 6, 15: 7
};

const RETRO_TO_KEY = {
  0:  'z', 8:  'x', 1:  's', 9:  'a',
  2:  'v', 3:  'Enter',
  4:  'ArrowUp', 5:  'ArrowDown', 6:  'ArrowLeft', 7:  'ArrowRight',
  10: 'q', 11: 'e'
};

const KEY_CODES = {
  'x':'KeyX', 'z':'KeyZ', 's':'KeyS', 'a':'KeyA',
  'q':'KeyQ', 'e':'KeyE', 'v':'KeyV',
  'Enter':'Enter',
  'ArrowUp':'ArrowUp', 'ArrowDown':'ArrowDown',
  'ArrowLeft':'ArrowLeft', 'ArrowRight':'ArrowRight'
};

const KEYCODES_NUM = {
  'ArrowUp':38, 'ArrowDown':40, 'ArrowLeft':37, 'ArrowRight':39,
  'Enter':13
};

const _padState = {};
let _gamepadRAF = null;
let _debugMode = false;

try {
  _debugMode = new URLSearchParams(location.search).has('gpdebug');
} catch {}

function logDebug(...args) {
  if (_debugMode) console.log('[gamepad]', ...args);
}

function emitKey(type, key) {
  const code = KEY_CODES[key] || key;
  const keyCode = KEYCODES_NUM[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);

  const ev = new KeyboardEvent(type, {
    key, code, keyCode, which: keyCode,
    bubbles: true, cancelable: true, view: window
  });

  try {
    Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
    Object.defineProperty(ev, 'which',   { get: () => keyCode });
  } catch {}

  window.dispatchEvent(ev);
  document.dispatchEvent(ev);

  const canvas = document.querySelector('#game canvas');
  if (canvas) canvas.dispatchEvent(ev);
}

function sendInput(retroButton, pressed) {
  const gm = window.EJS_emulator?.gameManager;
  let sent = false;

  if (gm && typeof gm.simulateInput === 'function') {
    try {
      gm.simulateInput(0, retroButton, pressed ? 1 : 0);
      sent = true;
      logDebug('simulateInput', retroButton, pressed ? '↓' : '↑');
    } catch (e) {
      logDebug('simulateInput falhou:', e.message);
    }
  }

  const key = RETRO_TO_KEY[retroButton];
  if (key) {
    emitKey(pressed ? 'keydown' : 'keyup', key);
    logDebug('key', pressed ? '↓' : '↑', key);
  }

  return sent;
}

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const DEADZONE = 0.5;

  for (const pad of pads) {
    if (!pad || !pad.connected) continue;

    for (const padIdx in PAD_TO_RETRO) {
      const i = +padIdx;
      const btn = pad.buttons[i];
      if (!btn) continue;
      const pressed = btn.pressed || btn.value > 0.5;
      const retro = PAD_TO_RETRO[i];
      const stateKey = `b${pad.index}-${i}`;
      const was = !!_padState[stateKey];

      if (pressed && !was) {
        _padState[stateKey] = true;
        sendInput(retro, true);
      } else if (!pressed && was) {
        _padState[stateKey] = false;
        sendInput(retro, false);
      }
    }

    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    const dirs = {
      6: ax < -DEADZONE,
      7: ax >  DEADZONE,
      4: ay < -DEADZONE,
      5: ay >  DEADZONE
    };
    for (const retro in dirs) {
      const pressed = dirs[retro];
      const stateKey = `a${pad.index}-${retro}`;
      const was = !!_padState[stateKey];
      if (pressed && !was) { _padState[stateKey] = true; sendInput(+retro, true); }
      else if (!pressed && was) { _padState[stateKey] = false; sendInput(+retro, false); }
    }
  }
  _gamepadRAF = requestAnimationFrame(pollGamepad);
}

function startGamepadBridge() {
  if (_gamepadRAF) return;
  const gm = window.EJS_emulator?.gameManager;
  console.info('[gamepad] bridge ativo. simulateInput disponível?', typeof gm?.simulateInput === 'function');
  if (_debugMode) console.info('[gamepad] modo debug ativo');
  _gamepadRAF = requestAnimationFrame(pollGamepad);
}

function stopGamepadBridge() {
  if (_gamepadRAF) { cancelAnimationFrame(_gamepadRAF); _gamepadRAF = null; }
  for (const k in _padState) delete _padState[k];
}

let _current      = null;
let _dom          = null;
let _eventsBound  = false;
let _progressTimer= null;
let _saveToastTimer = null;

function getDom() {
  if (_dom) return _dom;
  _dom = {
    overlay:       document.getElementById('emulator-overlay'),
    stage:         document.getElementById('emulator-stage'),
    container:     document.getElementById('game'),
    title:         document.getElementById('emulator-title'),
    consoleBadge:  document.getElementById('emulator-console'),
    loading:       document.getElementById('emulator-loading'),
    loadingText:   document.getElementById('emulator-loading-text'),
    progress:      document.getElementById('emulator-progress'),
    cancelBtn:     document.getElementById('emulator-cancel'),
    error:         document.getElementById('emulator-error'),
    errorMsg:      document.getElementById('emulator-error-msg'),
    errorClose:    document.getElementById('emulator-error-close'),
    closeBtn:      document.getElementById('emulator-close'),
    fullscreenBtn: document.getElementById('emulator-fullscreen'),
    restartBtn:    document.getElementById('emulator-restart'),
    saveStatus:    document.getElementById('emulator-save-status'),
    bar:           document.getElementById('emulator-bar')
  };
  return _dom;
}

function openOverlay(game) {
  const d = getDom();
  d.title.textContent        = game.titulo || 'Jogo';
  d.consoleBadge.textContent = game.plataforma?.nome || game.console || '';
  d.overlay.classList.remove('hidden');
  d.overlay.classList.add('flex');
  document.body.style.overflow = 'hidden';
  hideError();
}

function hideOverlay() {
  const d = getDom();
  d.overlay.classList.add('hidden');
  d.overlay.classList.remove('flex');
  document.body.style.overflow = '';
  if (d.container) d.container.innerHTML = '';
}

function showLoading(text) {
  const d = getDom();
  d.loading.classList.remove('hidden');
  d.loading.classList.add('flex');
  d.loadingText.textContent = text || 'Carregando emulador';
  d.progress.style.width    = '0%';
  startProgressSimulation();
}

function hideLoading() {
  const d = getDom();
  d.loading.classList.add('hidden');
  d.loading.classList.remove('flex');
  stopProgressSimulation();
}

function showError(msg) {
  const d = getDom();
  hideLoading();
  d.error.classList.remove('hidden');
  d.error.classList.add('flex');
  d.errorMsg.textContent = msg || 'Erro desconhecido.';
}

function hideError() {
  const d = getDom();
  d.error.classList.add('hidden');
  d.error.classList.remove('flex');
}

function showSaveIndicator() {
  const el = getDom().saveStatus;
  if (!el) return;
  el.style.opacity = '1';
  clearTimeout(_saveToastTimer);
  _saveToastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function startProgressSimulation() {
  stopProgressSimulation();
  const d = getDom();
  let p = 0;
  _progressTimer = setInterval(() => {
    p += Math.random() * 6 + 2;
    if (p >= 90) { p = 90; clearInterval(_progressTimer); _progressTimer = null; }
    d.progress.style.width = `${p}%`;
  }, 320);
}

function stopProgressSimulation() {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

function completeProgress() {
  stopProgressSimulation();
  const d = getDom();
  d.progress.style.width = '100%';
}

function cleanupEmulatorGlobals() {
  document.querySelectorAll('script[data-ejs-loader="true"]').forEach(s => s.remove());
  for (const key of EJS_GLOBALS) {
    try { delete window[key]; } catch {}
    if (key in window) window[key] = undefined;
  }
  const container = document.getElementById('game');
  if (container) container.innerHTML = '';
}

function bootEmulator(game, core) {
  return new Promise(async (resolve, reject) => {
    let sram = null;
    try {
      sram = await saves.get(game.id);
    } catch (e) {
      console.warn('[emulator] Falha ao ler SRAM:', e);
    }

    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn(arg);
    };

    const timeoutId = setTimeout(() => {
      done(reject, new Error(
        'Tempo esgotado ao carregar o emulador. ' +
        'Verifique se a ROM existe em "' + game.rom + '".'
      ));
    }, LOAD_TIMEOUT_MS);

    const volume = prefs.get('muted') ? 0 : prefs.get('volume', 0.7);

    Object.assign(window, {
      EJS_player:           '#game',
      EJS_core:             core,
      EJS_gameUrl:          encodeURI(game.rom),
      EJS_gameName:         game.titulo || game.id,
      EJS_pathtodata:       EJS_CDN,
      EJS_startOnLoaded:    true,
      EJS_volume:           volume,
      EJS_color:            '#C13524',
      EJS_backgroundColor:  '#0F0D0B',
      EJS_language:         'en-US',
      EJS_disableDatabases: false,
      EJS_threads:          false,

      EJS_onReady: () => {
        try {
          const gm = window.EJS_emulator?.gameManager;
          if (sram && gm?.loadSaveFile) gm.loadSaveFile(new Uint8Array(sram));
        } catch (e) {
          console.warn('[emulator] Falha ao restaurar SRAM:', e);
        }
      },

      EJS_onGameStart: () => {
        try {
          const gm = window.EJS_emulator?.gameManager;
          if (sram && gm?.loadSaveFile) gm.loadSaveFile(new Uint8Array(sram));
        } catch {}

        if (_current) {
          _current.started = true;
          _current.sessionStart = Date.now();
        }
        completeProgress();
        setTimeout(() => {
          hideLoading();
          startGamepadBridge();
          events.emit('emulator:started', { gameId: game.id });
        }, 220);
        done(resolve);
      }
    });

    const script = document.createElement('script');
    script.src = EJS_SCRIPT_URL;
    script.async = true;
    script.dataset.ejsLoader = 'true';
    script.onerror = () => {
      done(reject, new Error('Não foi possível baixar o EmulatorJS do CDN. Verifique sua conexão.'));
    };
    document.head.appendChild(script);
  });
}

async function persistSave(game) {
  try {
    const gm = window.EJS_emulator?.gameManager;
    if (!gm?.getSaveFile) return;
    const sram = gm.getSaveFile();
    if (!sram || !sram.byteLength) return;
    await saves.put(game.id, sram, { consoleId: game.core });
    showSaveIndicator();
    requestPersistentStorage().catch(() => {});
  } catch (e) {
    console.warn('[emulator] Falha ao persistir SRAM:', e);
  }
}

async function play(game) {
  if (!game || !game.id) throw new Error('play(): objeto de jogo inválido.');
  if (_current) await stop('switch');

  const core = CORE_MAP[game.core];
  if (!core) {
    openOverlay(game);
    showError(`O console "${game.plataforma?.nome || game.console}" (core: ${game.core}) não é suportado.`);
    return;
  }

  if (!game.rom) {
    openOverlay(game);
    showError('Este jogo não possui arquivo de ROM configurado.');
    return;
  }

  recents.push(game.id, {
    titulo:    game.titulo,
    consoleId: game.core,
    capa:      game.capa
  });
  stats.registerPlay(game.id);

  _current = { game, core, sessionStart: 0, cancelled: false, started: false };

  openOverlay(game);
  showLoading(`Carregando ${game.titulo}…`);

  if (!_eventsBound) { bindGlobalEvents(); _eventsBound = true; }

  try {
    cleanupEmulatorGlobals();
    await bootEmulator(game, core);
    if (_current?.cancelled) await stop('cancelled');
  } catch (err) {
    console.error('[emulator] erro de boot:', err);
    showError(err?.message || 'Não foi possível iniciar o jogo.');
  }
}

async function stop(reason = 'user') {
  if (!_current) { hideOverlay(); return; }
  const { game, sessionStart, started } = _current;

  if (started) await persistSave(game);
  if (started && sessionStart) {
    const ms = Date.now() - sessionStart;
    recents.setSessionDuration(game.id, ms);
    stats.addSessionTime(ms);
  }

  _current = null;
  stopGamepadBridge();
  cleanupEmulatorGlobals();
  hideOverlay();

  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
  }

  events.emit('emulator:stopped', { gameId: game.id, reason });
}

async function restart() {
  if (!_current) return;
  const game = _current.game;
  await stop('restart');
  setTimeout(() => play(game), 100);
}

async function toggleFullscreen() {
  const el = getDom().overlay;
  if (!el) return;
  try {
    if (!document.fullscreenElement) await el.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch (e) {
    console.warn('[emulator] Fullscreen falhou:', e);
  }
}

function bindGlobalEvents() {
  const d = getDom();

  d.closeBtn?.addEventListener('click', () => stop('user'));
  d.errorClose?.addEventListener('click', () => stop('error'));
  d.fullscreenBtn?.addEventListener('click', toggleFullscreen);
  d.restartBtn?.addEventListener('click', restart);

  d.cancelBtn?.addEventListener('click', () => {
    if (_current) _current.cancelled = true;
    stop('cancelled');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _current && !document.fullscreenElement) stop('escape');
  });

  document.addEventListener('fullscreenchange', () => {
    const btn = getDom().fullscreenBtn;
    if (!btn) return;
    btn.setAttribute('aria-label', document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia');
  });

  document.addEventListener('visibilitychange', () => {
    if (!_current?.started) return;
    const gm = window.EJS_emulator?.gameManager;
    if (document.hidden && gm?.pause) gm.pause();
  });
}

function isPlaying()      { return !!_current?.started; }
function getCurrentGame() { return _current?.game || null; }
function getSupportedCores() { return Object.keys(CORE_MAP); }

window.GREmulator = { play, stop, restart, isPlaying, getCurrentGame, getSupportedCores };
})();
