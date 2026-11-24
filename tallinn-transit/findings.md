---
schema: openmapstack-findings/v1
project_id: tallinn-transit
question: Loo Tallinna ühistranspordi kaart ja uksest ukseni reisiplaneerija koos
  aadressiotsingu, sõidukite asukohtade, päris jalgsimarsruutide ning võrguta kasutamisega.
run_id: run-20261124-112425
scope: Tallinna linnatranspordi, Elroni ja OSM-i fikseeritud andmepakett
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
  - id: rail_network
    status: passed
  - id: live_fix_time
    status: warning
  - id: walking_network
    status: passed
validation_report: validation/latest-report.json
context_sha256: sha256:b5f066eb909833e3573d41764856eb9e744a938a7784d76c863e7c58a565cded
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
  rationale: GPS vajab võrguühendust. Tallinn ei anna üksiksõiduki mõõtmisaega; Elron
    annab selle Europe/Tallinn ajavööndis.
- id: A5
  statement: Hoone või platvorm ühendatakse lähima sobiva teelõiguga kuni 70 m piires.
    Edasine teekond järgib olemasolevat võrku. Arvestatakse foot/access piiranguid,
    suletud tõkkeid ja oneway:foot suundi.
  rationale: Hoone viitepunkt ei ole alati sissepääs. Viimaste meetrite ühendus võib
    olla ligikaudne; ligipääsetavus ja ajutised sulgemised vajavad kohapealset kontrolli.
- id: A6
  statement: Rongid osalevad samas sõiduplaanipõhises teekonnaotsingus bussi ja trammiga.
    Elroni GTFS-i peatus Tallinn on koondatud Balti jaamaga; säilivad eri suundade
    peatused ja tegelikud jalgsikäigud. Puuduvaid perrooni numbreid ei tuletata peatuse
    ID-st.
  rationale: Linna sees võib rong anda kiireima ühenduse, ent ümberistumine peab järgima
    jalgteid.
- id: A7
  statement: Värsked avalikud sõidukiasukohad arhiveeritakse kasutajapäringu käivitatud
    algallikauuendusel. Kordused eemaldatakse olemasolevas Durable Objectis ja andmed
    säilivad privaatses R2 Parquet-arhiivis. Lisanduv viieminutiline taustakogumine
    lõpeb automaatselt 15.11.2026 kell 09:21:59 Europe/Tallinn; kasutajapäringutest
    kogumine ja ajalugu säilivad.
  rationale: Nõudluspõhisele ajaloole lisatakse ajaliselt piiratud võrdlusandmed.
    Tallinnal puudub üksiksõiduki mõõtmisaeg; Elroni reisinumber ei ole füüsilise
    rongi identifikaator.
warnings:
- id: LIVE-001
  severity: medium
  issue: fix_time_unknown
  statement: Tallinna busside ja trammide GPS ei anna üksiksõiduki mõõtmisaega. Elroni
    rongide mõõtmisaeg on teada ja üle 3 minuti vanad asukohad eemaldatakse. Teekonna
    ajad lähtuvad sõiduplaanist, mitte GPS-ist.
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
  statement: Sõiduplaani andmepaketti uuendatakse kord kuus; hilisemad muudatused
    ei pruugi kohe kajastuda. Teedevõrk on fikseeritud väljavõte.
  mitigation: Rakendus märgib üle 45 päeva vana sõiduplaani. Enne reisi kontrolli
    vedaja teateid.
- id: LICENSE-001
  severity: low
  issue: license_unverified
  statement: Tallinna ühistranspordivood on avalikud, kuid nende standardset edasilevitamise
    litsentsi ei leitud. Allikaviited on säilitatud.
  mitigation: Laiema edasilevitamise tingimused tuleb linnaga täpsustada.
