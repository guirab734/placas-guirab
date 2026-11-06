import { pbkdf2Sync, randomBytes } from "node:crypto";

// Read credentials over hidden stdin, never from arguments or a file.
process.stdin.setRawMode?.(true);
process.stdin.setEncoding("utf8");
process.stdout.write("Ready for admin password JSON on stdin (input is hidden).\n");
let input = "";
process.stdin.on("data", chunk => {
  input += chunk;
  if (!/[\r\n]/.test(input)) return;
  process.stdin.pause();
  try {
    const { password } = JSON.parse(input.trim());
    if (typeof password !== "string" || !password.length || password.length > 256) throw new Error();
    const salt = randomBytes(32);
    const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
    process.stdout.write(JSON.stringify({
      ADMIN_PASSWORD_HASH: `pbkdf2-sha256:100000:${salt.toString("hex")}:${hash.toString("hex")}`,
      ADMIN_RATE_KEY: randomBytes(32).toString("hex"),
    }) + "\n");
  } catch { process.stderr.write("Could not prepare admin credentials.\n"); process.exitCode = 1; }
});
