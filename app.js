(() => {
const $ = id => document.getElementById(id);
const v = $('v'), listEl = $('list');
const soundOverlay = $('sound-overlay');
const IOS_DEVICE = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ALL = window.CHANNELS.map((c, i) => ({ i, name: c[0], url: c[1], logo: c[2], country: c[3], cats: c[4] || [], hd: c[5] }));
const LS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, val) => { try { localStorage.setItem(k, JSON.stringify(val)); } catch {} };
const byUrl = new Map(ALL.map(c => [c.url, c.i]));
let cur = byUrl.get(LS('ctv.url')) ?? 0, prev = cur;
const verifiedRomanian = new Set(ALL.filter(c => c.country === 'Romania' && c.hd === 1).map(c => c.url));
const savedHidden = LS('ctv.hidden') || [];
const hidden = new Set(savedHidden.filter(url => !verifiedRomanian.has(url)));
if (hidden.size !== savedHidden.length) save('ctv.hidden', [...hidden]);
const favs = new Set((LS('ctv.favs') || []).filter(u => byUrl.has(u)));
let fCountry = LS('ctv.country'), fGenre = LS('ctv.genre') || '';
if (fCountry === null) fCountry = 'Romania';
let hls = null, dir = 1, skipCount = 0, loadTimer = null, osdTimer = null;
let rows = [], view = [], ROW = 54, remoteSelection = cur, tvUiTimer = null, lastPointerMove = 0;
let guideRequest = 0, canaleTimer = null;
const FAVORITES = '★ Favorite';
const TV_MODE = !!(window.AndroidHost && window.AndroidHost.isTelevision());
const EXT = (window.EXT_CHANNELS || []).map(c => ({ name: c[0], page: c[1], logo: c[2], category: c[3], provider: c[4] }));
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const vis = c => !hidden.has(c.url); // show all channels; HD badge still displayed when c.hd === 1
const OC = ['Generale', 'Știri', 'Sport', 'Filme', 'Copii', 'Diverse', 'Muzică'];   // same menu as the old cool-tv.net
function oldCat(c) {
  const h = n => c.cats.includes(n);
  if (h('Știri')) return 'Știri'; if (h('Sport')) return 'Sport';
  if (h('Copii') || h('Animație') || h('Familie')) return 'Copii'; if (h('Muzică')) return 'Muzică';
  if (h('Filme') || h('Seriale') || h('Clasice')) return 'Filme';
  if (h('General') || h('Divertisment') || h('Comedie') || h('Public')) return 'Generale';
  return 'Diverse';
}
ALL.forEach(c => c.oc = oldCat(c));
if (!OC.includes(fGenre) && fGenre !== FAVORITES) fGenre = '';

// ---------- playback ----------
function setStatus(txt, sub, err) {
  const s = $('status'); s.style.display = txt ? 'flex' : 'none';
  s.className = err ? 'err' : '';
  $('stxt').textContent = txt || '';
  $('ssub').textContent = sub || '';
  const logo = $('status-logo');
  logo.src = ALL[cur]?.logo || '';
  logo.style.visibility = logo.src ? 'visible' : 'hidden';
}
function showOsd(ch) {
  $('onm').textContent = ch.name; $('oct').textContent = ch.country + (ch.cats.length ? ' · ' + ch.cats.join(', ') : '');
  const o = $('osd'); o.classList.add('show'); clearTimeout(osdTimer); osdTimer = setTimeout(() => o.classList.remove('show'), 3500);
}
function fail() {                                         // not working -> remove from list, jump on
  clearTimeout(loadTimer);
  const pos = view.findIndex(c => c.i === cur);
  hidden.add(ALL[cur].url); save('ctv.hidden', [...hidden]);
  buildRows();
  if (!view.length) return setStatus('Niciun canal în această categorie', '', true);
  if (skipCount++ >= 25) return setStatus('Prea multe canale fără semnal', 'Încearcă altă categorie', true);
  setStatus('Fără semnal — trec la următorul…', '', true);
  const j = dir >= 0 ? Math.min(Math.max(pos, 0), view.length - 1) : Math.max(pos - 1, 0);
  setTimeout(() => play(view[j].i, true), 500);
}
function play(idx, auto) {
  const ch = ALL[idx]; if (!ch) return;
  if (idx !== cur) prev = cur;
  cur = idx; remoteSelection = idx; save('ctv.url', ch.url);
  if (!$('guide-panel').hidden) loadGuide(ch);
  if (!auto) skipCount = 0;
  showOsd(ch); setStatus('Se încarcă…', ch.name); highlight();
  if (TV_MODE) {
    const focusedPosition = view.findIndex(c => c.i === idx);
    if (focusedPosition >= 0) focusChannel(focusedPosition);
  }
  if (hls) { hls.destroy(); hls = null; }
  clearTimeout(loadTimer); loadTimer = setTimeout(fail, 15000);
  v.muted = IOS_DEVICE;
  syncAudioUI();
  v.onplaying = () => {
    clearTimeout(loadTimer);
    setStatus('');
    skipCount = 0;
    if (!IOS_DEVICE) v.muted = false;
    syncAudioUI();
  };
  const tryPlay = () => v.play().catch(() => setStatus('Apasă oriunde pentru a porni', ch.name));
  if (/\.(mp4|webm|ogg|mp3|aac)(\?|$)/i.test(ch.url) || !(window.Hls && Hls.isSupported())) {
    v.src = ch.url; v.onerror = fail; tryPlay();
  } else {
    hls = new Hls({
      enableWorker: true,
      maxBufferLength: 20,
      maxMaxBufferLength: 35,
      backBufferLength: 15,
      liveSyncDurationCount: 4,
      abrEwmaDefaultEstimate: 4e6,
      abrBandWidthFactor: 0.85,
      abrBandWidthUpFactor: 0.6,
      capLevelToPlayerSize: true
    });
    hls.loadSource(ch.url); hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && (hls._networkRetries = (hls._networkRetries || 0) + 1) <= 3) {
        hls.startLoad();
        return;
      }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !hls._rec) { hls._rec = 1; hls.recoverMediaError(); return; }
      fail();
    });
  }
}
const overlay = $('play-overlay');
let overlayTimer = null;
function showPlaybackOverlay() {
  if (!overlay) return;
  overlay.innerHTML = v.paused
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v18l15-9z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></svg>';
  overlay.hidden = false;
  clearTimeout(overlayTimer);
  if (!v.paused) overlayTimer = setTimeout(() => { overlay.hidden = true; }, 800);
}
v.addEventListener('play', showPlaybackOverlay);
v.addEventListener('pause', showPlaybackOverlay);

