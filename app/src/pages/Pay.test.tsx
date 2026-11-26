import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { VerificationLine } from "./Pay";

test("a paid request shows a note when the merchant key cannot be read", () => {
  const html = renderToStaticMarkup(
    <VerificationLine result={{ state: "key_unavailable" }} settled />,
  );

  expect(html).toContain("key could not be read from QoreChain");
  expect(html).not.toContain("Do not pay this request");
  expect(html).not.toContain('role="alert"');
});

test("an unpaid request warns against payment when the merchant key cannot be read", () => {
  const html = renderToStaticMarkup(<VerificationLine result={{ state: "key_unavailable" }} />);

  expect(html).toContain("Do not pay this request");
  expect(html).toContain('role="alert"');
});
