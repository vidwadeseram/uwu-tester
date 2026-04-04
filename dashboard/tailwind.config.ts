import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#0a0e1a",
          card: "#0f1629",
          border: "#1e2d4a",
          green: "#00ff88",
          cyan: "#00d4ff",
          yellow: "#ffd700",
          red: "#ff4444",
          muted: "#4a5568",
          text: "#e2e8f0",
          dim: "#94a3b8",
        },
      },
      fontFamily: {
        sans: ["JetBrains Mono", "Fira Code", "Cascadia Code", "ui-monospace", "monospace"],
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-down": "slideDown 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
