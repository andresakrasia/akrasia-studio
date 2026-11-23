import React from 'react';
import { createRoot } from 'react-dom/client';
import VideoModalListener from '../src/components/VideoModalListener';
import { bindPrivacyControls } from '../src/lib/privacy-controls';
import { initializePrivacyRuntime, PRIVACY_STORAGE_KEY, PRIVACY_CHANGE_EVENT, PRIVACY_TTL_MS, readPrivacyPreference } from '../src/lib/privacy-consent';

declare global { interface Window { __syntheticTagExecutions?: number; __privacyBrowserResult?: { assertions: number; failures: string[]; requests: string[]; frames: string[]; reloads: number }; } }
const results = document.getElementById('results')!;
let assertions = 0, reloads = 0;
const failures: string[] = [], requests: string[] = [], frames: string[] = [];
const ok = (value: unknown, text: string) => { assertions++; if (!value) failures.push(text); };
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;
const dialog = document.getElementById('privacyDialog') as HTMLDialogElement;
const banner = document.getElementById('privacyBanner')!;
const dispatchStorage = (raw: string | null) => {
  if (raw === null) localStorage.removeItem(PRIVACY_STORAGE_KEY); else localStorage.setItem(PRIVACY_STORAGE_KEY, raw);
  window.dispatchEvent(new StorageEvent('storage', { key: PRIVACY_STORAGE_KEY, newValue: raw, storageArea: localStorage }));
};
// Any production GTM/frame target is recorded and replaced BEFORE insertion. CSP
// independently forbids external requests if the interception regresses.
const append = document.head.append.bind(document.head);
document.head.append = (...nodes: (Node | string)[]) => {
  for (const node of nodes) if (node instanceof HTMLScriptElement && node.src.includes('googletagmanager.com')) {
    requests.push(node.src); node.src = '/mock-gtm.js';
  }
  append(...nodes);
};
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(name: string, value: string) {
  if (this instanceof HTMLIFrameElement && name === 'src' && /^https:\/\//.test(value)) { frames.push(value); value = '/mock-video'; }
  setAttribute.call(this, name, value);
};

async function run() {
  localStorage.removeItem(PRIVACY_STORAGE_KEY);
  const stop = initializePrivacyRuntime({ analyticsEnabled: true, containerId: 'GTM-SYNTHETIC' },
    { win: window, doc: document, reload: () => { reloads++; } });
  bindPrivacyControls(document, true);
  const root = createRoot(document.getElementById('videoFixture')!);
  root.render(<VideoModalListener />);
  await wait();
  ok(requests.length === 0, 'No analytics request on first visit');
  ok(!banner.hidden, 'First visit banner visible');
  ok(document.querySelectorAll('iframe').length === 0, 'No third-party frame on navigation');
  for (const raw of ['broken', JSON.stringify({ version: 0, updatedAt: Date.now(), analytics: true, externalMedia: true }),
    JSON.stringify({ version: 1, updatedAt: Date.now() - PRIVACY_TTL_MS, analytics: true, externalMedia: true }),
    JSON.stringify({ version: 1, updatedAt: Date.now(), analytics: 'true', externalMedia: false })]) {
    dispatchStorage(raw); ok(requests.length === 0, 'Corrupt/old values cannot load tags'); ok(!banner.hidden, 'Invalid preference asks again');
  }
  dispatchStorage(null);
  button('[data-privacy-reject]').click();
  ok(requests.length === 0, 'Reject causes no analytics request');
  ok(readPrivacyPreference()?.analytics === false && readPrivacyPreference()?.externalMedia === false, 'Reject persists both optional denials');
  ok(banner.hidden, 'Valid rejection hides banner');
  button('#privacyPersistentControl').click();
  ok(dialog.open, 'Settings remain accessible after rejection');
  ok(!checkbox('privacyAnalytics').checked && !checkbox('privacyMedia').checked, 'Rejected categories remain unchecked');
  ok(dialog.contains(document.activeElement), 'Native dialog moves focus inside');
  const stored = localStorage.getItem(PRIVACY_STORAGE_KEY);
  checkbox('privacyAnalytics').checked = true;
  button('#privacyCancel').click();
  await wait(); // The native close event returns focus after leaving the top layer.
  ok(localStorage.getItem(PRIVACY_STORAGE_KEY) === stored, 'Closing without saving leaves choice intact');
  ok(document.activeElement?.id === 'privacyPersistentControl', 'Focus returns to opener');
  document.dispatchEvent(new CustomEvent('video-open', { detail: { id: 'synthetic-project', title: 'Vídeo ficticio', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } }));
  await wait();
  ok(!document.querySelector('iframe'), 'Opening a video before media consent makes no frame');
  ok(document.body.textContent?.includes('permite los vídeos externos'), 'Video explains provider before loading');
  document.querySelector<HTMLButtonElement>('[aria-label="Cerrar vídeo"]')!.click();
  button('[data-privacy-accept]').click();
  await wait();
  const onDashboard = window.location.pathname.startsWith('/dashboard');
  ok(requests.length === (onDashboard ? 0 : 1), 'Accept loads reviewed tag once, dashboard never does');
  if (!onDashboard) ok(window.__syntheticTagExecutions === 1, 'Only local mock tag executed');
  ok(readPrivacyPreference()?.analytics && readPrivacyPreference()?.externalMedia, 'Accept persists explicit optional choice');
  button('[data-privacy-accept]').click();
  ok(requests.length === (onDashboard ? 0 : 1), 'Repeated accept does not duplicate tag');
  document.dispatchEvent(new CustomEvent('video-open', { detail: { id: 'synthetic-project', title: 'Vídeo ficticio', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } }));
  await wait();
  ok(document.querySelector('iframe')?.src.endsWith('/mock-video'), 'Consented provider replaced by local simulated video');
  ok(frames[0]?.startsWith('https://www.youtube-nocookie.com/'), 'YouTube embed uses restricted nocookie target');
  document.dispatchEvent(new CustomEvent('privacy-settings-open'));
  checkbox('privacyMedia').checked = false;
  button('#privacySave').click();
  await wait();
  ok(!document.querySelector('iframe'), 'Withdrawing media removes active frame immediately');
  ok(readPrivacyPreference()?.analytics === true && readPrivacyPreference()?.externalMedia === false, 'Media choice independent of analytics');
  document.querySelector<HTMLButtonElement>('[aria-label="Cerrar vídeo"]')!.click();
  button('#privacyPersistentControl').click();
  button('#privacyDialog [data-privacy-reject]').click();
  ok(reloads === (onDashboard ? 0 : 1), 'Withdrawing loaded tags requests full reload');
  ok(!document.getElementById('akrasia-consented-analytics'), 'Tag element removed on withdrawal');
  ok(readPrivacyPreference()?.analytics === false, 'Denied choice saved before reload');
  stop();
  const resume = initializePrivacyRuntime({ analyticsEnabled: true, containerId: 'GTM-SYNTHETIC' },
    { win: window, doc: document, reload: () => { reloads++; } });
  ok(requests.length === (onDashboard ? 0 : 1), 'Reinitialization after withdrawal stays blocked');
  dispatchStorage(JSON.stringify({ version: 1, updatedAt: Date.now(), analytics: false, externalMedia: true }));
  document.dispatchEvent(new CustomEvent('video-open', { detail: { id: 'synthetic-project', title: 'Vídeo ficticio', videoUrl: 'https://evil.invalid/arbitrary-frame' } }));
  await wait();
  ok(!document.querySelector('iframe'), 'Arbitrary provider never becomes an iframe even with media choice');
  document.querySelector<HTMLButtonElement>('[aria-label="Cerrar vídeo"]')!.click();
  dispatchStorage(null);
  ok(!banner.hidden, 'Storage deletion in another tab reopens choice');
  resume();
  const storeSet = Storage.prototype.setItem;
  try {
    localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), analytics: true, externalMedia: true }));
    Storage.prototype.setItem = function() { throw new DOMException('Synthetic storage full', 'QuotaExceededError'); };
    button('[data-privacy-reject]').click();
    ok(readPrivacyPreference()?.analytics === false, 'Failed persistence keeps current withdrawal in memory');
    ok(localStorage.getItem(PRIVACY_STORAGE_KEY) === null, 'Failed withdrawal write removes older accepted authority');
  } finally { Storage.prototype.setItem = storeSet; }
  // Leave fresh denied state and working production dialog for manual keyboard/mobile checks.
  button('[data-privacy-reject]').click();
  window.__privacyBrowserResult = { assertions, failures, requests, frames, reloads };
  results.textContent = failures.length ? `FAIL (${failures.length}/${assertions})\n${failures.join('\n')}` : `PASS · ${assertions} comprobaciones\nSin proveedores reales. ${requests.length} etiqueta(s) simulada(s), ${frames.length} vídeo(s) simulado(s).\nConfiguración disponible para teclado y móvil.`;
}
if (new URL(location.href).searchParams.has('firstvisit') || new URL(location.href).searchParams.has('manual')) {
  if (new URL(location.href).searchParams.has('firstvisit')) localStorage.removeItem(PRIVACY_STORAGE_KEY);
  const report = () => {
    const choice = readPrivacyPreference();
    results.textContent = `Prueba manual ficticia.\nElección: ${choice ? choice.analytics ? 'analítica permitida' : 'analítica rechazada' : 'sin elegir'}.\nSolicitudes de etiqueta simuladas: ${requests.length}. Reinicios solicitados: ${reloads}.\nEtiqueta activa: ${!!document.getElementById('akrasia-consented-analytics')}. Proveedores reales bloqueados.`;
  };
  initializePrivacyRuntime({ analyticsEnabled: true, containerId: 'GTM-SYNTHETIC' }, { win: window, doc: document, reload: () => { reloads++; report(); } });
  bindPrivacyControls(document, true);
  window.addEventListener(PRIVACY_CHANGE_EVENT, report);
  report();
} else run().catch(error => { results.textContent = `FAIL · ${String(error)}`; });
