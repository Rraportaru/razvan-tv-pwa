(() => {
const $ = id => document.getElementById(id);
const v = $('v'), strip = $('strip'), sp = $('sp');
const TV_MODE = !!(window.AndroidHost && window.AndroidHost.isTelevision()) ||
  document.querySelector('meta[name="projector-ui"]')?.content === 'true';
const IOS_DEVICE = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let remoteMode = TV_MODE, menuTimer = null, dockTimer = null, lastToolbarFocus = null, currentTileIndex = -1;
if (TV_MODE) document.body.classList.add('tv-projector', 'tv-menu-closed', 'tv-dock-hidden');
const ALL = window.CHANNELS.map((c, i) => ({ i, name: c[0], url: c[1], logo: c[2], country: c[3], cats: c[4] || [], hd: c[5], videoHeight: c[6] || 0 }));
const LS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, val) => { try { localStorage.setItem(k, JSON.stringify(val)); } catch {} };
const byUrl = new Map(ALL.map(c => [c.url, c.i]));
let cur = byUrl.get(LS('ctv.url')) ?? 0, prev = cur;
const verifiedRomanian = new Set(ALL.filter(c => c.country === 'Romania').map(c => c.url));
const savedHidden = LS('ctv.hidden') || [];
const hidden = new Set(savedHidden.filter(url => !verifiedRomanian.has(url))); // retested channels should reappear
if (hidden.size !== savedHidden.length) save('ctv.hidden', [...hidden]);
const favs = new Set((LS('ctv.favs') || []).filter(u => byUrl.has(u)));
let fCountry = LS('ctv.country'), fGenre = LS('ctv.genre') || '';
if (LS('ctv.catalog.version') !== 'romanian-hd-sd-v2') {
  fCountry = 'Romania';
  save('ctv.country', fCountry);
  save('ctv.catalog.version', 'romanian-hd-sd-v2');
} else if (fCountry === null) fCountry = 'Romania';
let hls = null, dir = 1, skipCount = 0, loadTimer = null, osdTimer = null, guideRequest = 0;
let view = [], items = [], PITCH = 124, lastA = -1, lastB = -1;
const FAVORITES = '★ Favorite';
const EXT = (window.EXT_CHANNELS || []).map(c => ({ name: c[0], page: c[1], logo: c[2], category: c[3], provider: c[4] }));
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const vis = c => !hidden.has(c.url);
const clean = n => n.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+/g, ' ').trim() || n;
const OC = ['Generale', 'Știri', 'Sport', 'Filme', 'Copii', 'Diverse', 'Muzică'];
function oldCat(c) {
  const h = n => c.cats.includes(n);
  if (h('Știri')) return 'Știri'; if (h('Sport')) return 'Sport';
  if (h('Copii') || h('Animație') || h('Familie')) return 'Copii'; if (h('Muzică')) return 'Muzică';
  if (h('Filme') || h('Seriale') || h('Clasice')) return 'Filme';
  if (h('General') || h('Divertisment') || h('Comedie') || h('Public')) return 'Generale';
  return 'Diverse';
}
ALL.forEach(c => { c.oc = oldCat(c); c.short = clean(c.name); });
const qualityLabel = c => c.hd === 1 ? 'HD verificat' :
  c.videoHeight >= 480 && c.videoHeight < 720 ? 'SD verificat' : '';
if (!OC.includes(fGenre) && fGenre !== FAVORITES) fGenre = '';

// ---------- logo plates ----------
const plateDark = new Map();                                  // logo url -> true if logo is light (needs dark plate)
const hue = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const initials = n => clean(n).split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
function plateHtml(name, logo, cls = 'plate', extra = '') {
  const dk = logo && plateDark.get(logo) ? ' dk' : '';
  const ini = `<span class="ini" style="background:linear-gradient(150deg,hsl(${hue(name)} 55% 42%),hsl(${(hue(name) + 40) % 360} 60% 30%))">${esc(initials(name))}</span>`;
  const img = logo ? `<img src="${esc(logo)}" data-u="${esc(logo)}" decoding="async" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()">` : '';
  return `<div class="${cls}${dk}${logo ? '' : ' noimg'}">${ini}${img}${extra}</div>`;
}
function judgeLogos(root) {                                    // light logos get a dark plate so they stay visible
  root.querySelectorAll('img[data-u]').forEach(img => {
    const u = img.dataset.u; if (plateDark.has(u)) return;
    const go = () => {
      let dark = false;
      try {
        const c = document.createElement('canvas'); c.width = c.height = 24;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data; let n = 0, l = 0;
        for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 40) { n++; l += (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255; }
        dark = n > 12 && l / n > 0.8;
      } catch {}
      plateDark.set(u, dark);
      if (dark) document.querySelectorAll('img[data-u]').forEach(i => { if (i.dataset.u === u) i.parentNode.classList.add('dk'); });
    };
    img.complete ? go() : img.addEventListener('load', go, { once: true });
  });
}

