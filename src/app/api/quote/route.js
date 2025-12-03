import { NextResponse } from 'next/server';

const quotes = [
    // AZİM VE KARARLILIK
    "Hayatın sana vurduğu darbeler seni yere serebilir ama ayağa kalkıp kalkmamak tamamen senin elindedir; gerçek güç düştüğünde değil, her düştüğünde daha güçlü kalktığında ortaya çıkar.",
    "Büyük başarıların sırrı, herkesin vazgeçtiği noktada bir adım daha atabilme cesaretini göstermektir; çünkü zafer, pes etmeyenlerin en büyük ödülüdür.",
    "Zirveye giden yol asla düz değildir; yokuşlar, engeller ve fırtınalarla doludur ama manzarayı en güzel görecek olanlar, o yokuşları tırmanmayı göze alanlardır.",
    "Bugün çektiğin acı, yarın hissedeceğin gücün ta kendisidir; bu yüzden zorluklardan kaçma, onları seni geliştirecek birer öğretmen olarak gör.",
    "Eğer hayallerin seni korkutmuyorsa, yeterince büyük değiller demektir; sınırlarını zorla ve potansiyelinin sandığından çok daha fazlası olduğunu keşfet.",
    "Başarı, beklemediğin bir anda kapını çalan bir misafir değil, her sabah uyanıp ilmek ilmek ördüğün bir kaderdir.",
    "Karanlığın en yoğun olduğu an, şafağın sökmesine en yakın olan andır; umudunu asla kaybetme, çünkü güneş her zaman yeniden doğar.",
    "Bir nehir, gücüyle değil, sürekliliğiyle kayaları deler; sen de hedeflerine ulaşmak istiyorsan su gibi sürekli ve kararlı olmalısın.",
    "Dünya, 'yapılamaz' diyenlerle doludur; sen ise o sırada 'yapıyorum' diyerek onları şaşırtan kişi olmalısın.",
    "Yetenek seni kapıdan içeri sokabilir, ama o odada kalmanı sağlayacak olan şey karakterin ve çalışma disiplinindir.",
    "Kaybetmekten korkma; çünkü her başarısızlık, başarıya giden yolda öğrenmen gereken bir dersi barındırır.",
    "En uzun yolculuklar bile, atılan cesur ve kararlı tek bir adımla başlar; ertelemeyi bırak ve o adımı şimdi at.",
    "Başkalarının senin hakkında ne düşündüğü, senin gerçeğin olmak zorunda değil; kendi hikayeni başkalarının kalemine bırakma.",
    "Zaman, sahip olduğun en değerli sermayedir; onu boşa harcama, çünkü geçen her saniye bir daha asla geri gelmeyecek.",
    "Mucizeler, sen konfor alanından çıkıp bilinmeze doğru cesurca yürüdüğünde gerçekleşmeye başlar.",
    "Bir şeyi gerçekten istiyorsan bir yolunu bulursun, istemiyorsan bir bahane bulursun; seçimin senin kaderini belirler.",
    "Hayat, fırtınanın geçmesini beklemek değil, yağmurun altında dans etmeyi öğrenmektir; zorluklarla yaşamayı öğren ve onlardan keyif al.",
    "Dün, tecrübe ettiğin bir rüyaydı; yarın, henüz gerçekleşmemiş bir hayal; ama bugün, elindeki tek gerçek ve onu en iyi şekilde değerlendirmelisin.",
    "Kendine inanmak, sihirli bir değnek gibidir; sen kendine inandığında, başkalarının imkansız dediği şeyler senin için mümkün hale gelir.",
    "Yorgun olduğunda değil, işin bittiğinde durmalısın; disiplin, canın istemediğinde bile yapman gerekeni yapabilmektir.",

    // VİZYON VE GELECEK
    "Gelecek, bugünden hazırlananlara aittir; yarınını inşa etmek istiyorsan, bugünün tuğlalarını özenle yerleştirmelisin.",
    "Hayal gücü, bilgiden daha önemlidir; çünkü bilgi sınırlıdır ama hayal gücü tüm dünyayı kapsar ve ilerlemenin anahtarıdır.",
    "Rotası olmayan bir gemiye hiçbir rüzgar yardım edemez; önce nereye gitmek istediğini bilmelisin ki rüzgarları arkana alabilesin.",
    "Sadece bakmakla kalma, görmeyi öğren; fırsatlar genellikle detaylarda ve başkalarının dikkat etmediği yerlerde gizlidir.",
    "Kendi ışığını keşfet; çünkü sen parladığında, etrafındaki karanlık kendiliğinden kaybolacaktır.",
    "En iyi intikam, muazzam bir başarıdır; enerjini seni aşağı çekenlere değil, seni yukarı taşıyacak hedeflere harca.",
    "Dünyayı değiştirmek istiyorsan, işe önce aynadaki kişiden başla; sen değiştiğinde, dünya da seninle birlikte değişecektir.",
    "Küçük insanlar kişileri, orta insanlar olayları, büyük insanlar ise fikirleri ve vizyonları konuşur.",
    "Bir gün değil, 'birinci gün' diyerek başla; ertelediğin her gün, hayallerinden bir adım daha uzaklaşmana neden olur.",
    "Engeller, gözünü hedeften ayırdığında gördüğün o ürkütücü şeylerdir; odaklanırsan engelleri değil, çözümleri görürsün.",
    "Başarı merdivenlerini ellerin cebinde tırmanamazsın; emek vermeden, ter dökmeden zirveye ulaşmak mümkün değildir.",
    "Yıldızlara ulaşamazsan bile, en azından aya inersin; hedeflerini her zaman yüksek tut ve asla vasatla yetinme.",
    "Kendi potansiyelini başkalarının sınırlı algılarına göre belirleme; sen, düşündüğünden çok daha fazlasısın.",
    "Risk almadan kazanılan zaferin tadı tuzu olmaz; cesaret et, atıl ve hayatın sana sunacağı ödülleri kucakla.",
    "Geçmişin pişmanlıklarıyla yaşamak yerine, geleceğin umutlarıyla hareket et; çünkü geçmişi değiştiremezsin ama geleceği şekillendirebilirsin.",
    "Her sabah yeniden doğuyoruz; bugün ne yaptığımız, hayatımızın geri kalanını belirleyen en önemli şeydir.",
    "Sabır, sadece beklemek değil; beklerken doğru tavrı sergileyebilmektir; tohumun çiçeğe dönüşmesi zaman ve özen ister.",
    "Başarı, düştüğün yerden kalkıp, aynı hevesle yoluna devam edebilme sanatıdır.",
    "Hayatının direksiyonuna geç; başkalarının seni sürüklemesine izin verme, kendi yolunu kendin çiz.",
    "Unutma, elmaslar baskı altında oluşur; yaşadığın zorluklar seni kırmak için değil, parlatmak içindir.",

    // İÇSEL GÜÇ VE BİLGELİK
    "İçindeki sesi dinle; o ses sana her zaman doğru yolu fısıldar, gürültülü dünyada onu duymayı öğren.",
    "Mutluluk, varılacak bir istasyon değil, yolculuğun kendisidir; anın tadını çıkar ve küçük şeylerdeki güzelliği gör.",
    "Başkası olma, kendin ol; çünkü dünya senin gibi birine daha önce hiç sahip olmadı ve bir daha da olmayacak.",
    "Hata yapmaktan korkma; hiç hata yapmamış bir insan, yeni bir şey denememiş demektir.",
    "Bilgi sana güç verir, ama karakter sana saygı kazandırır; ikisine de sahip olursan yenilmez olursun.",
    "Öfke, rüzgar gibidir; bir süre sonra diner ama geriye kırılmış dallar bırakır; sakin kalmayı öğren.",
    "Affetmek, geçmişi değiştirmez ama geleceğin önünü açar; yüklerinden kurtul ve hafifle.",
    "Gerçek zenginlik, sahip oldukların değil, kim olduğun ve başkalarının hayatına ne kattığındır.",
    "Korku, sadece zihninde yarattığın bir illüzyondur; onun üzerine yürüdüğünde duman gibi dağıldığını göreceksin.",
    "Hayat, %10 başına gelenler ve %90 onlara nasıl tepki verdiğindir; kontrol edemediğin olaylara değil, kendi tavrına odaklan.",
    "En büyük zafer, kendini fethetmektir; kendi zaaflarını, korkularını ve tembelliğini yenen insan, dünyayı yenebilir.",
    "Sözlerin gücünü hafife alma; ağzından çıkan her kelime, ya bir kalbi onarır ya da bir hayali yıkar.",
    "Minnettarlık, hayatın zenginliğini fark etmenin anahtarıdır; sahip olmadıklarına üzülmek yerine, elindekilerin kıymetini bil.",
    "Yalnız yürümekten korkma; bazen kartallar yalnız uçar, kargalar ise sürüyle dolaşır.",
    "Kalbinin pusulasını takip et; mantık seni A noktasından B noktasına götürür, hayal gücü ise her yere.",
    "Bir mum, başka bir mumu tutuşturmakla ışığından bir şey kaybetmez; bilgin ve sevgin paylaştıkça çoğalır.",
    "Zor zamanlar güçlü insanlar yaratır; güçlü insanlar iyi zamanlar yaratır; iyi zamanlar zayıf insanlar yaratır; zayıf insanlar zor zamanlar yaratır.",
    "Hayat bir yankı gibidir; ne verirsen onu alırsın, ne ekersen onu biçersin, ne söylersen onu duyarsın.",
    "Mükemmel olmak zorunda değilsin, ama dürüst ve samimi olmak zorundasın; çünkü sahtelik er ya da geç ortaya çıkar.",
    "Her gün, hayatının geri kalanının ilk günüdür; dünü değiştiremezsin ama bugünü ve yarını harika yapabilirsin.",

    // EYLEM VE DİSİPLİN
    "Beklemekle geçen zaman, kaybedilen zamandır; en iyi zaman şimdi, en iyi yer burasıdır.",
    "Motivasyon seni başlatır, alışkanlık ise devam ettirir; bu yüzden iyi alışkanlıklar edinmeye odaklan.",
    "Tembellik, yorgun olmadan dinlenme alışkanlığıdır; bu tuzağa düşme ve potansiyelini heba etme.",
    "Başarı, şans işi değildir; ter, kan, gözyaşı ve uykusuz gecelerin birleşimidir.",
    "Yapmadığın atışların %100'ünü ıskalarsın; denemekten, yanılmaktan ve tekrar denemekten asla vazgeçme.",
    "Bir şeyi ertelemek, o işin yükünü gelecekteki kendine atmaktır; kendine bu kötülüğü yapma.",
    "Disiplin, anlık hazlardan vazgeçip, uzun vadeli hedeflere sadık kalabilme gücüdür.",
    "Zor olanı yap, hayatın kolaylaşsın; kolay olanı yaparsan, hayatın zorlaşır.",
    "Odaklanmak, 'hayır' diyebilme sanatıdır; hedefine hizmet etmeyen her şeye hayır demeyi öğren.",
    "Başarılı insanlar, başarısız insanların yapmaktan hoşlanmadığı şeyleri yapma disiplinine sahip olanlardır.",
    "Planın yoksa, başkalarının planının bir parçası olursun; kendi hayatının mimarı ol.",
    "Yarınlar, yorgun ve bezgin kimselere değil, rahatını terk edebilen gayretli insanlara aittir.",
    "Çalışmak, yeteneği her zaman yener; eğer yetenek çok çalışmazsa.",
    "Sadece konuşma, yap; sadece söyleme, göster; sadece söz verme, kanıtla.",
    "Zirve kalabalıktır diyenlere inanma, orası her zaman en tenha yerdir çünkü bedelini ödeyen azdır.",
    "Hayat bisiklet sürmek gibidir; dengede kalmak için sürekli hareket etmen gerekir.",
    "Limandaki gemi güvendedir, ama gemiler limanda beklemek için yapılmamıştır; açık denizlere yelken aç.",
    "Kendi şansını kendin yarat; ne kadar çok çalışırsan, o kadar şanslı olduğunu göreceksin.",
    "Başarı bir gecede gelmez; yıllarca süren görünmez emeğin, bir anda görünür hale gelmesidir.",
    "Vazgeçmek, başarısızlığın en kesin yoludur; yorulsan da, dinlen ama asla vazgeçme.",

    // DERİN DÜŞÜNCELER
    "İnsan, düşleri öldüğü gün ölür; nefes alsa bile ruhu yaşamayı bırakmıştır.",
    "Gülümsemek, iki insan arasındaki en kısa mesafedir ve en zor kapıları açan anahtardır.",
    "Hayat, satranç gibidir; hamle yapmadan önce düşünmelisin, ama zamanın da sonsuz olmadığını bilmelisin.",
    "Karanlığı lanetlemektense, bir mum yakmak çok daha iyidir; şikayet etme, çözüm üret.",
    "Büyük ağaçlar fırtınalarda en çok sallananlardır, ama kökleri sağlamsa asla devrilmezler.",
    "İyilik yap ve denize at; balık bilmezse Halik bilir; karşılık beklemeden yapılan iyilik en değerlisidir.",
    "Zaman her şeyin ilacıdır derler, ama aslında zaman sadece alışmayı öğretir; iyileşmek senin elindedir.",
    "Kuşlar, ayaklarına değil kanatlarına güvenirler; sen de koşullara değil, kendi yeteneklerine güven.",
    "Her son, yeni bir başlangıçtır; bittiği için üzülme, yaşandığı için mutlu ol ve önüne bak.",
    "Hayatın anlamı, senin ona yüklediğin anlamdır; boş bir tuval gibidir, onu hangi renklerle boyayacağın sana kalmış.",
    "Cesaret, korkmamak değil; korkuya rağmen atını sürmektir.",
    "Yolun sonunu göremiyor olabilirsin, ama bu yola çıkmana engel değildir; her adımda ufuk biraz daha aydınlanacaktır.",
    "En büyük hapishane, başkalarının ne düşüneceği korkusudur; bu duvarları yık ve özgürleş.",
    "Hayat bir yankı vadisidir; dünyaya ne haykırırsan, sana o geri döner.",
    "Gerçek lider, yol gösteren değil, yolda yürüyerek ilham verendir.",
    "Başarı, parmak şıklatarak gelmez; tırnaklarınla kazıyarak gelir.",
    "Güneşin sana ulaşmasını istiyorsan, gölgeden çıkmalısın.",
    "Hiçbir kış sonsuza kadar sürmez; her gecenin bir sabahı, her kışın bir baharı vardır.",
    "Düşmek ayıp değil, kalkmamak ayıptır; tozunu silkele ve yoluna devam et.",
    "Hayat, cesurları sever; risk al, adım at ve hikayeni yaz."
];

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const isBot = searchParams.get('bot') === 'true';

    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    if (isBot) {
        return new Response(randomQuote, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }

    return NextResponse.json({
        quote: randomQuote
    });
}
