import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "CBX Tool",
    identifier: "com.cbxtool.app",
    version: "1.0.0",
    icon: "resources/app.png",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    win: {
      icon: "resources/app.ico",
    },
    linux: {
      icon: "resources/app.png",
    },
    mac: {
      icons: "resources/app.icns",
    },
    views: {
      mainview: {
        entrypoint: "src/renderer/script.ts",
      },
    },
    copy: {
      "src/renderer/index.html": "views/mainview/index.html",
      "src/renderer/style.css": "views/mainview/style.css",
      "resources/app.png": "views/mainview/app.png",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
