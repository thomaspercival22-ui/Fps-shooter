// Renders the app icons (PNG) from an inline SVG.
import sharp from 'sharp';
import fs from 'fs';

const svg = (pad) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a22"/><stop offset="1" stop-color="#0d0f0c"/></linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2d38a"/><stop offset="1" stop-color="#c7892f"/></linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <circle cx="256" cy="226" r="118" fill="url(#sun)" opacity="0.95"/>
    <path d="M0 330 C 90 290 150 300 256 322 C 360 344 420 300 512 312 L512 512 L0 512 Z" fill="#8a6a3f"/>
    <path d="M0 372 C 120 340 220 360 300 376 C 390 394 450 360 512 366 L512 512 L0 512 Z" fill="#5d4527"/>
    <g fill="none" stroke="#111" stroke-width="16" stroke-linecap="round">
      <circle cx="256" cy="226" r="74"/>
      <path d="M256 118 V172 M256 280 V334 M148 226 H202 M310 226 H364"/>
    </g>
    <circle cx="256" cy="226" r="10" fill="#d12a1f"/>
  </g>
</svg>`);

fs.mkdirSync('icons', { recursive: true });
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-180.png', 180, 0], ['icon-maskable-512.png', 512, 60]]) {
  await sharp(svg(pad)).resize(size, size).png().toFile(`icons/${name}`);
  console.log('icon', name);
}
