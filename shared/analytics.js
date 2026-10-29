/* Optional PostHog RUM for public GitHub Pages. No application depends on it. */
(() => {
  'use strict';
  if (window.omsAnalytics) return;
  const token = 'phc_xD88zcSqjcjF2znkMUib6vjghN4CmLpn7CJz3kScQKNz';
  const host = 'https://eu.i.posthog.com';
  const prefix = '/openmapstack-samples/';
  const sites = new Set(['gallery', 'tallinn-transit', 'pv-location', 'toompea-3d', 'battlefield-visibility', 'detailplaneering']);
  const script = document.currentScript;
  const site = script?.dataset.site || 'gallery';
  const release = script?.dataset.release || 'unversioned';
  const once = new Set();
  const events = new Set(['app_ready', 'map_ready', 'planner_ready', 'route_search_completed', 'calculation_completed', 'demo_opened', 'feature_used']);
  const fields = new Set(['duration_ms', 'result_count', 'status', 'arrive_by', 'mode', 'target_site', 'feature', 'initial']);
  const enums = new Set(['success', 'error', 'no_results', 'all', 'bus', 'tram', 'train', 'scenario', 'evidence', 'validate', 'journey', 'routes', 'stops', 'sources', 'measure', 'section', 'solar', ...sites, 'tartu-bridges', 'urban-heat']);
  function permitted() {
    try {
      return location.protocol === 'https:' && location.hostname === 'jaakla.github.io'
        && (location.pathname === '/openmapstack-samples' || location.pathname.startsWith(prefix))
        && sites.has(site) && navigator.onLine !== false && !navigator.webdriver
        && !/bot|crawler|spider|headless|playwright|lighthouse/i.test(navigator.userAgent)
        && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl
        && !(site === 'tallinn-transit' && localStorage.getItem('tallinn-mode') === 'offline');
    } catch { return false; }
  }
  function safeURL(value, external = false) {
    try {
      if (!value) return '';
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return '';
      // Referring domain is enough for attribution; paths may contain user input.
      return external ? url.origin + '/' : url.origin + url.pathname;
    } catch { return ''; }
  }
  function cleanProperties(properties) {
    const clean = {};
    for (const [key, value] of Object.entries(properties || {})) {
      if (!fields.has(key)) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) clean[key] = Math.round(value * 100) / 100;
      else if (typeof value === 'boolean') clean[key] = value;
      else if (typeof value === 'string' && enums.has(value)) clean[key] = value;
    }
    return clean;
  }
  function beforeSend(event) {
    if (!permitted() || !event || !new Set(['$pageview', '$pageleave', '$web_vitals', ...events]).has(event.event)) return null;
    const properties = event.properties || {}, clean = cleanProperties(properties);
    const technical = /^(?:token|distinct_id|\$(?:device_id|session_id|window_id|lib|lib_version|browser|browser_version|browser_language|os|os_version|device_type|screen_width|screen_height|viewport_width|viewport_height|is_identified|time|referring_domain|session_entry_host|session_entry_pathname|web_vitals_[A-Z]+_value|web_vitals_pageview_id|pageview_id))$/;
    for (const [key, value] of Object.entries(properties)) {
      if (technical.test(key) && ['string', 'number', 'boolean'].includes(typeof value)) clean[key] = value;
    }
    clean.$current_url = safeURL(properties.$current_url || location.href) || safeURL(location.href);
    clean.$host = location.host;
    clean.$pathname = new URL(clean.$current_url).pathname;
    for (const key of ['$referrer', '$initial_referrer', '$session_entry_referrer']) {
      if (properties[key]) clean[key] = safeURL(properties[key], true);
    }
    if (properties.$session_entry_url) clean.$session_entry_url = safeURL(properties.$session_entry_url);
    clean.site = site; clean.environment = 'production'; clean.release = release;
    clean.$process_person_profile = false;
    return { ...event, properties: clean };
  }
  function track(name, properties = {}, onlyOnce = false) {
    try {
      if (!permitted() || !events.has(name) || (onlyOnce && once.has(name))) return;
      if (onlyOnce) once.add(name);
      const options = name === 'demo_opened' ? { transport: 'sendBeacon', send_instantly: true } : undefined;
      window.posthog?.capture(name, cleanProperties(properties), options);
    } catch { /* Analytics must never interrupt a rider flow or calculation. */ }
  }
  window.omsAnalytics = { track, once: (name, properties) => track(name, properties, true), site };
  if (!permitted()) return;

  // Minimal version of PostHog's documented async snippet: queue until SDK loads.
  const posthog = window.posthog = window.posthog || [];
  if (!posthog.__SV) {
    posthog._i = [];
    posthog.init = (key, config) => posthog._i.push([key, config, 'posthog']);
    for (const method of ['capture', 'register']) posthog[method] = (...args) => posthog.push([method, ...args]);
    posthog.__SV = 1;
    const sdk = document.createElement('script');
    sdk.async = true; sdk.crossOrigin = 'anonymous';
    sdk.src = 'https://eu-assets.i.posthog.com/static/array.js';
    sdk.onerror = () => { posthog.length = 0; posthog.capture = () => {}; };
    document.head.append(sdk);
  }
  posthog.init(token, {
    api_host: host, defaults: '2026-08-30',
    autocapture: false, capture_pageview: false, capture_pageleave: true,
    capture_performance: { web_vitals: true, network_timing: false },
    disable_session_recording: true, disable_surveys: true,
    capture_heatmaps: false, capture_dead_clicks: false, capture_exceptions: false,
    enable_recording_console_log: false, rageclick: false, person_profiles: 'never',
    persistence: 'localStorage', cross_subdomain_cookie: false, disableDeviceModel: true,
    save_campaign_params: false, advanced_disable_flags: true, remote_config_refresh_interval_ms: 0,
    before_send: beforeSend,
  });
  posthog.register({ site, environment: 'production', release });
  posthog.capture('$pageview', { $current_url: safeURL(location.href), $referrer: safeURL(document.referrer, true) });

  // The static, independently verified planning atlas exposes readiness in text.
  // Observe only until ready; no polling, coordinates, DOM content or recordings.
  const isReady = () => site === 'gallery' ? !!document.querySelector('main h1')
    : site === 'detailplaneering' && /ümbruskonna hoonet/.test(document.querySelector('.map-heading span')?.textContent || '');
  function readiness() {
    if (!isReady()) return false;
    window.omsAnalytics.once(site === 'gallery' ? 'app_ready' : 'map_ready', { duration_ms: performance.now() });
    return true;
  }
  if (!readiness() && site === 'detailplaneering') {
    const observer = new MutationObserver(() => { if (readiness()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer.disconnect(), 60000);
  }
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('[role="tab"]');
    const feature = { Teekond: 'journey', Liinid: 'routes', Peatused: 'stops', Info: 'sources', Scenario: 'scenario', Evidence: 'evidence', Validate: 'validate' }[tab?.textContent.trim()];
    if (feature) track('feature_used', { feature });
    const link = event.target.closest?.('a[href]');
    if (site === 'gallery' && link) {
      const url = new URL(link.href), target = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length).split('/')[0]
        : url.hostname === 'tartu-sillad.jaak-laineste.workers.dev' ? 'tartu-bridges'
        : url.hostname === 'urban-heat-dashboard.jaak-laineste.workers.dev' ? 'urban-heat' : null;
      if (target && enums.has(target)) track('demo_opened', { target_site: target });
    }
  });
})();
