import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
  maxmem: 128 * 16384 * 16 * 2
};

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }) {
  const [salt, expectedHex] = hash.split(":");
  if (!salt || !expectedHex) return false;

  const actual = await derive(password, salt);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, options.dkLen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
