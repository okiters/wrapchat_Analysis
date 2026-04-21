// ─────────────────────────────────────────────────────────────────────────
// theme.js — Wrapchat Design System (Direction A / Unwrap)
//
// Usage:
//   import { DA, PAL, Shell, ACard, Nav, ... } from './theme.js';
//
// Every screen gets its background, card colors, and primitives from here.
// Screens keep all their own logic, state, and text — only the render layer
// uses these tokens and components.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';

// ── Base tokens ────────────────────────────────────────────────────────────
// Used for non-result screens (auth, upload, nav chrome) and as fallbacks.
export const DA = {
  bg:     '#2A1969',
  text:   '#fff',
  muted:  'rgba(255,255,255,0.6)',
  faint:  'rgba(255,255,255,0.3)',
  teal:   '#3DC4BF',
  amber:  '#F5A84C',
  lime:   '#C2DC3A',
  blue:   '#6AAFD4',
  orange: '#E07040',
  purple: '#9B8FD8',
  dp:     "'Nunito',sans-serif",        // display — headings
  bp:     "'Nunito Sans',sans-serif",   // body — labels, body copy
};

// ── Per-section palettes ───────────────────────────────────────────────────
// bg    → full-screen background for that section
// inner → card / button fill
// accent → highlights, borders, labels, pill text
export const PAL = {
  roast:    { bg:'#B83A10', inner:'#E8592A', accent:'#FF8B6A' },
  lovely:   { bg:'#7A1C48', inner:'#A02860', accent:'#F08EBF' },
  funny:    { bg:'#4A6A04', inner:'#6E9A08', accent:'#C8F06A' },
  stats:    { bg:'#083870', inner:'#0E5AAA', accent:'#6AB4F0' },
  ai:       { bg:'#1A3060', inner:'#2A4A90', accent:'#8AACF0' },
  upload:   { bg:'#2C1268', inner:'#4A1EA0', accent:'#A08AF0' },
  toxicity: { bg:'#3D0A0A', inner:'#8B1A1A', accent:'#E04040' },
  lovelang: { bg:'#3D1A2E', inner:'#8B3A5A', accent:'#F08EBF' },
  growth:   { bg:'#0A2E2E', inner:'#1A6B5A', accent:'#3AF0C0' },
  accounta: { bg:'#0A1A3D', inner:'#1A3A8B', accent:'#6AB4F0' },
  energy:   { bg:'#2E1A0A', inner:'#8B5A1A', accent:'#F0A040' },
};

// accent hex → card inner color (ACard auto-lookup, no extra prop needed)
export const ACCENT_INNER = {};
Object.values(PAL).forEach(p => { ACCENT_INNER[p.accent] = p.inner; });

// report type id → palette key
export const RT_PAL = {
  general:  'upload',
  toxicity: 'toxicity',
  lovelang: 'lovelang',
  growth:   'growth',
  accounta: 'accounta',
  energy:   'energy',
};

// section → human-readable pill label
// Extend this when new report types are added.
export const PILL_LABEL = {
  roast:    'The Roast',
  lovely:   'The Lovely',
  funny:    'The Funny',
  stats:    'The Stats',
  ai:       'Insight',
  upload:   'Wrapped',
  toxicity: 'Toxicity Report',
  lovelang: 'Love Language',
  growth:   'Growth Report',
  accounta: 'Accountability',
  energy:   'Energy Report',
};

// section → pill text color (always the PAL accent for that section)
export const PILL_COLOR = Object.fromEntries(
  Object.entries(PAL).map(([k, v]) => [k, v.accent])
);

