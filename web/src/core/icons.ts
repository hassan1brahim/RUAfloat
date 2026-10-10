/** Small inline glyphs for the map legend. Each is a 16x16 shape filled with `currentColor`, so the row's
 * existing severity color (amber/red/magenta/etc.) tints the icon — replaces plain color swatches/dots/lines
 * with a pictogram that says what the row means before you've even read the text. */
const SVG_OPEN = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';

export const icons = {
  water: `${SVG_OPEN}<path d="M8 1.4C8 1.4 3.1 7.3 3.1 10.3A4.9 4.9 0 0 0 12.9 10.3C12.9 7.3 8 1.4 8 1.4Z" fill="currentColor"/></svg>`,
  building: `${SVG_OPEN}<rect x="3" y="2" width="10" height="12.5" rx="1" fill="currentColor"/><g fill="#0b0f14" opacity=".55"><rect x="5.3" y="4.3" width="2" height="2"/><rect x="8.7" y="4.3" width="2" height="2"/><rect x="5.3" y="7.6" width="2" height="2"/><rect x="8.7" y="7.6" width="2" height="2"/><rect x="6.5" y="11" width="3" height="3.5"/></g></svg>`,
  shelter: `${SVG_OPEN}<path d="M8 2 14.5 13.5H1.5Z" fill="currentColor"/><rect x="7.2" y="8.6" width="1.6" height="4.9" fill="#0b0f14" opacity=".55"/></svg>`,
  hospital: `${SVG_OPEN}<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="currentColor"/><rect x="6.8" y="3.8" width="2.4" height="8.4" fill="#0b0f14"/><rect x="3.8" y="6.8" width="8.4" height="2.4" fill="#0b0f14"/></svg>`,
  police: `${SVG_OPEN}<path d="M8 1.1 13.8 3.3V8C13.8 11.4 11.4 13.6 8 14.8 4.6 13.6 2.2 11.4 2.2 8V3.3Z" fill="currentColor"/></svg>`,
  fire: `${SVG_OPEN}<path d="M8.2 1C8.2 1 4.6 4.7 4.6 8.4A3.5 3.5 0 0 0 11.6 8.4C11.6 6.9 10.6 6.1 10.3 5.3 10.1 6.1 9.6 6.5 9.6 6.5 9.9 4.5 8.2 1 8.2 1Z" fill="currentColor"/><path d="M7.9 9.3C7.9 9.3 6.7 10.4 6.7 11.4A1.75 1.75 0 0 0 10.2 11.4C10.2 10.6 9.6 10.1 9.4 9.7 9.3 10.1 9 10.3 9 10.3 9.2 9.4 7.9 9.3 7.9 9.3Z" fill="#0b0f14" opacity=".4"/></svg>`,
  lightning: `${SVG_OPEN}<path d="M9.2 1 3.5 9.2H7L6.4 15 12.6 6.3H9Z" fill="currentColor"/></svg>`,
  rain: `${SVG_OPEN}<path d="M4.6 8.4A3 3 0 0 1 5 2.6 3.6 3.6 0 0 1 12.2 3.4 2.6 2.6 0 0 1 11.8 8.4Z" fill="currentColor"/><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M5.5 10.2 4.3 13"/><path d="M8.3 10.2 7.1 13.6"/><path d="M11.1 10.2 9.9 13"/></g></svg>`,
  barrier: `${SVG_OPEN}<rect x="1" y="4.5" width="14" height="7" rx="1.2" fill="currentColor"/><path d="M1.5 6 14.5 10M1.5 10 14.5 6" stroke="#0b0f14" stroke-width="1.6" stroke-linecap="round" opacity=".5"/></svg>`,
  eye: `${SVG_OPEN}<path d="M1 8C2.6 4.8 5.1 3.2 8 3.2S13.4 4.8 15 8C13.4 11.2 10.9 12.8 8 12.8S2.6 11.2 1 8Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.1" fill="currentColor"/></svg>`,
};
export type IconName = keyof typeof icons;

/** `<i>` wrapper matching the size/alignment of the old `.sw`/`.dot`/`.ln` swatches, tinted to `color`. */
export const ic = (name: IconName, color: string, opacity?: number) =>
  `<i class="ic" style="color:${color}${opacity != null ? `;opacity:${opacity}` : ""}">${icons[name]}</i>`;

/** One-off: the student flood-depth row shows a single gradient (not a severity color), so it can't use `currentColor`. */
export const waterGradientIcon = (id: string, from: string, to: string) =>
  `<i class="ic">${SVG_OPEN}<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><path d="M8 1.4C8 1.4 3.1 7.3 3.1 10.3A4.9 4.9 0 0 0 12.9 10.3C12.9 7.3 8 1.4 8 1.4Z" fill="url(#${id})"/></svg></i>`;
