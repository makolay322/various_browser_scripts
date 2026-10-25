# various_browser_scripts

Çeşitli Tampermonkey kullanıcı scriptleri. Yeni script eklendikçe bu liste güncellenir.

## Kurulum

1. Tarayıcına [Tampermonkey](https://www.tampermonkey.net/) eklentisini kur.
2. İstediğin `*.user.js` dosyasını GitHub'da aç, **Raw** düğmesine tıkla; Tampermonkey kurulum ekranı açılır.

## Scriptler

| Script | Açıklama |
|---|---|
| [`youtube-repeat-hider.user.js`](youtube-repeat-hider.user.js) | YouTube'da sürekli aynı videoların önerilmesini engeller. |

### YouTube Tekrar Eden Video Gizleyici

Ana sayfadaki video karolarında ve izleme sayfasındaki sağ "Önerilenler" sütununda:

- Her videonun ID'sini tarayıcıda (Tampermonkey depolaması) saklar.
- Bir video, bir oturumda ekranda (görünür alanda) ilk kez belirdiğinde sayacı 1 artar. Aynı oturumda tekrar görünmesi sayacı artırmaz.
- Sayacı **3'e ulaşmış** videoları **4. gösterimden itibaren gizler**.
- İzlediğin videonun kendisi sayılmaz ve gizlenmez.

Notlar:

- **Oturum**, sayfanın tam yüklenmesidir (yeni sekme veya F5). Ana sayfa ile video sayfası arasındaki geçişler aynı oturumdur.
- 30 günden eski kayıtlar otomatik silinir (en fazla 20.000 kayıt tutulur).
- Tampermonkey menüsünden **Sayaçları sıfırla** ve **İstatistik** komutları kullanılabilir.
- Ayarlar script başındaki sabitlerdedir (`MAX_SHOWS`, `MAX_AGE_MS`).
- YouTube arayüzü sık değiştiği için seçiciler (`TILE_SELECTOR`) zamanla güncelleme isteyebilir.
