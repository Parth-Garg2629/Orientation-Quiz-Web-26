/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#FAFAFA",
        surface: "#FFFFFF",
        ink: "#111827",
        muted: "#6B7280",
        accent: {
          DEFAULT: "#4F46E5",
          soft: "rgba(79, 70, 229, 0.08)",
          hover: "#4338CA",
        },
        danger: {
          DEFAULT: "#DC2626",
          soft: "rgba(220, 38, 38, 0.08)",
        },
        success: {
          DEFAULT: "#16A34A",
          soft: "rgba(22, 163, 74, 0.08)",
        },
        border: "#E5E7EB",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Space Mono", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};