// ---------- playback ----------
function setStatus(txt, sub, err) {
  const s = $('status'); s.style.display = txt ? 'flex' : 'none'; s.className = err ? 'err' : '';
  $('stxt').textContent = txt || ''; $('ssub').textContent = sub || '';
  const l = $('status-logo'); l.src = ALL[cur]?.logo || ''; l.style.visibility = l.src ? 'visible' : 'hidden';
}
function nowPlaying(ch) {
  $('nppl').outerHTML = plateHtml(ch.name, ch.logo, 'pl').replace('class="pl', 'id="nppl" class="pl');
  $('npn').textContent = ch.short; $('nps').textContent = ch.country + (ch.oc ? ' · ' + ch.oc : '') +
    (qualityLabel(ch) ? ' · ' + qualityLabel(ch) : '');
  $('osdpl').outerHTML = plateHtml(ch.name, ch.logo, 'pl').replace('class="pl', 'id="osdpl" class="pl');
  $('osdn').textContent = ch.short; $('osds').textContent = $('nps').textContent;
  judgeLogos($('nppl').parentNode); judgeLogos($('osdpl').parentNode);
  const o = $('osd'); o.classList.add('show'); clearTimeout(osdTimer); osdTimer = setTimeout(() => o.classList.remove('show'), 3200);
  $('bFav').classList.toggle('on', favs.has(ch.url));
}
function osdMsg(t) {
  $('osdpl').style.display = 'none'; $('osdn').textContent = t; $('osds').textContent = '';
  const o = $('osd'); o.classList.add('show'); clearTimeout(osdTimer); osdTimer = setTimeout(() => { o.classList.remove('show'); $('osdpl').style.display = ''; }, 1400);
}
function fail() {                                              // not working -> remove from list, jump on
  clearTimeout(loadTimer);
  const c0 = ALL[cur];
  if (c0.country === 'Romania' && (c0._r || 0) < 2) { c0._r = (c0._r || 0) + 1; setStatus('Reconectare…', c0.short); setTimeout(() => play(cur, true), 900); return; }
  const pos = view.findIndex(c => c.i === cur);
  hidden.add(ALL[cur].url); save('ctv.hidden', [...hidden]);
  buildAll(true);
  if (!view.length) return setStatus('Niciun canal în această categorie', '', true);
  if (skipCount++ >= 25) return setStatus('Prea multe canale fără semnal', 'Încearcă altă categorie', true);
  setStatus('Fără semnal — trec la următorul…', '', true);
  const j = dir >= 0 ? Math.min(Math.max(pos, 0), view.length - 1) : Math.max(pos - 1, 0);
  setTimeout(() => play(view[j].i, true), 400);
}
function setMuted(m) {
  v.muted = m;
  $('mute').classList.toggle('muted', m);
  $('sound-overlay').hidden = !IOS_DEVICE || !m;
}
function play(idx, auto) {
  const ch = ALL[idx]; if (!ch) return;
  const tileHadFocus = !!document.activeElement?.closest?.('.tile');
  if (idx !== cur) prev = cur;
  cur = idx; save('ctv.url', ch.url);
  if (!$('guide-panel').hidden) loadGuide(ch);
  if (!auto) skipCount = 0;
  nowPlaying(ch); setStatus('Se încarcă…', ch.short); renderStrip(true); centerCurrent();
  if (remoteMode && tileHadFocus) {
    requestAnimationFrame(() => focusRemoteElement(sp.querySelector(`.tile[data-i="${ch.i}"]`)));
  }
  if (hls) { hls.destroy(); hls = null; }
  clearTimeout(loadTimer); loadTimer = setTimeout(fail, 12000);
  setMuted(IOS_DEVICE);
  v.onplaying = () => {
    clearTimeout(loadTimer);
    setStatus('');
    skipCount = 0;
    if (!IOS_DEVICE) setMuted(false);
  };
  const tryPlay = () => v.play().catch(() => setStatus('Apasă oriunde pentru a porni', ch.short));
  if (/\.(mp4|webm|ogg|mp3|aac)(\?|$)/i.test(ch.url) || !(window.Hls && Hls.isSupported())) {
    v.src = ch.url; v.onerror = fail; tryPlay();
  } else {
    hls = new Hls({ enableWorker: true, maxBufferLength: 20, maxMaxBufferLength: 35, backBufferLength: 15,
      liveSyncDurationCount: 4, abrEwmaDefaultEstimate: 4e6, abrBandWidthFactor: .85, abrBandWidthUpFactor: .6, capLevelToPlayerSize: true,
      fragLoadingMaxRetry: 4, levelLoadingMaxRetry: 3, manifestLoadingMaxRetry: 2, startFragPrefetch: true });
    hls.loadSource(ch.url); hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && (hls._n = (hls._n || 0) + 1) <= 3) { hls.startLoad(); return; }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if ((hls._m = (hls._m || 0) + 1) === 1) { hls.recoverMediaError(); return; }
        if (hls._m === 2) { hls.swapAudioCodec(); hls.recoverMediaError(); return; }
      }
      fail();
    });
  }
}
function step(d) {
  dir = d; if (!view.length) return;
  const p = view.findIndex(c => c.i === cur);
  play(view[p < 0 ? 0 : (p + d + view.length) % view.length].i);
}
const next = () => step(1), back = () => step(-1);

