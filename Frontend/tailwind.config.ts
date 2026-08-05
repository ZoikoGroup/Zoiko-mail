import type { Config } from 'tailwindcss';

/**
 * Every colour maps to a CSS custom property defined in app/globals.css,
 * so light and dark are token-level swaps rather than duplicated classes.
 *
 * Palette provenance: accent petrol and the dark-mode set were validated
 * for OKLCH lightness band, chroma floor, CVD separation and contrast.
 * AI violet is deliberately separate from the brand accent so a
 * machine-generated claim never reads as a system state.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}', './src/constants/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        surface: 'var(--surface)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',
        border: 'var(--border)',
        bstrong: 'var(--bstrong)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          ink: 'var(--accent-ink)',
          soft: 'var(--accent-soft)',
          on: 'var(--accent-on)',
        },
        ai: {
          DEFAULT: 'var(--ai)',
          soft: 'var(--ai-soft)',
        },
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        crit: { DEFAULT: 'var(--crit)', soft: 'var(--crit-soft)' },
        // Committed brand panel — identical in both themes by design.
        pnl: {
          DEFAULT: 'var(--pnl)',
          2: 'var(--pnl-2)',
          ink: 'var(--pnl-ink)',
          mut: 'var(--pnl-mut)',
          line: 'var(--pnl-line)',
        },
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)',
        editorial: 'var(--font-editorial)',
      },
      fontSize: {
        micro: ['9.5px', { lineHeight: '1.4', letterSpacing: '0.12em' }],
        data: ['11.5px', { lineHeight: '1.68' }],
        xs2: ['12.5px', { lineHeight: '1.5' }],
        base2: ['13.5px', { lineHeight: '1.55' }],
        field: ['14px', { lineHeight: '1.5' }],
        h3: ['22px', { lineHeight: '1.22', letterSpacing: '-0.019em' }],
        thesis: ['26px', { lineHeight: '1.24', letterSpacing: '-0.013em' }],
      },
      borderRadius: {
        field: '10px',
        card: '16px',
        panel: '14px',
        chip: '5px',
        tile: '11px',
      },
      boxShadow: {
        e1: 'var(--sh1)',
        e2: 'var(--sh2)',
        e3: 'var(--sh3)',
        focus: '0 0 0 3px var(--accent-soft)',
        'focus-crit': '0 0 0 3px var(--crit-soft)',
      },
      spacing: {
        '4.5': '1.125rem',
        '18': '4.5rem',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        pulse2: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 260ms cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        pulse2: 'pulse2 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
