// NEON KNOCKOUT glove skins (v16): bought with Nebula Arcade tickets in the shop (shop.js), worn in the arcade's Neon Knockout
// studio (nk/nkgame.js). Arcade copy only. localStorage 'gaNK.gloves' = { owned: [...], on: 'classic' }.
export const NK_GLOVES = [
  { id: 'gold', name: 'Gold Gloves', price: 150 },
  { id: 'fire', name: 'Fire Gloves', price: 200 },
  { id: 'ice', name: 'Ice Gloves', price: 200 },
];
const SKIN = {
  classic: { name: 'Classic', body: 0xf4f8ff, band: 0x1e6bff, glow: 0x2a6bff, rim: 0x6fa8ff, trail: [0x5fd8ff, 0x8a8bff] },
  gold: { name: 'Gold', body: 0xffcf4a, band: 0xff9a00, glow: 0xffc94a, rim: 0xfff1a8, trail: [0xffd56a, 0xffb000] },
  fire: { name: 'Fire', body: 0xff4a12, band: 0xffd000, glow: 0xff5a00, rim: 0xffb04a, trail: [0xff8a00, 0xff2a00], fx: 'fire' },
  ice: { name: 'Ice', body: 0xd8f8ff, band: 0x5fd8ff, glow: 0x9fe8ff, rim: 0xffffff, trail: [0xbff6ff, 0x7fd8ff], fx: 'ice' },
};
const KEY = 'gaNK.gloves';
export function gloveState() { let s = null; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} s = s && typeof s === 'object' ? s : {}; if (!Array.isArray(s.owned)) s.owned = []; s.owned = s.owned.filter(id => SKIN[id] && id !== 'classic'); if (!SKIN[s.on] || (s.on !== 'classic' && !s.owned.includes(s.on))) s.on = 'classic'; return s; }
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
export const ownsGlove = id => id === 'classic' || gloveState().owned.includes(id);
export function grantGlove(id) { if (!SKIN[id]) return false; const s = gloveState(); if (!s.owned.includes(id)) s.owned.push(id); s.on = id; save(s); return true; }
export function wearGlove(id) { if (!ownsGlove(id)) return false; const s = gloveState(); s.on = id; save(s); return true; }
export const gloveSkin = id => SKIN[id || gloveState().on] || SKIN.classic;
export const gloveIds = () => ['classic', ...NK_GLOVES.map(g => g.id)];
// a small picture for the shop tiles (canvas, no WebGL)
export function gloveIcon(id, size = 128) { const k = SKIN[id] || SKIN.classic, c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), s = size / 128, hex = n => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = '#0a0414'; g.fillRect(0, 0, size, size); const gr = g.createRadialGradient(64 * s, 60 * s, 4 * s, 64 * s, 60 * s, 60 * s); gr.addColorStop(0, hex(k.glow) + '88'); gr.addColorStop(1, '#0a041400'); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  g.fillStyle = hex(k.body); g.beginPath(); g.ellipse(64 * s, 54 * s, 34 * s, 30 * s, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(34 * s, 66 * s, 12 * s, 16 * s, -0.5, 0, 7); g.fill();
  g.fillRect(44 * s, 74 * s, 40 * s, 30 * s); g.fillStyle = hex(k.band); g.fillRect(42 * s, 84 * s, 44 * s, 7 * s); g.fillRect(42 * s, 98 * s, 44 * s, 6 * s);
  g.strokeStyle = hex(k.rim); g.lineWidth = 3 * s; g.beginPath(); g.ellipse(64 * s, 54 * s, 34 * s, 30 * s, 0, 0, 7); g.stroke();
  if (k.fx === 'fire') { g.fillStyle = '#ffd000cc'; for (const [x, h] of [[46, 22], [60, 30], [76, 24], [88, 16]]) { g.beginPath(); g.moveTo((x - 7) * s, 28 * s); g.quadraticCurveTo(x * s, (28 - h) * s, (x + 7) * s, 28 * s); g.fill(); } }
  if (k.fx === 'ice') { g.strokeStyle = '#ffffffcc'; g.lineWidth = 2 * s; for (const [x, y] of [[22, 22], [104, 30], [100, 100]]) { for (let a = 0; a < 3; a++) { const r = 9 * s, t = a * Math.PI / 3; g.beginPath(); g.moveTo(x * s - Math.cos(t) * r, y * s - Math.sin(t) * r); g.lineTo(x * s + Math.cos(t) * r, y * s + Math.sin(t) * r); g.stroke(); } } }
  return c.toDataURL('image/png'); }
