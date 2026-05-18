import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const config = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64
};

export async function hashBetterAuthPassword(password: string) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    ...config,
    maxmem: 128 * config.N * config.r * 2
  });

  // Better Auth stores credential passwords as "salt:derived_key".
  return `${salt}:${bytesToHex(key)}`;
}
