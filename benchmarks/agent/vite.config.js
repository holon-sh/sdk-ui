import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { holon } from "holon-ui/vite";

export default defineConfig({ plugins: [react(), holon()] });
