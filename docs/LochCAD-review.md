# LochCAD incelemesi ve uygulanan iyileştirmeler

İnceleme, [README](https://github.com/rathlinus/LochCAD), [kullanıcı kılavuzu](https://github.com/rathlinus/LochCAD/blob/main/docs/BENUTZERHANDBUCH.md) ve [değişiklik kaydındaki](https://github.com/rathlinus/LochCAD/blob/main/CHANGELOG.md) özellikler ve kullanım akışları üzerinden yapıldı. Belgeler özellik kapsamını doğruluyor; algoritmaların veya canlı uygulamanın performansı hakkında karşılaştırmalı bir ölçüm yapılmadı.

Yeni işlevler Perfboard Editor'ün kendi JavaScript/SVG arayüzü ve proje modeli üzerinde geliştirildi. LochCAD kaynak dosyaları, varlıkları veya bağımlılıkları projeye aktarılmadı.

## Uygulananlar

| LochCAD'de görülen özellik | Bu projeye katkısı | Buradaki uygulama |
| --- | --- | --- |
| Perfboard ve stripboard | Gerçek bakır yolları hesaba katmak | Yatay/dikey, alt yüzde bakır şeritler; tel ve pinlerle aynı fiziksel bağlantı hesabı |
| Yol kesme ve lehim köprüleri | Montaj işlemlerini çizimde saklamak | Delikler arasında kesim; komşu delikler arasında yüz seçilebilir köprü; tıklayarak ekleme/kaldırma ve geri alma |
| Açık bağlantı çizgileri | Eksik bağlantıları görerek tamamlamak | Pinlerde Plan net; fiziksel adalar arasında kısa kılavuzlar; listeden kablo başlatma; bakır yol vurgulama |
| DRC | Bakır yolların oluşturduğu hataları yakalamak | Net çakışması, eksik bağlantı, aynı deliği paylaşan pinler, bağlı NC pini, kesimi aşan çıplak kablo ve etkisiz kesim kontrolleri |
| Netlist JSON | Bağlantıları başka araçlara aktarabilmek | Fiziksel bağlantı adaları ile planlanan netleri ayrı kaydeden, bir tabanlı koordinatlara sahip JSON |
| Proje notları | Tasarım kararlarını proje ile saklamak | Otomatik kaydedilen metin/Markdown defteri ve işaretlenebilir montaj adımları |
| Montaj çıktısı | Ekrandaki bilgiyi çalışma tezgâhına taşımak | Kesim/köprü koordinat listesi, notlar ve görevler içeren baskı; aynalanmış alt yüz çizimi; Markdown indirme |
| Ayrıntılı 3D görünüm | Bileşenleri ve kartın iki yüzünü anlaşılır göstermek | Babylon ile bağımsız geliştirilen paket modelleri, metal/plastik malzemeler, açık delikler, tel ve lehim geometrisi; kamera görünümleri, saydamlık, katmanlar ve PNG |

## Tasarım kararları

- Kesim bir delik üzerine değil iki pad arasına yerleştirilir. Her iki delik de pin için kullanılabilir; çizimdeki boşluk ve elektriksel kesinti aynı veriden üretilir.
- Aynı net adı verilen iki ada fiziksel olarak birleşmiş sayılmaz. Kılavuzlar kullanıcıdan beklenen bağlantıyı gösterir ve gerçek bakır oluşunca kaybolur.
- Kılavuzlar fiziksel adaları birbirine bağlayan bir ağaç oluşturur; aynı net için gereksiz ek çizgiler üretilmez. Kullanıcı güzergâhı seçer ve ara dönüşler ekleyebilir.
- Bakır iş planı konumu bulma ve kaldırma işlevleri sağlar. Montaj çıktıları koordinatların hangi yüzden okunduğunu açıkça belirtir.
- Yeni dosya alanları isteğe bağlıdır. Eski iki ADAU1701 örneğinin pin ve kablo koordinatları korunur; kesimler, köprüler, pin netleri ve defter kayıt/geri alma sürecine katılır.
- Ek paket veya derleme adımı gerekmez. `npm start` akışı korunur.

## Daha büyük geliştirmeler için değerlendirme

LochCAD ayrıca bağımsız şema editörü, şemadan yerleşime aktarım, otomatik yerleşim/yönlendirme, SPICE simülasyonu, çoklu proje yöneticisi ve gerçek zamanlı ortak çalışma sunuyor. Bunlar ayrı geliştirme adımları olarak değerlendirildi:

1. **Şema ve bağlantı planı eşleştirmesi:** Net amaçlarının görsel olarak tanımlanması ve şema ile kartın değişikliklerinin birlikte izlenmesi.
2. **Yerleşim önerileri ve kontrollü yönlendirme:** Bileşen gövde ölçüleri, bakır yüzleri, geçişler ve kesimler için doğrulanmış kurallara dayanan önizlemeli öneriler.
3. **Kalıcı proje kitaplığı:** Kurtarma geçmişinden bağımsız proje kartları ve toplu yedekleme.
4. **Simülasyon:** Elektriksel pin tipleri ve bileşen modelleri ile bir simülasyon motorunun bütünleştirilmesi.
5. **Ortak çalışma:** Sunucu, eşzamanlı düzenleme ve proje paylaşım modeli.

İlk güncellemenin ardından 3D görüntüleyici de geliştirildi. LochCAD'in 3D özellikleri fikir düzeyinde değerlendirildi; modeller, geometri ve arayüz bu projenin Babylon tabanlı yapısı için bağımsız yazıldı. Gövde ölçüleri temsili, pin konumları kayıtlı yerleşimle aynıdır.

## Doğrulama

- `npm test`: Eski örnekler, veri doğrulama, fiziksel bağlantı hesabı, net kılavuzları, kesimler/köprüler, 3D geometri ve çıktı üretimi.
- `python3 tests/browser_smoke.py`: Önceki düzenleme, kayıt, kurtarma, baskı ve mobil akışlar.
- `python3 tests/browser_copper.py`: Yeni bakır araçları, net planlama, defter, çıktı ve mobil akışlar.
- `python3 tests/browser_3d.py --babylon /path/to/babylon.js`: Gerçek Babylon çalışma zamanı ve Chrome yazılımsal WebGL ile 49 bileşen, iki eski örnek, kamera, yüzler, seçim, katmanlar, PNG, tam ekran, mobil görünüm ve kaynak temizliği.

3D birim testleri GPU gerektirmez. Ayrı 3D tarayıcı testi gerçek WebGL çizimini doğrular; yerel Babylon dosyası verildiğinde dış ağ isteklerinin tamamı kapatılır. Fiziksel ekran kartlarında karşılaştırmalı performans ölçümü yapılmadı.
