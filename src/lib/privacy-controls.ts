import { PRIVACY_CHANGE_EVENT, readPrivacyPreference, savePrivacyPreference } from './privacy-consent';

/** Native dialog supplies focus containment and Escape; no checkbox is preselected for a new visitor. */
export function bindPrivacyControls(doc: Document, analyticsEnabled: boolean): () => void {
  const banner = doc.getElementById('privacyBanner');
  const dialog = doc.getElementById('privacyDialog') as HTMLDialogElement | null;
  const analytics = doc.getElementById('privacyAnalytics') as HTMLInputElement | null;
  const media = doc.getElementById('privacyMedia') as HTMLInputElement | null;
  if (!banner || !dialog || !analytics || !media) return () => {};
  let returnFocus: HTMLElement | null = null;
  const refresh = () => { banner.hidden = !!readPrivacyPreference(); };
  const close = () => { dialog.close(); returnFocus?.focus(); };
  const save = (choices: { analytics: boolean; externalMedia: boolean }) => {
    if (dialog.open) close();
    // Hide before dispatching; GTM retraction may immediately navigate.
    banner.hidden = true;
    savePrivacyPreference({ analytics: choices.analytics && analyticsEnabled, externalMedia: choices.externalMedia });
  };
  const open = (trigger?: HTMLElement) => {
    const current = readPrivacyPreference();
    analytics.checked = analyticsEnabled && current?.analytics === true;
    media.checked = current?.externalMedia === true;
    returnFocus = trigger || (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
    if (!dialog.open) dialog.showModal();
  };
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;
    if (target.hasAttribute('data-privacy-settings')) open(target);
    else if (target.hasAttribute('data-privacy-accept')) save({ analytics: analyticsEnabled, externalMedia: true });
    else if (target.hasAttribute('data-privacy-reject')) save({ analytics: false, externalMedia: false });
    else if (target.id === 'privacySave') save({ analytics: analytics.checked, externalMedia: media.checked });
    else if (target.id === 'privacyCancel') close();
  };
  const escape = () => { returnFocus?.focus(); };
  const openOnEvent = () => open();
  doc.addEventListener('click', click);
  doc.addEventListener('privacy-settings-open', openOnEvent);
  dialog.addEventListener('close', escape);
  window.addEventListener(PRIVACY_CHANGE_EVENT, refresh);
  refresh();
  return () => {
    doc.removeEventListener('click', click);
    doc.removeEventListener('privacy-settings-open', openOnEvent);
    dialog.removeEventListener('close', escape);
    window.removeEventListener(PRIVACY_CHANGE_EVENT, refresh);
  };
}
