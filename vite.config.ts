import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/dist/**", "**/fixtures/**", "contracts/**", "keys/**"],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/fixtures/**", "keys/**", "**/dist/**"],
  },
  test: {
    projects: [
      { test: { name: "core", include: ["packages/core/test/**/*.test.ts"] } },
      { test: { name: "service", include: ["service/test/**/*.test.ts"], testTimeout: 60_000 } },
    ],
  },
});
