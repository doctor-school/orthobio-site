// One-off generator for the static icons in public/ (favicon PNG + apple touch
// icon + og:image). Run manually when the brand mark changes.
import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('public', { recursive: true });
const mark = readFileSync('src/assets/orto-mark-color.svg');

copyFileSync('src/assets/orto-mark-color.svg', 'public/favicon.svg');

await sharp(mark, { density: 384 }).resize(32, 32).png().toFile('public/favicon-32.png');
await sharp(mark, { density: 768 }).resize(180, 180).png().toFile('public/apple-touch-icon.png');

// og:image — the mark centred on the page background, 1200×630.
const markPng = await sharp(mark, { density: 900 }).resize(420, 420).png().toBuffer();
await sharp({
  create: { width: 1200, height: 630, channels: 4, background: '#ffffff' },
})
  .composite([{ input: markPng, gravity: 'centre' }])
  .png()
  .toFile('public/og-image.png');

console.log('icons written');