// ── Google Fonts ───────────────────────────────────────────────────────────
// Call once at app root (e.g. in index.js or App.jsx top-level).
export function injectFonts() {
  if (document.getElementById('wc-fonts')) return;
  const link = document.createElement('link');
  link.id   = 'wc-fonts';
  link.rel  = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

// ── Global CSS (keyframes + scrollbar) ────────────────────────────────────
// Call once at app root alongside injectFonts().
export function injectGlobalStyles() {
  if (document.getElementById('wc-styles')) return;
  const style = document.createElement('style');
  style.id = 'wc-styles';
  style.textContent = `
    @keyframes fadeUp  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    @keyframes slideR  { from{opacity:0;transform:translateX(36px)}  to{opacity:1;transform:translateX(0)} }
    @keyframes slideL  { from{opacity:0;transform:translateX(-36px)} to{opacity:1;transform:translateX(0)} }
    @keyframes blink   { 0%,80%,100%{opacity:.1} 40%{opacity:1} }
    @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(12px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
    .wc-fu  { animation: fadeUp .38s cubic-bezier(.2,0,.1,1) both }
    .wc-fu2 { animation: fadeUp .38s .08s cubic-bezier(.2,0,.1,1) both }
    .wc-fu3 { animation: fadeUp .38s .16s cubic-bezier(.2,0,.1,1) both }
    .wc-fu4 { animation: fadeUp .38s .24s cubic-bezier(.2,0,.1,1) both }
    .wc-sR  { animation: slideR .26s cubic-bezier(.2,0,.1,1) both }
    .wc-sL  { animation: slideL .26s cubic-bezier(.2,0,.1,1) both }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    button { transition: all .15s; cursor: pointer; }
    button:hover  { opacity: .82; transform: scale(.98); }
    button:active { opacity: .65; transform: scale(.95); }
  `;
  document.head.appendChild(style);
}

// ── Geo — decorative background shape ─────────────────────────────────────
// shape: 'sq-r' (rounded square) | 'circle' | 'sq' (sharp square)
export function Geo({ size=60, color, shape='sq-r', top, left, right, bottom, rotate=0, opacity=0.12 }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom,
      zIndex: 0, pointerEvents: 'none',
      width: size, height: size,
      background: color, opacity,
      borderRadius: shape === 'circle' ? '50%' : shape === 'sq-r' ? size * 0.18 : 4,
      transform: `rotate(${rotate}deg)`,
    }} />
  );
}

// ── Shell — full-screen page wrapper ──────────────────────────────────────
// sec   → section key from PAL/PILL_LABEL (shows pill label + drives pill color)
// bg    → override background (defaults to DA.bg for non-result screens)
// prog / total → drives the thin top progress bar (0/0 = hidden)
// onBack  → renders ← Back button (top-left)
// onClose → renders × button (top-right)
// geos  → pass <><Geo .../><Geo .../></> for that screen's background shapes
export function Shell({ sec, prog=0, total=0, onClose, onBack, geos, bg, children }) {
  const pill      = PILL_LABEL[sec];
  const pillColor = PILL_COLOR[sec] || DA.teal;
  return (
    <div style={{
      width: 'min(430px,100vw)', minHeight: '100svh',
      background: bg || DA.bg,
      position: 'relative', display: 'flex', flexDirection: 'column',
      flexShrink: 0, overflow: 'hidden',
      WebkitFontSmoothing: 'antialiased',
      fontFamily: DA.bp,
    }}>
      {geos}

      {/* progress bar */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'rgba(255,255,255,0.1)', zIndex:5 }}>
        <div style={{ height:'100%', background:'rgba(255,255,255,0.65)', borderRadius:'0 2px 2px 0',
          width: `${total > 0 ? Math.round((prog / total) * 100) : 0}%`, transition:'width .4s' }} />
      </div>

      {/* section pill */}
      {pill && (
        <div style={{ position:'absolute', top:14, left: onBack ? 92 : 14, zIndex:10,
          background:`${pillColor}20`, border:`1px solid ${pillColor}50`,
          borderRadius:999, padding:'4px 12px',
          fontFamily: DA.bp, fontSize:11, fontWeight:700,
          color: pillColor, letterSpacing:'0.04em' }}>
          {pill}
        </div>
      )}

      {/* back button */}
      {onBack && (
        <button onClick={onBack} style={{ position:'absolute', top:10, left:14, zIndex:10,
          background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.14)',
          borderRadius:999, padding:'7px 14px',
          fontFamily: DA.bp, color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:700 }}>
          ← Back
        </button>
      )}

      {/* close button */}
      {onClose && (
        <button onClick={onClose} style={{ position:'absolute', top:10, right:14, zIndex:10,
          background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.14)',
          borderRadius:999, width:34, height:34,
          fontFamily: DA.bp, color:'rgba(255,255,255,0.7)', fontSize:18,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          ×
        </button>
      )}

      {/* scrollable content */}
      <div style={{ position:'relative', zIndex:2, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:20, padding:'58px 24px 56px',
        overflowY:'auto', flex:1 }}>
        {children}
      </div>
    </div>
  );
}

// ── RShell — result screen wrapper ────────────────────────────────────────
// Derives bg + geo accent from PAL[sec] automatically.
// step prop is used as React key to trigger slide-in animation on each step.
export function RShell({ sec, prog, total, onClose, step, children }) {
  const p = PAL[sec] || { bg: DA.bg, accent: DA.teal };
  return (
    <Shell sec={sec} prog={prog} total={total} onClose={onClose} bg={p.bg} geos={<>
      <Geo shape="sq-r"  size={90} color={p.accent} top={60}    right={-24} rotate={18}  opacity={0.20} />
      <Geo shape="sq-r"  size={60} color={p.accent} bottom={100} left={-18} rotate={-14} opacity={0.15} />
      <Geo shape="circle" size={40} color={p.accent} bottom={200} right={20}              opacity={0.12} />
    </>}>
      <div key={step} className="wc-sR" style={{ display:'contents' }}>{children}</div>
    </Shell>
  );
}