$('stage').addEventListener('click', e => {
  if (suppressStageClick) { suppressStageClick = false; return; }
  if (e.target.closest('button,input,select,a')) return;
  if (document.fullscreenElement || TV_MODE || $('app').classList.contains('nolist')) togglePlayback();
  else if (v.paused && v.src !== '') v.play().catch(() => {});
});

let touchStart = null, suppressStageClick = false, clearSuppressedClick = null;
$('app').addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && e.isPrimary && !e.target.closest('#guide-panel')) {
    touchStart = { x: e.clientX, y: e.clientY, inStage: !!e.target.closest('#stage') };
  }
}, { passive: true });
$('app').addEventListener('pointerup', e => {
  if (e.pointerType !== 'touch' || !e.isPrimary || !touchStart) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
  const inStage = touchStart.inStage;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 55) return;
  suppressStageClick = true;
  clearTimeout(clearSuppressedClick);
  clearSuppressedClick = setTimeout(() => { suppressStageClick = false; }, 500);
  const verticalFactor = (window.innerWidth > window.innerHeight) ? 1.0 : 1.2;
  if (Math.abs(dy) > Math.abs(dx) * verticalFactor) {
    if (inStage) dy < 0 ? next() : back();
  } else if (Math.abs(dx) > Math.abs(dy) * verticalFactor) {
    toggleList();
  }
}, { passive: true });
$('app').addEventListener('pointercancel', () => { touchStart = null; }, { passive: true });
document.addEventListener('click', e => {
  if (!suppressStageClick) return;
  e.preventDefault();
  e.stopPropagation();
  suppressStageClick = false;
}, true);

