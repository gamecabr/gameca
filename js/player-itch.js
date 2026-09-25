;(function () {
  let _cache = null;
  let _dom = null;

  function getDom() {
    if (_dom) return _dom;
    _dom = {
      overlay: document.getElementById('itch-overlay'),
      stage:   document.getElementById('itch-stage'),
      title:   document.getElementById('itch-title'),
      close:   document.getElementById('itch-close')
    };
    return _dom;
  }

  async function carregarCache() {
    if (_cache) return _cache;
    try {
      const res = await fetch('data/embeds.json', { cache: 'no-cache' });
      _cache = res.ok ? await res.json() : {};
    } catch {
      _cache = {};
    }
    return _cache;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function montarIframe(url, titulo) {
    const wrap = document.createElement('div');
    wrap.className = 'itch-player-wrapper';
    wrap.innerHTML =
      '<iframe src="' + escapeHtml(url) + '"' +
      ' title="' + escapeHtml(titulo) + '"' +
      ' frameborder="0" scrolling="no" allowfullscreen="true" allowtransparency="true"' +
      ' webkitallowfullscreen="true" mozallowfullscreen="true" msallowfullscreen="true"' +
      ' allow="autoplay; fullscreen *; geolocation; microphone; camera; midi; monetization; xr-spatial-tracking; gamepad; gyroscope; accelerometer; xr; cross-origin-isolated; web-share"' +
      ' loading="eager" referrerpolicy="origin"></iframe>';
    return wrap;
  }

  function montarFallback(url, titulo) {
    const wrap = document.createElement('div');
    wrap.className = 'itch-player-fallback';
    wrap.innerHTML =
      '<div class="itch-fallback-inner">' +
        '<p class="itch-fallback-text">Este jogo não pode ser exibido aqui.</p>' +
        '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="itch-fallback-btn">' +
          'Jogar no itch.io' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
            '<path d="M7 17 17 7M7 7h10v10" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
        '</a>' +
      '</div>';
    return wrap;
  }

  async function open(game) {
    if (!game || !game.itch_url) return;
    const d = getDom();
    if (!d.overlay || !d.stage) return;

    d.stage.innerHTML = '';
    d.title.textContent = game.titulo || '—';

    const cache = await carregarCache();
    const embed = cache[game.id];

    if (embed?.url) {
      d.stage.appendChild(montarIframe(embed.url, game.titulo || ''));
    } else {
      d.stage.appendChild(montarFallback(game.itch_url, game.titulo || ''));
    }

    d.overlay.classList.remove('hidden');
    d.overlay.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const d = getDom();
    if (!d.overlay) return;
    d.overlay.classList.add('hidden');
    d.overlay.classList.remove('flex');
    d.stage.innerHTML = '';
    document.body.style.overflow = '';
  }

  function init() {
    const d = getDom();
    if (!d.overlay) return;
    d.close?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !d.overlay.classList.contains('hidden')) close();
    });
  }

  window.GRItchPlayer = { open, close, init, refresh: () => { _cache = null; return carregarCache(); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
