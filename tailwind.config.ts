import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        card: "hsl(var(--card))",
        primary: "hsl(var(--primary))",
        danger: "hsl(var(--danger))",
        warning: "hsl(var(--warning))",
      },
      boxShadow: {
        soft: "0 16px 50px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [forms],
};

export default config;
