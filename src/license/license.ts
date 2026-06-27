/**
 * License gate for open-core (AGPL-3.0 core + commercial "ee/" premium).
 *
 * The OSS core is fully functional on its own. Premium features live under
 * `ee/` (a commercial license) and are only activated when a valid license key
 * is present. Core code never imports `ee/` directly — it calls through this
 * gate, so the project builds and runs with the premium tree absent.
 */
import { log } from '../lib/logger.js';

/** Premium capabilities. Add entries as ee/ features land. */
export type PremiumFeature =
  | 'llm-summaries'
  | 'fact-extraction'
  | 'semantic-clustering'
  | 'alert-delivery'; // webhook / email dispatch

interface LicenseInfo {
  valid: boolean;
  plan: 'community' | 'pro' | 'enterprise';
  features: Set<PremiumFeature>;
}

const ALL: PremiumFeature[] = ['llm-summaries', 'fact-extraction', 'semantic-clustering', 'alert-delivery'];

let cached: LicenseInfo | null = null;

/**
 * Resolve the active license. For now this is a placeholder that reads
 * NEWSFLIP_LICENSE_KEY; replace the body with real verification (signed JWT,
 * licensing API, etc.) in the ee/ build. Absent/invalid key => community plan.
 */
export function getLicense(): LicenseInfo {
  if (cached) return cached;

  const key = process.env.NEWSFLIP_LICENSE_KEY?.trim();
  if (!key) {
    cached = { valid: false, plan: 'community', features: new Set() };
    return cached;
  }

  // TODO(ee): verify signature/expiry against the licensing service.
  // Placeholder: any non-empty key unlocks all premium features locally.
  log.info('Premium license key detected — enabling ee features');
  cached = { valid: true, plan: 'enterprise', features: new Set(ALL) };
  return cached;
}

export function isPremiumEnabled(feature: PremiumFeature): boolean {
  return getLicense().features.has(feature);
}

/** Test helper to reset the memoized license. */
export function __resetLicenseCache(): void {
  cached = null;
}
