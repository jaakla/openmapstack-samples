---
schema: openmapstack-findings/v1
project_id: tallinn-transit
question: Loo Tallinna ühistranspordi kaart ja uksest ukseni reisiplaneerija koos
  aadressiotsingu, sõidukite asukohtade, päris jalgsimarsruutide ning võrguta kasutamisega.
run_id: run-20261029-053908
scope: Tallinna ühistranspordi fikseeritud GTFS-i ja OSM-i andmepakett
validation:
  status: warning
  checks:
  - id: geometry_valid
    status: passed
  - id: crs_known
    status: passed
  - id: row_count_gt_zero
    status: passed
  - id: source_result_complete
    status: passed
  - id: gtfs_references
    status: passed
  - id: gtfs_monotonic_times
    status: passed
  - id: layer_extent_within_aoi
    status: passed
  - id: metric_transfer_bound
    status: passed
  - id: crs_roundtrip
    status: passed
  - id: route_modes_known
    status: passed
  - id: live_fix_time
    status: warning
  - id: walking_network
    status: passed
validation_report: validation/latest-report.json
context_sha256: sha256:807c4ec91d877022aa268d786344ad29602458d028fc4bfd768fe3dbc0ee433b
assumptions:
- id: A1
  statement: Sama peatuse lähestikku paiknevad platvormid koondatakse kuni 400 m vahedega.
    Nimesid „Balti jaam 1” ja „Balti jaam” käsitletakse ühise peatusena ainult siis,
    kui numbrita nimi on lähteandmetes olemas. Loendid ja kaugvaade näitavad peatust;
    sõidujuhised määravad täpse platvormi. Veebis lisanduvad In-ADS-i aadressid.
  rationale: Üks peatus võib teenindada mitut suunda. Eraldi kaugel paiknevaid samanimelisi
    peatusi ei ühendata.
- id: A2
  statement: Kõnniteed järgitakse OpenStreetMapi jalakäijate teedevõrgus. Vaikimisi
    võrreldakse kõiki kuni 1000 m jalgsikäigu kaugusel platvorme; ümberistumiste jalgsitee
    võib olla kuni 600 m. Kõndimise kiirus on 1,25 m/s; ümberistumisel lisandub 120
    sekundit varuaega.
  rationale: Pikem jalgsikäik võib anda kiirema ühenduse. Lähim peatus ei ole ainus
    kandidaat.
- id: A3
  statement: Kuupäev ja kellaaeg käivad Europe/Tallinn ajavööndi järgi. Arvesse lähevad
    kalendrierandid, südaööd ületavad reisid ning eelmine, valitud ja järgmine teeninduspäev.
  rationale: Teekond peab jääma õigeks ka välismaa ajavööndis seadmes.
- id: A4
  statement: Veebirežiimis uuendatakse GPS-i iga 10 sekundi järel. Võrguta režiimi
    valimine salvestab kogu andmepaketi ja eemaldab GPS-asukohad. Paus peatab uuendamise,
    jätkamine küsib asukohad kohe uuesti.
  rationale: GPS vajab võrguühendust. Üksiksõidukite asukohamõõtmise aeg ja hilinemised
    ei ole teada.
- id: A5
  statement: Hoone või platvorm ühendatakse lähima sobiva teelõiguga kuni 70 m piires.
    Edasine teekond järgib olemasolevat võrku. Arvestatakse foot/access piiranguid,
    suletud tõkkeid ja oneway:foot suundi.
  rationale: Hoone viitepunkt ei ole alati sissepääs. Viimaste meetrite ühendus võib
    olla ligikaudne; ligipääsetavus ja ajutised sulgemised vajavad kohapealset kontrolli.
warnings:
- id: LIVE-001
  severity: medium
  issue: fix_time_unknown
  statement: GPS näitab sõidukite viimati saadud asukohti. Üksiksõidukite mõõtmisaeg,
    hilinemised ja prognoositavad saabumised pole teada.
  mitigation: Aegunud asukohad tuhmuvad ja eemaldatakse; teekonna ajad lähtuvad sõiduplaanist.
