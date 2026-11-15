export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        desktop: "#f6f5f4",
        surface: "#ffffff",
        chrome: "#deddda",
        border: "#c0bfbc",
        charcoal: "#241f31",
        muted: "#5e5c64",
        gnome: "#3584e4",
        "gnome-dark": "#1c71d8",
        success: "#1b8553",
        "success-soft": "#d8f0e3",
        warning: "#ad5d00",
        "warning-soft": "#fdf0d5",
        danger: "#c01c28",
        "danger-soft": "#fbd8d8",
        panel: "#2d2d2d",
        "panel-text": "#f6f5f4",
      },
      fontFamily: {
        sans: ["Cantarell", "Ubuntu", "Noto Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", "Consolas", "monospace"],
      },
      borderRadius: {
        window: "7px",
      },
      boxShadow: {
        window: "0 1px 2px rgba(12, 10, 16, 0.16), 0 10px 28px -10px rgba(12, 10, 16, 0.42)",
        menu: "0 6px 20px rgba(12, 10, 16, 0.32)",
      },
    },
  },
  plugins: [],
};
