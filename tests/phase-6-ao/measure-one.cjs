const fs = require("fs");

const dataset = JSON.parse(
  fs.readFileSync("tests/phase-6-ao/dataset.json", "utf8")
);

const pairId = process.env.PAIR_ID ?? "pair-014";
const pair = dataset.find(x => x.pairId === pairId);

if (!pair) {
  throw new Error(`${pairId} not found`);
}

async function embed(text) {
  const r = await fetch("http://127.0.0.1:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text:latest",
      input: [text]
    })
  });

  if (!r.ok) {
    throw new Error(`Ollama /api/embed failed: HTTP ${r.status}`);
  }

  const data = await r.json();
  const vector = data.embeddings?.[0];

  if (!Array.isArray(vector)) {
    throw new Error("No embeddings[0] returned");
  }

  if (vector.length !== 768) {
    throw new Error(`Expected 768 dimensions, got ${vector.length}`);
  }

  if (!vector.every(Number.isFinite)) {
    throw new Error("Embedding contains non-finite values");
  }

  return vector;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

(async () => {
  const a = await embed(pair.textA);
  const b = await embed(pair.textB);
  const similarity = cosine(a, b);

  console.log(`PAIR=${pair.pairId}`);
  console.log(`LABEL=${pair.label}`);
  console.log(`FACT_KEY=${pair.factKey}`);
  console.log(`SIMILARITY=${similarity.toFixed(6)}`);
  console.log(`RANGE=${similarity >= 0.70 && similarity <= 0.90 ? "PASS" : "FAIL"}`);
  console.log(`CRITICAL_BAND=${similarity >= 0.80 && similarity < 0.85 ? "YES" : "NO"}`);
})().catch(err => {
  console.error("ERROR=" + err.message);
  process.exit(1);
});











