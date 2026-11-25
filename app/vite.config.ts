import { execFileSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

function commit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [tailwindcss()],
  define: { __CHIT_COMMIT__: JSON.stringify(commit()) },
  build: {
    // The largest chunk is @qorechain/sdk, loaded only when a merchant registers a key.
    chunkSizeWarningLimit: 2400,
    rolldownOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          /\/(?:@base-ui|lucide-react)\//.test(warning.id ?? "")
        )
          return;
        warn(warning);
      },
      output: {
        codeSplitting: {
          groups: [
            { name: "evm", test: /\/viem\// },
            { name: "pqc", test: /\/(?:@qorechain\/(?:qoresign|pqc)|@noble|@scure)\// },
          ],
        },
      },
    },
  },
  test: {
    name: "app",
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30_000,
  },
});
