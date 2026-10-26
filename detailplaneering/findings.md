---
schema: openmapstack-findings/v1
project_id: idaringtee-21
question: Kujutada esitatud detailplaneeringu jooniseid 3D-kaardil koos olemasoleva
  olukorraga ligikaudu 1 km ulatuses planeeringuala ümber.
run_id: run-20261026-181505
scope: Supplied Idaringtee 21 plan drawing and a 1000 m straight-line neighbourhood
  buffer
validation:
  status: warning
  checks:
  - id: source_hashes_match
    status: passed
  - id: independent_grid_reference
    status: passed
  - id: plot_area_matches_drawing
    status: passed
  - id: context_coverage
    status: passed
  - id: proposed_ground_labels
    status: passed
  - id: overrides_applied
    status: passed
  - id: height_limits_consistent
    status: passed
  - id: context_api_complete
    status: passed
  - id: thematic_registration
    status: passed
  - id: thematic_content
    status: passed
  - id: ditch_source_location
    status: passed
  - id: geometry_valid
    status: passed
  - id: feature_ids_unique
    status: passed
  - id: context_selection_exact
    status: passed
  - id: mahud
    status: warning
  - id: ajakohasus
    status: warning
  - id: dokumendid
    status: warning
  - id: menetlus
    status: warning
  - id: reljeef
    status: warning
  - id: kasutustingimused
    status: warning
  - id: teemakihid
    status: warning
validation_report: validation/latest-report.json
context_sha256: sha256:4e0d397e95466331d56849e834dbabcb821cfce7dec856b0f7bc1944843b9fbe
assumptions:
- id: A1
  statement: Ümbruskond hõlmab 1000 m laiust sirgjoonelise kauguse puhvrit planeeringuala
    välispiirist süsteemis EPSG:3301. Puhvriga lõikuvad hooned säilitatakse tervikuna.
  rationale: Kasutaja soovis ligikaudu 1 km ulatusega ümbrust, mitte liikumisajast
    sõltuvat teenindusala.
- id: A2
  statement: PDF kasutab tasapinnal L-EST97 koordinaatsüsteemi ja kõrguste jaoks EH2000
    süsteemi. Kaks joonise koordinaatristi määravad sarnasusteisenduse; kolmandat
    kasutatakse sõltumatuks kontrolliks.
  rationale: Need süsteemid on märgitud joonisele ja seletuskirja.
- id: A3
  statement: Hoone kontuurist luuakse maht lubatud absoluutse parapetikõrguseni. Kõrgus
    planeeritud maapinnast arvutatakse sama krundi lähima orienteeruva kõrgusmärgi
    järgi.
  rationale: Joonised ei määra lõplikku arhitektuurset katusekuju ega tulevase maapinna
    täpset pinda.
- id: A4
  statement: Olemasoleva hoone kõrguseks võetakse ETAK-i positiivne korgus_m väärtus.
    Puuduva või vigase väärtuse korral kuvatakse ainult hoone kontuur.
  rationale: Teadmata kõrgustele oletuslikke väärtusi ei lisata.
- id: A5
  statement: Tehnovõrkude ja mõjuala joonis seotakse põhijoonisega ühiste krundipolügoonide
    kaudu. Kahe suurima krundi keskpunktid määravad sarnasusteisenduse; ülejäänud
    29 krundi keskpunktidega kontrollitakse asukohta. Jooniste legendid, kirjanurgad
    ja üldplaneeringu väljavõte jäetakse geograafilistest kihtidest välja.
  rationale: Nii säilib jooniste tegelik geomeetria ja kontrollitav paigutus. Võrgutrassidele
    ei omistata joonisel puuduvat sügavust.
warnings:
- id: mahud
  severity: medium
  statement: 3D-hooned on joonisel kujutatud hoonealuste pindade ja lubatud parapetikõrguste
    põhjal loodud tinglikud mahud, mitte kinnitatud arhitektuursed lahendused. Maapinna
    orienteeruv kõrgus võetakse sama krundi lähimast planeeritud kõrgusmärgist.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: planned
  issue: massing
