const { execSync } = require("child_process");

try {
  const out = execSync("npx tsc -p c:/Users/Piyush/aether-v2/tsconfig.json --noEmit --pretty", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log("TSC_NOERROR");
} catch (e) {
  console.log("TSC_EXIT=" + (e.status ?? "n/a"));
  console.log("---STDOUT---");
  console.log(String(e.stdout ?? "").slice(0, 6000));
  console.log("---STDERR---");
  console.log(String(e.stderr ?? "").slice(0, 6000));
}