- id: WALK-001
  severity: medium
  issue: endpoint_snap_and_accessibility
  statement: Jalgsikäigud järgivad OpenStreetMapi teedevõrku. Hoone või platvormi
    viimased kuni 70 meetrit võivad olla ligikaudsed; ratastooliga ligipääsetavus
    ja ajutised sulgemised pole kinnitatud.
  mitigation: Kontrolli sissepääse ja kohapealseid liikumistingimusi.
- id: FRESH-001
  severity: medium
  issue: snapshot_freshness
  statement: Sõiduplaan ja teedevõrk on fikseeritud andmepaketis. Hilisemad muudatused
    ei lisandu automaatselt; sõiduplaani tuleb vähemalt kord nädalas uuendada.
  mitigation: Rakendus märgib üle seitsme päeva vana sõiduplaani.
- id: LICENSE-001
  severity: low
  issue: license_unverified
  statement: Tallinna ühistranspordivood on avalikud, kuid nende standardset edasilevitamise
    litsentsi ei leitud. Allikaviited on säilitatud.
  mitigation: Laiema edasilevitamise tingimused tuleb linnaga täpsustada.
findings:
- id: network
  statement: Andmepakett sisaldab 80 liini, 517 koondatud peatust, 1118 platvormi
    ja 20048 sõiduplaanireisi. Teenindus sõltub valitud kuupäevast.
  evidence:
  - stops
  - stations
  - routes
- id: transfers
  statement: Ümberistumiste võrk sisaldab 9864 suunatud OSM-i jalgsimarsruuti pikkusega
    kuni 600 meetrit, mõõdetuna EPSG:3301 süsteemis.
  evidence:
  - stops
  limitations:
  - Arvestatakse jalgsi liikumise piiranguid ja ühiseid OSM-i sõlmi. Viimase kuni
    70 m ühendus hoone või platvormiga võib olla ligikaudne; ajutised sulgemised ja
    ratastooliga ligipääsetavus pole kinnitatud.
- id: live
  statement: Sõidukite asukohti küsitakse sõiduplaanist sõltumatult. Need ei määra
    hilinemist ega prognoositavat saabumisaega.
  evidence:
  - routes
  limitations:
  - GPS-i voos puudub üksiksõiduki mõõtmisaeg. Hiljuti saadud vastus võib sisaldada
    vanemaid asukohti.
evidence:
  stops:
    definition:
      path: data/derived/stops.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/stops.geojson
      sha256: sha256:8b9c0cf1bbfbf339364477473f36f67c39e21feaf803d083ab64021f55bff2ff
  stations:
    definition:
      path: data/derived/stations.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/stations.geojson
      sha256: sha256:e326e936d63bb03b1067109ed9cc3f66b3355308d48d20c2ded8a85b307f4366
  routes:
    definition:
      path: data/derived/routes.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/routes.geojson
      sha256: sha256:e72a7497c1fa5c505aefb3b80f0ece70201c84a8197f716be25707b8e6405491
---
# Findings

Loo Tallinna ühistranspordi kaart ja uksest ukseni reisiplaneerija koos aadressiotsingu, sõidukite asukohtade, päris jalgsimarsruutide ning võrguta kasutamisega.

Scope: Tallinna ühistranspordi fikseeritud GTFS-i ja OSM-i andmepakett. Run: `run-20261029-053908`. Validation: **warning**.

## network

Andmepakett sisaldab 80 liini, 517 koondatud peatust, 1118 platvormi ja 20048 sõiduplaanireisi. Teenindus sõltub valitud kuupäevast.

Evidence:

- [stops](data/derived/stops.geojson)
- [stations](data/derived/stations.geojson)
- [routes](data/derived/routes.geojson)

