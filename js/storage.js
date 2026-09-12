/**
 * storage.js — Camada de persistência do GameRetroProject
 * ---------------------------------------------------------
 * Duas camadas independentes:
 *   • LocalStorage  → dados leves (favoritos, recentes, preferências, estatísticas)
 *   • IndexedDB     → dados pesados (saves de jogo .sram, um blob por jogo)
 *
 * Todas as operações são assíncronas por padrão (mesmo as de LocalStorage,
 * via Promise.resolve()) para que o resto do app trate os dois backends
 * de forma uniforme.
 *
 * Uso:
 *   import { favorites, recents, saves, prefs, events } from './storage.js';
 */

/* ============================================================
   CONSTANTES
   ============================================================ */

const LS_PREFIX = 'gr:';                 // namespace para evitar colisão
const LS_KEYS = {
  favorites: `${LS_PREFIX}favorites`,
  recents:   `${LS_PREFIX}recents`,
  prefs:     `${LS_PREFIX}prefs`,
  stats:     `${LS_PREFIX}stats`
};

const IDB_NAME    = 'GameRetroDB';
const IDB_VERSION = 2;
const IDB_STORES  = {
  saves: 'saves',        // { gameId, blob: ArrayBuffer, size, updatedAt, consoleId }
  meta:  'meta',         // { key, value } — espaço livre para metadados futuros
  roms:  'roms'          // { id, titulo, romBlob, capaBlob, heroBlob, ... } — uploads do usuário
};

const MAX_RECENTS = 30;                  // tamanho máximo do histórico "Continue de Onde Parou"

/* ============================================================
   EVENT BUS (pub/sub leve)
   ============================================================ */

const _listeners = new Map();

const events = {
  /** Registra um callback para um evento. Retorna função de unsubscribe. */
  on(name, cb) {
    if (!_listeners.has(name)) _listeners.set(name, new Set());
    _listeners.get(name).add(cb);
    return () => _listeners.get(name)?.delete(cb);
  },
  /** Dispara um evento com payload opcional. */
  emit(name, payload) {
    _listeners.get(name)?.forEach(cb => {
      try { cb(payload); } catch (e) { console.warn(`[events:${name}]`, e); }
    });
  }
};

/* ============================================================
   HELPERS
   ============================================================ */

