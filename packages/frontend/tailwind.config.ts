import type { Config } from 'tailwindcss';

// `accent`/`border` (and everything else in this file below the `flow` block) is the
// original shadcn HSL token system -- kept working as-is per the Wave 1 rebrand contract.
// It reads from `--shadcn-accent`/`--shadcn-border` (see src/index.css) because Flow's own
// design tokens (src/theme/tokens.css) now own the bare `--accent`/`--border` CSS custom
// properties. Wave 2 migrates components onto the `flow` namespace below; once nothing
// references the shadcn keys, delete this whole legacy block (Wave 3 debt).
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--shadcn-border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--shadcn-accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Flow's own design-token system (src/theme/tokens.css, design doc §2/§3). Values
        // are already valid CSS colors (hex or color-mix()), so no hsl() wrapper.
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
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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
        serif: 'var(--font-serif)',
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