// ---------- sidebar + filters ----------
const ICON = {
  '': '<circle cx="9" cy="9" r="6.5"/><path d="M2.7 9h12.6M9 2.5c2 2 2 11 0 13M9 2.5c-2 2-2 11 0 13"/>',
  [FAVORITES]: '<path d="m9 2 2.1 4.3 4.7.7-3.4 3.3.8 4.7L9 12.8l-4.2 2.2.8-4.7L2.2 7l4.7-.7z"/>',
  'Generale': '<rect x="2" y="3.5" width="14" height="10" rx="2"/><path d="M6 16h6M9 13.5V16"/>',
  'Știri': '<path d="M3 3h10v12H3z"/><path d="M6 6h4M6 9h4M6 12h2M13 6h2v8"/>',
  'Sport': '<circle cx="9" cy="9" r="6.5"/><path d="m7 3 2 3 3-.5M15 8l-3 2 1 4M4 13l3-2-1-3"/>',
  'Filme': '<rect x="2.5" y="3" width="13" height="12" rx="1.5"/><path d="M6 3v12M12 3v12M2.5 7h3.5M12 7h3.5M2.5 11h3.5M12 11h3.5"/>',
  'Copii': '<circle cx="9" cy="9" r="6.5"/><path d="M6 10s1 2 3 2 3-2 3-2M6.5 7h.1M11.5 7h.1"/>',
  'Diverse': '<rect x="2.5" y="2.5" width="5" height="5" rx="1"/><rect x="10.5" y="2.5" width="5" height="5" rx="1"/><rect x="2.5" y="10.5" width="5" height="5" rx="1"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/>',
  'Muzică': '<path d="M11 12V3l5-1v9M11 6l5-1M11 12a2 2 0 1 1-2-2h2M16 11a2 2 0 1 1-2-2h2"/>'
};
function fillCountry() {
  const cn = new Map(); ALL.filter(vis).forEach(c => cn.set(c.country, (cn.get(c.country) || 0) + 1));
  const first = ['Romania', 'Moldova'], names = [...cn.keys()];
  const order = [...first.filter(k => cn.has(k)), ...names.filter(k => !first.includes(k)).sort((a, b) => a.localeCompare(b, 'ro'))];
  $('country').innerHTML = `<option value="">Toate țările (${ALL.filter(vis).length})</option>` + order.map(k => `<option value="${esc(k)}">${esc(k)} (${cn.get(k)})</option>`).join('');
  if (!cn.has(fCountry)) fCountry = '';
  $('country').value = fCountry;
}
function renderCats() {
  const base = ALL.filter(c => vis(c) && (!fCountry || c.country === fCountry));
  const hasRomanianChannels = !fCountry || fCountry === 'Romania';
  const rows = [['', 'Toate', base.length], [FAVORITES, 'Favorite', base.filter(c => favs.has(c.url)).length],
    ...OC.map(k => [k, k, base.filter(c => c.oc === k).length +
      (hasRomanianChannels ? EXT.filter(c => c.category === k).length : 0)])];
  $('cats').innerHTML = rows.map(([k, n, c]) => `<button data-k="${esc(k)}" class="${fGenre === k ? 'on' : ''}" title="${esc(n)}"><svg viewBox="0 0 18 18">${ICON[k]}</svg><span class="nm">${esc(n)}</span><span class="ct">${c}</span></button>`).join('');
}
function buildAll(keepScroll) {
  const q = $('search').value.trim().toLowerCase();
  view = ALL.filter(c => vis(c) && (!fCountry || c.country === fCountry) &&
    (!fGenre || (fGenre === FAVORITES ? favs.has(c.url) : c.oc === fGenre)) &&
    (!q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q)));
  const mayShowExternal = !fCountry || fCountry === 'Romania';
  const external = mayShowExternal && (!fGenre || EXT.some(c => c.category === fGenre)) && (q || fGenre)
    ? EXT.filter(c => !fGenre || c.category === fGenre) : [];
  const xs = external.filter(x => !q || x.name.toLowerCase().includes(q));
  items = [...xs.map(x => ({ x })), ...view.map(c => ({ c }))];
  sp.style.width = items.length * PITCH + 'px';
  $('count').textContent = view.length + ' canale' + (xs.length ? ' + ' + xs.length + ' linkuri externe' : '');
  $('reset').textContent = hidden.size ? `Arată ascunse (${hidden.size})` : '';
  renderCats();
  if (!keepScroll) strip.scrollLeft = 0;
  renderStrip(true);
}

