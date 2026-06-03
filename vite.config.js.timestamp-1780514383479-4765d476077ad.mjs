// vite.config.js
import { defineConfig } from "file:///sessions/magical-epic-noether/mnt/game/node_modules/vite/dist/node/index.js";
var vite_config_default = defineConfig({
  root: "frontend",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return id.toString().split("node_modules/")[1].split("/")[0].toString();
          }
        }
      }
    }
  },
  optimizeDeps: {
    include: ["socket.io-client"]
  }
  // server: {
  //     proxy: {
  //         "/foo": "http://localhost:3000",
  //         "/api": {
  //             target: "https://localhost:3000",
  //             changeOrigin: true,
  //             secure: false,
  //             ws: true,
  //         },
  //     },
  // },
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbWFnaWNhbC1lcGljLW5vZXRoZXIvbW50L2dhbWVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9tYWdpY2FsLWVwaWMtbm9ldGhlci9tbnQvZ2FtZS92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvbWFnaWNhbC1lcGljLW5vZXRoZXIvbW50L2dhbWUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAgIHJvb3Q6IFwiZnJvbnRlbmRcIixcbiAgICBwdWJsaWNEaXI6IFwiLi4vcHVibGljXCIsXG4gICAgYnVpbGQ6IHtcbiAgICAgICAgb3V0RGlyOiBcIi4uL2Rpc3RcIixcbiAgICAgICAgZW1wdHlPdXREaXI6IHRydWUsXG4gICAgICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTYwMCxcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzKGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcyhcIm5vZGVfbW9kdWxlc1wiKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGlkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRvU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuc3BsaXQoXCJub2RlX21vZHVsZXMvXCIpWzFdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnNwbGl0KFwiL1wiKVswXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50b1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgfSxcbiAgICBvcHRpbWl6ZURlcHM6IHtcbiAgICAgICAgaW5jbHVkZTogW1wic29ja2V0LmlvLWNsaWVudFwiXSxcbiAgICB9LFxuXG4gICAgLy8gc2VydmVyOiB7XG4gICAgLy8gICAgIHByb3h5OiB7XG4gICAgLy8gICAgICAgICBcIi9mb29cIjogXCJodHRwOi8vbG9jYWxob3N0OjMwMDBcIixcbiAgICAvLyAgICAgICAgIFwiL2FwaVwiOiB7XG4gICAgLy8gICAgICAgICAgICAgdGFyZ2V0OiBcImh0dHBzOi8vbG9jYWxob3N0OjMwMDBcIixcbiAgICAvLyAgICAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgLy8gICAgICAgICAgICAgc2VjdXJlOiBmYWxzZSxcbiAgICAvLyAgICAgICAgICAgICB3czogdHJ1ZSxcbiAgICAvLyAgICAgICAgIH0sXG4gICAgLy8gICAgIH0sXG4gICAgLy8gfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1UyxTQUFTLG9CQUFvQjtBQUVwVSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUN4QixNQUFNO0FBQUEsRUFDTixXQUFXO0FBQUEsRUFDWCxPQUFPO0FBQUEsSUFDSCxRQUFRO0FBQUEsSUFDUixhQUFhO0FBQUEsSUFDYix1QkFBdUI7QUFBQSxJQUN2QixlQUFlO0FBQUEsTUFDWCxRQUFRO0FBQUEsUUFDSixhQUFhLElBQUk7QUFDYixjQUFJLEdBQUcsU0FBUyxjQUFjLEdBQUc7QUFDN0IsbUJBQU8sR0FDRixTQUFTLEVBQ1QsTUFBTSxlQUFlLEVBQUUsQ0FBQyxFQUN4QixNQUFNLEdBQUcsRUFBRSxDQUFDLEVBQ1osU0FBUztBQUFBLFVBQ2xCO0FBQUEsUUFDSjtBQUFBLE1BQ0o7QUFBQSxJQUNKO0FBQUEsRUFDSjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1YsU0FBUyxDQUFDLGtCQUFrQjtBQUFBLEVBQ2hDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQWFKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
