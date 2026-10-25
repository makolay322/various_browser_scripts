// ==UserScript==
// @name         YouTube Gereksiz İçerik Temizleyici
// @namespace    https://github.com/makolay322/various_browser_scripts
// @version      1.0.0
// @description  Yarıda bırakılmış videoları, canlı yayınları, "Mix" playlistlerini ve "Yeni konuları keşfedin" satırlarını gizler.
// @author       makolay322
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Hangi filtrelerin açık olacağı
  const HIDE_IN_PROGRESS = true;   // kısmen izlenmiş videolar
  const HIDE_LIVE = true;          // canlı yayınlar
  const HIDE_MIXES = true;         // "Your Mix" / "Mix – ..." playlistleri
  const HIDE_TOPIC_SHELVES = true; // "Yeni konuları keşfedin" vb. satırlar

  // Bu sayfalarda dokunma (izleme geçmişi, playlist sayfaları, kütüphane)
  const EXCLUDED_PATHS = [/^\/feed\/history/, /^\/playlist/, /^\/feed\/(you|library)/];

  const HIDE_CLASS = 'ytcr-hidden';
  const style = document.createElement('style');
  style.textContent = `.${HIDE_CLASS} { display: none !important; }`;
  document.documentElement.appendChild(style);

  // --- Karo tespiti: video linklerinden yukarı çık ---
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href^="/shorts/"], a[href*="list=RD"]';
  const INNER_TILE_SELECTOR = [
    'ytd-compact-video-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-compact-radio-renderer',
    'yt-lockup-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-radio-renderer',
    'ytd-playlist-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
  ].join(',');
  // Oynatma listesi paneli (şu an dinlenen liste) asla gizlenmez
  const NEVER_HIDE = 'ytd-playlist-panel-video-renderer, ytd-playlist-panel-renderer';

  function findTiles() {
    const tiles = new Set();
    document.querySelectorAll(LINK_SELECTOR).forEach((a) => {
      if (a.closest(NEVER_HIDE)) return;
      const tile = a.closest('ytd-rich-item-renderer') || a.closest(INNER_TILE_SELECTOR);
      if (tile) tiles.add(tile);
    });
    return tiles;
  }

  // --- Kural: kısmen izlenmiş ---
  const PROGRESS_SELECTOR = [
    'ytd-thumbnail-overlay-resume-playback-renderer #progress',
    '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
    'yt-thumbnail-overlay-progress-bar-view-model [style*="width"]',
  ].join(',');

  function isInProgress(tile) {
    for (const el of tile.querySelectorAll(PROGRESS_SELECTOR)) {
      const w = parseFloat(el.style.width);
      if (w > 0) return true;
    }
    return false;
  }

  // --- Kural: canlı yayın ---
  const BADGE_SELECTOR = [
    'ytd-thumbnail-overlay-time-status-renderer',
    'yt-thumbnail-badge-view-model',
    '.badge-shape-wiz__text',
    '.yt-badge-shape__text',
    'ytd-badge-supported-renderer',
  ].join(',');
  const LIVE_TEXT = /^\s*(live|canl[ıiI])\s*$/i;

  function isLive(tile) {
    if (tile.querySelector('ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"], .badge-style-type-live-now, [class*="badge-shape-wiz--thumbnail-live"], [class*="thumbnail-live"]')) {
      return true;
    }
    for (const el of tile.querySelectorAll(BADGE_SELECTOR)) {
      if (LIVE_TEXT.test(el.textContent)) return true;
    }
    return false;
  }

  // --- Kural: Mix playlisti ---
  // Mix playlist kimlikleri "RD" ile başlar (RDMM, RDGM, RDEM...); RDCLAK (resmi küratörlü) hariç.
  const MIX_TITLE = /^\s*(your mix|mix\b|karışım)/i;

  function isMix(tile) {
    for (const a of tile.querySelectorAll('a[href*="list=RD"]')) {
      if (!/list=RDCLAK/.test(a.getAttribute('href'))) return true;
    }
    const title = tile.querySelector('#video-title, h3, [class*="lockup-metadata-view-model-wiz__title"]');
    return !!title && MIX_TITLE.test(title.textContent);
  }

  // --- Kural: konu keşfet satırları ---
  const SHELF_SELECTOR = 'ytd-rich-section-renderer, ytd-shelf-renderer, ytd-horizontal-card-list-renderer, ytd-rich-shelf-renderer';
  const SHELF_TITLE = /yeni konular|konuları keşfedin|explore (new )?topics|discover new topics/i;

  function isTopicShelf(shelf) {
    const t = shelf.querySelector('#title, #title-text, h2, yt-formatted-string.ytd-rich-shelf-renderer');
    return !!t && SHELF_TITLE.test(t.textContent);
  }

  function setHidden(el, hide) {
    el.classList.toggle(HIDE_CLASS, hide);
  }

  function scan() {
    if (EXCLUDED_PATHS.some((re) => re.test(location.pathname))) {
      document.querySelectorAll('.' + HIDE_CLASS).forEach((el) => el.classList.remove(HIDE_CLASS));
      return;
    }

    findTiles().forEach((tile) => {
      const hide =
        (HIDE_IN_PROGRESS && isInProgress(tile)) ||
        (HIDE_LIVE && isLive(tile)) ||
        (HIDE_MIXES && isMix(tile));
      setHidden(tile, hide);
    });

    if (HIDE_TOPIC_SHELVES) {
      document.querySelectorAll(SHELF_SELECTOR).forEach((shelf) => {
        // İç içe shelf'lerde yalnızca en dıştakini işle
        const outer = shelf.parentElement && shelf.parentElement.closest(SHELF_SELECTOR);
        if (outer) return;
        setHidden(shelf, isTopicShelf(shelf));
      });
    }
  }

  let timer = null;
  function scheduleScan() {
    clearTimeout(timer);
    timer = setTimeout(scan, 250);
  }

  // Rozetler ve ilerleme çubukları karolardan sonra yüklenebildiği için alt ağacı izle
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', scheduleScan);

  scan();
})();