- id: RAIL-001
  severity: medium
  issue: rail_coverage_and_snapshot
  statement: Elron on kaasatud olemasoleva Tallinna ja lähiümbruse kaardi piires,
    kuni Valingu, Saku ja Kullini. Rongisõiduplaani lähteversioon on 01.10.2026; hilisemad
    ajutised muudatused ei pruugi selles sisalduda. Kontrolli enne rongireisi Elroni
    teateid.
  mitigation: Värskenda GTFS-i kontrollitud lähtevoost; ära pikenda katvust ilma kaartide
    ja jalgsivõrgu uuendamiseta.
findings:
- id: network
  statement: Andmepakett sisaldab 104 liini, 534 koondatud peatust, 1170 platvormi
    ja 21549 sõiduplaanireisi. Teenindus sõltub valitud kuupäevast.
  evidence:
  - stops
  - stations
  - routes
- id: transfers
  statement: Ümberistumiste võrk sisaldab 10410 suunatud OSM-i jalgsimarsruuti pikkusega
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
  - Tallinna GPS-i voos puudub üksiksõiduki mõõtmisaeg. Elron annab mõõtmisaja; üle
    180 s vanad rongiasukohad jäetakse välja.
evidence:
  stops:
    definition:
      path: data/derived/stops.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/stops.geojson
      sha256: sha256:8d180a67f614c56ebb15ac0ce3956f78245c3d0d5eb11d821aae01872b6eb86a
  stations:
    definition:
      path: data/derived/stations.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/stations.geojson
      sha256: sha256:3a91da02685826a02475a5759648ab2cd23e5117a2567bd3f11584436cf1eafc
  routes:
    definition:
      path: data/derived/routes.geojson
      format: GeoJSON (EPSG:4326)
      generated_by: export_network
      crs: EPSG:4326
    files:
    - path: data/derived/routes.geojson
      sha256: sha256:1bed0330dbcfe634b009154be7c8c7e386de7bf532697fb6911e9d962a01c88a
---
# Findings

Loo Tallinna ühistranspordi kaart ja uksest ukseni reisiplaneerija koos aadressiotsingu, sõidukite asukohtade, päris jalgsimarsruutide ning võrguta kasutamisega.

Scope: Tallinna linnatranspordi, Elroni ja OSM-i fikseeritud andmepakett. Run: `run-20261124-112425`. Validation: **warning**.

## network

Andmepakett sisaldab 104 liini, 534 koondatud peatust, 1170 platvormi ja 21549 sõiduplaanireisi. Teenindus sõltub valitud kuupäevast.

Evidence:

- [stops](data/derived/stops.geojson)
- [stations](data/derived/stations.geojson)
- [routes](data/derived/routes.geojson)

## transfers

Ümberistumiste võrk sisaldab 10410 suunatud OSM-i jalgsimarsruuti pikkusega kuni 600 meetrit, mõõdetuna EPSG:3301 süsteemis.

Evidence:

- [stops](data/derived/stops.geojson)

Limitation: Arvestatakse jalgsi liikumise piiranguid ja ühiseid OSM-i sõlmi. Viimase kuni 70 m ühendus hoone või platvormiga võib olla ligikaudne; ajutised sulgemised ja ratastooliga ligipääsetavus pole kinnitatud.

## live

Sõidukite asukohti küsitakse sõiduplaanist sõltumatult. Need ei määra hilinemist ega prognoositavat saabumisaega.

Evidence:

- [routes](data/derived/routes.geojson)

Limitation: Tallinna GPS-i voos puudub üksiksõiduki mõõtmisaeg. Elron annab mõõtmisaja; üle 180 s vanad rongiasukohad jäetakse välja.

## Assumptions and limitations

