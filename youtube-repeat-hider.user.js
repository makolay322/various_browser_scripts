// ==UserScript==
// @name         YouTube Tekrar Eden Video Gizleyici
// @namespace    https://github.com/makolay322/various_browser_scripts
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/makolay322/various_browser_scripts/main/youtube-repeat-hider.user.js
// @downloadURL  https://raw.githubusercontent.com/makolay322/various_browser_scripts/main/youtube-repeat-hider.user.js
// @description  Ana sayfa ve izleme sayfasındaki önerilerde, 3 kez gösterilmiş videoları 4. gösterimden itibaren gizler.
// @author       makolay322
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MAX_SHOWS = 3;                       // bu kadar gösterimden sonra gizle
  const STORE_KEY = 'ytRepeatHider.counts';
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 günden eski kayıtlar silinir
  const MAX_ENTRIES = 20000;
  const HIDE_CLASS = 'ytrh-hidden';

  // "Oturum" = her sayfa gösterimi: tam yükleme (F5 / yeni sekme) veya YouTube içi sayfa geçişi.
  // Aynı sayfa gösteriminde tekrar görünen video bir kez sayılır.
  const sessionSeen = new Set();

  // { videoId: { c: gösterimSayısı, t: sonGörülmeZamanı } }
  let counts = GM_getValue(STORE_KEY, {});
  let saveTimer = null;

  const style = document.createElement('style');
  style.textContent = `.${HIDE_CLASS} { display: none !important; }`;
  document.documentElement.appendChild(style);

  // id -> eklenecek sayaç farkı (0 = sadece son görülme zamanını tazele)
  const pending = new Map();

  // Başka sekmelerin yazdıklarını ezmemek için kaydederken depoyu yeniden okuyup farkları uygular.
  function flush() {
    const stored = GM_getValue(STORE_KEY, {});
    const now = Date.now();
    for (const [id, delta] of pending) {
      const rec = stored[id] || { c: 0, t: 0 };
      rec.c += delta;
      rec.t = now;
      stored[id] = rec;
    }
    pending.clear();
    let ids = Object.keys(stored);
    for (const id of ids) {
      if (now - stored[id].t > MAX_AGE_MS) delete stored[id];
    }
    ids = Object.keys(stored);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((x, y) => stored[x].t - stored[y].t)
        .slice(0, ids.length - MAX_ENTRIES)
        .forEach((id) => delete stored[id]);
    }
    GM_setValue(STORE_KEY, stored);
    counts = stored;
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 1000);
  }

  function isSupportedPage() {
    return location.pathname === '/' || location.pathname === '/watch';
  }

  function currentVideoId() {
    return location.pathname === '/watch'
      ? new URLSearchParams(location.search).get('v')
      : null;
  }

  function getVideoId(tile) {
    const a = tile.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    if (!a) return null;
    const href = a.getAttribute('href');
    const m = href.match(/[?&]v=([\w-]{6,})/) || href.match(/\/shorts\/([\w-]+)/);
    return m ? m[1] : null;
  }

  const INNER_TILE_SELECTOR = [
    'ytd-compact-video-renderer',
    'yt-lockup-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
  ].join(',');
  // Abonelikler sayfası (YouTube önbelleğinde DOM'da kalsa bile) sayılmaz ve gizlenmez.
  const EXCLUDED_AREA = 'ytd-browse[page-subtype="subscriptions"]';
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href^="/shorts/"]';

  // Karolar, içlerindeki video linklerinden bulunur (YouTube tag adları sık değişiyor).
  function findTiles() {
    const tiles = new Set();
    document.querySelectorAll(LINK_SELECTOR).forEach((a) => {
      if (a.closest(EXCLUDED_AREA)) return;
      const tile = a.closest('ytd-rich-item-renderer') || a.closest(INNER_TILE_SELECTOR);
      if (tile) tiles.add(tile);
    });
    return tiles;
  }

  // Görünür alana ilk kez giren karo "gösterildi" sayılır.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const tile = entry.target;
      const id = tile.dataset.ytrhId;
      io.unobserve(tile);
      delete tile.dataset.ytrhObs;
      if (!id || sessionSeen.has(id)) continue;
      if (!isSupportedPage() || tile.closest(EXCLUDED_AREA)) continue;
      sessionSeen.add(id);
      const rec = counts[id] || (counts[id] = { c: 0, t: 0 });
      rec.c += 1;
      pending.set(id, (pending.get(id) || 0) + 1);
      scheduleSave();
    }
  }, { threshold: 0.1 });

  // Her taramada her karo yeniden değerlendirilir (karolar geri dönüştürülür, sayfa geçişlerinde durum değişir).
  function processTile(tile) {
    const id = getVideoId(tile);

    if (!id || id === currentVideoId()) { // izlenen videoyu sayma/gizleme
      tile.classList.remove(HIDE_CLASS);
      if (tile.dataset.ytrhObs) { io.unobserve(tile); delete tile.dataset.ytrhObs; }
      delete tile.dataset.ytrhId;
      return;
    }
    tile.dataset.ytrhId = id;

    const seen = sessionSeen.has(id);
    const rec = counts[id];
    const hide = !seen && !!rec && rec.c >= MAX_SHOWS;
    tile.classList.toggle(HIDE_CLASS, hide);
    if (hide) pending.set(id, pending.get(id) || 0); // kaydı canlı tut
    if (hide) scheduleSave();

    const wantObserve = !hide && !seen;
    if (!wantObserve) {
      if (tile.dataset.ytrhObs) { io.unobserve(tile); delete tile.dataset.ytrhObs; }
    } else if (tile.dataset.ytrhObs !== id) {
      io.unobserve(tile);
      io.observe(tile);
      tile.dataset.ytrhObs = id;
    }
  }

  function scan() {
    if (!isSupportedPage()) return;
    findTiles().forEach(processTile);
  }

  // Debounce değil throttle: YouTube sürekli DOM değiştirdiği için debounce hiç çalışmayabilir.
  let scanTimer = null;
  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 300);
  }

  new MutationObserver(scheduleScan)
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => {
    // Yeni sayfa gösterimi = yeni oturum
    flush();
    sessionSeen.clear();
    io.disconnect();
    document.querySelectorAll('[data-ytrh-obs]').forEach((el) => delete el.dataset.ytrhObs);
    scheduleScan();
  });
  window.addEventListener('pagehide', flush);

  GM_registerMenuCommand('Sayaçları sıfırla', () => {
    counts = {};
    pending.clear();
    GM_setValue(STORE_KEY, counts);
    document.querySelectorAll('.' + HIDE_CLASS).forEach((el) => el.classList.remove(HIDE_CLASS));
    scheduleScan();
    alert('YouTube Tekrar Gizleyici: tüm sayaçlar sıfırlandı.');
  });
  GM_registerMenuCommand('İstatistik', () => {
    const ids = Object.keys(counts);
    const hidden = ids.filter((id) => counts[id].c >= MAX_SHOWS).length;
    alert(`Kayıtlı video: ${ids.length}\nGizlenen (>=${MAX_SHOWS} gösterim): ${hidden}`);
  });

  scan();
})();
