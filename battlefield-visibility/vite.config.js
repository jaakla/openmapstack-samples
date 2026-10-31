import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
import { publicationAttribution } from "./publication.js";
export default defineConfig({
  plugins: [react(), publicationAttribution(), analyticsPlugin('battlefield-visibility', 'cdd722ab5ded9b55fa614e9969cf46922da66db1e52aeee949e8930ca9db5b07')],
  build: { target: "es2022" },
});
