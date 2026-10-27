// ==UserScript==
// @name         YouTube Playlist Temizleyici
// @namespace    https://github.com/makolay322/various_browser_scripts
// @version      1.3.0
// @description  Beğenilen videolar (list=LL) dahil, açık playlist sayfasındaki videoları tek tek listeden kaldırır.
// @author       makolay322
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STEP_DELAY = 700;      // iki silme arası bekleme (ms)
  const WAIT_MENU = 3000;      // menü öğesi için azami bekleme
  const WAIT_REMOVED = 4000;   // karonun kalkması için azami bekleme
  const MAX_LOAD_TRIES = 5;    // yeni video yüklenmesi için kaydırma denemesi

  const LINK_SELECTOR = 'a[href*="/watch?v="]';
  // Başlık/kenar çubuğundaki "tümünü oynat" linkleri video karosu değildir
  const SKIP_AREA = 'ytd-playlist-header-renderer, ytd-playlist-sidebar-renderer, yt-page-header-renderer, ytd-masthead, ytd-miniplayer';
  // Yeni düzende menü düğmesi .ytLockupMetadataViewModelMenuButton içindedir (aria-label dile göre değişir: "Mehr Aktionen", "More actions"...)
  const MENU_BTN_SELECTOR = '[class*="MenuButton"] button, #menu button, ytd-menu-renderer button, button[aria-label*="menu" i], button[aria-label*="menü" i], button[aria-label*="eylem" i], button[aria-label*="action" i], button[aria-label*="aktion" i]';
  const MENU_ITEM_SELECTOR = 'ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item, ytd-menu-navigation-item-renderer, [role="menuitem"]';
  // "Remove from Liked videos", "Remove from <playlist>", "Beğenilen videolardan kaldır", "... listesinden kaldır"
  const REMOVE_TEXT = /remove from|kaldır|entfernen|supprimer|eliminar|quitar|rimuovi/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!(el && (el.offsetParent || el.getClientRects().length));

  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  function findRemoveItem() {
    return [...document.querySelectorAll(MENU_ITEM_SELECTOR)].find(
      (el) => visible(el) && REMOVE_TEXT.test(el.textContent)
    );
  }

  const videoId = (a) => (a.getAttribute('href').match(/[?&]v=([\w-]+)/) || [])[1];

  // Karo: video linkini ve tek bir üç nokta menü düğmesini içeren en büyük üst eleman
  // (YouTube'un tag adları sık değiştiği için tag'e bağlı değil).
  function findItems() {
    const items = new Set();
    document.querySelectorAll(LINK_SELECTOR).forEach((a) => {
      if (a.closest(SKIP_AREA)) return;
      const id = videoId(a);
      let tile = null;
      for (let el = a.parentElement; el && el !== document.body; el = el.parentElement) {
        const menus = el.querySelectorAll(MENU_BTN_SELECTOR).length;
        const otherVideo = [...el.querySelectorAll(LINK_SELECTOR)].some((l) => videoId(l) !== id);
        if (menus > 1 || otherVideo) break;
        if (menus === 1) tile = el;
      }
      if (tile && visible(tile)) items.add(tile);
    });
    document.querySelectorAll('ytd-playlist-video-renderer').forEach((el) => visible(el) && items.add(el));
    return [...items];
  }

  function nextItem() {
    return findItems().find((el) => !el.dataset.ytpcFailed);
  }

  const hasVideo = (id) => [...document.querySelectorAll(LINK_SELECTOR)]
    .some((a) => videoId(a) === id && visible(a) && !a.closest(SKIP_AREA));

  async function removeOne(item) {
    const link = [...item.querySelectorAll(LINK_SELECTOR)][0];
    const id = link && videoId(link);
    item.scrollIntoView({ block: 'center' });
    await sleep(150);
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const btn = item.querySelector(MENU_BTN_SELECTOR);
    if (!btn) return false;
    btn.click();

    const entry = await waitFor(findRemoveItem, WAIT_MENU);
    if (!entry) {
      document.body.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    entry.click();
    // Karo DOM'dan kalkana (veya gizlenene) kadar bekle
    const gone = await waitFor(() => !item.isConnected || !visible(item) || (id && !hasVideo(id)), WAIT_REMOVED);
    return !!gone;
  }

  let running = false;
  let removed = 0;
  let failed = 0;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#222;color:#fff;' +
    'padding:10px 12px;border-radius:10px;font:13px/1.4 sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);';
  const status = document.createElement('div');
  const button = document.createElement('button');
  button.style.cssText = 'margin-top:6px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer;' +
    'background:#c00;color:#fff;font-weight:600;width:100%;';
  panel.append(status, button);

  // YouTube SPA: sayfa tam yüklenmeden playlist'e geçilebilir, paneli sayfaya göre ekle/kaldır.
  function syncPanel() {
    const onPlaylist = location.pathname === '/playlist';
    if (onPlaylist && !panel.isConnected) document.body.appendChild(panel);
    if (!onPlaylist) { running = false; panel.remove(); }
  }
  window.addEventListener('yt-navigate-finish', syncPanel);
  setInterval(syncPanel, 1000);

  function render(msg) {
    status.textContent = msg || `Kaldırılan: ${removed} · Başarısız: ${failed}`;
    button.textContent = running ? 'Durdur' : 'Listeyi temizle';
  }

  async function run() {
    running = true;
    let loadTries = 0;
    render();
    while (running) {
      const item = nextItem();
      if (!item) {
        // Liste tembel yükleniyor: kaydırıp yeni video bekle
        if (loadTries++ >= MAX_LOAD_TRIES) break;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(1200);
        continue;
      }
      loadTries = 0;
      const ok = await removeOne(item);
      if (ok) removed++;
      else { failed++; item.dataset.ytpcFailed = '1'; }
      render();
      await sleep(STEP_DELAY);
    }
    const stopped = !running;
    running = false;
    render(stopped ? `Durduruldu. Kaldırılan: ${removed} · Başarısız: ${failed}` : `Bitti. Kaldırılan: ${removed} · Başarısız: ${failed}`);
  }

  button.addEventListener('click', () => {
    if (running) { running = false; return; }
    const n = findItems().length;
    if (!confirm(`Bu listedeki videolar tek tek kaldırılacak (şu an yüklü: ${n}). Devam edilsin mi?`)) return;
    removed = 0; failed = 0;
    run();
  });

  render('Hazır');
  syncPanel();
})();
