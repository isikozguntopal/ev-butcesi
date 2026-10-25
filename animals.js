// Ekranlardaki tatlı hayvancıklar: konuşan "Buddy", alttan geçen "Walker" ve kutlama "Party".
import { html, useState, useEffect } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

const pick = a => a[Math.floor(Math.random() * a.length)];

const FACES = ['🐶', '🐱', '🐰', '🐻', '🐼', '🦊', '🐸', '🐷', '🐨', '🐹', '🐮', '🐯', '🦁', '🐵', '🐧', '🐥', '🐻‍❄️', '🐭'];
const WALKERS = ['🐕', '🐈', '🐇', '🐖', '🐄', '🐓', '🦆', '🐢', '🐿️', '🦔', '🐑', '🐐', '🐩', '🦙', '🐁', '🦫'];
const FOODS = ['🍎', '🥕', '🍌', '🍪', '🧀', '🍉', '🥦', '🍓', '🍩', '🦴', '🌽', '🥐', '🍕', '🐟'];
const LAUGHS = ['hihi', 'haha', 'kikiki', 'hö hö'];
const ACTIONS = ['wave', 'laugh', 'eat', 'poop', 'dance', 'sleep', 'love'];

/** Her gün ve her ekran için farklı ama gün içinde sabit bir hayvan */
export function dailyFace(slot = 0) {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return FACES[(day * 7 + slot * 5) % FACES.length];
}

/** Metne göre sabit küçük hayvan (boş satırlar için) */
export function faceFor(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FACES[h % FACES.length];
}

/** Konuşma balonlu hayvancık. Kendi kendine hareket eder, dokununca başka bir şey yapar. */
export function Buddy({ face, say }) {
  const [act, setAct] = useState({ name: 'wave', n: 0, food: pick(FOODS), laugh: pick(LAUGHS) });
  const next = () => setAct(a => ({
    name: pick(ACTIONS.filter(x => x !== a.name)), n: a.n + 1, food: pick(FOODS), laugh: pick(LAUGHS),
  }));
  useEffect(() => {
    const t = setTimeout(next, 4200 + Math.random() * 2600);
    return () => clearTimeout(t);
  }, [act.n]);

  return html`
    <div class="buddy-wrap">
      <button class=${`buddy act-${act.name}`} key=${act.n} onClick=${next} aria-label="Hayvancık">
        <span class="face">${face}</span>
        ${act.name === 'wave' && html`<span class="prop hand">👋</span>`}
        ${act.name === 'eat' && html`<span class="prop food">${act.food}</span>`}
        ${act.name === 'poop' && html`<span class="prop poop">💩</span><span class="prop fart">💨</span>`}
        ${act.name === 'laugh' && html`<span class="prop laugh">${act.laugh}</span>`}
        ${act.name === 'dance' && html`<span class="prop note">🎵</span>`}
        ${act.name === 'sleep' && html`<span class="prop zzz">💤</span>`}
        ${act.name === 'love' && html`<span class="prop heart">❤️</span>`}
      </button>
      ${say && html`<div class="bubble">${say}</div>`}
    </div>`;
}

/** Arada bir sekme çubuğunun üstünden yürüyüp geçen hayvan; ortada durup kaka yapar, yemek yer ya da el sallar. */
export function Walker() {
  const [w, setW] = useState(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t;
    const schedule = delay => {
      t = setTimeout(() => {
        setW({
          id: Date.now(),
          animal: pick(WALKERS),
          dir: Math.random() < 0.5 ? 'ltr' : 'rtl',
          stop: pick(['poop', 'poop', 'eat', 'wave', 'love']),
          food: pick(FOODS),
        });
        schedule(15000 + Math.random() * 15000);
      }, delay);
    };
    schedule(2000);
    return () => clearTimeout(t);
  }, []);
  if (!w) return null;
  const prop = { eat: w.food, wave: '👋', love: '❤️' }[w.stop];
  return html`
    <div class=${`walker ${w.dir}`} key=${w.id} aria-hidden="true">
      <div class="walk-track">
        <span class="flip"><span class="walk-animal">${w.animal}</span></span>
        ${prop && html`<span class="walk-prop">${prop}</span>`}
      </div>
      ${w.stop === 'poop' && html`<span class="walk-poop">💩</span>`}
    </div>`;
}

export const celebrate = text => window.dispatchEvent(new CustomEvent('tf-party', { detail: text }));

const CONFETTI = ['🎉', '✨', '⭐', '💛', '🎊', '✨', '🌟', '💚'];

/** celebrate("Ödendi!") çağrılınca zıplayan hayvan + konfeti */
export function Party() {
  const [p, setP] = useState(null);
  useEffect(() => {
    const on = e => setP({ id: Date.now(), text: e.detail, animal: pick(FACES) });
    window.addEventListener('tf-party', on);
    return () => window.removeEventListener('tf-party', on);
  }, []);
  useEffect(() => {
    if (!p) return;
    const t = setTimeout(() => setP(null), 1900);
    return () => clearTimeout(t);
  }, [p]);
  if (!p) return null;
  return html`
    <div class="party" key=${p.id} aria-live="polite">
      ${CONFETTI.map((c, i) => {
        const a = (i / CONFETTI.length) * Math.PI * 2;
        return html`<span class="conf" style=${`--x:${Math.cos(a) * 90}px;--y:${Math.sin(a) * 70 - 30}px`}>${c}</span>`;
      })}
      <span class="party-animal">${p.animal}</span>
      <span class="party-text">${p.text}</span>
    </div>`;
}
