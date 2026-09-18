/**
 * app.js — GAMECA
 * Home com grade + filtros (console, gênero, ordenação) + busca
 */

;(function(){
const { favorites, recents, prefs, events } = window.GRStorage;
const { play, isPlaying } = window.GREmulator;

const state = {
  games:         [],
  byId:          new Map(),
  filteredGames: [],
  filters: {
    platform:      '',
    genre:         '',
    sort:          'az',
    onlyFavorites: false
  },
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
  } catch { return 'pt'; }
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

function tGenre(g) {
  if (!g) return '';
  const slug = String(g).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  const key = 'genre.' + slug;
  const trans = t(key);
  return trans === key ? g : trans;
}

function tTag(tg) {
  if (!tg) return '';
  const slug = String(tg).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-');
  const key = 'tag.' + slug;
  const trans = t(key);
  return trans === key ? tg : trans;
}

function tField(game, field) {
  if (!game) return '';
  if (state.lang === 'pt') return game[field] || '';
  const i18n = game[field + '_i18n'];
  if (i18n && i18n[state.lang]) return i18n[state.lang];
  return game[field] || '';
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
    populateFilters();
    renderHero();
    renderGrid();
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

  dom.filterConsole     = $('#filter-console');
  dom.filterGenre       = $('#filter-genre');
  dom.filterSort        = $('#filter-sort');
  dom.filterCount       = $('#filter-count');
  dom.filterClear       = $('#filter-clear');

  dom.gridContainer     = $('#grid-container');
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

function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* ============================================================
   CARD
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
  if (game.genero?.length) metaParts.push(game.genero.map(tGenre).join(' • '));
  dom.heroMeta.textContent = metaParts.join('  ·  ');

  dom.heroResumo.textContent = tField(game, 'resumo') || tField(game, 'sinopse') || '';

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
   FILTROS
   ============================================================ */

function populateFilters() {
  if (!dom.filterConsole || !dom.filterGenre) return;

  const consoles = [...new Set(state.games.map(g => getPlataformaNome(g)).filter(Boolean))].sort();

  const genresSet = new Set();
  state.games.forEach(g => (g.genero || []).forEach(x => genresSet.add(x)));
  const genres = [...genresSet].sort();

  const curConsole = state.filters.platform;
  const curGenre   = state.filters.genre;

  dom.filterConsole.innerHTML = `<option value="">${t('filter.all')}</option>` +
    consoles.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  dom.filterGenre.innerHTML = `<option value="">${t('filter.all')}</option>` +
    genres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(tGenre(g))}</option>`).join('');

  dom.filterConsole.value = curConsole;
  dom.filterGenre.value   = curGenre;
}

function applyFilters() {
  let list = [...state.games];

  if (state.filters.onlyFavorites) {
    const favSet = new Set(favorites.all());
    list = list.filter(g => favSet.has(g.id));
  }

  if (state.filters.platform) {
    list = list.filter(g => getPlataformaNome(g) === state.filters.platform);
  }

  if (state.filters.genre) {
    list = list.filter(g => (g.genero || []).includes(state.filters.genre));
  }

  const q = normalize(state.searchTerm.trim());
  if (q) {
    list = list.filter(g => {
      const hay = [
        g.titulo,
        getPlataformaNome(g),
        getCriadorNome(g),
        ...(g.genero || []),
        ...(g.tags || [])
      ].map(normalize).join(' ');
      return hay.includes(q);
    });
  }

  const sort = state.filters.sort;
  list.sort((a, b) => {
    if (sort === 'az') return (a.titulo || '').localeCompare(b.titulo || '');
    if (sort === 'za') return (b.titulo || '').localeCompare(a.titulo || '');
    if (sort === 'featured') {
      const fa = (a.is_featured || a.destaque) ? 1 : 0;
      const fb = (b.is_featured || b.destaque) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (a.titulo || '').localeCompare(b.titulo || '');
    }
    if (sort === 'recent') {
      const ya = a.ano || 0;
      const yb = b.ano || 0;
      return yb - ya;
    }
    return 0;
  });

  state.filteredGames = list;
}

function updateFilterCount() {
  if (!dom.filterCount) return;
  const total = state.games.length;
  const shown = state.filteredGames.length;

  if (shown === total) {
    dom.filterCount.textContent = `${total} ${total === 1 ? t('count.game') : t('count.games')}`;
  } else {
    dom.filterCount.textContent = `${shown} / ${total}`;
  }

  const hasFilter = state.filters.platform || state.filters.genre ||
                    state.filters.onlyFavorites || state.searchTerm;
  dom.filterClear?.classList.toggle('hidden', !hasFilter);
}

function clearFilters() {
  state.filters.platform      = '';
  state.filters.genre         = '';
  state.filters.onlyFavorites = false;
  state.searchTerm            = '';

  if (dom.filterConsole) dom.filterConsole.value = '';
  if (dom.filterGenre)   dom.filterGenre.value   = '';
  if (dom.filterSort)    dom.filterSort.value    = 'az';
  if (dom.searchInput)   dom.searchInput.value   = '';
  if (dom.searchClear)   dom.searchClear.classList.add('hidden');

  dom.navLinks.forEach(b => b.classList.toggle('active', b.dataset.filter === 'todos'));

  applyFilters();
  renderGrid();
}

/* ============================================================
   GRADE
   ============================================================ */

function renderGrid() {
  const grid = dom.gridContainer;
  if (!grid) return;

  grid.querySelectorAll(':scope > .card, :scope > .ad-slot').forEach(el => el.remove());

  const games = state.filteredGames;

  if (!games.length) {
    dom.emptyState?.classList.remove('hidden');
    grid.classList.add('hidden');
    updateFilterCount();
    return;
  }

  dom.emptyState?.classList.add('hidden');
  grid.classList.remove('hidden');

  const frag = document.createDocumentFragment();
  games.forEach((game, i) => {
    frag.appendChild(buildCard(game));
    if ((i + 1) % 12 === 0 && i < games.length - 1) {
      const ad = document.createElement('div');
      ad.className = 'col-span-full ad-slot ad-slot-horizontal my-2 md:my-4';
      ad.setAttribute('aria-hidden', 'true');
      frag.appendChild(ad);
    }
  });
  grid.appendChild(frag);

  applyI18n();
  updateFilterCount();
}

/* ============================================================
   CONTINUE
   ============================================================ */

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
   MODAL
   ============================================================ */

function openDetail(gameId) {
  const game = state.byId.get(gameId);
  if (!game) return;
  state.currentGame = game;

  dom.detailBackdropImg.src = game.hero || game.capa || '';
  dom.detailBackdropImg.alt = game.titulo || '';
  dom.detailBackdropImg.onerror = () => { dom.detailBackdropImg.style.opacity = '0.25'; };

  dom.detailTitle.textContent = game.titulo || '';
  dom.detailBadge.textContent = getPlataformaNome(game);

  const metaParts = [];
  if (game.ano) metaParts.push(game.ano);
  if (game.jogadores) metaParts.push(playersLabel(game.jogadores));
  if (game.genero?.length) metaParts.push(game.genero.map(tGenre).join(' • '));
  dom.detailMeta.textContent = metaParts.join('  ·  ');

  dom.detailResumo.textContent = tField(game, 'sinopse') || tField(game, 'resumo') || t('detail.no_description');

  dom.detailFicha.innerHTML = '';
  const fichaData = [
    [t('detail.console'),   getPlataformaNome(game)],
    [t('detail.developer'), getCriadorNome(game)],
    [t('detail.year'),      game.ano],
    [t('detail.genre'),     (game.genero || []).map(tGenre).join(', ')],
    [t('detail.players'),   game.jogadores],
    [t('detail.tags'),      (game.tags || []).map(tTag).join(', ')]
  ].filter(([, v]) => v);

  fichaData.forEach(([k, v]) => {
    const node = dom.tplFicha.content.firstElementChild.cloneNode(true);
    $('dt', node).textContent = k;
    $('dd', node).textContent = String(v);
    dom.detailFicha.appendChild(node);
  });

  const criadorNome = getCriadorNome(game);
  const criadorSite = game.criador?.site || game.link_oficial || '';

  dom.detailBox.querySelector('.detail-footer-dynamic')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'detail-footer-dynamic px-5 md:px-10 pb-10';
  wrap.innerHTML = `
    <div class="mt-8 pt-6 border-t border-ink-600 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-[0.25em] text-cream-dim mb-1">${escapeHtml(t('detail.developer'))}</p>
          <p class="text-sm text-cream font-semibold truncate">${escapeHtml(criadorNome || '—')}</p>
        </div>
        ${criadorSite ? `
          <a href="${escapeHtml(criadorSite)}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center gap-2 bg-gold text-ink-900 font-bold text-xs uppercase tracking-wider
                    px-4 py-2 rounded-sm hover:bg-gold-light transition active:scale-[0.98] shrink-0">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17 17 7M7 7h10v10" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${escapeHtml(t('detail.support'))}
          </a>
        ` : ''}
      </div>
      <p class="text-[11px] text-cream-muted leading-relaxed">
        ${escapeHtml(t('detail.disclaimer_before'))}
        <a href="mailto:gameca.oficial@gmail.com" class="text-gold hover:text-gold-light underline underline-offset-2">gameca.oficial@gmail.com</a>
        ${escapeHtml(t('detail.disclaimer_after'))}
      </p>
    </div>
  `;
  dom.detailBox.appendChild(wrap);

  updateFavButton(game.id);

  dom.detailPlay.onclick = () => { closeDetail(); startGame(game.id); };

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
  try { await play(game); }
  catch (e) {
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
  dom.searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const v = e.target.value;
    dom.searchClear?.classList.toggle('hidden', !v);
    searchDebounce = setTimeout(() => {
      state.searchTerm = v;
      applyFilters();
      renderGrid();
    }, 200);
  });

  dom.searchClear?.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.searchClear.classList.add('hidden');
    state.searchTerm = '';
    applyFilters();
    renderGrid();
    dom.searchInput.focus();
  });

  dom.filterConsole?.addEventListener('change', e => {
    state.filters.platform = e.target.value;
    applyFilters();
    renderGrid();
  });

  dom.filterGenre?.addEventListener('change', e => {
    state.filters.genre = e.target.value;
    applyFilters();
    renderGrid();
  });

  dom.filterSort?.addEventListener('change', e => {
    state.filters.sort = e.target.value;
    applyFilters();
    renderGrid();
  });

  dom.filterClear?.addEventListener('click', clearFilters);

  /* Nav principal */
  dom.navLinks.forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      state.filters.platform      = '';
      state.filters.genre         = '';
      state.filters.onlyFavorites = false;
      state.searchTerm            = '';
      if (dom.searchInput) dom.searchInput.value = '';
      if (dom.searchClear) dom.searchClear.classList.add('hidden');
      if (dom.filterConsole) dom.filterConsole.value = '';
      if (dom.filterGenre)   dom.filterGenre.value   = '';

      if (f === 'favoritos') {
        state.filters.onlyFavorites = true;
      }

      dom.navLinks.forEach(b => b.classList.toggle('active', b === btn));

      applyFilters();
      renderGrid();
    });
  });

  dom.mobileCat?.addEventListener('change', e => {
    const f = e.target.value;
    const matching = dom.navLinks.find(b => b.dataset.filter === f);
    if (matching) matching.click();
  });

  dom.langSwitcher?.addEventListener('change', e => setLang(e.target.value));

  /* Sidebar */
  $$('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;

      if (action === 'home') {
        clearFilters();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        $$('.sidebar-item').forEach(b => b.classList.toggle('active', b === btn));
        return;
      }

      if (action === 'explore') {
        state.filters.platform      = '';
        state.filters.genre         = '';
        state.filters.onlyFavorites = false;
        state.searchTerm            = '';
        if (dom.searchInput) dom.searchInput.value = '';
        dom.navLinks.forEach(b => b.classList.remove('active'));
        applyFilters();
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        $$('.sidebar-item').forEach(b => b.classList.toggle('active', b === btn));
        return;
      }

      if (action === 'library') {
        state.filters.onlyFavorites = true;
        state.filters.platform      = '';
        state.filters.genre         = '';
        state.searchTerm            = '';
        if (dom.searchInput) dom.searchInput.value = '';
        dom.navLinks.forEach(b => b.classList.toggle('active', b.dataset.filter === 'favoritos'));
        applyFilters();
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        $$('.sidebar-item').forEach(b => b.classList.toggle('active', b === btn));
        return;
      }

      if (action === 'updates') {
        toast('Atualizações em breve.');
        return;
      }
      if (action === 'messages') {
        toast('Mensagens em breve.');
        return;
      }
      if (action === 'settings') {
        toast('Configurações em breve.');
        return;
      }
    });
  });

  /* Modal */
  dom.detailClose?.addEventListener('click', closeDetail);
  dom.detailBackdrop?.addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.detailModal.classList.contains('hidden')) closeDetail();
  });

  dom.detailFav?.addEventListener('click', () => {
    if (!state.currentGame) return;
    const isFav = favorites.toggle(state.currentGame.id);
    updateFavButton(state.currentGame.id);
    toast(isFav ? t('toast.added') : t('toast.removed'));
  });

  /* Reações */
  events.on('favorites:changed', () => {
    $$('.card').forEach(card => {
      const id = card.dataset.gameId;
      const star = card.querySelector('.card-fav');
      if (!star) return;
      star.style.opacity = favorites.has(id) ? '1' : '';
    });
    if (state.filters.onlyFavorites) {
      applyFilters();
      renderGrid();
    }
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

  dom.loadingRows?.remove();
  if (dom.langSwitcher) dom.langSwitcher.value = state.lang;

  applyI18n();
  populateFilters();

  pickHeroPool();
  renderHero();
  resetHeroTimer();

  applyFilters();
  renderGrid();
  renderContinueRow();

  bindEvents();
  handleScroll();
  handleConnectivity();

  console.info('[app] rodando. Total:', state.games.length);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();
