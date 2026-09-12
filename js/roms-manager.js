/**
 * roms-manager.js — Gerenciador de upload de jogos
 * ------------------------------------------------------------
 * Permite arrastar ROM + capa + hero, detecta o console pela
 * extensão, auto-preenche o título e salva tudo no IndexedDB.
 */

;(function () {
  const STORAGE = () => window.GRStorage;
  const dom = {};
  const state = {
    romFile:  null,
    capaFile: null,
    heroFile: null,
    detected: null
  };

  /* ---------- Helpers ---------- */

  function slugify(s) {
    return String(s || '')
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

  function detectConsole(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      a26:  { console: 'Atari 2600',       core: 'atari2600' },
      nes:  { console: 'NES',              core: 'nes' },
      unf:  { console: 'NES',              core: 'nes' },
      unif: { console: 'NES',              core: 'nes' },
      sfc:  { console: 'SNES',             core: 'snes' },
      smc:  { console: 'SNES',             core: 'snes' },
      gb:   { console: 'Game Boy',         core: 'gb' },
      gbc:  { console: 'Game Boy Color',   core: 'gbc' },
      gba:  { console: 'Game Boy Advance', core: 'gba' },
      md:   { console: 'Mega Drive',       core: 'segaMD' },
      gen:  { console: 'Mega Drive',       core: 'segaMD' },
      bin:  { console: 'Mega Drive',       core: 'segaMD' },
      sms:  { console: 'Master System',    core: 'sms' },
      gg:   { console: 'Game Gear',        core: 'segaGG' }
    };
    return map[ext] || null;
  }

  /* ---------- Cache DOM ---------- */

  function cacheDom() {
    dom.modal         = document.getElementById('manager-modal');
    dom.backdrop      = document.getElementById('manager-backdrop');
    dom.close         = document.getElementById('manager-close');
    dom.form          = document.getElementById('manager-form');
    dom.consoleTag    = document.getElementById('detected-console');
    dom.fieldTitulo   = document.getElementById('field-titulo');
    dom.fieldAno      = document.getElementById('field-ano');
    dom.fieldDev      = document.getElementById('field-dev');
    dom.fieldGenero   = document.getElementById('field-genero');
    dom.fieldResumo   = document.getElementById('field-resumo');
    dom.fieldSinopse  = document.getElementById('field-sinopse');
    dom.fieldDestaque = document.getElementById('field-destaque');
    dom.saveBtn       = document.getElementById('manager-save');
    dom.cancelBtn     = document.getElementById('manager-cancel');
    dom.list          = document.getElementById('manager-list');
    dom.listItems     = document.getElementById('manager-list-items');
    dom.dropRom       = document.getElementById('drop-rom');
    dom.dropCapa      = document.getElementById('drop-capa');
    dom.dropHero      = document.getElementById('drop-hero');
    dom.fileRom       = document.getElementById('file-rom');
    dom.fileCapa      = document.getElementById('file-capa');
    dom.fileHero      = document.getElementById('file-hero');
  }

  /* ---------- Abrir / fechar ---------- */

  async function open() {
    cacheDom();
    dom.modal.classList.remove('hidden');
    dom.modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    resetForm();
    await renderList();
  }

  function close() {
    cacheDom();
    dom.modal.classList.add('hidden');
    dom.modal.classList.remove('flex');
    document.body.style.overflow = '';
    resetForm();
  }

  function resetForm() {
    state.romFile = null;
    state.capaFile = null;
    state.heroFile = null;
    state.detected = null;

    if (dom.form) dom.form.classList.add('hidden');
    if (dom.consoleTag) dom.consoleTag.textContent = '';

    ['fieldTitulo','fieldAno','fieldDev','fieldGenero','fieldResumo','fieldSinopse'].forEach(k => {
      if (dom[k]) dom[k].value = '';
    });
    if (dom.fieldDestaque) dom.fieldDestaque.checked = false;

    [dom.dropRom, dom.dropCapa, dom.dropHero].forEach(dz => {
      if (!dz) return;
      const inner   = dz.querySelector('.dropzone-inner');
      const filled  = dz.querySelector('.dropzone-filled');
      const preview = dz.querySelector('.dropzone-preview');
      if (inner) inner.classList.remove('hidden');
      if (filled) { filled.classList.add('hidden'); filled.innerHTML = ''; }
      if (preview) { preview.classList.add('hidden'); preview.removeAttribute('src'); }
    });
  }

  /* ---------- Arquivos ---------- */

  function setRomFile(file) {
    const detected = detectConsole(file.name);
    if (!detected) {
      alert('Formato não reconhecido: ' + file.name + '\n\nExtensões suportadas: .nes .sfc .smc .gb .gbc .gba .md .gen .bin .a26 .sms .gg');
      return;
    }
    state.romFile = file;
    state.detected = detected;

    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    dom.fieldTitulo.value = baseName;

    dom.consoleTag.textContent = '● ' + detected.console + '  →  core: ' + detected.core;

    const inner = dom.dropRom.querySelector('.dropzone-inner');
    const filled = dom.dropRom.querySelector('.dropzone-filled');
    if (inner) inner.classList.add('hidden');
    if (filled) {
      filled.classList.remove('hidden');
      filled.innerHTML = '<p class="font-mono text-xs text-cream">📦 ' + escapeHtml(file.name) +
                         ' <span class="text-cream-muted">(' + (file.size/1024).toFixed(0) + ' KB)</span></p>';
    }

    dom.form.classList.remove('hidden');
  }

  function setImageFile(kind, file) {
    const dropzone = kind === 'capa' ? dom.dropCapa : dom.dropHero;
    if (!dropzone) return;
    const preview = dropzone.querySelector('.dropzone-preview');
    const inner = dropzone.querySelector('.dropzone-inner');
    if (preview) {
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
    }
    if (inner) inner.classList.add('hidden');
    if (kind === 'capa') state.capaFile = file;
    else state.heroFile = file;
  }

  /* ---------- Dropzones ---------- */

  function setupDropzone(zone, input, onFile) {
    if (!zone || !input) return;
    zone.addEventListener('click', (e) => {
      if (e.target.closest('input[type=file]')) return;
      input.click();
    });
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) onFile(e.target.files[0]);
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  /* ---------- Salvar ---------- */

  async function save() {
    if (!state.romFile)  { alert('Adicione a ROM primeiro.'); return; }
    if (!state.detected) { alert('Não foi possível detectar o console.'); return; }

    const titulo = dom.fieldTitulo.value.trim();
    if (!titulo) { alert('Preencha o título.'); return; }

    const id = slugify(titulo) + '-' + state.detected.core;

    const record = {
      id,
      titulo,
      console:        state.detected.console,
      core:           state.detected.core,
      genero:         dom.fieldGenero.value.split(',').map(s => s.trim()).filter(Boolean),
      ano:            parseInt(dom.fieldAno.value, 10) || null,
      desenvolvedora: dom.fieldDev.value.trim(),
      jogadores:      1,
      resumo:         dom.fieldResumo.value.trim(),
      sinopse:        dom.fieldSinopse.value.trim(),
      tags:           [],
      link_oficial:   '',
      destaque:       dom.fieldDestaque.checked,
      romBlob:        state.romFile,
      capaBlob:       state.capaFile,
      heroBlob:       state.heroFile
    };

    dom.saveBtn.disabled = true;
    dom.saveBtn.textContent = 'Salvando…';

    try {
      await STORAGE().roms.put(record);
      close();
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar: ' + e.message);
    } finally {
      dom.saveBtn.disabled = false;
      dom.saveBtn.textContent = 'Salvar jogo';
    }
  }

  /* ---------- Lista ---------- */

  async function renderList() {
    const items = await STORAGE().roms.getAll();

    if (!items.length) {
      dom.list.classList.add('hidden');
      return;
    }

    dom.list.classList.remove('hidden');
    dom.listItems.innerHTML = '';

    items.forEach(g => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-3 bg-ink-700 border border-ink-500 rounded-sm p-2';

      const thumbUrl = g.capaBlob ? URL.createObjectURL(g.capaBlob) : '';

      row.innerHTML =
        (thumbUrl
          ? '<img src="' + thumbUrl + '" class="w-10 h-14 object-cover rounded-sm bg-ink-600" />'
          : '<div class="w-10 h-14 bg-ink-600 rounded-sm flex items-center justify-center text-xs">🕹️</div>'
        ) +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-semibold text-cream truncate">' + escapeHtml(g.titulo) + '</p>' +
          '<p class="font-mono text-[10px] uppercase tracking-wider text-gold">' + escapeHtml(g.console) + '</p>' +
        '</div>' +
        '<button class="remove-btn text-cream-muted hover:text-play text-xl leading-none px-2" data-id="' + escapeHtml(g.id) + '" title="Remover">×</button>';

      row.querySelector('.remove-btn').addEventListener('click', async () => {
        if (!confirm('Remover "' + g.titulo + '"?')) return;
        await STORAGE().roms.remove(g.id);
        await renderList();
      });

      dom.listItems.appendChild(row);
    });
  }

  /* ---------- Init ---------- */

  function init() {
    cacheDom();

    document.getElementById('add-game-btn')?.addEventListener('click', open);
    dom.close?.addEventListener('click', close);
    dom.backdrop?.addEventListener('click', close);
    dom.cancelBtn?.addEventListener('click', close);
    dom.saveBtn?.addEventListener('click', save);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.modal && !dom.modal.classList.contains('hidden')) close();
    });

    setupDropzone(dom.dropRom,  dom.fileRom,  (f) => setRomFile(f));
    setupDropzone(dom.dropCapa, dom.fileCapa, (f) => setImageFile('capa', f));
    setupDropzone(dom.dropHero, dom.fileHero, (f) => setImageFile('hero', f));
  }

  window.GRRomsManager = { init, open, close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
