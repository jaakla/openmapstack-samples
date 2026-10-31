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

## Reaalajaseire ja vaiksed teavitused

Workeri ja kasutajamõju seire on eraldi. GPS-i andmetervist ei võrdsustata
staatilise sõiduplaani igapäevase auditiga ega nädalase brauserikontrolliga.

| Otspunkt | HTTP 200 | HTTP 503 | Algallikapäring |
| --- | --- | --- | --- |
| `/health/live` | Worker vastab | Workeri käivitamine/teenindamine ebaõnnestub | Ei |
| `/health/data` | Mõlemad allikad `fresh` | Vähemalt üks `stale` või `unavailable` | Ei |

Mõlemad toetavad GET/HEAD ja annavad `Cache-Control: no-store`. Data-health
loeb kahe olemasoleva Durable Objecti viimase seisu. JSON-i `sources.tallinn`
ja `sources.elron` sisaldavad `status`, `timestamp`, `ageSeconds`, `upstreamError`,
`validatedAt`, `vehicleCount` ning `lastAttempt` välju. Andmete puudumisel on
ajatempel ja vanus `null`. Külm cache annab `unavailable`; seire ei mõtle
varasemat edukat seisu välja. Andmed värskenevad kasutaja GPS-päringutega.
Kui liiklust pole üle 60 s, võib data-health näidata vananenud viimast seisu,
kuigi Worker on töökorras. Monitor ise ei soojenda cache'i ega diagnoosi
algallikat uue päringuga. See on teadlikult viimase teadaoleva seisu kontroll.

Andmete piirid on `fresh` kuni 60 s, `stale` üle 60 kuni 180 s ning
`unavailable` üle 180 s. Algallika vea korral saab kuni 180 s vanu viimaseid
edukaid andmeid olemasolevast cache'ist olekuga `stale`. Ükski tõrge ei pikenda
andmete algset aega. Brauser arvutab vanust edasi ka HTTP-cache'is ja pausil,
näitab kummagi allika hoiatust eraldi ning eemaldab aegunud markerid.
Ühe allika tõrge ei peida teise allika värskeid sõidukeid.

Workeri struktureeritud logi `gps_upstream` sisaldab `feed`, `at`, `outcome`,
`reason`, `errorClass`, `upstreamStatus` ja `durationMs` välju. Klassid on
`timeout`, `upstream_5xx`, `upstream_4xx`, `network_error`, `invalid_response`
ja `internal_error`. Korrektne tühi CSV või Elroni tühi andmeloend logitakse
`outcome: empty`, `reason: empty_response`, `errorClass: null`; see pole
upstream'i rike. Tühjus jääb nähtavaks ka `vehicleCount: 0` kaudu. Päevase
Tallinna voo ootamatut tühjust kontrollib lisaks olemasolev nädalakontroll.
Kui Elroni katvuses olevad asukohad on kõik vananenud, logitakse `expired_fixes`;
seda ei käsitleta värske tühja vaatlusena. Elroni andmete aeg pärineb mõõtmistest.
Workeri sidumise või Cache API sisemine viga annab `worker_internal_error`
logi. `wrangler.jsonc` lubab rakenduse logid, kuid mitte automaatsed invocation-logid;
otsingutekste, kasutaja asukohti ega upstream'i vastuse sisu ei logita.

### Kahe Better Stacki monitori loomine või uuendamine

Seadistus: `monitoring/betterstack.json`. Vaikimisi mõlemale:

- kontroll iga 180 s Euroopa piirkonnast, päringu timeout 10 s;
- `confirmation_period: 300` ja `recovery_period: 180`;
- e-post sisse, kõned, SMS, push ja critical alert välja;
- `policy_id: null`, `team_wait: null`, monitor jääb aktiivseks.

Viie minuti confirmation algab esimesest täheldatud veast; 180 s kontrollisammu
tõttu pole tegelik tuvastusaeg täpselt viis minutit. Soovi korral vali kontol
toetatud sagedasem kontroll. Recovery nõuab taastunud seisu kinnitamist.
E-posti teavitused töötavad ka öösel, kuid äratavaid kanaleid ei kasutata
kummalgi monitoril ühelgi kellaajal. Varasemale eskalatsioonipoliitikale jäämine
võiks kanalisätted tühistada, seetõttu eemaldab seadistus nende kahe monitori
`policy_id` väärtuse. Teisi monitore, poliitikaid ja heartbeat'e ei muudeta.
Öist maintenance-akent ei seata: kontrollid ja intsidentide ajalugu säilivad.