## transfers

Ümberistumiste võrk sisaldab 9864 suunatud OSM-i jalgsimarsruuti pikkusega kuni 600 meetrit, mõõdetuna EPSG:3301 süsteemis.

Evidence:

- [stops](data/derived/stops.geojson)

Limitation: Arvestatakse jalgsi liikumise piiranguid ja ühiseid OSM-i sõlmi. Viimase kuni 70 m ühendus hoone või platvormiga võib olla ligikaudne; ajutised sulgemised ja ratastooliga ligipääsetavus pole kinnitatud.

## live

Sõidukite asukohti küsitakse sõiduplaanist sõltumatult. Need ei määra hilinemist ega prognoositavat saabumisaega.

Evidence:

- [routes](data/derived/routes.geojson)

Limitation: GPS-i voos puudub üksiksõiduki mõõtmisaeg. Hiljuti saadud vastus võib sisaldada vanemaid asukohti.

## Assumptions and limitations

- Sama peatuse lähestikku paiknevad platvormid koondatakse kuni 400 m vahedega. Nimesid „Balti jaam 1” ja „Balti jaam” käsitletakse ühise peatusena ainult siis, kui numbrita nimi on lähteandmetes olemas. Loendid ja kaugvaade näitavad peatust; sõidujuhised määravad täpse platvormi. Veebis lisanduvad In-ADS-i aadressid. Üks peatus võib teenindada mitut suunda. Eraldi kaugel paiknevaid samanimelisi peatusi ei ühendata.
- Kõnniteed järgitakse OpenStreetMapi jalakäijate teedevõrgus. Vaikimisi võrreldakse kõiki kuni 1000 m jalgsikäigu kaugusel platvorme; ümberistumiste jalgsitee võib olla kuni 600 m. Kõndimise kiirus on 1,25 m/s; ümberistumisel lisandub 120 sekundit varuaega. Pikem jalgsikäik võib anda kiirema ühenduse. Lähim peatus ei ole ainus kandidaat.
- Kuupäev ja kellaaeg käivad Europe/Tallinn ajavööndi järgi. Arvesse lähevad kalendrierandid, südaööd ületavad reisid ning eelmine, valitud ja järgmine teeninduspäev. Teekond peab jääma õigeks ka välismaa ajavööndis seadmes.
- Veebirežiimis uuendatakse GPS-i iga 10 sekundi järel. Võrguta režiimi valimine salvestab kogu andmepaketi ja eemaldab GPS-asukohad. Paus peatab uuendamise, jätkamine küsib asukohad kohe uuesti. GPS vajab võrguühendust. Üksiksõidukite asukohamõõtmise aeg ja hilinemised ei ole teada.
- Hoone või platvorm ühendatakse lähima sobiva teelõiguga kuni 70 m piires. Edasine teekond järgib olemasolevat võrku. Arvestatakse foot/access piiranguid, suletud tõkkeid ja oneway:foot suundi. Hoone viitepunkt ei ole alati sissepääs. Viimaste meetrite ühendus võib olla ligikaudne; ligipääsetavus ja ajutised sulgemised vajavad kohapealset kontrolli.
- GPS näitab sõidukite viimati saadud asukohti. Üksiksõidukite mõõtmisaeg, hilinemised ja prognoositavad saabumised pole teada.
- Jalgsikäigud järgivad OpenStreetMapi teedevõrku. Hoone või platvormi viimased kuni 70 meetrit võivad olla ligikaudsed; ratastooliga ligipääsetavus ja ajutised sulgemised pole kinnitatud.
- Sõiduplaan ja teedevõrk on fikseeritud andmepaketis. Hilisemad muudatused ei lisandu automaatselt; sõiduplaani tuleb vähemalt kord nädalas uuendada.
- Tallinna ühistranspordivood on avalikud, kuid nende standardset edasilevitamise litsentsi ei leitud. Allikaviited on säilitatud.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)