- id: ajakohasus
  severity: medium
  statement: Olemasolevate hoonete, ortofotode ja reljeefi vaatlusajad erinevad. Andmed
    laaditi alla 26.10.2026; nende vastavust tänasele olukorrale pole kohapeal kontrollitud.
    Teadmata kõrgusega hooned kuvatakse tasapinnaliste kontuuridena.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: existing
  issue: vintage
- id: dokumendid
  severity: medium
  statement: Korralduse kokkuvõttes on 21 ehitatavat krunti, põhijoonisel aga 24 elamu-
    või ärikrunti. Pos 14 lubab kahte hoonet, kuid kujutab üht ühendatud kontuuri.
    Vaade järgib esitatud joonist ega lahenda dokumentide erinevusi. Joonise kruntide
    kogupindala on 10,18 ha, seletuskiri kirjeldab 10,9 ha suurust ala.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: planned
  issue: documents
- id: menetlus
  severity: medium
  statement: Korraldusega nr 737 võeti planeering vastu ja suunati avalikule väljapanekule
    26.10.–09.11.2026. See ei tähenda planeeringu kehtestamist.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: planned
  issue: status
- id: reljeef
  severity: medium
  statement: Reljeefi kuvamiseks on ametlikust maapinnamudelist võetud 5 m sammuga
    kõrgused. Planeeritud hoonete maapinnakõrgused põhinevad joonise orienteeruvatel
    kõrgusmärkidel. Kavandatud pinnasetöid, katusekaldeid, fassaade ja taimestiku
    ruumkuju pole modelleeritud.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: existing
  issue: terrain
- id: kasutustingimused
  severity: medium
  statement: Esitatud planeeringujooniste taaskasutustingimusi pole eraldi kontrollitud.
    Viited autorile AB Artes Terrae OÜ ja Tartu Linnavalitsusele on säilitatud.
  mitigation: Inspect the supplied documents and source metadata; preserve the stated
    uncertainty.
  layer: planned
  issue: licensing
- id: teemakihid
  severity: medium
  statement: Tehnovõrgud ning mõjuala liikumissuunad, bussipeatused ja maakasutuse
    märkused on taastatud 17.09.2026 PDF-joonistelt. Võrkude sügavusi pole määratud;
    mõjuala kirjeldused ei kinnita tänast maakasutust ega bussiliiklust. OSM-vektoraluskaart
    vajab internetiühendust.
  mitigation: Kontrolli algjoonist ja ajakohaseid võrguandmeid. Võrguühenduseta kasuta
    kohalikku Maa-ameti aluskaarti või ortofotot.
  layer: utilities
  issue: source-derived-thematic-context
findings:
- id: plan-recovered
  statement: 'Recovered 31 plots (10.18 ha), 32 main-building symbols and 10 ancillary
    symbols directly from the PDF CAD layers. Third-point registration residual: 0.000027
    m; this is internal registration consistency, not survey accuracy.'
  evidence:
  - planned
  - plots
  limitations:
  - Massing uses maximum permitted parapet elevations and nearest indicative ground
    levels. Roof form, façades and final designs are not supplied. Pos 14 depicts
    one connected symbol while the table permits two main buildings.
- id: neighbourhood
  statement: Selected 1115 existing building footprints intersecting the 1000 m buffer;
    55 have no usable reported height and remain footprint-only.
  evidence:
  - existing
  - context
  limitations:
  - ETAK and terrain observation dates vary; download date does not establish current
    field conditions.
- id: thematic-drawings
  statement: Recovered 12 utility categories and 40 context features from the supplied
    thematic PDFs, including six bus-stop symbols, movement markings, land-use notes
    and network connections. PDF clipping scopes exclude hatch instructions outside
    their visible geometry. Twenty-nine parcel centroids independently check each
    thematic registration.
  evidence:
  - utilities
  - relations
  limitations:
  - Network depth is unknown; surface projection is illustrative. Relationship annotations
    retain their drawing date and do not verify current bus service or land use.
