import { RuntimeState } from "./types";

export class Runtime {
  private state: RuntimeState;

  constructor(state: RuntimeState) {
    this.state = state;
  }

  get() {
    return this.state;
  }

  update(data: Partial<RuntimeState>) {
    this.state = {
      ...this.state,
      ...data,
    };
  }
}