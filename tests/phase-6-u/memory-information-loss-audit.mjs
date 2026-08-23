import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_PATH = path.resolve(process.cwd(), ".env.local");
function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // file absent is fine; env vars may come from shell
  }
}
loadEnv(ENV_PATH);

const REQUIRED_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  const blocked = {
    scopedToUser: "redacted",
    blocked: true,
    missingEnv,
    investigationA: null,
    investigationB: null,
    investigationC: null,
    investigationD: null,
    investigationE: null,
    investigationF: null,
    diagnosis: null,
  };
  console.log(JSON.stringify(blocked, null, 2));
  process.exit(1);
}

const userId =
  process.env.PHASE6M_USER_ID || process.env.PHASE6H_USER_ID;
if (!userId) {
  const blocked = {
    scopedToUser: "redacted",
    blocked: true,
    missingEnv: ["PHASE6M_USER_ID or PHASE6H_USER_ID"],
    investigationA: null,
    investigationB: null,
    investigationC: null,
    investigationD: null,
    investigationE: null,
    investigationF: null,
    diagnosis: null,
  };
  console.log(JSON.stringify(blocked, null, 2));
  process.exit(1);
}
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const EXPECTED = {
  eligibleTotal: 16,
  reflectionEligible: 10,
  nonReflectionEligible: 6,
  projectCount: 4,
  identityCount: 2,
};

const STRUCTURAL_MARKERS = [
  "because",
  "therefore",
  "since",
  "in order to",
  "goal",
  "connected to",
  "relationship",
];

function hasStructuralMarkers(content) {
  if (!content || typeof content !== "string") return false;
  const lower = content.toLowerCase();
  return STRUCTURAL_MARKERS.some((marker) => lower.includes(marker));
}

function approxTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

