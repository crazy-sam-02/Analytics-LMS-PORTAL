import path from "path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const toPosixPath = (id) => id.split(path.sep).join("/")

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    cssCodeSplit: true,
    modulePreload: {
      polyfill: false,
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) =>
          /(?:vendor-react|vendor-router|vendor-redux|vendor-query|store-|authSlice-|adminAuthSlice-|superAdminAuthSlice-|router-|useSeo-|vendor-icons-)/.test(dep)
        );
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = toPosixPath(id);

          if (normalizedId.includes("/node_modules/")) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return "vendor-react";
            }

            if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) {
              return "vendor-router";
            }

            if (/[\\/]node_modules[\\/](@reduxjs|react-redux|redux|immer|reselect)[\\/]/.test(id)) {
              return "vendor-redux";
            }

            if (normalizedId.includes("/node_modules/@tanstack/react-query/")) {
              return "vendor-query";
            }

            if (
              /[\\/]node_modules[\\/](recharts|d3-|victory-vendor|decimal.js|clsx)[\\/]/.test(id) ||
              normalizedId.includes("/node_modules/recharts/")
            ) {
              return "vendor-charts";
            }

            if (normalizedId.includes("/node_modules/lucide-react/")) {
              return "vendor-icons";
            }
          }

          if (
            normalizedId.includes("/src/pages/") &&
            !normalizedId.endsWith("/LoginPage.jsx") &&
            !normalizedId.endsWith("/PasswordResetPage.jsx")
          ) {
            return normalizedId
              .split("/src/pages/")[1]
              .replace(/\.jsx$/, "")
              .split("/")
              .map((part) => part.replace(/Page$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase())
              .join("-");
          }

          if (normalizedId.includes("/src/components/ui/")) {
            return "lms-ui";
          }
        },
      },
    },
  },
})
