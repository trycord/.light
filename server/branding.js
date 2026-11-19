// .light — merges customer white-label config with the mandatory, immutable watermark.
import config from './config.js';
import { publicWatermark, softwareIdentification } from './watermark.js';

// White-label settings are customer-controlled appearance only.
function whiteLabel() {
  return {
    product: config.brand.product,
    logo: config.brand.logo,
    wordmark: config.brand.wordmark,
    favicon: config.brand.favicon,
    background: config.brand.background,
    primaryColor: config.brand.primaryColor,
    accentColor: config.brand.accentColor,
    mark: config.brand.mark,
    tagline: config.brand.tagline,
    docTitle: config.brand.docTitle,
    supportEmail: config.brand.supportEmail,
    domain: config.platformDomain,
    signupEnabled: config.allowSignup,
  };
}

export function publicBranding() {
  return {
    ...whiteLabel(),
    // Mandatory watermark is appended last so white-label cannot overwrite it.
    watermark: publicWatermark(),
    identity: softwareIdentification(),
  };
}
