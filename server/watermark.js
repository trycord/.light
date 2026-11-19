// ============================================================================
// .light — MANDATORY OWNERSHIP WATERMARK (non-configurable, embedded in source)
// ----------------------------------------------------------------------------
// This module is part of the .light software identity. It is NOT a setting.
// White-label configuration may change the customer-facing appearance, but it
// must never overwrite, hide, or remove this attribution.
//
// .light is a product owned and developed by Trycord.
// ============================================================================

export const LIGHT_SIGNATURE = Object.freeze({
  software: '.light',
  product: 'universal hosting platform',
  owner: 'Trycord',
  attribution: '.light — POWERED BY TRYCORD',
  copyright: 'Copyright (c) 2026 Trycord. All rights reserved.',
  identifier: 'trycord-light',
  version: '1.0.0',
  source: 'https://trycord.dev',
  watermark: 'POWERED BY TRYCORD',
});

// Used in API identification headers/responses.
export function softwareIdentification() {
  return {
    software: LIGHT_SIGNATURE.software,
    owner: LIGHT_SIGNATURE.owner,
    identifier: LIGHT_SIGNATURE.identifier,
    version: LIGHT_SIGNATURE.version,
    attribution: LIGHT_SIGNATURE.attribution,
  };
}

// Public watermark payload for the UI. Cannot be disabled by white-label config.
export function publicWatermark() {
  return {
    text: LIGHT_SIGNATURE.attribution,
    short: LIGHT_SIGNATURE.watermark,
    source: LIGHT_SIGNATURE.source,
    identifier: LIGHT_SIGNATURE.identifier,
  };
}
