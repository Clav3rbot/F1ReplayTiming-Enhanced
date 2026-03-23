import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)'],
        mono: ['var(--font-jetbrains-mono)'],
      },
      colors: {
        f1: {
          red: "#E10600",
          dark: "#0B0B11",
          surface: "#13131C",
          card: "#1A1A24",
          border: "#2A2A3C",
          muted: "#9EA1AC",
          text: "#F1F5F9",
          green: "#00FF41",
          magenta: "#FF00FF",
        },
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
  plugins: [],
};

export default config;
