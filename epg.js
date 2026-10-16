(() => {
  const BASE = 'https://tvonline.to';
  const CACHE_KEY = 'razvan-tv.guide-channels.v1';
  const CACHE_AGE = 12 * 60 * 60 * 1000;

  function key(value) {
    return String(value).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(hd|fhd|uhd|4k|sd)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Ghid TV: răspuns HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function directory() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (saved && Date.now() - saved.time < CACHE_AGE && saved.channels) return saved.channels;
    } catch {}

    const html = await fetchText(`${BASE}/program-tv/`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const channels = {};
    for (const link of doc.querySelectorAll('a[href^="/program-tv/"]')) {
      const path = link.getAttribute('href');
      const name = link.querySelector('b, strong')?.textContent?.trim() || '';
      if (!name || !/^\/program-tv\/[a-z0-9-]+\/$/.test(path || '')) continue;
      channels[key(name)] = path;
    }
    if (!Object.keys(channels).length) throw new Error('Ghidul nu a returnat lista de canale.');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), channels }));
    } catch {}
    return channels;
  }

  function findPath(channels, name) {
    const wanted = key(name);
    if (channels[wanted]) return channels[wanted];
    const match = Object.keys(channels)
      .filter(candidate => candidate.length >= 5 && (wanted.startsWith(candidate) || candidate.startsWith(wanted)))
      .sort((a, b) => Math.abs(a.length - wanted.length) - Math.abs(b.length - wanted.length))[0];
    return match ? channels[match] : null;
  }

  function item(row) {
    if (!row) return null;
    return {
      time: row.querySelector('time')?.textContent?.trim() || '',
      title: row.querySelector('b')?.textContent?.trim() || '',
      description: row.querySelector('small')?.textContent?.trim() || ''
    };
  }

  async function load(channelName) {
    const channels = await directory();
    const path = findPath(channels, channelName);
    if (!path) return { available: false, name: channelName, url: `${BASE}/cautare/?q=${encodeURIComponent(channelName)}` };

    const url = new URL(path, BASE).href;
    const html = await fetchText(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('.prog-list[data-panel="azi"] .pl-row')];
    const currentIndex = rows.findIndex(row => row.classList.contains('on'));
    if (currentIndex < 0) return { available: false, name: channelName, url };

    const previousRows = rows.slice(0, currentIndex).filter(row => row.classList.contains('past'));
    const nextRow = rows.slice(currentIndex + 1).find(row => !row.classList.contains('past'));
    return {
      available: true,
      name: doc.querySelector('h1')?.textContent?.trim() || channelName,
      url,
      previous: item(previousRows[previousRows.length - 1]),
      current: item(rows[currentIndex]),
      next: item(nextRow)
    };
  }

  window.RazvanTVGuide = { load };
})();
