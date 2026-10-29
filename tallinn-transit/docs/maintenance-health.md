# Avaliku teenuse nädalakontroll

Töövoog: `.github/workflows/maintenance-health.yml`.

- Automaatne käivitus esmaspäeval kell 09.17 (`Europe/Tallinn`, ka suveajal).
- Käsitsi: GitHub → Actions → Tallinn transit weekly health → Run workflow → main.
- Ainult `jaakla/openmapstack-samples` repositooriumi `main` haru; pole avaldamisõigusi.
- Rakendust ei ehitata ega avaldata. Kontrollitakse päriselt avalikku GitHub Pagesi
  rakendust ja selle praeguseid GPS-i ning In-ADS-i otspunkte.

## Kontrollid ja tõendid

Testid kasutavad tänast Tallinna kuupäeva. Sõiduplaani puhul peab iga järgneva
14 päeva kohta leiduma bussi-, trammi- ja rongireise. Test ei nõua kindlat liininumbrit,
väljumisaega ega muutumatut sõidukite arvu. Päevasel ajal täiesti tühi Tallinna
GPS-voog on viga; tühi Elroni voog võib tähendada, et kaardi piires pole ronge.
Tallinna puhul kontrollitakse voo Last-Modified aega, sest üksikmõõtmise aega allikas ei anna.

Brauseritest kontrollib mõlemas vaates päris kaarti ja GPS-markerite joonistamist,
aadressiotsingut, uksest ukseni teekonda tänavavõrgu jalgsilõikudega, saabumisaja
järgi planeerimist, peatuste otsingut ja rongiga marsruuti. JavaScripti vead,
konsooli veateated ja HTTP tõrked ebaõnnestuvad. Ekraanipilt jäädvustatakse ka
eduka kontrolli korral; vea korral säilib lisaks Playwrighti trace.

Viie sekundi piir rakendub DOMContentLoaded ajale ja planeerija kasutusvalmidusele,
millest lahutatakse nelja suure algandmefaili võrgulaadimise ajavahemike ühend.
See ei lahuta JavaScripti/JSON-i töötlemist ega varja suurt tegelikku ooteaega:
raportis on eraldi kogu kasutusvalmiduse aeg ja algandmete laadimise aeg.
Mõõtmised on Chromiumi kontrollkeskkonnas, mitte kasutajate p95 statistika ega
mobiilside simulatsioon. Aeglane tulemus tekitab vea, mitte automaatse lävendi tõstmise.

Actionsi töö lehe **Summary** näitab kokkuvõtet; **Artifacts** sisaldab:

- `health.json`: masinloetav koondtulemus, aeg ja kontrollkoodi commit;
- `playwright.json`: täielik raport koos mõõtmiste ja andmeversioonidega;
- ekraanipildid ning vea korral trace-failid.

Avaliku andmepaketi versioonid, päritolu ajatemplid ja suurused salvestatakse
eraldi tõendina. Kontrollkoodi commit pole avaliku rakenduse versiooni tõend.
Artefakte säilitatakse 30 päeva. Püsiv staatuse töölaud ja pikem ajalugu on eraldi töö.

## Better Stack

Loo **Heartbeats → Create heartbeat**, nimi `Tallinn liigub – nädalakontroll`,
intervall 7 päeva, grace 1 päev; vali e-posti teavitused ja õige saaja.
Lisa selle salajane URL repositooriumi **Settings → Secrets and variables → Actions**
alla nimega `BETTERSTACK_WEEKLY_HEARTBEAT_URL`. Käivita töö käsitsi ja kontrolli tulemust.

Secret puudumisel testid töötavad, kuid Summary ja logi hoiatavad, et väline
teavitus pole seadistatud. Edukas täielik töö saadab heartbeat'i, vigane töö
saadab `/fail` päringu koos Actionsi raporti lingiga. Katkestatud töö ei kinnita edu.
Saladus antakse ainult eraldi teavitustööle, mis ei laadi repositooriumi ega
käivita npm-sõltuvusi või brauserit. Ära lisa URL-i avalikku koodi või raportitesse.

