/**
 * Hand-drawn inline SVG icons for the HUD. Flat colours with a dark outline so they stay readable
 * at small sizes over a busy 3D scene. No gradients (ids would clash when an icon is repeated).
 */
const O = '#1a0f08';
const S = `stroke="${O}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
const wrap = (body: string) => `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  lettuce: wrap(
    `<path ${S} fill="#3f9a2c" d="M24 43c-9 0-17-6-17-15 0-6 3-9 6-11-1-5 3-9 8-8 2-4 8-4 10 0 5-1 9 3 8 8 3 2 6 5 6 11 0 9-8 15-17 15z"/>` +
      `<path fill="#7ad04a" d="M24 40c-6 0-12-4-12-11 0-4 2-7 5-8 0-4 3-6 7-5 2-3 6-2 7 1 3 0 5 3 4 6 2 2 3 4 3 6 0 7-7 11-14 11z"/>` +
      `<path fill="none" stroke="#d8f5a0" stroke-width="2" stroke-linecap="round" d="M24 40V18M24 30l-6-6M24 26l6-6M24 34l7-5"/>`,
  ),
  bread: wrap(
    `<path ${S} fill="#d58a32" d="M8 22c0-8 7-12 16-12s16 4 16 12c0 2-1 3-3 4v12c0 2-1 3-3 3H14c-2 0-3-1-3-3V26c-2-1-3-2-3-4z"/>` +
      `<path fill="#f4cf8a" d="M14 27h20v10H14z"/>` +
      `<path fill="none" stroke="#a85a18" stroke-width="2" stroke-linecap="round" d="M16 16l3 4M23 14l2 5M30 15l1 5"/>`,
  ),
  tomato: wrap(
    `<circle ${S} cx="24" cy="27" r="15" fill="#e2321e"/>` +
      `<ellipse cx="18" cy="22" rx="4" ry="3" fill="#ff8a6a"/>` +
      `<path ${S} fill="#3f9a2c" d="M24 13l-7-3 4 5-6 2 7 1 2 5 2-5 7-1-6-2 4-5z"/>`,
  ),
  potato: wrap(
    `<path ${S} fill="#c8954a" d="M10 30c-3-8 3-17 13-19 9-2 16 2 17 9 1 8-5 16-15 17-7 1-13-1-15-7z"/>` +
      `<path fill="#e4b874" d="M14 27c-1-6 4-11 10-12 5-1 9 1 10 5-5 0-14 2-20 7z"/>` +
      `<circle cx="18" cy="31" r="1.6" fill="#7a5222"/><circle cx="29" cy="26" r="1.6" fill="#7a5222"/><circle cx="25" cy="34" r="1.4" fill="#7a5222"/><circle cx="33" cy="20" r="1.3" fill="#7a5222"/>`,
  ),
  pasta: wrap(
    `<path ${S} fill="#f0f0f4" d="M5 30h38c0 7-8 12-19 12S5 37 5 30z"/>` +
      `<path fill="none" stroke="#f3cf5a" stroke-width="2.4" stroke-linecap="round" d="M10 29c2-6 6-4 8-8s6-6 9-2 7 3 9 0 5 4 3 10M14 29c3-3 5-1 7-5s5-1 7 1 4 0 6 4"/>` +
      `<path fill="none" stroke="${O}" stroke-width="1.4" d="M10 29c2-6 6-4 8-8s6-6 9-2 7 3 9 0 5 4 3 10"/>` +
      `<path ${S} fill="#9aa0aa" d="M33 6l-2 15M37 7l-4 15"/>`,
  ),
  steak: wrap(
    `<path ${S} fill="#a8322a" d="M8 25c0-9 9-15 19-14 9 1 14 7 13 14-1 8-8 13-17 13-9 0-15-5-15-13z"/>` +
      `<path fill="none" stroke="#f3e0c8" stroke-width="3" stroke-linecap="round" d="M14 23c3-5 9-7 15-5"/>` +
      `<path fill="none" stroke="#5a120c" stroke-width="2" stroke-linecap="round" d="M15 30l6-6M21 33l9-9M28 33l6-6"/>`,
  ),
  beef: wrap(
    `<rect ${S} x="6" y="15" width="36" height="20" rx="10" fill="#8a2a22"/>` +
      `<ellipse ${S} cx="34" cy="25" rx="7" ry="9" fill="#d4504a"/>` +
      `<ellipse cx="34" cy="25" rx="3.5" ry="5" fill="#f08a80"/>` +
      `<path fill="none" stroke="#f3e0c8" stroke-width="1.6" d="M12 18v14M18 17v16M24 17v16"/>`,
  ),
  mushroom: wrap(
    `<path ${S} fill="#efe3cc" d="M19 26h10l2 14c0 2-2 3-7 3s-7-1-7-3z"/>` +
      `<path ${S} fill="#9a5a30" d="M6 26C6 15 14 7 24 7s18 8 18 19z"/>` +
      `<circle cx="17" cy="16" r="2.5" fill="#d8a070"/><circle cx="29" cy="13" r="2" fill="#d8a070"/><circle cx="33" cy="21" r="2.2" fill="#d8a070"/>`,
  ),
  greens: wrap(
    `<path ${S} fill="#3f9a2c" d="M8 40C12 26 22 12 36 6c2 1 2 2 1 4C26 18 18 30 14 42z"/>` +
      `<path ${S} fill="#5abc38" d="M16 42c5-12 13-22 26-28 1 1 1 3 0 4-11 6-18 16-22 26z"/>` +
      `<circle cx="24" cy="23" r="2" fill="#a8e070"/><circle cx="29" cy="17" r="2" fill="#a8e070"/><circle cx="27" cy="31" r="2" fill="#a8e070"/>`,
  ),
  salt: wrap(
    `<path ${S} fill="#e8eef2" d="M15 18h18l2 22c0 2-1 3-3 3H16c-2 0-3-1-3-3z"/>` +
      `<path ${S} fill="#b8c0c8" d="M16 18c0-7 3-12 8-12s8 5 8 12z"/>` +
      `<circle cx="21" cy="11" r="1.2" fill="${O}"/><circle cx="27" cy="11" r="1.2" fill="${O}"/><circle cx="24" cy="14" r="1.2" fill="${O}"/>` +
      `<path fill="#ffffff" d="M17 22h3v17h-3z" opacity=".8"/>`,
  ),
  knife: wrap(
    `<path ${S} fill="#d8dee6" d="M6 34L32 8c3-1 5 1 4 4L14 38z"/>` +
      `<path fill="#ffffff" d="M10 32L31 11l1 1L12 33z" opacity=".7"/>` +
      `<path ${S} fill="#6a3a1c" d="M14 38l6-6 9 9c1 2-1 4-3 3z"/>` +
      `<circle cx="23" cy="38" r="1.2" fill="#e8c070"/>`,
  ),
  pan: wrap(
    `<ellipse ${S} cx="20" cy="26" rx="15" ry="11" fill="#3a3a44"/>` +
      `<ellipse cx="20" cy="25" rx="11" ry="7.5" fill="#55555f"/>` +
      `<ellipse cx="20" cy="25" rx="5" ry="3.5" fill="#f2c94c"/><ellipse cx="20" cy="25" rx="2.2" ry="1.6" fill="#fff6c0"/>` +
      `<path ${S} fill="#1e1e24" d="M33 22l11-6c2 0 2 2 1 3l-10 7z"/>`,
  ),
  pot: wrap(
    `<path fill="none" stroke="#c8d8e8" stroke-width="2" stroke-linecap="round" d="M17 12c-2-3 2-4 0-7M24 12c-2-3 2-4 0-7M31 12c-2-3 2-4 0-7" opacity=".85"/>` +
      `<path ${S} fill="#9aa4b0" d="M9 18h30v18c0 4-3 6-7 6H16c-4 0-7-2-7-6z"/>` +
      `<rect ${S} x="6" y="15" width="36" height="5" rx="2" fill="#c8d0da"/>` +
      `<path ${S} fill="none" d="M9 24H4M39 24h5"/>` +
      `<path fill="#ffffff" d="M13 22h3v15h-3z" opacity=".4"/>`,
  ),
  fryer: wrap(
    `<rect ${S} x="7" y="20" width="34" height="22" rx="3" fill="#7a828c"/>` +
      `<path fill="#f0b030" d="M10 20h28v5H10z"/>` +
      `<path ${S} fill="none" d="M15 20V8h18v12"/>` +
      `<path fill="none" stroke="${O}" stroke-width="1.5" d="M18 10v10M24 10v10M30 10v10"/>` +
      `<circle cx="15" cy="33" r="2.5" fill="#e04020"/>`,
  ),
  plate: wrap(
    `<ellipse ${S} cx="24" cy="27" rx="20" ry="12" fill="#f4f1ea"/>` +
      `<ellipse cx="24" cy="26" rx="12" ry="6.5" fill="#dcd6ca"/>` +
      `<path fill="none" stroke="#c8a040" stroke-width="1.4" d="M8 27c1 5 7 8 16 8s15-3 16-8" opacity=".9"/>`,
  ),
  bell: wrap(
    `<path ${S} fill="#e8b830" d="M10 34c0-9 6-15 14-15s14 6 14 15z"/>` +
      `<rect ${S} x="6" y="34" width="36" height="5" rx="2" fill="#c89020"/>` +
      `<circle ${S} cx="24" cy="15" r="3" fill="#e8b830"/>` +
      `<path fill="#fff1b0" d="M15 31c0-5 3-8 7-9-2 3-3 6-3 9z"/>`,
  ),
  crate: wrap(
    `<rect ${S} x="6" y="12" width="36" height="28" rx="2" fill="#a86a32"/>` +
      `<path fill="none" stroke="${O}" stroke-width="2" d="M6 21h36M6 31h36M10 12l28 28"/>` +
      `<path fill="#c8884a" d="M8 14h32v6H8z" opacity=".7"/>` +
      `<circle cx="16" cy="9" r="4" ${S} fill="#e2321e"/><circle cx="28" cy="8" r="4" ${S} fill="#7ad04a"/>`,
  ),
  hand: wrap(
    `<path ${S} fill="#f1c6a0" d="M19 26V10c0-2 1-3 3-3s3 1 3 3v12l1-3c0-2 2-3 3-3 2 0 3 1 3 3v1c1-1 2-2 3-2 2 0 3 1 3 3v12c0 7-5 12-12 12-5 0-8-2-11-7l-5-9c-1-2 0-4 2-4 1 0 2 0 3 2z"/>` +
      `<path fill="none" stroke="#ffd23a" stroke-width="2.4" stroke-linecap="round" d="M12 8l3 3M8 15h4M22 1v3"/>`,
  ),
  serve: wrap(
    `<path ${S} fill="#d8dee6" d="M6 34c0-10 8-18 18-18s18 8 18 18z"/>` +
      `<rect ${S} x="3" y="34" width="42" height="5" rx="2" fill="#b0b8c2"/>` +
      `<circle ${S} cx="24" cy="13" r="3" fill="#d8dee6"/>` +
      `<path fill="#ffffff" d="M12 31c1-6 5-10 10-11-3 3-5 7-5 11z" opacity=".8"/>`,
  ),
  devil: wrap(
    `<path ${S} fill="#c8241a" d="M9 4c1 7 3 11 8 13M39 4c-1 7-3 11-8 13"/>` +
      `<path ${S} fill="#d9a628" d="M9 4l5 10 4 2M39 4l-5 10-4 2"/>` +
      `<path ${S} fill="#b8281c" d="M10 22c0-7 6-11 14-11s14 4 14 11c0 9-5 21-14 21S10 31 10 22z"/>` +
      `<path fill="#ffd23a" d="M14 23l8 3-1 3-7-2zM34 23l-8 3 1 3 7-2z"/>` +
      `<path fill="${O}" d="M14 20l9 4M34 20l-9 4" stroke="${O}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path fill="${O}" d="M17 34c4-3 10-3 14 0-4 1-10 1-14 0z"/>` +
      `<path fill="#f4f1ea" d="M19 34l1.5 2 1.5-2zM26 34l1.5 2 1.5-2z"/>`,
  ),
  stone: wrap(
    `<path ${S} fill="#8e8a84" d="M12 22c0-9 5-16 12-16s12 7 12 16c0 10-5 20-12 20s-12-10-12-20z"/>` +
      `<path fill="none" stroke="#5e5a54" stroke-width="2.6" stroke-linecap="round" d="M11 16c-4-3-5-8-3-11M37 16c4-3 5-8 3-11M14 9c-3-3-2-6 0-8M34 9c3-3 2-6 0-8M24 6V1"/>` +
      `<path fill="#5e5a54" d="M16 21h6v2h-6zM26 21h6v2h-6z"/>` +
      `<path fill="none" stroke="#5e5a54" stroke-width="1.6" stroke-linecap="round" d="M24 24v6l-2 1M20 35c3 1 5 1 8 0M30 12l-3 6 2 3M15 30l3 4"/>` +
      `<path fill="#b4b0a8" d="M15 14c2-4 5-6 8-6-3 2-5 5-6 8z"/>`,
  ),
  trident: wrap(
    `<path ${S} fill="#ff8a1e" d="M22 18h4v26h-4z"/>` +
      `<path ${S} fill="#ff8a1e" d="M10 4l3 5v6c0 3 3 5 6 5h10c3 0 6-2 6-5V9l3-5 1 11c0 6-5 10-11 10H19c-6 0-11-4-11-10z"/>` +
      `<path ${S} fill="#ffb03a" d="M24 1l3 6-3 12-3-12z"/>`,
  ),
  trash: wrap(
    `<path ${S} fill="#6a7480" d="M11 14h26l-3 28H14z"/>` +
      `<rect ${S} x="8" y="9" width="32" height="5" rx="2" fill="#8a949e"/>` +
      `<path ${S} fill="none" d="M20 9V6h8v3"/>` +
      `<path fill="none" stroke="#2a3038" stroke-width="2" stroke-linecap="round" d="M19 19l1 18M24 19v18M29 19l-1 18"/>`,
  ),
  warn: wrap(
    `<path ${S} fill="#ff4a2a" d="M24 4l20 38H4z"/><path fill="#fff" d="M22 16h4l-1 14h-2zM22 33h4v4h-4z"/>`,
  ),
  ember: wrap(
    `<path ${S} fill="#ff6a1a" d="M24 4c3 8 12 12 12 24 0 7-5 14-12 14s-12-7-12-14c0-6 3-9 5-12 1 4 3 6 5 6-1-7 0-12 2-18z"/>` +
      `<path fill="#ffd23a" d="M24 22c3 4 6 7 6 11 0 4-3 6-6 6s-6-2-6-6c0-3 2-5 3-7 1 2 2 3 3 3z"/>`,
  ),
  check: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
} as const;

