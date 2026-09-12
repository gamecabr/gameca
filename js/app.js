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
  currentGame:   null
};

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const dom = {};

function cacheDom() {
  dom.header            = $('#app-header');
  dom.searchInput       = $('#search-input');
  dom.searchClear       = $('#search-clear');
  dom.mobileCat         = $('#mobile-category');
  dom.navLinks          = $$('#main-nav .nav-link');

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

function buildCard(game) {
  const node = dom.tplCard.content.firstElementChild.cloneNode(true);
  node.dataset.gameId = game.id;

  const img = $('.card-cover', node);
  img.alt = `Capa de ${game.titulo}`;

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
        <span class="text-[9px] uppercase tracking-widest text-rust font-mono">${escapeHtml(game.console)}</span>
      `;
      node.insertBefore(fb, node.firstChild);
    }
  });
  img.src = game.capa || '';

  $('.card-console', node).textContent = game.console || '';
  $('.card-title',   node).textContent = game.titulo  || '';

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
  const destaques = state.games.filter(g => g.destaque);
  state.heroPool = destaques.length ? destaques : state.games.slice(0, 5);
  state.heroIndex = 0;
}

function renderHero() {
  if (!state.heroPool.length) return;
  const game = state.heroPool[state.heroIndex % state.heroPool.length];

  dom.heroBackdrop.style.opacity = '0';

  const bg = game.hero || game.capa || '';

  const img = new Image();
  img.onload = () => {
    dom.heroBackdrop.style.backgroundImage = `url("${bg}")`;
    dom.heroBackdrop.style.backgroundSize  = 'cover';
    dom.heroBackdrop.style.backgroundPosition = 'center 30%';
    dom.heroBackdrop.style.filter = 'blur(1px) brightness(.75)';
    dom.heroBackdrop.style.opacity = '1';
  };
  img.onerror = () => {
    dom.heroBackdrop.style.backgroundImage = 'radial-gradient(ellipse at 30% 40%, #252220 0%, #0F0D0B 70%)';
    dom.heroBackdrop.style.filter = 'none';
    dom.heroBackdrop.style.opacity = '1';
  };
  img.src = bg;

  dom.heroBadge.textContent = game.console || '';
  dom.heroTitle.textContent = game.titulo  || '';

  const metaParts = [];
  if (game.ano) metaParts.push(game.ano);
  if (game.desenvolvedora) metaParts.push(game.desenvolvedora);
  if (game.jogadores) metaParts.push(`${game.jogadores} jogador${game.jogadores === 1 ? '' : 'es'}`);
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
   FILEIRAS
   ============================================================ */

function buildHomeRows() {
  dom.rowsContainer.innerHTML = '';

  const byConsole = new Map();
  state.games.forEach(g => {
    const key = g.console || 'Outros';
    if (!byConsole.has(key)) byConsole.set(key, []);
    byConsole.get(key).push(g);
  });

  const ordem = ['SNES', 'NES', 'Mega Drive', 'Master System', 'Game Boy', 'Game Boy Color', 'Atari 2600'];
  const keys  = [...byConsole.keys()].sort((a, b) => {
    const ia = ordem.indexOf(a); const ib = ordem.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  keys.forEach(k => {
    const list = byConsole.get(k);
    if (list.length) dom.rowsContainer.appendChild(buildRow(`Clássicos do ${k}`, list, `console-${slugify(k)}`));
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
      dom.rowsContainer.appendChild(buildRow(`Destaques em ${gen}`, list, `genero-${slugify(gen)}`));
    });

  const shuffled = [...state.games].sort((a, b) =>
    slugify(a.id).localeCompare(slugify(b.id))
  );
  dom.rowsContainer.appendChild(buildRow('Descubra novos clássicos', shuffled, 'descubra'));
}

function renderContinueRow() {
  const items = recents.top(12).map(r => state.byId.get(r.id)).filter(Boolean);

  if (!items.length) { dom.rowContinue.classList.add('hidden'); return; }

  dom.rowContinue.classList.remove('hidden');
  const track = $('.row-track', dom.rowContinue);
  track.innerHTML = '';
  items.forEach(g => track.appendChild(buildCard(g)));
}

/* ============================================================
   BUSCA
   ============================================================ */

function renderSearchRow(results, term) {
  dom.searchTerm.textContent = `"${term}"`;

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
      g.titulo, g.console, g.desenvolvedora,
      ...(g.genero || []), ...(g.tags || [])
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
  dom.rowsContainer.innerHTML = '';

  if (filter === 'favoritos') {
    const list = favorites.all().map(id => state.byId.get(id)).filter(Boolean);
    if (!list.length) { dom.emptyState.classList.remove('hidden'); return; }
    dom.emptyState.classList.add('hidden');
    dom.rowsContainer.classList.remove('hidden');
    dom.rowsContainer.appendChild(buildRow('Minha Lista', list, 'favoritos'));
    return;
  }

  if (filter === 'console') {
    const byConsole = new Map();
    state.games.forEach(g => {
      const k = g.console || 'Outros';
      if (!byConsole.has(k)) byConsole.set(k, []);
      byConsole.get(k).push(g);
    });
    dom.emptyState.classList.add('hidden');
    dom.rowsContainer.classList.remove('hidden');
    [...byConsole.entries()].forEach(([k, list]) => {
      dom.rowsContainer.appendChild(buildRow(k, list, `console-${slugify(k)}`));
    });
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
  dom.detailBadge.textContent = game.console || '';

  const metaParts = [];
  if (game.ano) metaParts.push(game.ano);
  if (game.jogadores) metaParts.push(`${game.jogadores} jogador${game.jogadores === 1 ? '' : 'es'}`);
  if (game.genero?.length) metaParts.push(game.genero.join(' • '));
  dom.detailMeta.textContent = metaParts.join('  ·  ');

  dom.detailResumo.textContent = game.sinopse || game.resumo || 'Sem descrição disponível.';

  dom.detailFicha.innerHTML = '';
  const fichaData = [
    ['Console',        game.console],
    ['Desenvolvedora', game.desenvolvedora],
    ['Ano',            game.ano],
    ['Gênero',         (game.genero || []).join(', ')],
    ['Jogadores',      game.jogadores],
    ['Tags',           (game.tags || []).join(', ')]
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
    toast('Não foi possível iniciar o jogo.');
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
    toast(isFav ? '★ Adicionado à biblioteca' : '☆ Removido da biblioteca');
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
  if (!Array.isArray(data)) throw new Error('window.JOGOS não encontrado. Verifique data/jogos.js.');
  return data;
}

function init() {
  cacheDom();

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