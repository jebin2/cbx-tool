import os from "os";
import path from "path";
import fs from "fs";

const tempDir = path.join(os.tmpdir(), "cbx-tool-" + Math.random().toString(36).slice(2));
fs.mkdirSync(tempDir, { recursive: true });
console.log(tempDir);
