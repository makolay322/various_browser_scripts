// ==UserScript==
// @name         YouTube Playlist Temizleyici
// @namespace    https://github.com/makolay322/various_browser_scripts
// @version      1.5.0
// @description  Beğenilen videolar (list=LL) dahil, açık playlist sayfasındaki videoları tek tek listeden kaldırır.
// @author       makolay322
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.5.0';
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

  // YouTube bazı düğmelerde yalnızca tam işaretçi olay dizisine tepki verir
  function realClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
    });
  }

  const POPUP_AREA = 'ytd-popup-container, tp-yt-iron-dropdown, ytd-menu-popup-renderer, yt-contextual-sheet-layout, yt-sheet-view-model, [role="menu"], [role="dialog"]';
  const CLICKABLE = 'yt-list-item-view-model, ytd-menu-service-item-renderer, tp-yt-paper-item, [role="menuitem"], button, a';

  function popupTexts() {
    const out = [];
    document.querySelectorAll(POPUP_AREA + ', ' + MENU_ITEM_SELECTOR).forEach((el) => {
      if (!visible(el)) return;
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t && t.length < 90 && !out.includes(t)) out.push(t);
    });
    return out;
  }

  function findRemoveItem() {
    const direct = [...document.querySelectorAll(MENU_ITEM_SELECTOR)].find(
      (el) => visible(el) && REMOVE_TEXT.test(el.textContent) && el.textContent.length < 120
    );
    if (direct) return direct;
    // Yedek: açık menü/pencere içinde metni eşleşen en küçük eleman
    for (const area of document.querySelectorAll(POPUP_AREA)) {
      if (!visible(area)) continue;
      const hit = [...area.querySelectorAll('*')].filter((el) => !el.children.length && visible(el) && REMOVE_TEXT.test(el.textContent))[0];
      if (hit) return hit.closest(CLICKABLE) || hit;
    }
    return null;
  }

  let lastReason = '';

  const KNOWN_TILES = 'ytd-playlist-video-renderer, yt-lockup-view-model, ytd-playlist-panel-video-renderer';
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
      if (!tile) tile = a.closest(KNOWN_TILES);
      if (tile) items.add(tile);
    });
    document.querySelectorAll('ytd-playlist-video-renderer').forEach((el) => items.add(el));
    return [...items];
  }

  function nextItem() {
    return findItems().find((el) => !el.dataset.ytpcFailed && visible(el));
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
    if (!btn) { lastReason = 'menü düğmesi yok'; return false; }
    realClick(btn);

    const entry = await waitFor(findRemoveItem, WAIT_MENU);
    if (!entry) {
      lastReason = 'kaldır öğesi yok; menüde görünenler: ' + (popupTexts().join(' | ') || '(menü açılmadı)');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.click();
      return false;
    }
    realClick(entry);
    // Karo DOM'dan kalkana (veya gizlenene) kadar bekle
    const gone = await waitFor(() => !item.isConnected || !visible(item) || (id && !hasVideo(id)), WAIT_REMOVED);
    if (!gone) lastReason = 'tıklandı ama video listeden kalkmadı: ' + entry.textContent.replace(/\s+/g, ' ').trim();
    return !!gone;
  }

  let running = false;
  let removed = 0;
  let failed = 0;

  const panel = document.createElement('div');
  panel.style.cssText = 'white-space:pre-wrap;max-width:360px;position:fixed;right:16px;bottom:16px;z-index:99999;background:#222;color:#fff;' +
    'padding:10px 12px;border-radius:10px;font:13px/1.4 sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);';
  const status = document.createElement('div');
  const button = document.createElement('button');
  button.style.cssText = 'margin-top:6px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer;' +
    'background:#c00;color:#fff;font-weight:600;width:100%;';
  panel.append(status, button);

  // YouTube SPA: sayfa tam yüklenmeden playlist'e geçilebilir, paneli sayfaya göre ekle/kaldır.
  // Sorun giderme: paneldeki sayılar neyin bulunduğunu gösterir
  function diag() {
    const links = document.querySelectorAll(LINK_SELECTOR).length;
    const menus = document.querySelectorAll(MENU_BTN_SELECTOR).length;
    return `v${VERSION} · link: ${links} · menü: ${menus} · karo: ${findItems().length}`;
  }

  function syncPanel() {
    const onPlaylist = location.pathname === '/playlist';
    if (onPlaylist && !panel.isConnected) document.body.appendChild(panel);
    if (!onPlaylist) { running = false; panel.remove(); }
    if (onPlaylist && !running && !removed && !failed) render('Hazır · ' + diag());
  }
  window.addEventListener('yt-navigate-finish', syncPanel);
  setInterval(syncPanel, 1000);

  function render(msg) {
    status.textContent = msg || `Kaldırılan: ${removed} · Başarısız: ${failed}` + (lastReason ? `\nSon hata: ${lastReason}` : '');
    button.textContent = running ? 'Durdur' : 'Listeyi temizle';
  }

  async function run() {
    running = true;
    let loadTries = 0;
    let streak = 0;
    lastReason = '';
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
      if (ok) { removed++; streak = 0; }
      else { failed++; streak++; item.dataset.ytpcFailed = '1'; if (streak >= 3) break; } // üst üste 3 hata: dur
      render();
      await sleep(STEP_DELAY);
    }
    const stopped = !running;
    running = false;
    render((stopped ? 'Durduruldu. ' : 'Bitti. ') + `Kaldırılan: ${removed} · Başarısız: ${failed}` + (lastReason ? `\nSon hata: ${lastReason}` : ''));
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
