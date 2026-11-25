import { expect, test } from "vite-plus/test";
import { originAllowed } from "../src/config";

test("CORS origin matching supports exact origins and local port wildcards only", () => {
  const allowed = ["https://chit.antarktier.com", "http://127.0.0.1:*"];
  expect(originAllowed("https://chit.antarktier.com", allowed)).toBe(true);
  expect(originAllowed("https://chit.antarktier.com.evil.io", allowed)).toBe(false);
  expect(originAllowed("http://127.0.0.1:5173", allowed)).toBe(true);
  expect(originAllowed("http://127.0.0.1:5173.evil.io", allowed)).toBe(false);
  expect(originAllowed("http://localhost:5173", allowed)).toBe(false);
});
