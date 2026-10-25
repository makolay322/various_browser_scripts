// ==UserScript==
// @name         YouTube Tekrar Eden Video Gizleyici
// @namespace    https://github.com/makolay322/various_browser_scripts
// @version      1.0.0
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

  function pruneAndSave() {
    const now = Date.now();
    let ids = Object.keys(counts);
    for (const id of ids) {
      if (now - counts[id].t > MAX_AGE_MS) delete counts[id];
    }
    ids = Object.keys(counts);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => counts[a].t - counts[b].t)
        .slice(0, ids.length - MAX_ENTRIES)
        .forEach((id) => delete counts[id]);
    }
    GM_setValue(STORE_KEY, counts);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pruneAndSave, 1000);
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
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href^="/shorts/"]';

  // Karolar, içlerindeki video linklerinden bulunur (YouTube tag adları sık değişiyor).
  function findTiles() {
    const tiles = new Set();
    document.querySelectorAll(LINK_SELECTOR).forEach((a) => {
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
      if (!id) continue;
      io.unobserve(tile);
      if (sessionSeen.has(id)) continue;
      sessionSeen.add(id);
      const rec = counts[id] || { c: 0, t: 0 };
      rec.c += 1;
      rec.t = Date.now();
      counts[id] = rec;
      scheduleSave();
    }
  }, { threshold: 0.1 });

  function processTile(tile) {
    const id = getVideoId(tile);
    if (tile.dataset.ytrhId === id) return; // değişmemiş

    // YouTube karoları geri dönüştürür: id değiştiyse durumu sıfırla.
    io.unobserve(tile);
    tile.classList.remove(HIDE_CLASS);
    if (!id) { delete tile.dataset.ytrhId; return; }
    tile.dataset.ytrhId = id;

    if (id === currentVideoId()) return; // izlenen videoyu sayma/gizleme

    const rec = counts[id];
    if (!sessionSeen.has(id) && rec && rec.c >= MAX_SHOWS) {
      tile.classList.add(HIDE_CLASS);
      rec.t = Date.now();
      scheduleSave();
    } else {
      io.observe(tile);
    }
  }

  function scan() {
    if (!isSupportedPage()) return;
    findTiles().forEach(processTile);
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  new MutationObserver(scheduleScan)
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => {
    sessionSeen.clear();
    scheduleScan();
  });
  window.addEventListener('pagehide', pruneAndSave);

  GM_registerMenuCommand('Sayaçları sıfırla', () => {
    counts = {};
    GM_setValue(STORE_KEY, counts);
    document.querySelectorAll('.' + HIDE_CLASS).forEach((el) => el.classList.remove(HIDE_CLASS));
    alert('YouTube Tekrar Gizleyici: tüm sayaçlar sıfırlandı.');
  });
  GM_registerMenuCommand('İstatistik', () => {
    const ids = Object.keys(counts);
    const hidden = ids.filter((id) => counts[id].c >= MAX_SHOWS).length;
    alert(`Kayıtlı video: ${ids.length}\nGizlenen (>=${MAX_SHOWS} gösterim): ${hidden}`);
  });

  scan();
})();
