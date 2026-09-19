const fs = require("fs");
const p = "c:/Users/Piyush/aether-v2/lib/core/pipeline.ts";
const s = fs.readFileSync(p, "utf8");
const lines = s.split("\n");
const re = /saveUserMessage|buildContext\(|\"Brain\"|\"Context\"|'Brain'|'Context'|createMessageWithJob/;
lines.forEach((l, i) => {
  if (re.test(l)) console.log((i + 1) + ": " + l.replace(/\r$/, ""));
});
