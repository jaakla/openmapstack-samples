import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
import { publicationAttribution } from "./publication.js";
export default defineConfig({
  plugins: [react(), publicationAttribution(), analyticsPlugin('battlefield-visibility', '6cdeb1e0afb19e2ddc566d5221100a3fb3a13c2d681af5f0beb7d17570c6cc7d')],
  build: { target: "es2022" },
});
