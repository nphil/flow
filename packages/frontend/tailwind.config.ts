import type { Config } from 'tailwindcss';

// Flow's own design-token system (src/theme/tokens.css, design doc §2/§3) is the only color/
// radius/shadow/motion namespace this app uses. The legacy shadcn HSL bridge (former
// --background/--primary/--muted/etc. color entries here, backed by index.css's old
// `--shadcn-*`-prefixed :root/.dark block) has been deleted now that every component reads
// from the `flow` namespace below -- any leftover shadcn classname (bg-primary, text-
// muted-foreground, ...) simply fails to generate rather than silently rendering.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        flow: {
          bg: 'var(--bg)',
          panel: 'var(--bg-panel)',
          elevated: 'var(--bg-elevated)',
          border: 'var(--border)',
          text: 'var(--text)',
          'text-secondary': 'var(--text-secondary)',
          'text-muted': 'var(--text-muted)',
          accent: {
            DEFAULT: 'var(--accent)',
            hover: 'var(--accent-hover)',
            subtle: 'var(--accent-subtle)',
          },
          'on-accent': 'var(--on-accent)',
          danger: 'var(--danger)',
          ok: 'var(--ok)',
          warn: 'var(--warn)',
          node: {
            trigger: 'var(--node-trigger)',
            condition: 'var(--node-condition)',
            action: 'var(--node-action)',
            timing: 'var(--node-timing)',
            data: 'var(--node-data)',
            flowctl: 'var(--node-flowctl)',
            unknown: 'var(--node-unknown)',
          },
        },
      },
      borderRadius: {
        'flow-control': 'var(--radius-control)',
        'flow-card': 'var(--radius-card)',
        'flow-modal': 'var(--radius-modal)',
      },
      boxShadow: {
        'flow-card': 'var(--shadow-card)',
        'flow-pop': 'var(--shadow-pop)',
        'flow-modal': 'var(--shadow-modal)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      transitionDuration: {
        'flow-fast': 'var(--dur-fast)',
        'flow-med': 'var(--dur-med)',
        'flow-slow': 'var(--dur-slow)',
      },
      transitionTimingFunction: {
        'flow-warm': 'var(--ease-out-warm)',
      },
    },
  },
  plugins: [],
};

export default config;
