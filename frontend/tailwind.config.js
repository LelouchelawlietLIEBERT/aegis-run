export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#090d16",
        panel: "#111827",
        stroke: "#1f2937",
        emerald: "#10b981",
        amber: "#f59e0b",
        crimson: "#ef4444",
        accent: "#38bdf8",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 18px 45px -30px rgba(2, 6, 23, 0.9)",
      },
    },
  },
  plugins: [],
};
