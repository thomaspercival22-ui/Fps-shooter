// Copies the game's web files into www/ for the native Android build (Capacitor).
//   node tools/make-www.mjs && npx cap sync android
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = path.join(ROOT, 'www');
const FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js', 'src', 'vendor', 'assets', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
let n = 0;
const count = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? count(path.join(p, e.name)) : n++; };
count(OUT);
console.log(`www/: ${n} files`);