// ---------- horizontal strip (virtualised, large logo tiles) ----------
function renderStrip(force) {
  const a = Math.max(0, Math.floor(strip.scrollLeft / PITCH) - 3);
  const b = Math.min(items.length, Math.ceil((strip.scrollLeft + strip.clientWidth) / PITCH) + 3);
  if (!force && a === lastA && b === lastB) return;
  lastA = a; lastB = b;
  if (!items.length) { sp.innerHTML = '<div class="empty">Niciun canal aici.</div>'; return; }
  let html = '';
  for (let k = a; k < b; k++) {
    const it = items[k], left = k * PITCH;
    if (it.x) html += `<div class="tile" data-x="${esc(it.x.page)}" tabindex="0" role="link" style="left:${left}px" title="${esc(it.x.name)} — ${esc(it.x.provider)} · link extern">${plateHtml(it.x.name, it.x.logo, 'plate', '<i class="badge">↗</i>')}<div class="nm">${esc(it.x.name)}<br><small>${esc(it.x.provider)}</small></div></div>`;
    else {
      const c = it.c, badge = c.hd === 1
        ? '<i class="hdb">HD</i>'
        : c.country === 'Romania' && c.videoHeight >= 480 && c.videoHeight < 720
          ? '<i class="sdb">SD</i>' : '';
      html += `<div class="tile${c.i === cur ? ' on' : ''}" data-i="${c.i}" tabindex="0" role="button" aria-label="${esc(c.short)}" style="left:${left}px" title="${esc(c.name)}">${plateHtml(c.name, c.logo, 'plate', badge)}<div class="nm">${favs.has(c.url) ? '★ ' : ''}${esc(c.short)}</div></div>`;
    }
  }
  sp.innerHTML = html; judgeLogos(sp);
}
function centerCurrent() {
  const k = items.findIndex(it => it.c && it.c.i === cur); if (k < 0) return;
  const x = k * PITCH, l = strip.scrollLeft, w = strip.clientWidth;
  if (x < l + 20 || x + PITCH > l + w - 20) strip.scrollTo({ left: Math.max(0, x - (w - PITCH) / 2), behavior: 'smooth' });
}
let raf = 0;
strip.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderStrip(false); }); });
strip.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY * 1.2; e.preventDefault(); } }, { passive: false });
let drag = null, moved = false;                                // click-and-drag to scroll
strip.addEventListener('mousedown', e => { drag = { x: e.clientX, l: strip.scrollLeft }; moved = false; });
window.addEventListener('mousemove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) { moved = true; strip.scrollLeft = drag.l - dx; } });
window.addEventListener('mouseup', () => { drag = null; });
sp.addEventListener('click', e => {
  if (moved) { moved = false; return; }
  const t = e.target.closest('.tile'); if (!t) return;
  if (t.dataset.x) {
    if (window.AndroidHost) window.AndroidHost.openExternal(t.dataset.x);
    else window.open(t.dataset.x, 'cooltv_site', 'width=1280,height=800');
  } else play(+t.dataset.i);
});

function guideRow(label, program, state, emptyText) {
  const title = program?.title || emptyText;
  return `<div class="guide-row${state === 'current' ? ' current' : ''}">` +
    `<time>${esc(program?.time || label)}</time><div><b>${esc(title)}</b>` +
    `${program?.description ? `<small>${esc(program.description)}</small>` : ''}</div></div>`;
}
async function loadGuide(channel) {
  const request = ++guideRequest;
  const panel = $('guide-panel');
  $('guide-title').textContent = `Program TV · ${channel.short}`;
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

// ---------- controls ----------
const fire = (el, fn) => el.addEventListener('click', fn);
fire($('bGuide'), toggleGuide);
fire($('guide-close'), () => { $('guide-panel').hidden = true; guideRequest++; });
fire($('guide-source'), e => {
  e.preventDefault();
  if (window.AndroidHost) window.AndroidHost.openExternal(e.currentTarget.href);
  else window.open(e.currentTarget.href, '_blank', 'noopener');
});
$('search').addEventListener('input', () => buildAll());
$('country').onchange = e => { fCountry = e.target.value; save('ctv.country', fCountry); buildAll(); if (view.length && !view.some(c => c.i === cur)) play(view[0].i); };
$('cats').onclick = e => {
  const b = e.target.closest('button'); if (!b) return; fGenre = b.dataset.k; save('ctv.genre', fGenre);
  buildAll(); if (view.length && !view.some(c => c.i === cur)) play(view[0].i);
};
$('reset').onclick = e => { e.preventDefault(); hidden.clear(); save('ctv.hidden', []); fillCountry(); buildAll(); };
fire($('bNext'), next); fire($('bPrev'), back);
fire($('bLast'), () => play(prev));
fire($('bRand'), () => { if (view.length) play(view[Math.floor(Math.random() * view.length)].i); });
fire($('bFav'), () => { const u = ALL[cur].url; favs.has(u) ? favs.delete(u) : favs.add(u); save('ctv.favs', [...favs]); $('bFav').classList.toggle('on', favs.has(u)); buildAll(true); osdMsg(favs.has(u) ? 'Adăugat la Favorite' : 'Scos din Favorite'); });
const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
let playbackOverlayTimer = null;
function showPlaybackOverlay() {
  const overlay = $('play-overlay');
  overlay.innerHTML = v.paused
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v18l15-9z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></svg>';
  overlay.hidden = false;
  overlay.style.opacity = '1';
  clearTimeout(playbackOverlayTimer);
  if (!v.paused) playbackOverlayTimer = setTimeout(() => { overlay.hidden = true; }, 800);
}
v.addEventListener('play', showPlaybackOverlay);
v.addEventListener('pause', showPlaybackOverlay);
const mute = () => { setMuted(!v.muted); osdMsg(v.muted ? 'Mute' : 'Sunet pornit'); };
const vol = d => { setMuted(false); v.volume = Math.min(1, Math.max(0, v.volume + d)); $('vol').value = v.volume; save('ctv.vol', v.volume); osdMsg('Volum ' + Math.round(v.volume * 100) + '%'); };
function menuItems() {
  return [...document.querySelectorAll('#cats button'), $('country'), $('search'), $('reset')]
    .filter(el => el.getClientRects().length > 0 && !el.hasAttribute('disabled'));
}
function toolbarItems() {
  return [...document.querySelectorAll('#bar button, #bar input')]
    .filter(el => el.getClientRects().length > 0 && !el.hasAttribute('disabled'));
}
function focusRemoteElement(element) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function focusTile(index) {
  if (!items.length) return;
  currentTileIndex = Math.max(0, Math.min(index, items.length - 1));
  const left = currentTileIndex * PITCH;
  if (left < strip.scrollLeft || left + PITCH > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = Math.max(0, left - (strip.clientWidth - PITCH) / 2);
  }
  renderStrip(true);
  requestAnimationFrame(() => {
    const item = items[currentTileIndex];
    const tile = [...sp.querySelectorAll('.tile')].find(candidate =>
      item.c ? candidate.dataset.i === String(item.c.i) : candidate.dataset.x === item.x.page);
    focusRemoteElement(tile);
  });
}
function focusCurrentTile() {
  const index = items.findIndex(item => item.c && item.c.i === cur);
  focusTile(index < 0 ? 0 : index);
}
function closeTvMenu() {
  clearTimeout(menuTimer);
  document.body.classList.add('tv-menu-closed');
  $('bSide').setAttribute('aria-expanded', 'false');
  if (document.activeElement?.closest('#side')) focusRemoteElement($('bSide'));
}
function armTvMenuTimeout() {
  clearTimeout(menuTimer);
  if (!document.body.classList.contains('tv-menu-closed')) {
    menuTimer = setTimeout(closeTvMenu, 3000);
  }
  wakeProjectorDock();
}
function wakeProjectorDock() {
  if (!remoteMode) return;
  document.body.classList.remove('tv-dock-hidden');
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    closeTvMenu();
    document.body.classList.add('tv-dock-hidden');
  }, 3000);
}
function openTvMenu() {
  document.body.classList.remove('tv-menu-closed');
  $('bSide').setAttribute('aria-expanded', 'true');
  const first = menuItems()[0];
  focusRemoteElement(first);
  armTvMenuTimeout();
}
function toggleSide() {
  if (!remoteMode) {
    document.body.classList.toggle('nosb');
    return;
  }
  if (document.body.classList.contains('tv-menu-closed')) openTvMenu();
  else closeTvMenu();
}
function enableRemoteMode() {
  if (remoteMode) return;
  remoteMode = true;
  document.body.classList.add('tv-projector', 'tv-menu-closed', 'tv-dock-hidden');
  focusRemoteElement($('bSide'));
}
fire($('mute'), mute); fire($('bFs'), toggleFs); fire($('bSide'), toggleSide);
$('sound-overlay').addEventListener('click', () => {
  setMuted(false);
  v.play().catch(() => setStatus('Apasă din nou pentru a porni sunetul', ALL[cur].short));
});
function moveRemoteFocus(direction) {
  enableRemoteMode();
  if (!document.body.classList.contains('tv-menu-closed')) {
    const candidates = menuItems();
    const index = candidates.indexOf(document.activeElement);
    if (direction === 'LEFT') {
      closeTvMenu();
      return;
    }
    if (direction === 'RIGHT') {
      closeTvMenu();
      focusRemoteElement(toolbarItems()[0]);
      return;
    }
    const nextIndex = index < 0 ? 0 : (index + (direction === 'DOWN' ? 1 : -1) + candidates.length) % candidates.length;
    focusRemoteElement(candidates[nextIndex]);
    armTvMenuTimeout();
    return;
  }

  if (direction === 'UP') {
    next();
    return;
  }
  if (direction === 'DOWN') {
    back();
    return;
  }

  const active = document.activeElement;
  const tile = active?.closest?.('.tile');
  if (tile) {
    const tileIndex = items.findIndex(item => item.c
      ? String(item.c.i) === tile.dataset.i
      : item.x?.page === tile.dataset.x);
    if (direction === 'LEFT' || direction === 'RIGHT') {
      focusTile(tileIndex + (direction === 'RIGHT' ? 1 : -1));
    }
    return;
  }

  const controls = toolbarItems();
  const controlIndex = controls.indexOf(active);
  if (controlIndex >= 0) {
    lastToolbarFocus = active;
    if (direction === 'LEFT' || direction === 'RIGHT') {
      const nextIndex = (controlIndex + (direction === 'RIGHT' ? 1 : -1) + controls.length) % controls.length;
      focusRemoteElement(controls[nextIndex]);
    }
    return;
  }
  focusRemoteElement($('bSide'));
}
function activateRemoteSelection() {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    active.click();
  } else {
    focusRemoteElement($('bSide'));
  }
}
window.onAndroidRemoteKey = key => {
  enableRemoteMode();
  wakeProjectorDock();
  if (key === 'CHANNEL_UP' || key === 'PAGE_UP' || key === 'MEDIA_NEXT') next();
  else if (key === 'CHANNEL_DOWN' || key === 'PAGE_DOWN' || key === 'MEDIA_PREVIOUS') back();
  else if (key === 'MUTE') mute();
  else if (key === 'PLAY_PAUSE') v.paused ? v.play().catch(() => {}) : v.pause();
  else if (key === 'CENTER') activateRemoteSelection();
  else if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(key)) moveRemoteFocus(key);
  armTvMenuTimeout();
};
window.onAndroidRemoteActivity = () => {
  enableRemoteMode();
  wakeProjectorDock();
};
window.onAndroidRemoteLongPress = () => {
  const url = ALL[cur].url;
  if (!favs.has(url)) favs.add(url);
  save('ctv.favs', [...favs]);
  $('bFav').classList.add('on');
  buildAll(true);
  osdMsg('Adăugat la Favorite');
};
document.addEventListener('click', () => {
  if (!remoteMode) return;
  wakeProjectorDock();
  armTvMenuTimeout();
});
$('vol').addEventListener('input', e => { setMuted(false); v.volume = +e.target.value; save('ctv.vol', v.volume); });
v.volume = LS('ctv.vol') ?? 1; $('vol').value = v.volume;
v.addEventListener('dblclick', toggleFs);
$('stage').addEventListener('click', e => {
  if (e.target.closest('button,input,select,a')) return;
  if (document.fullscreenElement) v.paused ? v.play().catch(() => {}) : v.pause();
  else if (v.paused && v.src !== '') v.play().catch(() => {});
});
$('stage').addEventListener('wheel', e => { e.deltaY < 0 ? next() : back(); }, { passive: true });