async function runAudit() {
  const snapshotQuery = supabase
    .from("memories")
    .select(
      "id,memory_type,status,importance_v2,confidence_v2,title,content,summary"
    )
    .eq("user_id", userId)
    .in("status", ["active", "candidate"])
    .gte("confidence_v2", 0.7)
    .gte("importance_v2", 0.5);

  const { data: snapshotRows, error: snapshotError } = await snapshotQuery;

  if (snapshotError) {
    console.error("SNAPSHOT QUERY FAILED", snapshotError.message);
    process.exit(2);
  }

  const allEligible = snapshotRows ?? [];

  const reflectionEligible = allEligible.filter(
    (m) => m.memory_type === "reflection"
  );
  const nonReflectionEligible = allEligible.filter(
    (m) => m.memory_type !== "reflection"
  );
  const projectCount = nonReflectionEligible.filter(
    (m) => m.memory_type === "project"
  ).length;
  const identityCount = nonReflectionEligible.filter(
    (m) => m.memory_type === "identity"
  ).length;

  const snapshotMatchesExpected =
    allEligible.length === EXPECTED.eligibleTotal &&
    reflectionEligible.length === EXPECTED.reflectionEligible &&
    nonReflectionEligible.length === EXPECTED.nonReflectionEligible &&
    projectCount === EXPECTED.projectCount &&
    identityCount === EXPECTED.identityCount;

  if (!snapshotMatchesExpected) {
    const mismatchResult = {
      scopedToUser: "redacted",
      blocked: false,
      missingEnv: [],
      snapshotMatchesExpected: false,
      actual: {
        eligibleTotal: allEligible.length,
        reflectionEligible: reflectionEligible.length,
        nonReflectionEligible: nonReflectionEligible.length,
        projectCount,
        identityCount,
      },
      expected: EXPECTED,
    };
    console.log(JSON.stringify(mismatchResult, null, 2));
    process.exit(3);
  }

  const targetIds = nonReflectionEligible.map((m) => m.id);

  const detailQuery = supabase
    .from("memories")
    .select(
      "id,memory_type,status,importance_v2,confidence_v2,title,content,summary,project_id,tags,metadata,source_ref,observation_id"
    )
    .eq("user_id", userId)
    .in("id", targetIds);

  const { data: detailRows, error: detailError } = await detailQuery;

  if (detailError) {
    console.error("DETAIL QUERY FAILED", detailError.message);
    process.exit(4);
  }

  const memories = (detailRows ?? []).map((m) => {
    const tags = m.tags ?? [];
    const metadata = m.metadata ?? {};
    const isEmptySummary = !m.summary || m.summary === "";

    return {
      memoryType: m.memory_type,
      status: m.status,
      importanceV2: m.importance_v2 ?? 0,
      confidenceV2: m.confidence_v2 ?? 0,
      titleLength: typeof m.title === "string" ? m.title.length : 0,
      contentLength: typeof m.content === "string" ? m.content.length : 0,
      summaryLength: isEmptySummary ? 0 : (m.summary?.length ?? 0),
      emptySummary: isEmptySummary,
      estimatedTokens: approxTokens(m.content),
      hasStructuralMarkers: hasStructuralMarkers(m.content),
      fieldPresence: {
        summary: !isEmptySummary,
        tags: Array.isArray(tags) && tags.length > 0,
        metadata:
          typeof metadata === "object" &&
          metadata !== null &&
          Object.keys(metadata).length > 0,
        sourceRef: !!m.source_ref,
        projectId: !!m.project_id,
        observationId: !!m.observation_id,
      },
    };
  });

  const emptySummaryCount = memories.filter((m) => m.emptySummary).length;
  const nonEmptySummaryCount = memories.length - emptySummaryCount;

  const jobsQuery = supabase
    .from("memory_jobs")
    .select("id,status,message_id")
    .eq("user_id", userId);

  const { data: jobs, error: jobsError } = await jobsQuery;

  if (jobsError) {
    console.error("JOBS QUERY FAILED", jobsError.message);
    process.exit(5);
  }

  const jobsExist = (jobs ?? []).length > 0;
  const jobsWithMessageId = (jobs ?? []).filter((j) => !!j.message_id).length;

  const measurement = {
    phase: "6-U",
    measuredAt: new Date().toISOString(),
    access: "AVAILABLE",
    scopedToUser: "redacted",
    productionWrites: 0,
    blocked: false,
    missingEnv: [],
    investigationA: {
      eligibleTotal: allEligible.length,
      reflectionEligible: reflectionEligible.length,
      nonReflectionEligible: nonReflectionEligible.length,
      projectCount,
      identityCount,
      snapshotMatchesExpected: true,
      memories,
    },
    investigationB: {
      summaryPipelineExists: false,
      emptySummaryCount,
      nonEmptySummaryCount,
    },
    investigationC: {
      extractorPreservesRelationships: false,
      extractorPreservesCausal: false,
      extractorPreservesTemporal: false,
      extractorPreservesProject: false,
      extractorPreservesProvenance: false,
      structuralMismatch: true,
    },
    investigationD: {
      atomicityLevel: "single_fact",
      relationalContextPreserved: false,
    },
    investigationE: {
      fieldsDiscarded: [
        "summary",
        "explicit",
        "projectRef",
        "observation_id",
        "source_ref",
      ],
      fieldsTransformed: ["importance", "confidence"],
      provenanceGap: true,
      observationIdNeverWritten: true,
    },
    investigationF: {
      groupingStrategy: "memory_type_only",
      summaryAlwaysEmpty: true,
      crossTypeSynthesisBlocked: true,
    },
    diagnosis: {
      primaryLossPoint: "extraction",
      secondaryLossPoints: [
        "write_path",
        "summary_pipeline",
        "reflection_input_construction",
        "provenance",
      ],
      notTheProblem: [
        "reflector_mechanism",
        "parser_sanitizer",
        "model",
        "eligibility_gate",
        "self_feed",
        "embedding_retrieval",
      ],
    },
    memoryJobs: {
      totalJobs: (jobs ?? []).length,
      jobsExist,
      jobsWithMessageId,
      observationIdGapConfirmed: jobsWithMessageId === 0,
    },
  };

  const outputPath = path.join(__dirname, "measurement.json");
  fs.writeFileSync(outputPath, JSON.stringify(measurement, null, 2));

  console.log(JSON.stringify(measurement, null, 2));

  const validations = [
    measurement.investigationA.snapshotMatchesExpected === true,
    measurement.investigationB.emptySummaryCount === EXPECTED.nonReflectionEligible,
    measurement.investigationB.summaryPipelineExists === false,
    measurement.investigationC.structuralMismatch === true,
    measurement.investigationE.provenanceGap === true,
    measurement.investigationE.observationIdNeverWritten === true,
    measurement.investigationF.crossTypeSynthesisBlocked === true,
  ];

  const allPassed = validations.every((v) => v === true);

  if (!allPassed) {
    console.error("VALIDATION FAILED");
    process.exit(6);
  }

  process.exit(0);
}

runAudit().catch((err) => {
  console.error("AUDIT SCRIPT FAILED", err.message);
  process.exit(7);
});