export type IconName = keyof typeof ICONS;

/** Corner ornament (top-left orientation): a bracket with a small barbed spike. */
export function cornerSvg(rot: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><g transform="rotate(${rot} 14 14)">` +
    `<path d="M2 17V8l6-6h9" fill="none" stroke="#ffb03a" stroke-width="2"/>` +
    `<path d="M5 13V9.5L9.5 5H13" fill="none" stroke="#ff6a1a" stroke-width="1.2"/>` +
    `<path d="M2 21l-1.2 3h2.4zM21 2l3-1.2v2.4z" fill="#ffb03a"/>` +
    `<circle cx="8" cy="8" r="1.6" fill="#ffd23a"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Stylised fallback portrait of Gorgon: snake hair, glowing eyes, a permanent scowl. */
export const GORGON_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
<rect width="100" height="100" fill="#2a0e08"/>
<circle cx="50" cy="56" r="44" fill="#5a1a0c" opacity=".6"/>
${[
  'M30 34C18 30 14 18 20 10', 'M40 28C34 16 38 6 46 4', 'M60 28C66 16 62 6 54 4', 'M70 34C82 30 86 18 80 10',
  'M26 46C12 46 6 36 8 26', 'M74 46C88 46 94 36 92 26', 'M50 26C50 14 54 8 60 6',
]
  .map((d) => `<path d="${d}" fill="none" stroke="#1a0f08" stroke-width="9" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#d9a628" stroke-width="6" stroke-linecap="round"/>`)
  .join('')}
<circle cx="20" cy="10" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/><circle cx="46" cy="4" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/>
<circle cx="54" cy="4" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/><circle cx="80" cy="10" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/>
<circle cx="8" cy="26" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/><circle cx="92" cy="26" r="4.5" fill="#d9a628" stroke="#1a0f08" stroke-width="2"/>
<path d="M28 50c0-16 10-24 22-24s22 8 22 24c0 20-10 36-22 36S28 70 28 50z" fill="#d88c5e" stroke="#1a0f08" stroke-width="2.5"/>
<path d="M30 40h40c-4-8-11-12-20-12s-16 4-20 12z" fill="#d9a628"/>
<path d="M34 50l13 4M66 50l-13 4" stroke="#5a2a14" stroke-width="4" stroke-linecap="round"/>
<ellipse cx="41" cy="56" rx="5" ry="3" fill="#d8ff3a"/><ellipse cx="59" cy="56" rx="5" ry="3" fill="#d8ff3a"/>
<circle cx="41" cy="56" r="1.4" fill="#1a0f08"/><circle cx="59" cy="56" r="1.4" fill="#1a0f08"/>
<path d="M44 45l6 4 6-4" fill="none" stroke="#9a4a2a" stroke-width="1.6"/>
<path d="M48 58l-2 9h7" fill="none" stroke="#9a4a2a" stroke-width="2" stroke-linecap="round"/>
<path d="M39 76c6-6 16-6 22 0-6-2-16-2-22 0z" fill="#3a1210" stroke="#3a1210" stroke-width="3" stroke-linejoin="round"/>
<path d="M34 68l4 2M66 68l-4 2" stroke="#9a4a2a" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