document.addEventListener('keydown', e => {
  if (e.target.id === 'search' || e.target.id === 'country') { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key;
  if (remoteMode && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
    e.preventDefault();
    moveRemoteFocus(k.slice(5).toUpperCase());
    armTvMenuTimeout();
    return;
  }
  if (k === 'ArrowRight' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); next(); }
  else if (k === 'ArrowLeft' || k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); back(); }
  else if (k === '+' || k === '=') vol(.1); else if (k === '-') vol(-.1);
  else if (k === 'm' || k === 'M') mute();
  else if (k === 'f' || k === 'F') toggleFs();
  else if (k === 'l' || k === 'L') toggleSide();
  else if (k === 'b' || k === 'B' || k === 'Backspace') play(prev);
  else if (k === 'r' || k === 'R') $('bRand').click();
  else if (k === ' ') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); }
  else if (k === '/') { e.preventDefault(); document.body.classList.remove('nosb'); $('search').focus(); }
});

// fullscreen: overlay UI hides itself when the mouse is idle
let idleT = 0;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idleT);
  if (document.fullscreenElement) idleT = setTimeout(() => document.body.classList.add('idle'), 3000);
  if (remoteMode) wakeProjectorDock();
};
document.addEventListener('mousemove', wake); document.addEventListener('keydown', wake);
document.addEventListener('pointerdown', wake);
document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('fs', !!document.fullscreenElement); wake(); setTimeout(() => renderStrip(true), 60); });
window.addEventListener('resize', () => renderStrip(true));
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }); }, 1000);

// freeze watchdog: if the picture stops moving for 12 s, reconnect (instead of lagging forever)
let wdT = -1, wdN = 0;
setInterval(() => {
  if (v.paused || document.hidden || $('status').style.display === 'flex') { wdN = 0; return; }
  if (v.currentTime === wdT) { if (++wdN >= 6) { wdN = 0; fail(); } } else { wdT = v.currentTime; wdN = 0; }
}, 2000);
// ---------- start: show the channels first, then tune in ----------
fillCountry(); buildAll();
if (!view.some(c => c.i === cur) && view.length) cur = view[0].i;
nowPlaying(ALL[cur]); renderStrip(true); centerCurrent();
if (TV_MODE) focusRemoteElement($('bSide'));
setTimeout(() => play(cur), 30);
})();
