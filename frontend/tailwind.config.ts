import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Theme colors are RGB channels in globals.css, switched by the
        // .light class on <html>. "ink" is the foreground the old "white"
        // played: white on the dark theme, near-black on the light one.
        f1: {
          red: "rgb(var(--f1-red) / <alpha-value>)",
          dark: "rgb(var(--f1-dark) / <alpha-value>)",
          surface: "rgb(var(--f1-surface) / <alpha-value>)",
          card: "rgb(var(--f1-card) / <alpha-value>)",
          border: "rgb(var(--f1-border) / <alpha-value>)",
          muted: "rgb(var(--f1-muted) / <alpha-value>)",
          text: "rgb(var(--f1-text) / <alpha-value>)",
          green: "rgb(var(--f1-green) / <alpha-value>)",
          magenta: "rgb(var(--f1-magenta) / <alpha-value>)",
        },
        ink: "rgb(var(--ink) / <alpha-value>)",
        tyre: {
          soft: "#FF3333",
          medium: "#FFC906",
          hard: "#FFFFFF",
          inter: "#39B54A",
          wet: "#0067FF",
        },
      },
      boxShadow: {
        'glow': '0 0 15px var(--tw-shadow-color)',
        'glass': '0 4px 30px rgba(0, 0, 0, 0.1)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  // light: styles that only apply on the light theme
  plugins: [plugin(({ addVariant }) => addVariant("light", ":root.light &"))],
};

export default config;
