import { hashPassword, verifyPassword } from "./password.js";

describe("legacy password hashing", () => {
  it("hashes and verifies the Better Auth scrypt format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    await expect(verifyPassword({ hash, password: "correct horse battery staple" })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: "wrong password" })).resolves.toBe(false);
  });
});
