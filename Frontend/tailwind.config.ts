import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",

  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Swap these for your own brand faces later.
        serif: ["Georgia", "ui-serif", "serif"],
      },
      colors: {
        // Zoiko brand hooks — the component uses Tailwind's default
        // teal/slate/amber, but you can point these at real hex values
        // and refactor the classes to bg-brand-teal etc.
        brand: {
          teal: "#0d7d7d",
          navy: "#1f3a5f",
          amber: "#d97706",
        },
      },
    },
  },
  plugins: [],
};
export default config;