```sh
cd tallinn-transit
python3 scripts/betterstack-monitoring.py plan
# Anna BETTERSTACK_API_TOKEN turvaliselt keskkonna kaudu; ära kirjuta võtit faili.
# Globaalse tokeni puhul määra ka BETTERSTACK_TEAM_NAME.
python3 scripts/betterstack-monitoring.py apply
```

`plan` ei vaja tokenit ega tee võrgupäringuid. `apply` loeb kõik monitoride
lehed, leiab sama URL-i ja tiimi monitorid ning uuendab need PATCH-iga;
puuduvad loob POST-iga. Olemasolevaid monitore ei kustutata ja nende ajalugu
säilib. Sama URL-i mitme vaste korral peatub käsk, et vale monitori mitte muuta.
Pärast käivitamist kontrolli Better Stackis mõlema monitori kanaleid ja perioode.

Enne monitoride aktiveerimist avalda uus Worker (`npm run worker:deploy`),
käivita mõlemad GPS-päringud (`/vehicles`, `/trains`) ning kontrolli
`/health/live` ja `/health/data`. Seejärel avalda kasutajaliides tavapärase
Pagesi töövooga. Kohalik test või `plan` ei avalda midagi.

Seadistuse alus: Better Stacki [monitoride loomise API](https://betterstack.com/docs/uptime/api/create-a-new-monitor/),
[uuendamise API](https://betterstack.com/docs/uptime/api/update-an-existing-monitor/)
ja [monitoride väljad](https://betterstack.com/docs/uptime/api/list-all-existing-monitors/).

### Hommikune koondraport

`.github/workflows/maintenance-incidents.yml` koostab iga päev kell 09.20
(`Europe/Tallinn`) mõlema monitori hetkeoleku ja viimase 24 tunni intsidentide
raporti. Ka varem alanud lahtised ja selle perioodi jooksul taastunud intsidendid
kaasatakse. Raport loeb Better Stacki ajalugu; see ei ava, sulge ega kustuta
intsidente. Koondfail jääb 90 päevaks Actionsi artefaktiks ning saadetakse
e-postiga SMTP STARTTLS-i kaudu. Töö vajab ainult Pythoni standardteeki.

Lisa repositooriumi Actionsi secrets:

- `BETTERSTACK_API_TOKEN` – vastava tiimi lugemisõigusega token raportiks;
- `MONITORING_EMAIL_FROM` ja `MONITORING_EMAIL_TO` – saatja ja saaja;
- `MONITORING_SMTP_HOST`, `MONITORING_SMTP_USERNAME`, `MONITORING_SMTP_PASSWORD`.

Valikulised Actionsi variables on `BETTERSTACK_TEAM_NAME` (globaalse tokeniga)
ja `MONITORING_SMTP_PORT` (vaikimisi 587). API token antakse ainult lugemise
sammule, SMTP saladused ainult saatmise sammule. Seadistuse `apply` käsk vajab
eraldi kirjutamisõigusega tokenit; päevatöö ei käivita seda käsku.

Käivita töö esmalt käsitsi ja kontrolli raporti saabumist. Seejärel määra
Actionsi variable `MONITORING_DIGEST_ENABLED=true`, et ajastus aktiveerida.
Secret'ite puudumine annab käsitsi kontrollis vea; edu ei väideta ega e-posti
saatmist ei jäeta vaikselt vahele. Fail peab ajastuse toimimiseks olema `main` harus.
Kohalik raporti eelvaade ei saada kirja:

```sh
python3 scripts/betterstack-monitoring.py report --output /tmp/tallinn-incidents.txt
```

Raporti allikas on Better Stacki [intsidentide API](https://betterstack.com/docs/uptime/api/list-all-incidents/).
Selle muudatusega tarnitakse seadistus ja juhend; Better Stacki kontol monitoride
aktiveerimine ning SMTP/GitHubi secret'ite lisamine on eraldi käivitustoimingud.
