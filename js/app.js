/**
 * app.js — GAMECA
 */

;(function(){
const { favorites, recents, prefs, events } = window.GRStorage;
const { play, isPlaying } = window.GREmulator;

const state = {
  games:         [],
  byId:          new Map(),
  currentFilter: prefs.get('lastFilter', 'todos'),
  searchTerm:    '',
  heroIndex:     0,
  heroPool:      [],
  heroTimer:     null,
  currentGame:   null,
  lang:          'pt'
};

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const dom = {};

/* ============================================================
   i18n
   ============================================================ */

function detectLang() {
  try {
    const saved = localStorage.getItem('gameca:lang');
    if (saved && window.I18N?.[saved]) return saved;

    const nav = (navigator.language || 'pt').toLowerCase();
    if (nav.startsWith('pt')) return 'pt';
    if (nav.startsWith('hi')) return 'hi';
    if (nav.startsWith('en')) return 'en';
    return 'pt';
  } catch {
    return 'pt';
  }
}

function t(key, vars) {
  const dict = window.I18N?.[state.lang] || window.I18N?.pt || {};
  let str = dict[key] ?? key;
  if (vars) {
    for (const k in vars) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    }
  }
  return str;
}

function applyI18n() {
  const dict = window.I18N?.[state.lang] || window.I18N?.pt || {};

  $$('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = dict[key];
    if (val === undefined) return;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  $$('[data-i18n-attr]').forEach(el => {
    const key = el.dataset.i18n;
    const attr = el.dataset.i18nAttr;
    const val = dict[key];
    if (val !== undefined && attr) el.setAttribute(attr, val);
  });

  document.documentElement.lang = state.lang === 'pt' ? 'pt-BR' : state.lang;
}

function setLang(lang) {
  if (!window.I18N?.[lang]) return;
  state.lang = lang;
  try { localStorage.setItem('gameca:lang', lang); } catch {}
  applyI18n();
  if (dom.langSwitcher) dom.langSwitcher.value = lang;
  if (state.games.length) {
    renderHero();
    buildHomeRows();
    renderContinueRow();
  }
}

/* ============================================================
   DOM
   ============================================================ */

function cacheDom() {
  dom.header            = $('#app-header');
  dom.searchInput       = $('#search-input');
  dom.searchClear       = $('#search-clear');
  dom.mobileCat         = $('#mobile-category');
  dom.navLinks          = $$('#main-nav .nav-link');
  dom.langSwitcher      = $('#lang-switcher');

  dom.heroBackdrop      = $('#hero-backdrop');
  dom.heroBadge         = $('#hero-badge');
  dom.heroTitle         = $('#hero-title');
  dom.heroMeta          = $('#hero-meta');
  dom.heroResumo        = $('#hero-resumo');
  dom.heroPlay          = $('#hero-play');
  dom.heroInfo          = $('#hero-info');
  dom.heroDots          = $('#hero-dots');

  dom.rowContinue       = $('#row-continue');
  dom.rowSearch         = $('#row-search');
  dom.searchTerm        = $('#search-term');
  dom.rowsContainer     = $('#rows-container');
  dom.adSlotMid         = $('#ad-slot-mid');
  dom.emptyState        = $('#empty-state');
  dom.loadingRows       = $('#loading-rows');

  dom.detailModal       = $('#detail-modal');
  dom.detailBackdrop    = $('#detail-backdrop');
  dom.detailClose       = $('#detail-close');
  dom.detailBox         = $('#detail-box');
  dom.detailBackdropImg = $('#detail-backdrop-img');
  dom.detailTitle       = $('#detail-title');
  dom.detailBadge       = $('#detail-badge');
  dom.detailMeta        = $('#detail-meta');
  dom.detailResumo      = $('#detail-resumo');
  dom.detailFicha       = $('#detail-ficha');
  dom.detailPlay        = $('#detail-play');
  dom.detailFav         = $('#detail-fav');

  dom.toastContainer    = $('#toast-container');

  dom.tplCard           = $('#tpl-card');
  dom.tplRow            = $('#tpl-row');
  dom.tplFicha          = $('#tpl-ficha');
}

/* ============================================================
   HELPERS
   ============================================================ */

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getPlataformaNome(game) {
  if (!game) return '';
  if (game.plataforma?.nome) return game.plataforma.nome;
  if (typeof game.plataforma === 'string') return game.plataforma;
  if (game.console) return game.console;
  return '';
}

function getCriadorNome(game) {
  if (!game) return '';
  if (game.criador?.nome) return game.criador.nome;
  if (typeof game.criador === 'string') return game.criador;
  if (game.desenvolvedora) return game.desenvolvedora;
  return '';
}

function playersLabel(n) {
  const num = Number(n);
  if (!num) return '';
  const key = num === 1 ? 'players.count' : 'players.count_plural';
  return t(key, { n: num });
}

/* ============================================================
   CARD / ROW
   ============================================================ */

function buildCard(game) {
  const node = dom.tplCard.content.firstElementChild.cloneNode(true);
  node.dataset.gameId = game.id;

  const img = $('.card-cover', node);
  img.alt = game.titulo || '';

  img.addEventListener('error', () => {
    img.removeAttribute('src');
    img.style.display = 'none';
    if (!node.querySelector('.card-fallback')) {
      const fb = document.createElement('div');
      fb.className = 'card-fallback w-full aspect-[3/4] flex flex-col items-center justify-center gap-2 p-3 text-center';
      fb.style.background = `linear-gradient(160deg, hsl(${(slugify(game.id).length * 47) % 360}, 30%, 18%), #0F0D0B)`;
      fb.innerHTML = `
        <span class="text-3xl">🎮</span>
        <span class="text-[11px] font-bold leading-tight text-cream">${escapeHtml(game.titulo)}</span>
        <span class="text-[9px] uppercase tracking-widest text-rust font-mono">${escapeHtml(getPlataformaNome(game))}</span>
      `;
      node.insertBefore(fb, node.firstChild);
    }
  });
  img.src = game.capa || '';

  $('.card-console', node).textContent = getPlataformaNome(game);
  $('.card-title',   node).textContent = game.titulo || '';

  if (favorites.has(game.id)) {
    const fav = $('.card-fav', node);
    fav.textContent = '★';
    fav.style.opacity = '1';
  }

  node.addEventListener('click', () => openDetail(game.id));
  return node;
}

function buildRow(title, games, rowKey) {
  const node = dom.tplRow.content.firstElementChild.cloneNode(true);
  node.dataset.rowKey = rowKey || slugify(title);
  $('.row-title', node).textContent = title;

  const track = $('.row-track', node);
  games.forEach(g => track.appendChild(buildCard(g)));

  const prev = $('.row-prev', node);
  const next = $('.row-next', node);
  if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' }));
  if (next) next.addEventListener('click', () => track.scrollBy({ left:  track.clientWidth * 0.85, behavior: 'smooth' }));

  return node;
}

function toast(msg, ms = 2600) {
  if (!dom.toastContainer) return;
  const el = document.createElement('div');
  el.className = 'pointer-events-auto bg-ink-900/95 border border-rust/40 rounded-sm px-4 py-2 text-sm text-cream shadow-xl animate-fade-in font-mono tracking-wide';
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ============================================================
   HERO
   ============================================================ */

function pickHeroPool() {
  const destaques = state.games.filter(g => g.is_featured || g.destaque);
  state.heroPool = destaques.length ? destaques : state.games.slice(0, 5);
  state.heroIndex = 0;
}

function renderHero() {
  if (!state.heroPool.length) return;
  const game = state.heroPool[state.heroIndex % state.heroPool.length];

  const img = dom.heroBackdrop;
  if (!img) return;

  const bg = game.hero || game.capa || '';

  img.style.opacity = '0';
  img.onload = () => { img.style.opacity = '1'; };
  img.onerror = () => { img.removeAttribute('src'); img.style.opacity = '0'; };
  img.src = bg;

  dom.heroBadge.textContent = getPlataformaNome(game);
  dom.heroTitle.textContent = game.titulo || '';

  const metaParts = [];
  if (game.ano) metaParts.push(game.ano);
  if (getCriadorNome(game)) metaParts.push(getCriadorNome(game));
  if (game.jogadores) metaParts.push(playersLabel(game.jogadores));
  if (game.genero?.length) metaParts.push(game.genero.join(' • '));
  dom.heroMeta.textContent = metaParts.join('  ·  ');

  dom.heroResumo.textContent = game.resumo || game.sinopse || '';

  dom.heroDots.innerHTML = '';
  state.heroPool.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'rounded-sm transition-all ' +
      (i === state.heroIndex ? 'bg-rust w-8' : 'bg-cream/25 hover:bg-cream/60 w-6');
    dot.style.height = '3px';
    dot.setAttribute('aria-label', `Ver destaque ${i + 1}`);
    dot.addEventListener('click', () => { state.heroIndex = i; renderHero(); resetHeroTimer(); });
    dom.heroDots.appendChild(dot);
  });

  dom.heroPlay.onclick = () => startGame(game.id);
  dom.heroInfo.onclick = () => openDetail(game.id);
}

function resetHeroTimer() {
  clearInterval(state.heroTimer);
  if (state.heroPool.length > 1) {
    state.heroTimer = setInterval(() => {
      state.heroIndex = (state.heroIndex + 1) % state.heroPool.length;
      renderHero();
    }, 9000);
  }
}

/* ============================================================
   FILEIRAS + SLOT DO MEIO
   ============================================================ */

function posicionarAdSlotMid(posicao) {
  const slot = dom.adSlotMid;
  const container = dom.rowsContainer;
  if (!slot || !container) return;

  const rows = Array.from(container.querySelectorAll(':scope > .row'));

  if (rows.length < 2) {
    slot.hidden = true;
    return;
  }

  const idx = Math.min(posicao, rows.length - 1);
  const referencia = rows[idx];

  referencia.insertAdjacentElement('afterend', slot);
  slot.hidden = false;
}

function buildHomeRows() {
  const container = dom.rowsContainer;
  const slot = dom.adSlotMid;

  if (slot && slot.parentElement !== container) {
    container.appendChild(slot);
  }

  container.querySelectorAll(':scope > .row').forEach(r => r.remove());

  const byPlataforma = new Map();
  state.games.forEach(g => {
    const key = getPlataformaNome(g) || 'Outros';
    if (!byPlataforma.has(key)) byPlataforma.set(key, []);
    byPlataforma.get(key).push(g);
  });

  const ordem = ['SNES', 'NES', 'Mega Drive', 'Master System', 'Game Boy', 'Game Boy Color', 'Atari 2600'];
  const keys  = [...byPlataforma.keys()].sort((a, b) => {
    const ia = ordem.indexOf(a); const ib = ordem.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  keys.forEach(k => {
    const list = byPlataforma.get(k);
    if (list.length) {
      container.appendChild(buildRow(t('row.platform', { name: k }), list, `plataforma-${slugify(k)}`));
    }
  });

  const byGenre = new Map();
  state.games.forEach(g => {
    (g.genero || []).forEach(gen => {
      if (!byGenre.has(gen)) byGenre.set(gen, []);
      byGenre.get(gen).push(g);
    });
  });

  [...byGenre.entries()]
    .filter(([, list]) => list.length >= 2)
    .forEach(([gen, list]) => {
      container.appendChild(buildRow(t('row.genre', { name: gen }), list, `genero-${slugify(gen)}`));
    });

  const shuffled = [...state.games].sort((a, b) =>
    slugify(a.id).localeCompare(slugify(b.id))
  );
  container.appendChild(buildRow(t('row.discover'), shuffled, 'descubra'));

  posicionarAdSlotMid(2);
}

function renderContinueRow() {
  const items = recents.top(12).map(r => state.byId.get(r.id)).filter(Boolean);

  if (!items.length) { dom.rowContinue.classList.add('hidden'); return; }

  dom.rowContinue.classList.remove('hidden');
  const track = $('.row-track', dom.rowContinue);
  track.innerHTML = '';
  items.forEach(g => track.appendChild(buildCard(g)));

  const title = $('.row-title', dom.rowContinue);
  if (title) title.textContent = t('row.continue');
}

/* ============================================================
   BUSCA
   ============================================================ */

function renderSearchRow(results, term) {
  if (dom.searchTerm) dom.searchTerm.textContent = `"${term}"`;

  if (!results.length) {
    dom.rowSearch.classList.add('hidden');
    dom.emptyState.classList.remove('hidden');
    return;
  }
  dom.emptyState.classList.add('hidden');
  dom.rowSearch.classList.remove('hidden');
  const track = $('.row-track', dom.rowSearch);
  track.innerHTML = '';
  results.forEach(g => track.appendChild(buildCard(g)));
}

function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function doSearch(term) {
  const q = normalize(term.trim());
  state.searchTerm = term;

  if (dom.searchClear) dom.searchClear.classList.toggle('hidden', !term);

  if (!q) {
    dom.rowSearch.classList.add('hidden');
    dom.emptyState.classList.add('hidden');
    dom.rowsContainer.classList.remove('hidden');
    dom.rowContinue.classList.toggle('hidden', recents.top(1).length === 0);
    return;
  }

  const results = state.games.filter(g => {
    const haystack = [
      g.titulo,
      getPlataformaNome(g),
      getCriadorNome(g),
      ...(g.genero || []),
      ...(g.tags || [])
    ].map(normalize).join(' ');
    return haystack.includes(q);
  });

  renderSearchRow(results, term);
  dom.rowsContainer.classList.add('hidden');
  dom.rowContinue.classList.add('hidden');
}

/* ============================================================
   FILTROS
   ============================================================ */

function applyFilter(filter) {
  state.currentFilter = filter;
  prefs.set('lastFilter', filter);

  dom.navLinks.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  if (dom.mobileCat) dom.mobileCat.value = filter;

  if (dom.searchInput.value) {
    dom.searchInput.value = '';
    doSearch('');
  }

  if (filter === 'todos') {
    dom.rowsContainer.classList.remove('hidden');
    dom.rowContinue.classList.toggle('hidden', recents.top(1).length === 0);
    return;
  }

  dom.rowContinue.classList.add('hidden');
  dom.rowsContainer.querySelectorAll(':scope > .row').forEach(r => r.remove());
  if (dom.adSlotMid) dom.adSlotMid.hidden = true;

  if (filter === 'favoritos') {
    const list = favorites.all().map(id => state.byId.get(id)).filter(Boolean);
    if (!list.length) { dom.emptyState.classList.remove('hidden'); return; }
    dom.emptyState.classList.add('hidden');
    dom.rowsContainer.classList.remove('hidden');
    dom.rowsContainer.appendChild(buildRow(t('row.favorites'), list, 'favoritos'));
    return;
  }

  if (filter === 'console') {
    const byPlataforma = new Map();
    state.games.forEach(g => {
      const k = getPlataformaNome(g) || 'Outros';
      if (!byPlataforma.has(k)) byPlataforma.set(k, []);
      byPlataforma.get(k).push(g);
    });
    dom.emptyState.classList.add('hidden');
    dom.rowsContainer.classList.remove('hidden');
    [...byPlataforma.entries()].forEach(([k, list]) => {
      dom.rowsContainer.appendChild(buildRow(k, list, `plataforma-${slugify(k)}`));
    });
    posicionarAdSlotMid(2);
    return;
  }

  const list = state.games.filter(g => (g.genero || []).includes(filter));
  if (!list.length) { dom.emptyState.classList.remove('hidden'); return; }
  dom.emptyState.classList.add('hidden');
  dom.rowsContainer.classList.remove('hidden');
  dom.rowsContainer.appendChild(buildRow(filter, list, `genero-${slugify(filter)}`));
}

/* ============================================================
   MODAL
   ============================================================ */

function openDetail(gameId) {
  const game = state.byId.get(gameId);
  if (!game) return;
  state.currentGame = game;

  dom.detailBackdropImg.src = game.hero || game.capa || '';
  dom.detailBackdropImg.alt = game.titulo || '';
  dom.detailBackdropImg.onerror = () => {
    dom.detailBackdropImg.style.opacity = '0.25';
  };

  dom.detailTitle.textContent = game.titulo || '';
  dom.detailBadge.textContent = getPlataformaNome(game);

  const metaParts = [];
  if (game.ano) metaParts.push(game.ano);
  if (game.jogadores) metaParts.push(playersLabel(game.jogadores));
  if (game.genero?.length) metaParts.push(game.genero.join(' • '));
  dom.detailMeta.textContent = metaParts.join('  ·  ');

  dom.detailResumo.textContent = game.sinopse || game.resumo || t('detail.no_description');

  dom.detailFicha.innerHTML = '';
  const fichaData = [
    [t('detail.console'),   getPlataformaNome(game)],
    [t('detail.developer'), getCriadorNome(game)],
    [t('detail.year'),      game.ano],
    [t('detail.genre'),     (game.genero || []).join(', ')],
    [t('detail.players'),   game.jogadores],
    [t('detail.tags'),      (game.tags || []).join(', ')]
  ].filter(([, v]) => v);

  fichaData.forEach(([k, v]) => {
    const node = dom.tplFicha.content.firstElementChild.cloneNode(true);
    $('dt', node).textContent = k;
    $('dd', node).textContent = String(v);
    dom.detailFicha.appendChild(node);
  });

  updateFavButton(game.id);

  dom.detailPlay.onclick = () => {
    closeDetail();
    startGame(game.id);
  };

  dom.detailModal.classList.remove('hidden');
  dom.detailModal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  dom.detailBox.scrollTop = 0;
}

function closeDetail() {
  dom.detailModal.classList.add('hidden');
  dom.detailModal.classList.remove('flex');
  document.body.style.overflow = '';
  state.currentGame = null;
}

function updateFavButton(gameId) {
  const isFav = favorites.has(gameId);
  const btn = dom.detailFav;
  btn.setAttribute('aria-pressed', String(isFav));
  btn.innerHTML = isFav
    ? '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3 6.9 7.5.6-5.7 4.9 1.7 7.3L12 17.8 5.5 21.7l1.7-7.3L1.5 9.5 9 8.9z"/></svg>'
    : '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>';
}

/* ============================================================
   JOGAR
   ============================================================ */

async function startGame(gameId) {
  const game = state.byId.get(gameId);
  if (!game) return;
  try {
    await play(game);
  } catch (e) {
    console.error('[app] falha ao iniciar jogo:', e);
    toast(t('toast.play_error'));
  }
}

/* ============================================================
   HEADER / CONEXÃO
   ============================================================ */

function handleScroll() {
  if (!dom.header) return;
  dom.header.classList.toggle('is-scrolled', window.scrollY > 24);
}

function handleConnectivity() {
  const badge = document.getElementById('offline-badge');
  if (!badge) return;
  badge.classList.toggle('hidden', navigator.onLine);
  badge.classList.toggle('flex',   !navigator.onLine);
}

/* ============================================================
   EVENTOS
   ============================================================ */

function bindEvents() {
  let searchDebounce;
  dom.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const v = e.target.value;
    searchDebounce = setTimeout(() => doSearch(v), 130);
  });

  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    doSearch('');
    dom.searchInput.focus();
  });

  dom.navLinks.forEach(btn =>
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter))
  );

  dom.mobileCat?.addEventListener('change', e => applyFilter(e.target.value));

  dom.langSwitcher?.addEventListener('change', e => setLang(e.target.value));

  document.getElementById('logo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    applyFilter('todos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  dom.detailClose.addEventListener('click', closeDetail);
  dom.detailBackdrop.addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.detailModal.classList.contains('hidden')) closeDetail();
  });

  dom.detailFav.addEventListener('click', () => {
    if (!state.currentGame) return;
    const isFav = favorites.toggle(state.currentGame.id);
    updateFavButton(state.currentGame.id);
    toast(isFav ? t('toast.added') : t('toast.removed'));
  });

  events.on('favorites:changed', () => {
    $$('.card').forEach(card => {
      const id = card.dataset.gameId;
      const star = card.querySelector('.card-fav');
      if (!star) return;
      star.style.opacity = favorites.has(id) ? '1' : '';
    });
    if (state.currentFilter === 'favoritos') applyFilter('favoritos');
  });

  events.on('recents:changed', () => renderContinueRow());
  events.on('emulator:stopped', () => renderContinueRow());

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('online',  handleConnectivity);
  window.addEventListener('offline', handleConnectivity);
}