/** Verifica se localStorage está realmente disponível (Safari privado, cookies, etc.). */
function lsAvailable() {
  try {
    const k = '__gr_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}
const HAS_LS = lsAvailable();

/** Lê um valor JSON do localStorage, com fallback seguro. */
function lsGet(key, fallback) {
  if (!HAS_LS) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn(`[storage] lsGet(${key}) falhou:`, e);
    return fallback;
  }
}

/** Escreve um valor JSON no localStorage. Retorna true em sucesso. */
function lsSet(key, value) {
  if (!HAS_LS) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storage] lsSet(${key}) falhou:`, e);
    return false;
  }
}

/* ============================================================
   INDEXEDDB — abertura e migração
   ============================================================ */

let _dbPromise = null;

/** Abre (ou reutiliza) a conexão com o IndexedDB. */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB não suportado neste navegador.'));
      return;
    }

    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

       req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion;

      // v0 → v1: cria as stores iniciais
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(IDB_STORES.saves)) {
          const store = db.createObjectStore(IDB_STORES.saves, { keyPath: 'gameId' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('consoleId', 'consoleId', { unique: false });
        }
        if (!db.objectStoreNames.contains(IDB_STORES.meta)) {
          db.createObjectStore(IDB_STORES.meta, { keyPath: 'key' });
        }
      }

      // v1 → v2: adiciona store "roms" para uploads do usuário
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(IDB_STORES.roms)) {
          const store = db.createObjectStore(IDB_STORES.roms, { keyPath: 'id' });
          store.createIndex('console',   'console',   { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // Outra aba pediu upgrade — fechamos para não bloquear
        db.close();
        _dbPromise = null;
        console.info('[storage] Conexão IDB fechada por versionchange.');
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('[storage] IDB bloqueado por outra aba.');
  });

  return _dbPromise;
}

/** Executa uma transação IDB e devolve uma Promise com o resultado do request. */
async function idbRun(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('Transação abortada'));
  });
}

/* ============================================================
   API — FAVORITOS (LocalStorage)
   ============================================================ */

const favorites = {
  /** Retorna a lista de IDs favoritados (ordem: inserção). */
  all() {
    return lsGet(LS_KEYS.favorites, []);
  },

  /** true se o jogo estiver na lista. */
  has(id) {
    return favorites.all().includes(id);
  },

  /** Adiciona/remove e devolve o novo estado (true = favoritado). */
  toggle(id) {
    const list = favorites.all();
    const idx = list.indexOf(id);
    let nowFav;
    if (idx >= 0) {
      list.splice(idx, 1);
      nowFav = false;
    } else {
      list.push(id);
      nowFav = true;
    }
    lsSet(LS_KEYS.favorites, list);
    events.emit('favorites:changed', { id, isFavorite: nowFav, list });
    return nowFav;
  },

  /** Remove explicitamente. */
  remove(id) {
    const list = favorites.all().filter(x => x !== id);
    lsSet(LS_KEYS.favorites, list);
    events.emit('favorites:changed', { id, isFavorite: false, list });
  },

  /** Limpa tudo. */
  clear() {
    lsSet(LS_KEYS.favorites, []);
    events.emit('favorites:changed', { id: null, isFavorite: false, list: [] });
  }
};

/* ============================================================
   API — RECENTES (LocalStorage) — alimenta "Continue de Onde Parou"
   ============================================================ */

const recents = {
  /**
   * Retorna o histórico do mais recente ao mais antigo.
   * Cada item: { id, playedAt, playCount, lastSessionMs }
   */
  all() {
    return lsGet(LS_KEYS.recents, []);
  },

  /** Top N (default 12) para exibição no carrossel. */
  top(n = 12) {
    return recents.all().slice(0, n);
  },

  /**
   * Marca um jogo como "aberto agora".
   * Chamado quando o usuário clica em "Iniciar Jogo" (antes do emulador carregar).
   * Se já existir, sobe para o topo e incrementa playCount.
   * @param {string} id
   * @param {{ consoleId?: string, titulo?: string, capa?: string }} [meta]
   */
  push(id, meta = {}) {
    if (!id) return;
    const list = recents.all();
    const existing = list.find(r => r.id === id);

    if (existing) {
      existing.playedAt = Date.now();
      existing.playCount = (existing.playCount || 1) + 1;
      // move para o topo
      list.splice(list.indexOf(existing), 1);
      list.unshift(existing);
    } else {
      list.unshift({
        id,
        playedAt: Date.now(),
        playCount: 1,
        lastSessionMs: 0,
        consoleId: meta.consoleId || null,
        titulo: meta.titulo || null,
        capa: meta.capa || null
      });
    }

    // cap no tamanho
    if (list.length > MAX_RECENTS) list.length = MAX_RECENTS;

    lsSet(LS_KEYS.recents, list);
    events.emit('recents:changed', { id, list });
  },

  /**
   * Registra a duração da última sessão (chamado ao fechar o emulador).
   * @param {string} id
   * @param {number} ms  duração em milissegundos
   */
  setSessionDuration(id, ms) {
    const list = recents.all();
    const item = list.find(r => r.id === id);
    if (!item) return;
    item.lastSessionMs = Math.max(0, Math.floor(ms));
    item.playedAt = Date.now();
    lsSet(LS_KEYS.recents, list);
    events.emit('recents:changed', { id, list });
  },

  /** Remove um item específico. */
  remove(id) {
    const list = recents.all().filter(r => r.id !== id);
    lsSet(LS_KEYS.recents, list);
    events.emit('recents:changed', { id, list });
  },

  /** Limpa o histórico completo. */
  clear() {
    lsSet(LS_KEYS.recents, []);
    events.emit('recents:changed', { id: null, list: [] });
  }
};

/* ============================================================
   API — PREFERÊNCIAS (LocalStorage)
   ============================================================ */

const DEFAULT_PREFS = {
  volume: 0.7,
  muted: false,
  lastFilter: 'todos',
  shaders: 'none',           // reservado p/ EmulatorJS
  biosWarningDismissed: false
};

const prefs = {
  all() {
    return { ...DEFAULT_PREFS, ...lsGet(LS_KEYS.prefs, {}) };
  },
  get(key, fallback) {
    const all = prefs.all();
    return key in all ? all[key] : fallback;
  },
  set(key, value) {
    const all = { ...prefs.all(), [key]: value };
    lsSet(LS_KEYS.prefs, all);
    events.emit('prefs:changed', { key, value, all });
    return value;
  },
  reset() {
    lsSet(LS_KEYS.prefs, {});
    events.emit('prefs:changed', { key: null, value: null, all: { ...DEFAULT_PREFS } });
  }
};

/* ============================================================
   API — ESTATÍSTICAS (LocalStorage)
   ============================================================ */

const stats = {
  all() {
    return lsGet(LS_KEYS.stats, { totalPlays: 0, totalSessionMs: 0, gamesPlayed: {} });
  },

  /** Incrementa contadores de uso quando o jogo inicia de fato. */
  registerPlay(id) {
    const s = stats.all();
    s.totalPlays++;
    s.gamesPlayed[id] = (s.gamesPlayed[id] || 0) + 1;
    s.lastPlayedAt = Date.now();
    lsSet(LS_KEYS.stats, s);
    events.emit('stats:changed', s);
  },

  /** Soma tempo total ao encerrar sessão. */
  addSessionTime(ms) {
    const s = stats.all();
    s.totalSessionMs += Math.max(0, Math.floor(ms));
    lsSet(LS_KEYS.stats, s);
    events.emit('stats:changed', s);
  },

  clear() {
    lsSet(LS_KEYS.stats, { totalPlays: 0, totalSessionMs: 0, gamesPlayed: {} });
    events.emit('stats:changed', stats.all());
  }
};

/* ============================================================
   API — SAVES DO EMULADOR (IndexedDB)
   ============================================================ */

const saves = {
  /**
   * Salva (ou sobrescreve) o SRAM de um jogo.
   * @param {string} gameId
   * @param {ArrayBuffer|Uint8Array} sramData
   * @param {{ consoleId?: string }} [meta]
   */
  async put(gameId, sramData, meta = {}) {
    if (!gameId || sramData == null) {
      throw new Error('saves.put: gameId e sramData são obrigatórios.');
    }
    // Normaliza para ArrayBuffer (evita problemas de clone estruturado)
    const buffer = sramData instanceof Uint8Array
      ? sramData.buffer.slice(sramData.byteOffset, sramData.byteOffset + sramData.byteLength)
      : sramData;

    const record = {
      gameId,
      consoleId: meta.consoleId || null,
      blob: buffer,
      size: buffer.byteLength,
      updatedAt: Date.now()
    };

    await idbRun(IDB_STORES.saves, 'readwrite', store => store.put(record));
    events.emit('saves:changed', { gameId, size: record.size, updatedAt: record.updatedAt });
    return record;
  },

  /**
   * Carrega o SRAM salvo de um jogo.
   * @param {string} gameId
   * @returns {Promise<ArrayBuffer|null>}
   */
  async get(gameId) {
    const rec = await idbRun(IDB_STORES.saves, 'readonly', store => store.get(gameId));
    return rec?.blob || null;
  },

  /** Retorna metadados (sem o blob) de um save. */
  async meta(gameId) {
    const rec = await idbRun(IDB_STORES.saves, 'readonly', store => store.get(gameId));
    if (!rec) return null;
    const { blob, ...rest } = rec;
    return rest;
  },

  /** Lista todos os saves com metadados (sem blob). */
  async list() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORES.saves, 'readonly');
      const out = [];
      const req = tx.objectStore(IDB_STORES.saves).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const { gameId, consoleId, size, updatedAt } = cursor.value;
          out.push({ gameId, consoleId, size, updatedAt });
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror    = () => reject(tx.error);
    });
  },

  /** Remove o save de um jogo. */
  async remove(gameId) {
    await idbRun(IDB_STORES.saves, 'readwrite', store => store.delete(gameId));
    events.emit('saves:changed', { gameId, size: 0, updatedAt: Date.now() });
  },

  /** Apaga todos os saves (com confirmação do caller). */
  async clear() {
    await idbRun(IDB_STORES.saves, 'readwrite', store => store.clear());
    events.emit('saves:changed', { gameId: null, size: 0, updatedAt: Date.now() });
  },

  /** true se existe save para o jogo. */
  async has(gameId) {
    const m = await saves.meta(gameId);
    return !!m;
  }
};

/* ============================================================
   API — UTILITÁRIOS DE ALTO NÍVEL
   ============================================================ */

/**
 * Migra os dados antigos de uma versão anterior do app (se existirem).
 * Aqui é onde você colocaria um "schema version" no futuro.
 */
async function migrateLegacyData() {
  // Exemplo de migração: se existia "favoritos" em localStorage sem prefixo,
  // move para o novo formato.
  const legacy = localStorage.getItem('favoritos');
  if (legacy && !localStorage.getItem(LS_KEYS.favorites)) {
    try {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        lsSet(LS_KEYS.favorites, parsed);
        console.info('[storage] Migrados favoritos legados.');
      }
    } catch { /* ignora */ }
  }
}

/**
 * Estima o uso atual de armazenamento (útil para mostrar ao usuário).
 * Requer Storage API (Chrome/Edge/Safari modernos).
 * @returns {Promise<{ usage:number, quota:number, percent:number }|null>}
 */
async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, percent: quota ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/**
 * Solicita ao navegador que o armazenamento seja "persistente"
 * (evita que o browser apague IndexedDB sob pressão de espaço).
 */
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Apaga TODOS os dados do app (favoritos, recentes, preferências, saves).
 * Útil para um botão "Resetar aplicativo" nas configurações.
 */
async function wipeAll() {
  favorites.clear();
  recents.clear();
  prefs.reset();
  stats.clear();
  try { await saves.clear(); } catch (e) { console.warn('[storage] wipeAll(saves):', e); }
  events.emit('storage:wiped');
}
/* ============================================================
   API — ROMS (IndexedDB) — jogos enviados pelo usuário
   Guarda o jogo COMPLETO: metadados + blobs (ROM, capa, hero)
   ============================================================ */

const roms = {
  async put(record) {
    if (!record?.id) throw new Error('roms.put: id obrigatório.');
    const now = Date.now();
    const data = { ...record, createdAt: record.createdAt || now, updatedAt: now };
    await idbRun(IDB_STORES.roms, 'readwrite', store => store.put(data));
    events.emit('roms:changed', { id: data.id, action: 'put' });
    return data;
  },

  async get(id) {
    return idbRun(IDB_STORES.roms, 'readonly', store => store.get(id));
  },

  async getAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORES.roms, 'readonly');
      const out = [];
      const req = tx.objectStore(IDB_STORES.roms).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { out.push(cursor.value); cursor.continue(); }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror    = () => reject(tx.error);
    });
  },

  async remove(id) {
    await idbRun(IDB_STORES.roms, 'readwrite', store => store.delete(id));
    events.emit('roms:changed', { id, action: 'remove' });
  },

  async clear() {
    await idbRun(IDB_STORES.roms, 'readwrite', store => store.clear());
    events.emit('roms:changed', { id: null, action: 'clear' });
  }
};
/* ============================================================
   EXPORT CONSOLIDADO (para conveniência)
   ============================================================ */

window.GRStorage = {
  favorites,
  recents,
  prefs,
  stats,
  saves,
  roms,
  events,
  migrateLegacyData,
  estimateStorage,
  requestPersistentStorage,
  wipeAll
};