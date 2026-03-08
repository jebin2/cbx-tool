import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "CBX Tool",
    identifier: "com.cbxtool.app",
    version: "1.0.0",
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
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