// ── Typography ─────────────────────────────────────────────────────────────
export const Overline = ({ children }) => (
  <div className="wc-fu" style={{ fontFamily:DA.bp, fontSize:11, fontWeight:700,
    letterSpacing:'0.1em', textTransform:'uppercase', color:DA.faint, width:'100%' }}>
    {children}
  </div>
);

export const Heading = ({ children, size=32 }) => (
  <div className="wc-fu" style={{ fontFamily:DA.dp, fontWeight:900, fontSize:size,
    color:DA.text, letterSpacing:'-0.025em', lineHeight:1.05, width:'100%' }}>
    {children}
  </div>
);

export const Sub = ({ children }) => (
  <div className="wc-fu2" style={{ fontFamily:DA.bp, fontSize:14, color:DA.muted,
    lineHeight:1.55, width:'100%' }}>
    {children}
  </div>
);

export const BigStat = ({ children }) => (
  <div className="wc-fu2" style={{ fontFamily:DA.dp, fontWeight:900, fontSize:46,
    color:DA.text, letterSpacing:'-0.03em', lineHeight:1, textAlign:'center' }}>
    {children}
  </div>
);

// Italic quote / AI insight block
export const Quip = ({ children }) => (
  <div className="wc-fu3" style={{ fontFamily:DA.bp, fontSize:14, textAlign:'center',
    color:'rgba(255,255,255,0.82)', background:'rgba(255,255,255,0.07)',
    padding:'13px 18px', borderRadius:18, width:'100%',
    lineHeight:1.55, fontStyle:'italic', fontWeight:500 }}>
    {children}
  </div>
);

// Small uppercase label inside a card
export const CLabel = ({ children, color }) => (
  <div style={{ fontFamily:DA.bp, fontSize:11, fontWeight:700, letterSpacing:'0.08em',
    textTransform:'uppercase', color: color || DA.teal, marginBottom:12 }}>
    {children}
  </div>
);

