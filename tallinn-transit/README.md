# Tallinn liigub

Eestikeelne Tallinna ühistranspordi kaart ja uksest ukseni reisiplaneerija.
Sõiduplaan, teekonnaarvutus ja jalakäijate teedevõrk töötavad seadmes. Veebis
lisanduvad Maa- ja Ruumiameti In-ADS-i aadressiotsing ja sõidukite GPS-asukohad.

**Avalik rakendus: https://jaakla.github.io/openmapstack-samples/tallinn-transit/**

## Käivitamine

Vaja on Node 24+ ning kanoonilise koostamise jaoks Python 3.14.

```sh
cd tallinn-transit
npm ci
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.lock
.venv/bin/python pipeline.py
npm start
```

Ava http://127.0.0.1:5177. Arenduseks: `npm run dev`.
Pärast andmete esmast koostamist piisab kasutajaliidese eelvaateks käsust
`npm run build`. See ei uuenda projekti päritolukirjeid ega võrguta paketi loendit;
lõplikuks kasutamiseks käivita alati `pipeline.py` ja allpool toodud kontrollid.

## Kasutamine

- Vali lähte- ja sihtkoht peatuseotsingust, veebis aadressiotsingust või kaardilt.
  Kaardi hüpikaken pakub toiminguid **Teekond siit** ja **Teekond siia**, kuvab
  ligipääsetavad peatused ning tõstab esile tegelikud jalgsirajad.
- Aadressi puhul võrdleb planeerija kõiki lubatud jalgsikäigu kaugusel platvorme,
  mitte ainult lähimat. Vaikimisi on ulatus 1000 m; valida saab 300–1500 m.
  Ümberistumiste jalgsirada võib olla kuni 600 m. Nii võib kaugem peatus anda
  varasema saabumise või hilisema võimaliku väljumise.
- Valida saab väljumisaja või saabumistähtaja, kuupäeva, liikumisviisi ja kuni
  kolm ümberistumist. Kõik ajad on **Europe/Tallinn** ajavööndis, sõltumata seadmest.
  Arvestatakse kalendrierandeid, peale-/mahamineku piiranguid ja üle 24:00 reise.
- Sama nimega lähestikku paiknevad platvormid on loendites ja kaugvaate kaardil
  üks peatus. Lähivaates on näha üksikplatvormide asukohad; platvormikoodid ilmuvad
  täpsetes reisijuhistes. Üle 400 m lahus olevad samanimelised kohad ei ühine
  automaatselt üheks peatuseks.
- Bussilõigud on sinised, trammilõigud korallpunased ja rongilõigud oranžid nii kaardil kui juhistes.
  Kaardil korduvad valitud teekonna liininumbrid. Jalgsikäigud on katkendjoonega.
- Sõiduki klõps avab ainult olemasolevad andmed. Puuduvat kiirust ega muid
  `undefined`/`null` väärtusi ei kuvata. GPS-i paus säilitab viimased asukohad;
  jätkamine küsib andmed kohe uuesti. Kaardistiili ja kihtide muutmine taastab
  viimase sõidukikihi. Vananenud asukohad tuhmuvad ning eemaldatakse.

## Veebis ja võrguta

Päise lülitil on kaks režiimi. **Võrguta** valimisel laetakse kogu rakendus,
kaardid, fondid, sõiduplaan ja jalakäijate teedevõrk automaatselt seadmesse.
Režiim lülitub pärast edukat allalaadimist. GPS-asukohad eemaldatakse ja
võrgupõhine aadressiotsing lõpetatakse. Otsing peatuste ja kaardipunktide järgi,
jalgsirajad ning sõiduplaani järgi planeerimine jäävad tööle.

Võrguta režiim töötab HTTPS-is või localhostis tootmisversiooniga. Arendusserveris
on service worker keelatud. Brauser võib andmeid kettaruumi puudumisel eemaldada;
rakendus küsib pärast salvestamist püsivat salvestusruumi. Valmis pakett on umbes
60 MB. Täpne suurus on `dist/offline-manifest.json` failis ja salvestamise teates.
Service worker teenindab ka PMTilesi baidivahemikke. Veebirežiimis eelistatakse
võrgust värsket faili; võrguta kasutatakse ainult täielikult salvestatud paketti.

