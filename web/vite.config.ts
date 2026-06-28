import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev runs behind the Go server on one port (ENOWX_PORT). Vite listens on an
// internal port; the browser reaches it (and HMR) through the Go proxy, so the
// HMR client talks back over the public port.
const publicPort = Number(process.env.ENOWX_PORT ?? 1430);
const vitePort = Number(process.env.ENOWX_VITE_PORT ?? 5174);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
    hmr: { clientPort: publicPort },
  },
});
