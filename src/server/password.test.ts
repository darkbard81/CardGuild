import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password storage", () => {
  it("never stores the password and accepts only the right one", async () => {
    const password = "correct horse battery staple";
    const stored = await hashPassword(password);

    expect(stored).not.toContain(password);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
    // A different salt each time, so equal passwords do not produce equal rows.
    expect(await hashPassword(password)).not.toBe(stored);
  });

  it("reads a corrupt or foreign hash as a failed login instead of throwing", async () => {
    for (const stored of ["", "plaintext", "scrypt$0$8$1$c2FsdA$a2V5", "argon2$1$2$3$4$5", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });
});
