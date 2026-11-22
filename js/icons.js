// Inline SVG line-art icons: stroke currentColor, 1.5 stroke width, round caps, no fill.

const rays = (cx, cy, r1, r2, n = 8, only = null) => {
  let d = '';
  for (let i = 0; i < n; i++) {
    if (only && !only.includes(i)) continue;
    const a = (i * 2 * Math.PI) / n - Math.PI / 2;
    const c = Math.cos(a); const s = Math.sin(a);
    d += `M${(cx + c * r1).toFixed(2)} ${(cy + s * r1).toFixed(2)}L${(cx + c * r2).toFixed(2)} ${(cy + s * r2).toFixed(2)}`;
  }
  return d;
};
const gearPath = () => {
  const pts = []; const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i * 2 * Math.PI) / n;
    const w = Math.PI / n;
    [[-0.55, 6.6], [-0.3, 9], [0.3, 9], [0.55, 6.6]].forEach(([f, rad]) => {
      const a = a0 + f * w;
      pts.push(`${(12 + Math.cos(a) * rad).toFixed(2)} ${(12 + Math.sin(a) * rad).toFixed(2)}`);
    });
  }
  return `M${pts.join('L')}Z`;
};

const CLOUD = 'M7 18.5h10.3a3.6 3.6 0 0 0 .6-7.15A5.4 5.4 0 0 0 7.6 10.1 4.2 4.2 0 0 0 7 18.5z';
const CLOUD_HIGH = 'M7 15h10.3a3.3 3.3 0 0 0 .5-6.55A5 5 0 0 0 8 7.2 3.9 3.9 0 0 0 7 15z';
const MOON = 'M19.5 14.2A7.8 7.8 0 1 1 9.8 4.5a6.2 6.2 0 0 0 9.7 9.7z';

