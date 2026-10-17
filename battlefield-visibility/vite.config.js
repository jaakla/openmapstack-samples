import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publicationAttribution } from "./publication.js";
export default defineConfig({
  plugins: [react(), publicationAttribution()],
  build: { target: "es2022" },
});
