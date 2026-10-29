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
Kohalik test ei saada Better Stacki teadet. See töö ei uuenda GTFS-i, OSM-i ega
teeke; nende staging- ja avaldamistööd tuleb luua eraldi.