document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen', on);
  if (window.AndroidHost && window.AndroidHost.setFullscreen) window.AndroidHost.setFullscreen(on);
  showCanaleButton();
});
function step(d) {
  dir = d; if (!view.length) return;
  const p = view.findIndex(c => c.i === cur);
  const n = p < 0 ? 0 : (p + d + view.length) % view.length;
  play(view[n].i);
}
const next = () => step(1), back = () => step(-1);

function guideRow(label, program, state, emptyText) {
  const title = program?.title || emptyText;
  return `<div class="guide-row${state === 'current' ? ' current' : ''}">` +
    `<time>${esc(program?.time || label)}</time><div><b>${esc(title)}</b>` +
    `${program?.description ? `<small>${esc(program.description)}</small>` : ''}</div></div>`;
}
async function loadGuide(channel) {
  const request = ++guideRequest;
  const panel = $('guide-panel');
  $('guide-title').textContent = `Program TV · ${channel.name}`;
  $('guide-status').textContent = 'Se încarcă programul…';
  $('guide-items').innerHTML = '';
  try {
    const guide = await window.RazvanTVGuide.load(channel.name);
    if (request !== guideRequest || panel.hidden || channel.i !== cur) return;
    $('guide-source').href = guide.url;
    if (!guide.available) {
      $('guide-status').textContent = 'Ghidul TV nu are program disponibil pentru acest canal.';
      return;
    }
    $('guide-status').textContent = 'Ora României · Europe/Bucharest';
    $('guide-items').innerHTML =
      guideRow('A fost', guide.previous, 'past', 'Programul anterior nu este disponibil') +
      guideRow('Acum', guide.current, 'current', 'Programul curent nu este disponibil') +
      guideRow('Urmează', guide.next, 'next', 'Nu este listată următoarea emisiune');
  } catch (error) {
    if (request !== guideRequest || panel.hidden || channel.i !== cur) return;
    console.error('Nu s-a putut încărca ghidul TV:', error);
    $('guide-status').textContent = 'Programul nu s-a încărcat. Verifică conexiunea sau deschide ghidul online.';
    $('guide-source').href = 'https://tvonline.to/program-tv/';
  }
}
function toggleGuide() {
  const panel = $('guide-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) { guideRequest++; return; }
  loadGuide(ALL[cur]);
}
$('bGuide').addEventListener('click', toggleGuide);
$('guide-close').addEventListener('click', () => {
  $('guide-panel').hidden = true;
  guideRequest++;
});
$('guide-source').addEventListener('click', e => {
  e.preventDefault();
  const url = e.currentTarget.href;
  if (window.AndroidHost) window.AndroidHost.openExternal(url);
  else window.open(url, '_blank', 'noopener');
});

// ---------- filters + list ----------
function fillSelects() {
  const cn = new Map();
  ALL.filter(vis).forEach(c => cn.set(c.country, (cn.get(c.country) || 0) + 1));
  const total = ALL.filter(vis).length;
  $('country').innerHTML = `<option value="">Toate țările (${total})</option>` +
    [...cn].sort(([a], [b]) => a.localeCompare(b, 'ro')).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join('');
  if (!cn.has(fCountry)) fCountry = '';
  $('country').value = fCountry; renderCats();
}
function renderCats() {
  const base = ALL.filter(c => vis(c) && (!fCountry || c.country === fCountry));
  const n = k => base.filter(c => c.oc === k).length;
  const favCount = base.filter(c => favs.has(c.url)).length;
  const categories = [
    ['', 'Toate', base.length],
    [FAVORITES, 'Favorite', favCount],
    ...OC.map(k => [k, k, n(k) +
      ((!fCountry || fCountry === 'Romania') ? EXT.filter(c => c.category === k).length : 0)])
  ];
  $('cats').innerHTML = categories.map(([key, name, count]) =>
    `<button data-k="${esc(key)}" class="${fGenre === key ? 'on' : ''}" aria-label="${esc(name)}, ${count} canale">` +
    `<span class="cat-icon">${categoryIcon(key)}</span><span class="cat-name">${esc(name)}</span><span>${count}</span></button>`
  ).join('');
}
function categoryIcon(key) {
  const paths = key === FAVORITES ? '<path d="m9 2 2.1 4.3 4.7.7-3.4 3.3.8 4.7L9 12.8l-4.2 2.2.8-4.7L2.2 7l4.7-.7z"/>' :
    key === 'Știri' ? '<path d="M3 3h10v12H3z"/><path d="M6 6h4M6 9h4M6 12h2M13 6h2v8"/>' :
    key === 'Sport' ? '<circle cx="9" cy="9" r="6.5"/><path d="m7 3 2 3 3-.5M15 8l-3 2 1 4M4 13l3-2-1-3"/>' :
    key === 'Filme' ? '<rect x="2.5" y="3" width="13" height="12" rx="1.5"/><path d="M6 3v12M12 3v12M2.5 7h3.5M12 7h3.5M2.5 11h3.5M12 11h3.5"/>' :
    key === 'Copii' ? '<circle cx="9" cy="9" r="6.5"/><path d="M6 10s1 2 3 2 3-2 3-2M6.5 7h.1M11.5 7h.1"/>' :
    key === 'Muzică' ? '<path d="M11 12V3l5-1v9M11 6l5-1M11 12a2 2 0 1 1-2-2h2M16 11a2 2 0 1 1-2-2h2"/>' :
    key === 'Diverse' ? '<rect x="2.5" y="2.5" width="5" height="5" rx="1"/><rect x="10.5" y="2.5" width="5" height="5" rx="1"/><rect x="2.5" y="10.5" width="5" height="5" rx="1"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/>' :
    key === 'Generale' ? '<rect x="2" y="3.5" width="14" height="10" rx="2"/><path d="M6 16h6M9 13.5V16"/>' :
    '<circle cx="9" cy="9" r="6.5"/><path d="M2.7 9h12.6M9 2.5c2 2 2 11 0 13M9 2.5c-2 2-2 11 0 13"/>';
  return `<svg viewBox="0 0 18 18" aria-hidden="true">${paths}</svg>`;
}
function buildRows() {
  const focusedChannel = document.activeElement?.closest?.('.ch[data-i]')?.dataset.i;
  const q = $('search').value.trim().toLowerCase();
  view = ALL.filter(c => vis(c) && (!fCountry || c.country === fCountry) &&
    (!fGenre || (fGenre === FAVORITES ? favs.has(c.url) : c.oc === fGenre)) &&
    (!q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q)));
  rows = [];
  const xq = $('search').value.trim().toLowerCase();
  const xs = (!fCountry || fCountry === 'Romania') && (!fGenre || EXT.some(x => x.category === fGenre))
    && (!!fGenre || !!xq) ? EXT.filter(x => (!fGenre || x.category === fGenre) && (!xq || x.name.toLowerCase().includes(xq))) : [];
  if (xs.length) { rows.push({ g: 'Căutări externe · deschise pe site-ul sursă' }); xs.forEach(x => rows.push({ x })); }
  let last = null;
  for (const c of view) { if (c.country !== last) { rows.push({ g: c.country }); last = c.country; } rows.push({ c }); }
  $('count').textContent = view.length + ' canale în catalog' + (xs.length ? ' + ' + xs.length + ' linkuri externe' : '');
  $('reset').textContent = hidden.size ? `Arată canalele ascunse (${hidden.size})` : '';
  listEl.innerHTML = '<div id="sp" style="position:relative"><div id="win" style="position:absolute;left:0;right:0;top:0"></div></div>';
  $('sp').style.height = rows.length * ROW + 'px';
  renderVisible();
  const restoreIndex = focusedChannel && view.some(c => c.i === +focusedChannel)
    ? +focusedChannel : cur;
  if (TV_MODE && view.some(c => c.i === restoreIndex)) focusChannel(view.findIndex(c => c.i === restoreIndex));
}
function renderVisible() {
  const win = $('win'); if (!win) return;
  const focusedChannel = document.activeElement?.closest?.('.ch[data-i]')?.dataset.i;
  const top = listEl.scrollTop, h = listEl.clientHeight;
  const a = Math.max(0, Math.floor(top / ROW) - 6), b = Math.min(rows.length, Math.ceil((top + h) / ROW) + 6);
  win.style.transform = `translateY(${a * ROW}px)`;
  let html = '';
  for (let k = a; k < b; k++) {
    const r = rows[k];
    if (r.g) html += `<div class="grp" style="height:${ROW}px;line-height:${ROW - 8}px">${esc(r.g)}</div>`;
    else if (r.x) {
      const initials = r.x.name.split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
      const logo = r.x.logo
        ? `<span class="ext-logo">${esc(initials)}</span><img loading="lazy" src="${esc(r.x.logo)}" onerror="this.style.display='none';this.previousElementSibling.classList.add('visible')">`
        : `<span class="ext-logo visible">${esc(initials)}</span>`;
      html += `<div class="ch ext" data-x="${esc(r.x.page)}" title="${esc(r.x.name + ' · ' + r.x.provider + ' · link extern')}" style="height:${ROW}px"><span class="external-icon" aria-hidden="true">↗</span>${logo}<span class="t">${esc(r.x.name)} <small>${esc(r.x.provider)}</small></span></div>`;
    }
    else {
      const c = r.c;
      html += `<div class="ch${c.i === cur ? ' on' : ''}${c.i === remoteSelection ? ' remote-selected' : ''}" data-i="${c.i}" tabindex="-1" role="button" aria-label="${esc(c.name)}" style="height:${ROW}px">` +
        (c.logo ? `<img loading="lazy" src="${esc(c.logo)}" onerror="this.style.visibility='hidden'">` : '<img style="visibility:hidden">') +
        `<span class="t">${favs.has(c.url) ? '★ ' : ''}${esc(c.name)}</span></div>`;
    }
  }
  win.innerHTML = html;
  if (focusedChannel !== undefined) {
    win.querySelector(`.ch[data-i="${focusedChannel}"]`)?.focus({ preventScroll: true });
  }
}
function highlight() { renderVisible(); $('bFav').textContent = favs.has(ALL[cur].url) ? '★ Fav' : '☆ Fav'; }
function focusChannel(index) {
  if (!view.length) return;
  const p = Math.max(0, Math.min(index, view.length - 1));
  remoteSelection = view[p].i;
  const rowIndex = rows.findIndex(r => r.c && r.c.i === remoteSelection);
  if (rowIndex >= 0) {
    const top = rowIndex * ROW, bottom = top + ROW;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight;
  }
  renderVisible();
  listEl.querySelector(`.ch[data-i="${remoteSelection}"]`)?.focus({ preventScroll: true });
}
function scrollToCurrent() {
  const k = rows.findIndex(r => r.c && r.c.i === cur);
  if (k >= 0) { listEl.scrollTop = Math.max(0, k * ROW - listEl.clientHeight / 2); renderVisible(); }
}
listEl.addEventListener('scroll', renderVisible);
listEl.addEventListener('click', e => {
  const el = e.target.closest('.ch'); if (!el) return;
  if (el.dataset.x) {
    if (window.AndroidHost) window.AndroidHost.openExternal(el.dataset.x);
    else window.open(el.dataset.x, 'cooltv_site', 'width=1280,height=800');
  } else play(+el.dataset.i);
});
$('search').addEventListener('input', () => { listEl.scrollTop = 0; buildRows(); });
$('search-button').onclick = () => { $('search').focus(); };
$('country').onchange = e => { fCountry = e.target.value; save('ctv.country', fCountry); listEl.scrollTop = 0; renderCats(); buildRows(); if (view.length && !view.some(c => c.i === cur)) play(view[0].i); };
$('cats').onclick = e => { const b = e.target.closest('button'); if (!b) return; fGenre = b.dataset.k; save('ctv.genre', fGenre); listEl.scrollTop = 0; renderCats(); buildRows(); if (view.length && !view.some(c => c.i === cur)) play(view[0].i); };
$('reset').onclick = e => { e.preventDefault(); hidden.clear(); save('ctv.hidden', []); fillSelects(); buildRows(); };