/* ============================================================
   BOOT
   ============================================================ */

function loadGames() {
  const data = window.JOGOS;
  if (!Array.isArray(data)) throw new Error('window.JOGOS não encontrado.');
  return data.filter(g => g.is_published !== false);
}

function init() {
  cacheDom();

  state.lang = detectLang();

  let games;
  try {
    games = loadGames();
    state.games = games;
    state.byId  = new Map(games.map(g => [g.id, g]));
  } catch (e) {
    console.error('[app] falha no catálogo:', e);
    if (dom.loadingRows) {
      dom.loadingRows.innerHTML =
        `<p class="text-center text-cream-muted py-10 px-6 font-mono text-xs uppercase tracking-widest">
          Não foi possível carregar o catálogo.<br><span class="text-rust">${escapeHtml(e.message)}</span>
        </p>`;
    }
    return;
  }

  if (dom.loadingRows) dom.loadingRows.classList.add('hidden');

  if (dom.langSwitcher) dom.langSwitcher.value = state.lang;

  applyI18n();

  pickHeroPool();
  renderHero();
  resetHeroTimer();
  buildHomeRows();
  renderContinueRow();

  if (state.currentFilter && state.currentFilter !== 'todos') {
    applyFilter(state.currentFilter);
  }

  bindEvents();
  handleScroll();
  handleConnectivity();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
