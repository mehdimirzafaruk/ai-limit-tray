# Değişiklikler

## Yayınlanmadı

- YENİ: Codex ve Claude Code oturumlarında gerçekleşen context sıkıştırmaları doğrudan oturum
  olaylarından algılanıyor; ana kart, hover özeti ve pencere katmanı `Compact uygulandı` bilgisini
  ve sıkıştırma sayısını gösteriyor.
- YENİ: Claude Desktop aktif sohbeti, modelin uygulamadaki context sınırı ve tahmini kalan yüzdesiyle
  sağ üst context katmanında gösteriliyor; Claude Desktop artık Claude Code süreciyle karışmıyor.
- YENİ: Aktif Codex veya Claude Code oturumunun 5 saatlik/haftalık kalan limiti `%20` ve altına
  düştüğünde context kartı, hover özeti ve pencere katmanında kalan yüzdeyle uyarı gösteriliyor;
  `%10` ve altı kritik kırmızı olarak işaretleniyor.
- YENİ: Öndeki Claude Code terminal penceresinde aktif oturumun modelini, kullanılan tokenını ve
  kalan context yüzdesini gösteren canlı katman eklendi.
- YENİ: Claude Code'un resmî `statusLine` verisini yerelde okuyan köprü eklendi; mevcut özel
  statusline komutu korunuyor, Git Bash ile zincirleniyor ve ilk ayarın yedeği alınıyor.
- İYİLEŞTİRME: Ana panel, hover özeti ve context katmanı Codex/Claude kaynağına göre başlık ve renk
  kullanıyor; birden fazla Claude oturumunda pencere başlığıyla eşleşen oturum öne alınıyor.
- DÜZELTME: Codex hesap tokenları limit isteğinden önce kontrollü aralıklarla yenileniyor;
  beklenmedik `401` durumunda tek seferlik zorunlu yenileme ve yeniden deneme yapılıyor.
- DÜZELTME: Geçici bağlantı hatalarında son başarılı limit verisi korunuyor ve ham İngilizce
  hata yerine kısa Türkçe durum gösteriliyor; profil artık yeniden eklenmek zorunda değil.
- İYİLEŞTİRME: Token canlı tutma aralığı 4 saate indirildi, başarısız kurtarma denemeleri
  sınırlandı ve uygulama Windows oturumuyla birlikte sessizce başlayacak şekilde ayarlandı.
- İYİLEŞTİRME: Arka plan kurtarması sırasında “Yeniden bağla” uyarısı yerine
  “Oturum korunuyor” durumu gösteriliyor.
- YENİ: Ana panel ve tepsi özeti artık yalnızca Codex masaüstünde gerçekten açık olan
  sohbetleri, kendi başlıkları ve kalan context oranlarıyla gösteriyor.
- YENİ: Öndeki Codex penceresinin sağ üstünde otomatik konumlanan, odağı almayan ve
  tıklamaları engellemeyen context katmanı eklendi. Katman tepsi menüsünden kapatılabilir.
- DÜZELTME: Context hesabında oturumun ömür boyu token toplamı yerine son model çağrısının
  gerçek context yükü ve Codex'in sistem yükü düzeltmesi kullanılıyor; uzun sohbetler artık
  yanlışlıkla `%100 dolu` görünmüyor ve kalan oran Codex ile eşleşiyor.
- DÜZELTME: En son değişen oturum dosyasını seçme kaldırıldı. Sohbet geçişleri Codex masaüstü
  görünüm olaylarından izleniyor; arka plandaki CLI/ajan oturumları aktif sohbeti ezmiyor.
- İYİLEŞTİRME: Tek örnek kilidi, foreground pencere kimliği doğrulaması, DPI uyumlu konumlama,
  yardımcı süreç temizliği ve aktif sohbet/context testleri eklendi.
- Panel artık varsayılan olarak sabit (sticky): fare tepsi simgesinden çekilince
  hover paneli artık otomatik kapanmıyor, ekranda sabit kalıyor.
- Hover panelinin sağ üstüne 📌 sabitleme düğmesi eklendi; tek tıkla aç/kapat.
- Tepsi sağ tık menüsüne "Paneli sabitle / Sabitlemeyi kaldır" seçeneği eklendi.
- Tercih `settings.json` içinde `stickyHover` alanıyla kalıcı olarak saklanıyor.

## 0.1.0 - 2026-08-15

- Birden fazla Codex hesabı desteği
- Claude hesabı ve kullanım penceresi desteği
- Birleşik Claude ve Codex oranları
- Hesap başına kısa ve haftalık limit görünümü
- Sabit boyutlu sistem tepsisi önizlemesi
- Windows kurulum paketi ve masaüstü kısayolu