evidence:
  planned:
    definition:
      path: data/derived/planned.geojson
      format: GeoJSON (EPSG:4326)
      kind: geodata
      crs: EPSG:4326
      generated_by: recover
    files:
    - path: data/derived/planned.geojson
      sha256: sha256:300c3a16dbc0e84be3154e11e63d8944d7800532b15fa8ece5229eafc704619f
  plots:
    definition:
      path: data/derived/plots.geojson
      format: GeoJSON (EPSG:4326)
      kind: geodata
      crs: EPSG:4326
      generated_by: recover
    files:
    - path: data/derived/plots.geojson
      sha256: sha256:9e0df74c26f9a79e00761e3ba9d9250de122919233bcf2c73af3357169d3f032
  existing:
    definition:
      path: data/derived/existing.geojson
      format: GeoJSON (EPSG:4326)
      kind: geodata
      crs: EPSG:4326
      generated_by: context
    files:
    - path: data/derived/existing.geojson
      sha256: sha256:761ad6658e04e344379110b55b0c6db03ed11befb756d70580bc0aa9e91e7e1f
  context:
    definition:
      path: data/derived/context.geojson
      format: GeoJSON (EPSG:4326)
      kind: geodata
      crs: EPSG:4326
      generated_by: context
    files:
    - path: data/derived/context.geojson
      sha256: sha256:c51b314caa79bd9c6e88df398cbdfec2d103096d8195d042baba745ba7c936ef
  utilities:
    definition:
      path: data/derived/utilities.geojson
      kind: geodata
      format: GeoJSON (EPSG:4326)
      generated_by: recover
    files:
    - path: data/derived/utilities.geojson
      sha256: sha256:def5159cc82eb7b6bc716e75ae4233babf2a7ccb28ba0252fdb7b8cecf6a6cb9
  relations:
    definition:
      path: data/derived/relations.geojson
      kind: geodata
      format: GeoJSON (EPSG:4326)
      generated_by: recover
    files:
    - path: data/derived/relations.geojson
      sha256: sha256:8a523a69bdfd748bcd083464634b5c3d9ff1338bb6144acaa88c0ef2362d0d38
---
# Findings

Kujutada esitatud detailplaneeringu jooniseid 3D-kaardil koos olemasoleva olukorraga ligikaudu 1 km ulatuses planeeringuala ümber.

Scope: Supplied Idaringtee 21 plan drawing and a 1000 m straight-line neighbourhood buffer. Run: `run-20261026-181505`. Validation: **warning**.

## plan-recovered

Recovered 31 plots (10.18 ha), 32 main-building symbols and 10 ancillary symbols directly from the PDF CAD layers. Third-point registration residual: 0.000027 m; this is internal registration consistency, not survey accuracy.

Evidence:

- [planned](data/derived/planned.geojson)
- [plots](data/derived/plots.geojson)

Limitation: Massing uses maximum permitted parapet elevations and nearest indicative ground levels. Roof form, façades and final designs are not supplied. Pos 14 depicts one connected symbol while the table permits two main buildings.

## neighbourhood

Selected 1115 existing building footprints intersecting the 1000 m buffer; 55 have no usable reported height and remain footprint-only.

Evidence:

- [existing](data/derived/existing.geojson)
- [context](data/derived/context.geojson)

Limitation: ETAK and terrain observation dates vary; download date does not establish current field conditions.

## thematic-drawings

Recovered 12 utility categories and 40 context features from the supplied thematic PDFs, including six bus-stop symbols, movement markings, land-use notes and network connections. PDF clipping scopes exclude hatch instructions outside their visible geometry. Twenty-nine parcel centroids independently check each thematic registration.

Evidence:

- [utilities](data/derived/utilities.geojson)
- [relations](data/derived/relations.geojson)

Limitation: Network depth is unknown; surface projection is illustrative. Relationship annotations retain their drawing date and do not verify current bus service or land use.

## Assumptions and limitations