// ── ACard — accent result card ─────────────────────────────────────────────
// accent → pass PAL[sec].accent; card bg is auto-derived from ACCENT_INNER.
export function ACard({ accent, children, style={} }) {
  return (
    <div className="wc-fu2" style={{
      borderRadius: 24,
      background: ACCENT_INNER[accent] || `${accent}22`,
      border: `1.5px solid ${accent}80`,
      padding: '22px 20px', width: '100%',
      position: 'relative', overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── DCard — plain dark info card ──────────────────────────────────────────
export function DCard({ children, style={} }) {
  return (
    <div className="wc-fu2" style={{
      borderRadius: 20,
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      padding: '18px', width: '100%',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── StatChips — 3-stat row inside ACard ───────────────────────────────────
// chips: array of [value, label] pairs, e.g. [['847','Alex msgs'],['400','Your msgs']]
export function StatChips({ chips }) {
  return (
    <div style={{ display:'flex', gap:8, marginTop:18 }}>
      {chips.map(([v, l]) => (
        <div key={l} style={{ flex:1, background:'rgba(255,255,255,0.12)', borderRadius:14, padding:'10px 8px' }}>
          <div style={{ fontFamily:DA.dp, fontWeight:800, fontSize:17, color:'#fff' }}>{v}</div>
          <div style={{ fontFamily:DA.bp, fontSize:10, color:'rgba(255,255,255,0.6)', marginTop:2 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

// ── Bar — horizontal progress bar ─────────────────────────────────────────
export function Bar({ value, max, color, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
        <span style={{ fontFamily:DA.bp, fontSize:13, fontWeight:600, color:DA.text }}>{label}</span>
        <span style={{ fontFamily:DA.bp, fontSize:13, color:DA.muted }}>
          {typeof value === 'number' && value <= 100 ? `${value}%` : value.toLocaleString()}
        </span>
      </div>
      <div style={{ height:9, borderRadius:999, background:'rgba(255,255,255,0.1)' }}>
        <div style={{ height:'100%', width:`${pct}%`, borderRadius:999, background:color, transition:'width .7s ease' }} />
      </div>
    </div>
  );
}

// ── ScoreRing — circular SVG score indicator ──────────────────────────────
export function ScoreRing({ score, max=10, color }) {
  const sz=120, sw=7, r=(sz-sw)/2, circ=2*Math.PI*r, pct=score/max;
  return (
    <div style={{ position:'relative', width:sz, height:sz, margin:'0 auto' }}>
      <svg width={sz} height={sz} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={sw} />
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round" />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontFamily:DA.dp, fontSize:32, fontWeight:900, color:'#fff', lineHeight:1 }}>{score}</div>
        <div style={{ fontFamily:DA.bp, fontSize:11, color:DA.faint }}>/ {max}</div>
      </div>
    </div>
  );
}

// ── Nav — Back / Next button row ──────────────────────────────────────────
// accent   → primary button background (use PAL[sec].accent)
// textColor → primary button text (use PAL[sec].bg to avoid purple clash)
export function Nav({ onBack, onNext, showBack=true, nextLabel='Next →', accent, textColor }) {
  const ac = accent   || DA.teal;
  const tc = textColor || '#fff';
  return (
    <div style={{ display:'flex', gap:10, width:'100%', marginTop:8 }}>
      {showBack && (
        <button onClick={onBack} style={{ flex:1, padding:'14px', borderRadius:999,
          background:'rgba(255,255,255,0.10)', border:'1.5px solid rgba(255,255,255,0.18)',
          fontFamily:DA.bp, color:'rgba(255,255,255,0.75)', fontSize:15, fontWeight:700 }}>
          ← Back
        </button>
      )}
      <button onClick={onNext} style={{ flex:1, padding:'14px', borderRadius:999,
        background: ac, border:'none',
        fontFamily:DA.bp, color:tc, fontSize:15, fontWeight:800 }}>
        {nextLabel}
      </button>
    </div>
  );
}

// ── PrimaryButton — full-width pill CTA ───────────────────────────────────
export function PrimaryButton({ children, onClick, color, textColor, disabled, style={} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: '16px', borderRadius: 999, border: 'none',
      background: color || DA.teal,
      fontFamily: DA.bp, fontWeight: 700, fontSize: 16,
      color: textColor || DA.bg,
      opacity: disabled ? 0.45 : 1,
      transition: 'all .2s',
      ...style,
    }}>
      {children}
    </button>
  );
}

// ── GhostButton — full-width pill secondary CTA ───────────────────────────
export function GhostButton({ children, onClick, style={} }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '13px', borderRadius: 999,
      background: 'transparent', border: '1.5px solid rgba(255,255,255,0.16)',
      fontFamily: DA.bp, fontWeight: 600, fontSize: 14, color: DA.muted,
      ...style,
    }}>
      {children}
    </button>
  );
}

// ── TextInput — styled input field ────────────────────────────────────────
export const inputStyle = {
  width: '100%',
  background: 'rgba(0,0,0,0.28)',
  border: '1.5px solid rgba(255,255,255,0.14)',
  borderRadius: 16,
  padding: '14px 16px',
  fontSize: 15,
  color: '#fff',
  outline: 'none',
  fontFamily: DA.bp,
};

// ── Toast — bottom notification ───────────────────────────────────────────
export function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, []);
  return (
    <div style={{ position:'fixed', bottom:28, left:'50%', zIndex:9999,
      background:'rgba(18,8,50,0.97)', backdropFilter:'blur(16px)',
      borderRadius:999, padding:'12px 22px', color:'#fff',
      fontFamily:DA.bp, fontSize:14, fontWeight:600,
      boxShadow:'0 8px 40px rgba(0,0,0,0.55)',
      animation:'toastIn .3s ease', whiteSpace:'nowrap',
      transform:'translateX(-50%)' }}>
      {msg}
    </div>
  );
}

// ── LoadingMosaic — 4-square animated spinner ─────────────────────────────
export function LoadingMosaic() {
  return (
    <div style={{ position:'relative', width:96, height:96, flexShrink:0 }}>
      {[
        { c:DA.amber, t:0,  l:0  },
        { c:DA.teal,  t:0,  l:52 },
        { c:DA.lime,  t:52, l:0  },
        { c:DA.blue,  t:52, l:52 },
      ].map((s, i) => (
        <div key={i} style={{ position:'absolute', top:s.t, left:s.l,
          width:44, height:44, background:s.c, borderRadius:8, opacity:.92,
          animation:`blink 1.8s ${i*.45}s ease-in-out infinite` }} />
      ))}
      <div style={{ position:'absolute', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)',
        width:12, height:12, background:DA.bg, borderRadius:3, zIndex:10 }} />
    </div>
  );
}