// ---------- remote ----------
const toggleList = () => {
  if (TV_MODE) {
    if (document.body.classList.contains('tv-ui-hidden')) revealTvUi();
    else hideTvUi();
    return;
  }
  $('app').classList.toggle('nolist');
  $('toggle').textContent = $('app').classList.contains('nolist') ? '☰ Canale' : '▶ TV';
  showCanaleButton();
  setTimeout(renderVisible, 50);
};
const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
function showCanaleButton() {
  clearTimeout(canaleTimer);
  const autoHide = !!document.fullscreenElement ||
    (matchMedia('(max-width:800px)').matches && $('app').classList.contains('nolist'));
  document.body.classList.remove('toggle-hidden');
  if (autoHide) canaleTimer = setTimeout(() => document.body.classList.add('toggle-hidden'), 2000);
}
const vol = d => { v.muted = false; v.volume = Math.min(1, Math.max(0, v.volume + d)); syncAudioUI(); osdMsg('Volum ' + Math.round(v.volume * 100) + '%'); };
const mute = () => {
  v.muted = !v.muted;
  syncAudioUI();
  osdMsg(v.muted ? 'Mute' : 'Sunet pornit');
};
const togglePlayback = () => v.paused ? v.play().catch(() => {}) : v.pause();
function osdMsg(t) { $('onm').textContent = t; $('oct').textContent = ''; const o = $('osd'); o.classList.add('show'); clearTimeout(osdTimer); osdTimer = setTimeout(() => o.classList.remove('show'), 1500); }
function syncAudioUI() {
  $('bMute').classList.toggle('muted', v.muted);
  $('bMute').setAttribute('aria-label', v.muted ? 'Pornește sunetul' : 'Oprește sunetul');
  $('bMute').title = v.muted ? 'Pornește sunetul (M)' : 'Oprește sunetul (M)';
  soundOverlay.hidden = !IOS_DEVICE || !v.muted;
}
function toggleFav() { const u = ALL[cur].url; favs.has(u) ? favs.delete(u) : favs.add(u); save('ctv.favs', [...favs]); buildRows(); highlight(); }
function addCurrentToFavorites() {
  const focusedChannel = document.activeElement?.closest?.('.ch[data-i]');
  const selectedIndex = focusedChannel ? +focusedChannel.dataset.i
    : (view.some(c => c.i === remoteSelection) ? remoteSelection : cur);
  const ch = ALL[selectedIndex];
  if (!favs.has(ch.url)) {
    favs.add(ch.url);
    save('ctv.favs', [...favs]);
  }
  fGenre = FAVORITES;
  fCountry = '';
  $('search').value = '';
  save('ctv.genre', fGenre);
  save('ctv.country', fCountry);
  fillSelects();
  buildRows();
  focusChannel(Math.max(0, view.findIndex(c => c.i === selectedIndex)));
  osdMsg('Adăugat la Favorite: ' + ch.name);
}
function revealTvUi() {
  if (!TV_MODE) return;
  clearTimeout(tvUiTimer);
  document.body.classList.remove('tv-ui-hidden');
  tvUiTimer = setTimeout(hideTvUi, 5000);
}
function hideTvUi() {
  if (TV_MODE) document.body.classList.add('tv-ui-hidden');
}
function moveRemoteFocus(direction) {
  const active = document.activeElement;
  const row = active?.closest?.('.ch[data-i]');
  if (row) {
    const p = view.findIndex(c => c.i === +row.dataset.i);
    if (direction === 'UP' || direction === 'DOWN') {
      const nextPosition = p + (direction === 'DOWN' ? 1 : -1);
      if (nextPosition >= 0 && nextPosition < view.length) {
        focusChannel(nextPosition);
        return;
      }
    }
  }
  const candidates = [...document.querySelectorAll('#side button:not(:disabled), #side select, #side input, #side .ch[data-i]')]
    .filter(el => el.getClientRects().length > 0);
  const from = active?.getBoundingClientRect?.();
  if (!from || !candidates.includes(active)) {
    focusChannel(Math.max(0, view.findIndex(c => c.i === cur)));
    return;
  }
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  const options = candidates.map(el => {
    if (el === active) return null;
    const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
    const primary = direction === 'DOWN' ? dy : direction === 'UP' ? -dy :
      direction === 'RIGHT' ? dx : -dx;
    if (primary <= 2) return null;
    const cross = direction === 'UP' || direction === 'DOWN' ? Math.abs(dx) : Math.abs(dy);
    return { el, score: primary + cross * 1.7 };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  if (options[0]) options[0].el.focus({ preventScroll: true });
  else focusChannel(Math.max(0, view.findIndex(c => c.i === cur)));
}
function activateRemoteSelection() {
  const active = document.activeElement;
  const channel = active?.closest?.('.ch[data-i]');
  if (channel) { play(+channel.dataset.i); return; }
  if (active && active !== document.body && active !== document.documentElement) active.click();
  else focusChannel(Math.max(0, view.findIndex(c => c.i === cur)));
}
window.onAndroidRemoteKey = key => {
  const wasHidden = document.body.classList.contains('tv-ui-hidden');
  if (TV_MODE && wasHidden && key === 'UP') { next(); return; }
  if (TV_MODE && wasHidden && key === 'DOWN') { back(); return; }
  revealTvUi();
  showCanaleButton();
  if (key === 'CHANNEL_UP' || key === 'PAGE_UP' || key === 'MEDIA_NEXT') { next(); return; }
  if (key === 'CHANNEL_DOWN' || key === 'PAGE_DOWN' || key === 'MEDIA_PREVIOUS') { back(); return; }
  if (key === 'MUTE') { mute(); return; }
  if (key === 'PLAY_PAUSE') { togglePlayback(); return; }
  if (key === 'CENTER') { activateRemoteSelection(); return; }
  if (key === 'UP' || key === 'LEFT' || key === 'DOWN' || key === 'RIGHT') moveRemoteFocus(key);
};
window.onAndroidRemoteActivity = () => { revealTvUi(); showCanaleButton(); };
window.onAndroidRemoteLongPress = () => {
  revealTvUi();
  addCurrentToFavorites();
};
document.addEventListener('pointermove', () => {
  const now = Date.now();
  if (now - lastPointerMove < 250) return;
  lastPointerMove = now;
  revealTvUi();
  showCanaleButton();
});
document.addEventListener('pointerdown', () => { revealTvUi(); showCanaleButton(); });

$('bNext').onclick = next; $('bPrev').onclick = back; $('bMute').onclick = mute;
$('sound-overlay').onclick = () => {
  v.muted = false;
  syncAudioUI();
  v.play().catch(() => setStatus('Apasă din nou pentru a porni sunetul', ALL[cur].name));
};
$('bVp').onclick = () => vol(.1); $('bVm').onclick = () => vol(-.1); $('bFs').onclick = toggleFs;
$('bLast').onclick = () => play(prev);
$('bRand').onclick = () => { if (view.length) play(view[Math.floor(Math.random() * view.length)].i); };
$('bFav').onclick = toggleFav; $('toggle').onclick = toggleList;
$('bWatch').onclick = toggleList;
v.addEventListener('dblclick', toggleFs);

document.addEventListener('keydown', e => {
  if (['search', 'country'].includes(e.target.id)) { if (e.key === 'Escape') e.target.blur(); return; }
  revealTvUi();
  showCanaleButton();
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
    e.preventDefault();
    if (TV_MODE) moveRemoteFocus(k.slice(5).toUpperCase());
    else (k === 'ArrowUp' || k === 'ArrowRight' ? next() : back());
  }
  else if (k === 'PageUp') { e.preventDefault(); next(); }
  else if (k === 'PageDown') { e.preventDefault(); back(); }
  else if (k === '+' || k === '=') vol(.1); else if (k === '-') vol(-.1);
  else if (k === 'm' || k === 'M') mute();
  else if (k === 'f' || k === 'F') toggleFs();
  else if (k === 'l' || k === 'L') toggleList();
  else if (k === 'b' || k === 'B' || k === 'Backspace') play(prev);
  else if (k === 'r' || k === 'R') $('bRand').click();
  else if (k === '/') { e.preventDefault(); $('app').classList.remove('nolist'); $('search').focus(); }
});
document.addEventListener('wheel', e => { if (e.target.closest('#stage')) { e.deltaY < 0 ? next() : back(); } }, { passive: true });
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }); }, 1000);

fillSelects(); buildRows();
if (!view.some(c => c.i === cur) && view.length) cur = view[0].i;
if (TV_MODE) {
  document.body.classList.add('tv-mode');
  focusChannel(Math.max(0, view.findIndex(c => c.i === cur)));
  revealTvUi();
} else if (matchMedia('(max-width:800px)').matches) $('app').classList.add('nolist');
showCanaleButton();
scrollToCurrent(); play(cur);
})();
