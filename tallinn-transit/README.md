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
- Bussilõigud on sinised ja trammilõigud korallpunased nii kaardil kui juhistes.
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
120 s varuaega. Võrgu põhjal moodustub 9864 suunatud kuni 600 m ümberistumisteed.

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

GPS-i CSV ei anna kinnitatud reisiidentifikaatorit ega üksiksõiduki mõõtmisaega.
Seetõttu ei tuletata sellest hilinemist või prognoositavat saabumist. Sõiduplaani
ajatempel ja hoiatus üle seitsme päeva vana paketi kohta jäävad nähtavaks.
Tallinna voogude standardset edasilevitamise litsentsi ei tuvastatud; allikad ja
see piirang on projekti päritoluinfos säilitatud.

## Server ja avaldamine

Tootmisversioon kasutab avaldatud serverless API-t:
**https://tallinn-transit-api.jaak-laineste.workers.dev/**.
`GET /gps` vahendab Tallinna sõidukeid, `GET /geocode?q=...` In-ADS-i aadresse.
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

- Üks püsiva olekuga Durable Object ühendab kogu maailma päringud. Algallikat
  küsitakse nõudluse korral kõige sagedamini kord 10 sekundi jooksul ehk kuni
  kuus korda minutis; taustal tühja liikluse korral päringuid ei tehta. Sama piir
  kehtib tõrgete ja Workeri taaskäivituste korral.
- Piirkondlik Cloudflare Cache API hoiab jagatud vastust alles ainult selle
  algsest 10-sekundilisest aknast järele jäänud aja. Päringuparameetrid ja lubatud
  origin'id ei tekita eraldi GPS-koopiaid. Cache API üksi pole globaalne, mistõttu
  on algallika koormuse piiramiseks vajalik ühine Durable Object.
- Piirkondlik vahemälu asub Cloudflare'i servas, kuid seda loetakse Workeri
  `caches.default` kaudu. Võrgupäring käivitab Workeri ka vahemälutabamuse korral;
  tabamus jätab ära Durable Objecti ja algallika päringu. Brauseri HTTP-vahemälu
  tabamus jätab ära ka Workeri päringu. Aadressiotsing ei kasuta jagatud vahemälu.
- Algallikale saadetakse eelmine `If-None-Match` ja `If-Modified-Since`.
  2026-10-29 päriskontroll kinnitas `304 Not Modified` tuge, null andmebaidiga.
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

## Kontrollimine ja kordamine

```sh
npm test
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
