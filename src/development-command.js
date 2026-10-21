// Fail closed until an OS sandbox passes the native command qualification.
// The initial handwritten macOS profile could not run even a benign echo.
// Prefer qualifying a maintained sandbox runtime instead of relaxing that
// profile or silently executing a command with the Companion's credentials.
async function runSandboxed() {
  throw new Error('Development commands unavailable: OS sandbox not qualified');
}
module.exports = { runSandboxed };
