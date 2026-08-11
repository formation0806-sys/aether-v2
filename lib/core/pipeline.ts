import { Runtime } from "./runtime";

import { getIdentity } from "@/lib/identity";
import { retrieveMemories } from "@/lib/memory";
import { retrieveKnowledge } from "@/lib/knowledge";
import { retrievePlans } from "@/lib/planner";

import { buildContext } from "@/lib/context";
import { buildBrain } from "@/lib/brain";

export async function runPipeline(runtime: Runtime) {
  const state = runtime.get();

  const identity = await getIdentity(state.userId);

  const memories = await retrieveMemories(
    state.userId,
    state.message
  );

  const knowledge = await retrieveKnowledge(
    state.userId,
    state.message
  );

  const plans = await retrievePlans(state.userId);

  runtime.update({
    identity,
    memories,
    knowledge,
    plans,
  });

  const context = await buildContext(
    state.userId,
    state.message
  );

  runtime.update({
    context,
  });

  const brain = await buildBrain({
    userId: state.userId,
    message: state.message,
  });

  runtime.update({
    prompt: brain.prompt,
  });

  return runtime.get();
}