const P = {
  sun: `<circle cx="12" cy="12" r="3.9"/><path d="${rays(12, 12, 6.9, 9.4)}"/>`,
  moon: `<path d="${MOON}"/>`,
  'partly-day': `<circle cx="8.6" cy="8.6" r="2.7"/><path d="${rays(8.6, 8.6, 4.9, 6.7, 8, [0, 1, 2, 6, 7, 5])}"/><path d="M9.5 19.5h8.2a3.2 3.2 0 0 0 .5-6.35 4.7 4.7 0 0 0-8.9.9A3.3 3.3 0 0 0 9.5 19.5z"/>`,
  'partly-night': `<path d="M10.8 4.6a5 5 0 1 0 6.3 6.9 4 4 0 0 1-6.3-6.9z"/><path d="M9.5 19.5h8.2a3.2 3.2 0 0 0 .5-6.35 4.7 4.7 0 0 0-8.9.9A3.3 3.3 0 0 0 9.5 19.5z"/>`,
  cloud: `<path d="${CLOUD}"/>`,
  fog: `<path d="M7 13h10.3a3.3 3.3 0 0 0 .5-6.55A5 5 0 0 0 8 5.2 3.9 3.9 0 0 0 7 13z"/><path d="M4 16.5h16M7 20h10"/>`,
  drizzle: `<path d="${CLOUD_HIGH}"/><path d="M9 18l-.6 1.6M13 18l-.6 1.6M17 18l-.6 1.6"/>`,
  rain: `<path d="${CLOUD_HIGH}"/><path d="M8.5 17.5l-1.3 3.2M12.5 17.5l-1.3 3.2M16.5 17.5l-1.3 3.2"/>`,
  snow: `<path d="${CLOUD_HIGH}"/><path d="M8.5 18.2v.1M12.5 19.8v.1M16.5 18.2v.1M10.5 21v.1M14.5 17.8v.1"/>`,
  sleet: `<path d="${CLOUD_HIGH}"/><path d="M8.5 17.5l-1.3 3.2M15.6 17.5l-1.3 3.2M12 18.7v.1M12 21.2v.1"/>`,
  thunder: `<path d="${CLOUD_HIGH}"/><path d="M12.8 14.5l-2.6 3.2h3.2l-2.2 3.6"/>`,
  wind: '<path d="M3 8.5h10.2a2.6 2.6 0 1 0-2.5-3.3M3 12.5h15.2a2.8 2.8 0 1 1-2.7 3.5M3 16.5h6.5a2.2 2.2 0 1 1-2.1 2.8"/>',
  umbrella: '<path d="M12 3.5a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12.5v6a2 2 0 0 1-4 0"/>',
  shirt: '<path d="M8.4 4.5L3 7l2 4.2 3-1.2V20h8V10l3 1.2L21 7l-5.4-2.5a3.7 3.7 0 0 1-7.2 0z"/>',
  sunwindow: `<circle cx="12" cy="11" r="3.1"/><path d="${rays(12, 11, 5.4, 7.2)}"/><path d="M5 20.5h14M5 18.5v2M19 18.5v2"/>`,
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  gear: `<path d="${gearPath()}"/><circle cx="12" cy="12" r="2.8"/>`,
  refresh: '<path d="M20 11.5a8 8 0 0 0-14.3-4M4 4.5v3.8h3.8M4 12.5a8 8 0 0 0 14.3 4M20 19.5v-3.8h-3.8"/>',
  alert: '<path d="M12 4l9.2 16H2.8z"/><path d="M12 10v4.6M12 17.4v.1"/>',
  pin: '<path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  car: '<path d="M4.5 17v-4.2l1.9-4.6A2 2 0 0 1 8.3 7h7.4a2 2 0 0 1 1.9 1.2l1.9 4.6V17z"/><path d="M4.5 12.8h15M7 17v2M17 17v2M8 15.1v.1M16 15.1v.1"/>',
  inbox: '<path d="M3.5 13.5l2.4-7.4a2 2 0 0 1 1.9-1.4h8.4a2 2 0 0 1 1.9 1.4l2.4 7.4"/><path d="M3.5 13.5v4.8A1.5 1.5 0 0 0 5 19.8h14a1.5 1.5 0 0 0 1.5-1.5v-4.8h-5.2a3.3 3.3 0 0 1-6.6 0z"/>',
  box: '<path d="M12 3.5l8 4v9l-8 4-8-4v-9z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',
  'moon-sleep': '<path d="M17.8 14.6A7 7 0 1 1 9.4 6.2a5.6 5.6 0 0 0 8.4 8.4z"/><path d="M14.2 3.8h4l-4 4.2h4"/>',
  ring: '<circle cx="12" cy="14.2" r="6.2"/><circle cx="12" cy="14.2" r="3.7"/><path d="M9.7 6.4L12 3.4l2.3 3"/>',
  suitcase: '<rect x="4" y="7.5" width="16" height="12" rx="2"/><path d="M9 7.5V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6v1.9M8 7.5v12M16 7.5v12"/>',
  ferris: '<circle cx="12" cy="10" r="6.2"/><path d="M12 3.8v12.4M5.8 10h12.4M7.6 5.6l8.8 8.8M16.4 5.6l-8.8 8.8M8.6 21L12 10l3.4 11M7 21h10"/>',
  gift: '<rect x="4" y="9" width="16" height="4" rx="1"/><path d="M5.5 13v6.5h13V13M12 9v10.5M12 9c-1.6-3.6-5.6-3.6-5.2-1.2.3 1.4 3 1.2 5.2 1.2zM12 9c1.6-3.6 5.6-3.6 5.2-1.2-.3 1.4-3 1.2-5.2 1.2z"/>',
  speaker: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  fork: '<path d="M7 3.5v6.2a2 2 0 0 0 4 0V3.5M9 3.5v17M16.5 20.5V3.5c-2 1.2-3 3.6-3 6.5 0 2 .9 3 3 3"/>',
  dumbbell: '<path d="M6.5 7.5v9M9 9v6M3.5 10v4M17.5 7.5v9M15 9v6M20.5 10v4M9 12h6"/>',
  bolt: '<path d="M13 3.5L6 13.5h5l-1 7 7-10h-5z"/>',
  drop: '<path d="M12 3.8s6 6.4 6 10.6a6 6 0 0 1-12 0C6 10.2 12 3.8 12 3.8z"/>',
  bin: '<path d="M5 7.5h14M9.5 7.5V5.2h5v2.3M6.6 7.5l.9 12.5h9l.9-12.5M10.2 11v5.5M13.8 11v5.5"/>',
};

export function icon(name, { size = 24, className = '', title = '' } = {}) {
  const body = P[name] || P.cloud;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"'} focusable="false">${body}</svg>`;
}

export function weatherIconName(code, isDay = 1) {
  const day = isDay !== 0;
  if (code == null) return 'cloud';
  if (code === 0) return day ? 'sun' : 'moon';
  if (code === 1 || code === 2) return day ? 'partly-day' : 'partly-night';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57 && code !== 56 && code !== 57) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}
export const weatherIcon = (code, isDay, opts) => icon(weatherIconName(code, isDay), opts);
export const ICON_NAMES = Object.keys(P);