- Sama peatuse lähestikku paiknevad platvormid koondatakse kuni 400 m vahedega. Nimesid „Balti jaam 1” ja „Balti jaam” käsitletakse ühise peatusena ainult siis, kui numbrita nimi on lähteandmetes olemas. Loendid ja kaugvaade näitavad peatust; sõidujuhised määravad täpse platvormi. Veebis lisanduvad In-ADS-i aadressid. Üks peatus võib teenindada mitut suunda. Eraldi kaugel paiknevaid samanimelisi peatusi ei ühendata.
- Kõnniteed järgitakse OpenStreetMapi jalakäijate teedevõrgus. Vaikimisi võrreldakse kõiki kuni 1000 m jalgsikäigu kaugusel platvorme; ümberistumiste jalgsitee võib olla kuni 600 m. Kõndimise kiirus on 1,25 m/s; ümberistumisel lisandub 120 sekundit varuaega. Pikem jalgsikäik võib anda kiirema ühenduse. Lähim peatus ei ole ainus kandidaat.
- Kuupäev ja kellaaeg käivad Europe/Tallinn ajavööndi järgi. Arvesse lähevad kalendrierandid, südaööd ületavad reisid ning eelmine, valitud ja järgmine teeninduspäev. Teekond peab jääma õigeks ka välismaa ajavööndis seadmes.
- Veebirežiimis uuendatakse GPS-i iga 10 sekundi järel. Võrguta režiimi valimine salvestab kogu andmepaketi ja eemaldab GPS-asukohad. Paus peatab uuendamise, jätkamine küsib asukohad kohe uuesti. GPS vajab võrguühendust. Tallinn ei anna üksiksõiduki mõõtmisaega; Elron annab selle Europe/Tallinn ajavööndis.
- Hoone või platvorm ühendatakse lähima sobiva teelõiguga kuni 70 m piires. Edasine teekond järgib olemasolevat võrku. Arvestatakse foot/access piiranguid, suletud tõkkeid ja oneway:foot suundi. Hoone viitepunkt ei ole alati sissepääs. Viimaste meetrite ühendus võib olla ligikaudne; ligipääsetavus ja ajutised sulgemised vajavad kohapealset kontrolli.
- Rongid osalevad samas sõiduplaanipõhises teekonnaotsingus bussi ja trammiga. Elroni GTFS-i peatus Tallinn on koondatud Balti jaamaga; säilivad eri suundade peatused ja tegelikud jalgsikäigud. Puuduvaid perrooni numbreid ei tuletata peatuse ID-st. Linna sees võib rong anda kiireima ühenduse, ent ümberistumine peab järgima jalgteid.
- Värsked avalikud sõidukiasukohad arhiveeritakse kasutajapäringu käivitatud algallikauuendusel. Kordused eemaldatakse olemasolevas Durable Objectis ja andmed säilivad privaatses R2 Parquet-arhiivis. Lisanduv viieminutiline taustakogumine lõpeb automaatselt 15.11.2026 kell 09:21:59 Europe/Tallinn; kasutajapäringutest kogumine ja ajalugu säilivad. Nõudluspõhisele ajaloole lisatakse ajaliselt piiratud võrdlusandmed. Tallinnal puudub üksiksõiduki mõõtmisaeg; Elroni reisinumber ei ole füüsilise rongi identifikaator.
- Tallinna busside ja trammide GPS ei anna üksiksõiduki mõõtmisaega. Elroni rongide mõõtmisaeg on teada ja üle 3 minuti vanad asukohad eemaldatakse. Teekonna ajad lähtuvad sõiduplaanist, mitte GPS-ist.
- Jalgsikäigud järgivad OpenStreetMapi teedevõrku. Hoone või platvormi viimased kuni 70 meetrit võivad olla ligikaudsed; ratastooliga ligipääsetavus ja ajutised sulgemised pole kinnitatud.
- Sõiduplaani andmepaketti uuendatakse kord kuus; hilisemad muudatused ei pruugi kohe kajastuda. Teedevõrk on fikseeritud väljavõte.
- Tallinna ühistranspordivood on avalikud, kuid nende standardset edasilevitamise litsentsi ei leitud. Allikaviited on säilitatud.
- Elron on kaasatud olemasoleva Tallinna ja lähiümbruse kaardi piires, kuni Valingu, Saku ja Kullini. Rongisõiduplaani lähteversioon on 01.10.2026; hilisemad ajutised muudatused ei pruugi selles sisalduda. Kontrolli enne rongireisi Elroni teateid.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)
