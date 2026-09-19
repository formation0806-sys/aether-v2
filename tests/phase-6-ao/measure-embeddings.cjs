const fs = require("fs");

const dataset = JSON.parse(
  fs.readFileSync("tests/phase-6-ao/dataset.json", "utf8")
);

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
    throw new Error("Ollama returned no embeddings[0]");
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
  console.log(`DATASET_PAIRS=${dataset.length}`);
  console.log("MODEL=nomic-embed-text:latest");
  console.log("EMBEDDING_DIM=768");
  console.log("");

  const results = [];

  for (const pair of dataset) {
    const a = await embed(pair.textA);
    const b = await embed(pair.textB);
    const similarity = cosine(a, b);

    results.push({
      pairId: pair.pairId,
      label: pair.label,
      factKey: pair.factKey,
      similarity
    });

    console.log(
      `${pair.pairId} | ${pair.label} | ${pair.factKey} | similarity=${similarity.toFixed(6)}`
    );
  }

  const outOfRange = results.filter(
    x => x.similarity < 0.70 || x.similarity > 0.90
  );

  const critical = results.filter(
    x => x.similarity >= 0.80 && x.similarity < 0.85
  );

  console.log("");
  console.log("===== AO EMBEDDING GATES =====");
  console.log(`TOTAL=${results.length}`);
  console.log(`OUT_OF_RANGE=${outOfRange.length}`);
  console.log(`CRITICAL_BAND=${critical.length}`);
  console.log(
    `G12_RANGE=${outOfRange.length === 0 ? "PASS" : "FAIL"}`
  );
  console.log(
    `G13_CRITICAL_BAND=${critical.length >= 6 ? "PASS" : "FAIL"}`
  );

  if (outOfRange.length > 0) {
    console.log("");
    console.log("OUT_OF_RANGE_PAIRS:");
    for (const x of outOfRange) {
      console.log(
        `${x.pairId} | ${x.label} | ${x.similarity.toFixed(6)}`
      );
    }
  }

  if (critical.length > 0) {
    console.log("");
    console.log("CRITICAL_BAND_PAIRS:");
    for (const x of critical) {
      console.log(
        `${x.pairId} | ${x.label} | ${x.similarity.toFixed(6)}`
      );
    }
  }
})().catch(err => {
  console.error("EMBEDDING_STAGE_ERROR");
  console.error(err.message);
  process.exit(1);
});