- Ümbruskond hõlmab 1000 m laiust sirgjoonelise kauguse puhvrit planeeringuala välispiirist süsteemis EPSG:3301. Puhvriga lõikuvad hooned säilitatakse tervikuna. Kasutaja soovis ligikaudu 1 km ulatusega ümbrust, mitte liikumisajast sõltuvat teenindusala.
- PDF kasutab tasapinnal L-EST97 koordinaatsüsteemi ja kõrguste jaoks EH2000 süsteemi. Kaks joonise koordinaatristi määravad sarnasusteisenduse; kolmandat kasutatakse sõltumatuks kontrolliks. Need süsteemid on märgitud joonisele ja seletuskirja.
- Hoone kontuurist luuakse maht lubatud absoluutse parapetikõrguseni. Kõrgus planeeritud maapinnast arvutatakse sama krundi lähima orienteeruva kõrgusmärgi järgi. Joonised ei määra lõplikku arhitektuurset katusekuju ega tulevase maapinna täpset pinda.
- Olemasoleva hoone kõrguseks võetakse ETAK-i positiivne korgus_m väärtus. Puuduva või vigase väärtuse korral kuvatakse ainult hoone kontuur. Teadmata kõrgustele oletuslikke väärtusi ei lisata.
- Tehnovõrkude ja mõjuala joonis seotakse põhijoonisega ühiste krundipolügoonide kaudu. Kahe suurima krundi keskpunktid määravad sarnasusteisenduse; ülejäänud 29 krundi keskpunktidega kontrollitakse asukohta. Jooniste legendid, kirjanurgad ja üldplaneeringu väljavõte jäetakse geograafilistest kihtidest välja. Nii säilib jooniste tegelik geomeetria ja kontrollitav paigutus. Võrgutrassidele ei omistata joonisel puuduvat sügavust.
- 3D-hooned on joonisel kujutatud hoonealuste pindade ja lubatud parapetikõrguste põhjal loodud tinglikud mahud, mitte kinnitatud arhitektuursed lahendused. Maapinna orienteeruv kõrgus võetakse sama krundi lähimast planeeritud kõrgusmärgist.
- Olemasolevate hoonete, ortofotode ja reljeefi vaatlusajad erinevad. Andmed laaditi alla 26.10.2026; nende vastavust tänasele olukorrale pole kohapeal kontrollitud. Teadmata kõrgusega hooned kuvatakse tasapinnaliste kontuuridena.
- Korralduse kokkuvõttes on 21 ehitatavat krunti, põhijoonisel aga 24 elamu- või ärikrunti. Pos 14 lubab kahte hoonet, kuid kujutab üht ühendatud kontuuri. Vaade järgib esitatud joonist ega lahenda dokumentide erinevusi. Joonise kruntide kogupindala on 10,18 ha, seletuskiri kirjeldab 10,9 ha suurust ala.
- Korraldusega nr 737 võeti planeering vastu ja suunati avalikule väljapanekule 26.10.–09.11.2026. See ei tähenda planeeringu kehtestamist.
- Reljeefi kuvamiseks on ametlikust maapinnamudelist võetud 5 m sammuga kõrgused. Planeeritud hoonete maapinnakõrgused põhinevad joonise orienteeruvatel kõrgusmärkidel. Kavandatud pinnasetöid, katusekaldeid, fassaade ja taimestiku ruumkuju pole modelleeritud.
- Esitatud planeeringujooniste taaskasutustingimusi pole eraldi kontrollitud. Viited autorile AB Artes Terrae OÜ ja Tartu Linnavalitsusele on säilitatud.
- Tehnovõrgud ning mõjuala liikumissuunad, bussipeatused ja maakasutuse märkused on taastatud 17.09.2026 PDF-joonistelt. Võrkude sügavusi pole määratud; mõjuala kirjeldused ei kinnita tänast maakasutust ega bussiliiklust. OSM-vektoraluskaart vajab internetiühendust.

[Project, sources and definitions](project.yaml)
 · [Validation report](validation/latest-report.json)
