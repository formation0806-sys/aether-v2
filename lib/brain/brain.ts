import { BrainInput, BrainOutput } from "./types";

export class Brain {
  async think(
    input: BrainInput
  ): Promise<BrainOutput> {
    return {
      reply: "",

      context: {
        identity: {},

        memories: [],

        knowledge: [],

        goals: [],

        tasks: [],
      },
    };
  }
}