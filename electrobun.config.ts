import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "CBX Tool",
    identifier: "com.cbxtool.app",
    version: "1.3.1",
    icon: "resources/icon-transparent-1.png",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/renderer/script.ts",
      },
    },
    copy: {
      "src/renderer/index.html": "views/mainview/index.html",
      "src/renderer/style.css": "views/mainview/style.css",
      "resources/icon-transparent-1.png": "icon.png",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
