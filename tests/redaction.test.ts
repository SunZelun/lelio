import { describe, expect, it } from "vitest";
import { redactString, redactValue } from "../src/main/logging/redaction";

describe("redaction", () => {
  it("redacts sensitive keys recursively", () => {
    const redacted = redactValue({
      nested: {
        apiKey: "sk-secret",
        Authorization: "Bearer abc123"
      },
      safe: "visible"
    });

    expect(redacted).toEqual({
      nested: {
        apiKey: "[REDACTED]",
        Authorization: "[REDACTED]"
      },
      safe: "visible"
    });
  });

  it("redacts token-like strings", () => {
    expect(redactString("Authorization: Bearer abc.def.ghi token=secret-value")).toContain("Bearer [REDACTED]");
    expect(redactString("Authorization: Bearer abc.def.ghi token=secret-value")).toContain("token=[REDACTED]");
  });
});