GitHubi ajastus võib hilineda ning avalikus passiivses repositooriumis välja
lülituda; puuduv heartbeat on selle sõltumatu valve pärast esimest edukat ühendust.
Töövoo lisamine kohalikku koopiasse ei aktiveeri ajastust: fail peab jõudma `main` harusse.

## Kohalik kontroll

```sh
cd tallinn-transit
npm ci --ignore-scripts
npx playwright install chromium
npm run test:maintenance
node scripts/maintenance-summary.mjs
```

Browser plugin not available: valideerimiseks kasutatakse olemasolevat Playwrighti.
Kohalik test ei saada Better Stacki teadet. Need kontrollid ei uuenda GTFS-i,
OSM-i ega teeke; nende staging- ja avaldamistööd tuleb luua eraldi.

## Igapäevane andmete värskuse kontroll

Töövoog `.github/workflows/maintenance-data.yml` käivitub iga päev kell 09.31
(`Europe/Tallinn`), samuti käsitsi **Actions → Tallinn transit daily data freshness**.
See kasutab olemasolevat secret'it `BETTERSTACK_DATA_HEARTBEAT_URL`.
Better Stacki intervall: 1 päev; grace: 6 tundi.

Iga päev kontrollitakse avaldatud sõiduplaani katvust tänasest järgmise 14 päevani
ning kooskõla avaliku päritolukirjeldusega. Tallinna ja Elroni GTFS-i lähteversioone
kontrollitakse kord seitsme päeva jooksul, OSM-i jalgsivõrgu lähteversiooni kord
kalendrikuus. Esimesel käivitamisel kontrollitakse kõiki allikaid kohe. Järgnevad
kontrollid kasutavad võimalusel ETag/Last-Modified tingimuslikke päringuid.
GTFS-i ZIP-i pelk ümberpakkimine ei loe uuenduseks, kui tabelite sisu on sama ja
kohaliku võrdlusfaili räsi vastab päriselt avaldatud versioonile.

Kontrollimise aega ei võrdsustata allalaadimise või avaldamise ajaga. Muutumatu
kehtiv allikas võib olla vana: kinnitatud sisuvastavus hoiab seire rohelisena.
Uue versiooni leidmisel on seis `update_available`. Kui avaldatud versioon pole
enam allikaga sama ning viimasest kinnitatud vastavusest (selle puudumisel
allalaadimisest) möödub GTFS-i puhul üle 8 või OSM-i puhul üle 40 päeva, on seis
`overdue` ning töö ebaõnnestub. Uue versiooni korduv leidmine tähtaega ei pikenda.
Võrgutõrge ei kirjuta varasemat edukat kontrolliaega üle.

Kontroll on kirjutuskaitstud: `update_available` ei tähenda, et uuendus on
staging'us testitud või production'is avaldatud. Aadressid tulevad endiselt
otse In-ADS-ist; aadressiotsingu toimimist kontrollib olemasolev nädalakontroll.
Taustakaardi uute planet-versioonide avastamine pole selle töö osa.

**Summary** näitab allikate seisud ja tähtajad. **Artifacts → tallinn-transit-data-state**
sisaldab `report.json`, `state.json` ja `summary.md`; seal on ajatemplid, räsid ja
suurused. Artefakte säilitatakse 90 päeva ning järgmine töö taastab viimase
selle sama töövoo lõpetatud `main`-käivituse oleku ka siis, kui andmeaudit leidis vea.
Ajaloo puudumisel tehakse uus tegelik allikakontroll; seda ei käsitleta varasema
eduka kontrolli tõendina. GitHubi API tõrget ei peideta puuduva ajaloo taha.

Edukas audit saadab heartbeat'i. Hilinenud uuendus, puuduv sõiduplaanikatvus või
ebaõnnestunud kontroll saadab `/fail` koos raporti lingiga. Teavitussaladus on
ainult eraldi teavitustööl. Tavakontroll ei vaja npm-i, brauserit ega LLM-i.

Kohalik käivitamine (ei saada teavitusi):

```sh
cd tallinn-transit
python3 -m unittest discover -s tests -p 'test_data_freshness.py'
python3 scripts/check-data-freshness.py
```
