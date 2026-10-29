import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { analyticsPlugin } from './vite-analytics.mjs';

const source = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
test('shared source changes require updating each canonical build input pin', () => {
  const pin = createHash('sha256').update(source).update(readFileSync(new URL('./vite-analytics.mjs', import.meta.url))).digest('hex');
  for (const site of ['tallinn-transit', 'pv-location', 'toompea-3d', 'battlefield-visibility']) {
    const config = readFileSync(new URL(`../${site}/vite.config.js`, import.meta.url), 'utf8');
    assert(config.includes(`analyticsPlugin('${site}', '${pin}')`));
    assert.throws(() => analyticsPlugin(site, 'old-pin'), /analytics source pin/);
  }
});
function boot(options = {}) {
  const scripts = [], listeners = {}, values = new Map();
  const navigator = { onLine: true, webdriver: false, userAgent: 'Mozilla/5.0 Chrome/145', ...options.navigator };
  const document = {
    currentScript: { dataset: { site: options.site || 'tallinn-transit', release: 'abc123' } },
    referrer: '', head: { append: s => scripts.push(s) }, createElement: () => ({}),
    querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const href = options.href || 'https://jaakla.github.io/openmapstack-samples/tallinn-transit/?address=SECRET#59.4,24.7';
  if (options.offline) values.set('tallinn-mode', 'offline');
  const window = {};
  const context = vm.createContext({ window, document, navigator, location: new URL(href), URL,
    localStorage: { getItem: key => values.get(key) || null }, performance: { now: () => 123 },
    setTimeout: () => 0, MutationObserver: class { observe() {} disconnect() {} },
  });
  vm.runInContext(source, context);
  return { window, context, scripts, listeners, navigator, values, config: window.posthog?._i[0][1] };
}

test('development, automation, privacy preferences and offline mode never load the SDK', () => {
  for (const options of [
    { href: 'http://localhost:5177/' }, { href: 'https://other.example/openmapstack-samples/' },
    { href: 'https://jaakla.github.io/another-repo/' }, { navigator: { webdriver: true } },
    { navigator: { onLine: false } }, { navigator: { doNotTrack: '1' } },
    { navigator: { globalPrivacyControl: true } }, { offline: true },
  ]) {
    const result = boot(options);
    assert.equal(result.scripts.length, 0);
    result.window.omsAnalytics.track('map_ready');
    assert.equal(result.window.posthog, undefined);
  }
});

test('production SDK uses EU, replay off, web vitals on and no automatic input collection', () => {
  const { scripts, config, context } = boot();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.equal(config.api_host, 'https://eu.i.posthog.com');
  assert.equal(config.autocapture, false);
  assert.equal(config.disable_session_recording, true);
  assert.equal(config.capture_performance.web_vitals, true);
  assert.equal(config.capture_performance.network_timing, false);
  assert.equal(config.person_profiles, 'never');
  vm.runInContext(source, context);
  assert.equal(scripts.length, 1);
});

test('outbound payloads remove query strings, coordinates, input and nested DOM data', () => {
  const { config } = boot();
  const event = config.before_send({ event: 'route_search_completed', properties: {
    token: 'public', distinct_id: 'anonymous', status: 'success', result_count: 3,
    address: 'SECRET', lat: 59.4, lon: 24.7, arbitrary: { secret: 'SECRET' },
    $current_url: 'https://jaakla.github.io/openmapstack-samples/tallinn-transit/?q=SECRET#coords',
    $session_entry_url: 'https://jaakla.github.io/openmapstack-samples/?address=SECRET',
    $referrer: 'https://search.example/path?search=SECRET',
    $set: { address: 'SECRET' }, $web_vitals_LCP_event: { element: 'SECRET' },
  } });
  assert.equal(event.properties.site, 'tallinn-transit');
  assert.equal(event.properties.status, 'success');
  assert.equal(event.properties.distinct_id, 'anonymous');
  assert.equal(event.properties.$referrer, 'https://search.example/');
  assert.doesNotMatch(JSON.stringify(event), /SECRET|coords|"lat"|"lon"|\$set/);
  assert.equal(config.before_send({ event: '$autocapture', properties: {} }), null);
});

test('web vitals retain numeric metrics without leaking resource and DOM details', () => {
  const { config } = boot();
  const event = config.before_send({ event: '$web_vitals', properties: { $web_vitals_LCP_value: 1250,
    $web_vitals_FCP_value: 300, $web_vitals_CLS_value: 0.1, $web_vitals_INP_value: 42,
    $web_vitals_LCP_event: { url: 'https://example.com/?address=SECRET' } } });
  assert.equal(event.properties.$web_vitals_LCP_value, 1250);
  assert.equal(event.properties.$web_vitals_CLS_value, 0.1);
  assert.doesNotMatch(JSON.stringify(event), /SECRET/);
});

test('readiness is emitted once; offline transitions suppress further captures', () => {
  const { window, values, config } = boot();
  window.omsAnalytics.once('map_ready', { duration_ms: 123 });
  window.omsAnalytics.once('map_ready', { duration_ms: 456 });
  assert.equal(window.posthog.filter(row => row[0] === 'capture' && row[1] === 'map_ready').length, 1);
  values.set('tallinn-mode', 'offline');
  assert.equal(config.before_send({ event: '$pageleave', properties: {} }), null);
});

test('blocked analytics cannot break interactions or grow the SDK queue', () => {
  const { window, scripts } = boot();
  scripts[0].onerror();
  for (let i = 0; i < 100; i++) window.omsAnalytics.track('route_search_completed', { status: 'success' });
  assert.equal(window.posthog.length, 0);
});

test('every allowed event explicitly disables person processing after sanitization', () => {
  const { config } = boot();
  for (const flag of [undefined, true, false]) {
    const properties = flag === undefined ? {} : { $process_person_profile: flag };
    for (const event of ['$pageview', '$pageleave', '$web_vitals', 'map_ready', 'route_search_completed']) {
      assert.equal(config.before_send({ event, properties }).properties.$process_person_profile, false);
    }
  }
});


test('gallery exits send immediately without changing batching of ordinary activity', () => {
  const { window } = boot({site: 'gallery'});
  window.omsAnalytics.track('demo_opened', {target_site: 'tallinn-transit'});
  const options = window.posthog.at(-1)[3];
  assert.equal(options.transport, 'sendBeacon');
  assert.equal(options.send_instantly, true);
  window.omsAnalytics.track('feature_used', {feature: 'stops'});
  assert.equal(window.posthog.at(-1)[3], undefined);
});