**Veebis** taastab GPS-i ja aadressiotsingu. Kui internet kaob, eemaldatakse
GPS-asukohad automaatselt. Ühenduse taastudes saab veebirežiimi ise sisse lülitada.
Aadressiotsing saadab teenusepakkujale otsinguteksti; kuupäevi, reisiplaane ega
seadme GPS-jälgi serverisse ei saadeta.

## Jalakäijate teedevõrk

Allikas on [BBBike'i Tallinna OSM-i väljavõte](https://download.bbbike.org/osm/bbbike/Tallinn/),
avaldatud 2026-10-24, salvestatud 2026-10-28. Muutmata PBF ja päringu päritolu
asuvad `data/source/` all; sisu SHA-256 on `project.yaml` failis. OSM on ODbL 1.0.

`walking.py` loeb PBF-i PyOsmiumiga, filtreerib jalakäijale keelatud teed ja
lukustatud/läbimatud tõkked ning teisendab punktid **EPSG:3301** süsteemi.
Sama OSM-i sõlm määrab ühenduse: teede geomeetriline ristumine ilma ühise sõlmeta
ühendust ei tekita (näiteks eritasandilised ristumised). Kraadiga kaks sõlmede
lihtsustamine säilitab kõik lähtegeomeetria tipud. `oneway:foot` piiranguid
järgitakse; autode ühesuunalisus ei keela automaatselt vastassuunas kõndimist.

Kanooniliste ümberistumiste ja kasutaja valitud punktide marsruutimiseks kasutatakse
sama **ngraph.path A\*** teeki. Kaalud on meetrites ning heuristik on samas kohalikus
projektsioonis. Teekonna pikkus tuleb võrgu servadest, mitte sirgjoonelisest
kaugusest. Kõndimise ajahinnang põhineb kiirusel 1,25 m/s. Ümberistumisel lisandub
120 s varuaega. Ümberistumiste võrk sisaldab ka rongi ja linnatranspordi jalgsikäike.

Hoone aadressi viitepunkt ei pruugi olla sissepääs. Alg- ja lõpp-punkt ühendatakse
sobiva teelõiguga kuni 70 m piires; selle viimase ühenduse läbitavus võib olla
ligikaudne. Kaugemat punkti ei ühendata suvalise sirgjoonega. Ligipääsetavust,
ajutisi sulgemisi ega puuduvat OSM-i teed ei saa kinnitada. Kui teed ei leita,
rakendus ei nimeta sirgjoont jalgsimarsruudiks.

## Muud allikad

- Tallinna ametlik [GTFS](https://transport.tallinn.ee/data/gtfs.zip) ja
  [GPS-voog](https://transport.tallinn.ee/gps.txt). Staatiline GPS-koopia on ainult
  parseritestide sisend; rakendus ei esita seda reaalaja varukoopiana.
- [In-ADS](https://inaadress.maaamet.ee/inaadress/gazetteer) aadresside veebipäringud.
  Kasutatakse ametlikke `viitepunkt_l` (pikkuskraad) ja `viitepunkt_b` (laiuskraad)
  välju. Aadressipäringud ei kuulu fikseeritud analüütilise andmepaketi hulka.
- Kaart: goplex.ee Protomaps `planet-20261006` Tallinna lõige, 1040 vektorpaani
  suurendustel 0–14. Suuremal suurendusel kasutatakse sama detaili ülezoomi.
  Fondid, stiilid ja sümbolid on kohalikud. © OpenStreetMapi kaasautorid,
  Protomaps tiles by goplex.ee. Interi font: SIL OFL.

Tallinna GPS-i CSV ei anna kinnitatud reisiidentifikaatorit ega üksiksõiduki mõõtmisaega.
Seetõttu ei tuletata sellest hilinemist või prognoositavat saabumist. Sõiduplaani
ajatempel ja hoiatus üle seitsme päeva vana paketi kohta jäävad nähtavaks.
Tallinna voogude standardset edasilevitamise litsentsi ei tuvastatud; allikad ja
see piirang on projekti päritoluinfos säilitatud.

## Elroni rongid

Rongid osalevad samas seadmes töötavas teekonnaotsingus, koos bussi ja trammiga.
Lisandusid 24 rongiliini, 48 suunapõhist peatuspunkti ja 1452 sõiduplaanireisi.
Katvus jääb olemasoleva kaardi piiridesse `[24.45,59.28,25.04,59.57]`, kuni
Valingu, Saku ja Kullini. See ei ole kogu Eesti rongiplaneerija.

Sõiduplaan pärineb [MobilityData poolt ametlikuks märgitud Elroni GTFS-ist](https://mobilitydatabase.org/feeds/gtfs/mdb-3153),
[tootja URL-ist](https://eu-gtfs.remix.com/elron.zip). Avaldaja on Regionaal- ja
Põllumajandusministeerium. Muutmata ZIP, räsi ja hankimise kirje on `data/source/` all.
Allika versioon on **01.10.2026**, kalendrid ulatuvad 31.12.2026-ni; ajutised
muudatused ei pruugi sisalduda. Enne reisi kontrolli [Elroni teateid](https://elron.ee/).
Staatilisi lähtevooge tuleb värskendada ja uuesti avaldada; rakendus neid taustal ei uuenda.

`gtfs_sources.py` lisab rongi-ID-dele `elron:` prefiksi, säilitab kellaajad,
kalendrierandid ning peale-/mahamineku piirangud. Kaardi piiridest väljuv reis
jaotatakse katvuse piires järjestikusteks lõikudeks; väljasõitu ja tagasitulekut
ei liideta lühiteeks. Raudteeliinid kasutavad allika tegelikke kujupunkte.
Elroni **Tallinn** kuvatakse **Balti jaamana**, säilitades algse nime päritoluinfos.
Lähestikku sama nimega rongi- ja linnatranspordi peatused on koondatud; platvormide
vahelised ümberistumised kasutavad tegelikke jalgsiradu. Puuduvaid perrooni numbreid
ei asendata GTFS-i peatuse ID-ga: juhistes näidatakse lähteandmete suunakirjeldust.

Reaalajaallikas on Elroni enda kaardil kasutatav
[`map_data.json`](https://elron.ee/map_data.json). See annab reisinumbri, asukoha,
kiiruse, suuna ja `asukoha_uuendus` mõõtmisaja. Aeg tõlgendatakse **Europe/Tallinn**
ajavööndis koos suveajaga. Puuduvad väljad jäetakse välja. Üle 180 s vanad,
tulevikus olevad ja katvusest väljas asukohad jäetakse välja, ka pausil ja HTTP-vahemälust.
GPS-reisinumber (nt 101) erineb GTFS-liininumbrist (nt RE34); kinnitamata vastavust
ei oletata. Valitud rongiliini kõrval jäävad nähtavaks piirkonna rongide asukohad.
Rongipiletid järgivad [Elroni tingimusi](https://elron.ee/piletiinfo/piletid).

Elroni GPS-vastusel on praegu `Cache-Control: max-age=1209600` (14 päeva).
Vahendaja kasutab fikseeritud URL-i ja tingimuslikke päringuid, kuid `fetch`
alampäringu vahemälu on `no-store`, et see ei külmutaks asukohti kaheks nädalaks.
Globaalne nõudluspõhine piir on üks päring 10 sekundi kohta; brauserile ja Workers
Cache'ile antakse 10 s eluiga. Allikate olekud ja vead on eraldi: Elroni tõrge ei
peida linnatransporti. Võrguta pakett sisaldab ka rongi sõiduplaane, peatusi,
raudtee geomeetriat ja ümberistumisi; **mõlema allika GPS eemaldatakse**.

## Server ja avaldamine

Tootmisversioon kasutab avaldatud serverless API-t:
**https://tallinn-transit-api.jaak-laineste.workers.dev/**.
`GET /gps` säilitab Tallinna algse CSV-voo, `GET /vehicles` tagastab sõidukid koos
suuna ja hinnangulise keskmise kiirusega JSON-kujul; `GET /trains` annab Elroni rongid;
`GET /geocode?q=...` otsib In-ADS-i aadresse.
`dist/` avaldatakse hoidla GitHub Pagesi töövoos alamkataloogi `tallinn-transit/`.
Töövoog koostab kanoonilise andmepaketi ja käivitab ühik- ning brauseritestid.
GPS-i ja aadressiotsingu Worker on eraldi avaldatud. Teekonnad arvutatakse
seadmes ja kaardid tulevad rakendusega kaasa.

`npm start` teenindab `dist/` kausta, PMTilesi baidivahemikke ja ka kohalikke
`/api/gps` ning `/api/geocode` teenuseid. Kohaliku API kasutamiseks tootmiskoostes
määra `VITE_API_BASE_URL=/api/`; arendusserver kasutab kohalikku API-t vaikimisi.
Muu vahendaja saab valida `VITE_API_BASE_URL=https://sinu-worker.example/` kaudu
(lõpus kaldkriips). Võrguta režiim peatab nii GPS-i kui aadressiotsingu ka siis,
kui API asub teisel domeenil. GPS-i ei salvestata võrguta paketti.

Worker avaldatakse käsuga `npm run worker:deploy`. Seaded on `wrangler.jsonc`:
CORS lubab `https://jaakla.github.io` ja kohaliku rakenduse pordi 5177;
`ALLOWED_ORIGINS` on komadega eraldatud lubatud origin'ide loend. API on avalike
andmete teenus; CORS ei ole autentimine. Suvalisi lähte-URL-e vahendada ei saa.
Aadressipäringuid ei salvestata vahemällu ega logita; Workeri päringulogid on
välja lülitatud. API võtmeid rakenduse kasutamiseks ei vaja.

### GPS-i 10-sekundiline vahemälu

- Kummalgi GPS-allikal on oma Durable Object, mis ühendab kogu maailma päringud. Üht algallikat
  küsitakse nõudluse korral kõige sagedamini kord 10 sekundi jooksul ehk kuni
  kuus korda minutis; taustal tühja liikluse korral päringuid ei tehta. Sama piir
  kehtib tõrgete ja Workeri taaskäivituste korral.
- Piirkondlik Cloudflare Cache API hoiab jagatud vastust alles ainult selle
  algsest 10-sekundilisest aknast järele jäänud aja. Päringuparameetrid ja lubatud
  origin'id ei tekita eraldi GPS-koopiaid. Cache API üksi pole globaalne, mistõttu
  on algallika koormuse piiramiseks vajalik ühine Durable Object.
- Workeri ees on lisaks uus **Workers Cache**, sisse lülitatud seadega
  `cache.enabled: true`. `CF-Cache-Status: HIT` tähendab, et vastus väljastati
  Workerit käivitamata. See austab `Vary: Origin`, `ETag`-i ja 10-sekundilist
  värskusakent; vigu ega aadressiotsingut ei salvestata (`no-store`).
  Workeri sees säilib `caches.default` piirkondliku vahemäluna ja Durable Object
  globaalse algallikapiiranguna. Brauseri HTTP-vahemälu väldib ka CDN-päringut.
- Algallikale saadetakse eelmine `If-None-Match` ja `If-Modified-Since`.
  Tallinna voo 2026-10-29 päriskontroll kinnitas `304 Not Modified` tuge, null andmebaidiga.
  Algallikas andis `ETag`-i ja `Last-Modified` päised, kuid mitte `Cache-Control`-i.
- Allavoolule antakse `Cache-Control: public, max-age=10, s-maxage=10,
  must-revalidate`, sisu räsi põhine `ETag`, algallika `Last-Modified` ja vastuse
  tegelik `Age`. Sama sisu tingimuslik päring saab samuti `304` vastuse.
  Vahemälust väljastamine ei alusta uut 10-sekundilist värskusakent.
- Brauser kasutab tavalist HTTP-vahemälu, mitte `no-store` päringuid.
  `X-GPS-Validated-At` säilitab algse kontrolliaja ka brauseri vahemälutabamuse
  korral. Algallika asukohtade vanust hinnatakse eraldi `Last-Modified` järgi.
- Tõrge annab `503`, `Cache-Control: no-store` ja `Retry-After`; vana GPS-i ei
  esitata uue kinnitusajaga. Algallika küpsiseid edasi ei saadeta.

Kontrollimiseks: `node scripts/verify-worker.mjs`. See teeb 20 samaaegset
kasutajapäringut, kontrollib ühist algallikapäringute loendurit, allavoolu `304`
vastust, aadressiotsingut ning järgmist värskendust 10-sekundilise akna järel.
Viimase avaldamise ja päriskontrolli andmed on `deployment/worker.json`.

Cloudflare'i alusdokumendid: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
ja [Durable Objectsi püsiv olek](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

## Sõidukite suund ja hinnanguline kiirus

Kaardi liininumber jääb püstiseks ja eraldi nool järgib kaardi pööramist.
Eelistatakse algallika suunanurka. Puuduvat suunda saab hinnata vähemalt 15 m
liikumise põhjal, kasutades viimast piisava pikkusega kahe punkti vahet; see
väldib eelmise tänava suuna ülemäärast keskmistamist pärast pööret.

Globaalses Durable Objectis hoitakse kuni kuut hiljutist vaatlust sõiduki kohta.
Keskmine kiirus arvutatakse kuni 40 s aknas asukohapunktide vaheliste kauguste
ja voo vaatlusaegade põhjal ning kuvatakse kujul **Hinnanguline keskmine kiirus: ~22 km/h (30 s)**.
Puuduv või ebaselge väärtus jäetakse välja. Algallika tegelik kiirus, kui see on
olemas, on eelistatud. Seisva sõiduki GPS-värinast ei tehta nullkiiruse mõõtmist.

Tallinna bussi- ja trammikiirused on voo vaatluste põhjal arvutatud hinnangud: voos puudub sõiduki enda
mõõtmise ajatempel. Need ei ole mõõdetud hetkkiirus ega saabumisprognoos.
HTTP 304 ja vahemälutabamused ei lisa vaatluspunkti. Üle 60 s paus, liinivahetus
või üle 120 km/h eeldav asukohahüpe alustab uut seeriat; kadunud sõidukite ajalugu
aegub 120 s järel. Ajaloos hoitakse kõige rohkem 1500 sõidukit ning lisapäringuid
algallikasse ei tehta. Üle 45 s vanu hinnangulisi kiirusi brauser enam ei kuva.

## Kontrollimine ja kordamine

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npx playwright install chromium
npm run test:browser
.venv/bin/openmapstack validate project.yaml
.venv/bin/openmapstack run project.yaml
.venv/bin/openmapstack verify project.yaml --rerun
```

Kui muudad sisendeid või koodi, käivita esmalt `pipeline.py`, sest CLI 0.5.0
keeldub vanale jooksukirjele mittevastavatest sisenditest juba eelkontrollis.
Pärast seda kasuta kanoonilist CLI käivitust ja puhast korduskoostamist.

Kanooniline toru loob tuletatud andmed, rakenduse, võrguta paketi, päritolutõendi,
`findings.md`, kontrolliaruande ja jooksukirje ning uuendab projekti viitasid.
Puhas kordamine kasutab ainult deklareeritud sisendeid ja lukustatud sõltuvusi.
Ühiktestid kontrollivad muu hulgas kaugema peatuse paremat ühendust, kalendrierandeid,
saabumistähtaega, jalakäijate suunapiiranguid ja tõkkest mööda kulgevat marsruuti.
HTTP-brauseritestid katavad päris aadressiotsingu, kihtide/GPS-i taastamise,
eestikeelse telefoni-UI ja täieliku võrguta laadimise.

OpenMapStack 0.5.0 valikulised Pythoni brauserikontrollid kasutavad `file://`
aadresse, millega Chromium ei laadi Vite'i ES-mooduleid. Need CLI kontrollid on
`not_testable`; tegeliku brauserikäitumise tõend annab ülaltoodud HTTP-testide komplekt.

## Haldusseire

Avaliku teenuse iganädalane kontroll ja Better Stacki ühendus:
[nädalakontrolli juhend](docs/maintenance-health.md).
