<p align="center">
  <img src="assets/icon.png" width="96" alt="AI Limit Tray simgesi">
</p>

# AI Limit Tray

Codex ve Claude kullanım limitlerini Windows sistem tepsisinden takip etmek için küçük bir masaüstü uygulaması.

Birden fazla Codex hesabı arasında çalışırken hangi hesabın ne kadar hakkı kaldığını görmek gereksiz yere dağınıktı. AI Limit Tray'i, tarayıcı sekmesi açmadan bu bilgiyi tek yerde görebilmek için yaptım.

## Neler gösteriyor?

- Claude hesaplarının birleşik kalan kullanım oranı
- Codex hesaplarının birleşik kalan kullanım oranı
- Her Codex hesabının ayrı kalan kullanım oranı
- Hesap başına kısa kullanım penceresi (genellikle 5 saat) ve haftalık/uzun pencere
- Limitlerin sıfırlanacağı tarih ve saat
- Codex, Claude Desktop veya Claude Code'da aktif oturumun kalan context oranı
- Öndeki Codex/Claude penceresinde otomatik görünen, tıklamaları engellemeyen context katmanı
- Oturumda context sıkıştırıldıysa `Compact uygulandı` bilgisi ve sıkıştırma sayısı
- 5 saatlik veya haftalık kullanımda `%20` ve altına düşen kalan limit için context alanında uyarı
- Tepsi simgesinin üzerinde bekleyince açılan kompakt özet

Claude değerleri turuncu, Codex değerleri yeşil gösterilir. Böylece hızlıca bakıldığında iki servis birbirine karışmaz.

Context bölümü kota göstergesinden ayrıdır. Codex/Claude Desktop'taki açık sohbet veya öndeki Claude Code
terminal oturumu değiştiğinde başlık, model ve son context yükü otomatik güncellenir. Codex oranı
sabit sistem yükünü kullanılabilir alandan ayırır; Claude Code oranı ise Claude'un resmî `statusLine`
verisindeki canlı kullanılan/kalan yüzdeyi kullanır. Katman yalnızca desteklenen pencere öndeyken
görünür, odağı üzerine almaz ve fare tıklamalarını alttaki pencereye geçirir. Tepsi menüsünden
kapatılıp yeniden açılabilir. Aktif hesabın 5 saatlik veya haftalık kalan limiti `%20` ve altına
düştüğünde context kartı kalan yüzdeyi sarı uyarıyla gösterir; `%10` ve altı kırmızı kritik uyarıdır.
Codex ve Claude Code oturum kayıtlarında bir context sıkıştırma sınırı oluştuğunda kart, hover özeti
ve pencere katmanı bunu `Compact uygulandı` etiketiyle kalıcı olarak belirtir.

## İndirme

Hazır Windows kurulum dosyasını [Releases](https://github.com/mehdimirzafaruk/ai-limit-tray/releases) sayfasından indirebilirsiniz.

Windows SmartScreen ilk çalıştırmada uyarı gösterebilir. Uygulama henüz ticari bir kod imzalama sertifikasıyla imzalanmıyor.

## Kaynaktan çalıştırma

Gereksinimler:

- Windows 10 veya 11
- Node.js 22 veya üzeri
- Claude hesabı bağlamak için [Claude Code](https://docs.anthropic.com/en/docs/claude-code) komutunun PATH üzerinde bulunması

```powershell
git clone https://github.com/mehdimirzafaruk/ai-limit-tray.git
cd ai-limit-tray
npm ci
npm start
```

Kurulum dosyası üretmek için:

```powershell
npm run check
npm run dist
```

Çıktı `dist/` klasörüne yazılır.

## Hesaplar nasıl saklanıyor?

Her Codex hesabı ayrı bir `CODEX_HOME`, Claude hesabı ise ayrı bir `CLAUDE_CONFIG_DIR` altında tutulur. Uygulamanın kendi `settings.json` dosyasında yalnızca profil adı ve kimliği vardır; erişim tokenları bu dosyaya kopyalanmaz.

Codex oturumları uygulama açıkken dört saatte bir arka planda yenilenir. Uygulama Windows
oturumuyla birlikte sessizce başlar; böylece uzun süre kullanılmayan hesapların tokenları da
canlı tutulur. Geçici bağlantı kesintilerinde profil silinmez ve yeniden eklenmez.

Claude Code context takibi ilk çalıştırmada `~/.claude/settings.json` içindeki mevcut `statusLine`
komutunu koruyan küçük bir köprü kurar. Önceki ayarın yedeği
`settings.ai-limit-tray-before-context.json` dosyasına alınır. Köprü yalnızca oturum kimliği,
model, çalışma dizini ve context sayaçlarını yerelde saklar; mesaj içeriğini veya kimlik bilgisini
kopyalamaz.

Codex bağlantısı paketle birlikte gelen resmî `@openai/codex` istemcisinin app-server protokolünü kullanır. Claude tüketici planlarında belgelenmiş genel bir kota API'si bulunmadığı için Claude entegrasyonu deneyseldir ve Anthropic tarafındaki değişikliklerde güncelleme gerektirebilir.

## Toplam oran nasıl hesaplanıyor?

Sağlayıcılar her planın mutlak kapasitesini paylaşmadığı için her bağlı hesap 100 kota birimi kabul edilir. Örneğin iki Codex hesabında `%80` ve `%50` kaldıysa birleşik değer `130 / 200`, yani `%65` olur. Bu sayı parasal bakiye değil, hesaplar arası birleşik yüzdedir.

## Geliştirme

Hata bildirimi ve küçük iyileştirmeler için issue açabilirsiniz. Değişiklik göndermek isterseniz önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına göz atın.

## Lisans

[MIT](LICENSE)
