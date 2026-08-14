export const SITE_BASELINE_SPEED = 1.2;
export const DEFAULT_ENCODED_SPEED = 1.4;
export const AUDIO_PLAYBACK_RATES = [1, 1.2, 1.5, 1.8, 2] as const;

export type AudioPlaybackRate = (typeof AUDIO_PLAYBACK_RATES)[number];

export function validAudioPlaybackRate(value: number): AudioPlaybackRate {
  return AUDIO_PLAYBACK_RATES.includes(value as AudioPlaybackRate)
    ? value as AudioPlaybackRate
    : 1;
}

export function siteSecondsFromEncodedSeconds(
  encodedSeconds: number,
  encodedSpeed = DEFAULT_ENCODED_SPEED,
) {
  return encodedSeconds * encodedSpeed / SITE_BASELINE_SPEED;
}

export function encodedSecondsFromSiteSeconds(
  siteSeconds: number,
  encodedSpeed = DEFAULT_ENCODED_SPEED,
) {
  return siteSeconds * SITE_BASELINE_SPEED / encodedSpeed;
}

export function transportPlaybackRate(
  userRate: number,
  encodedSpeed = DEFAULT_ENCODED_SPEED,
) {
  return userRate * SITE_BASELINE_SPEED / encodedSpeed;
}

/** Convert canonical M4A/SRC timeline seconds to the player's 1.2x site timeline. */
export function siteSecondsFromSourceSeconds(sourceSeconds: number) {
  return sourceSeconds / SITE_BASELINE_SPEED;
}

/** Convert the player's 1.2x site timeline back to canonical M4A/SRC seconds. */
export function sourceSecondsFromSiteSeconds(siteSeconds: number) {
  return siteSeconds * SITE_BASELINE_SPEED;
}
