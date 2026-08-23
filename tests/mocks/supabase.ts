import { vi } from "vitest";

export interface BuilderCall {
  method: string;
  args: unknown[];
}

export class QueryBuilder {
  calls: BuilderCall[] = [];
  constructor(private responder: (c: BuilderCall[]) => unknown) {}
  private rec(m: string, ...a: unknown[]) { this.calls.push({ method: m, args: a }); return this; }
  from(t: string) { return this.rec("from", t); }
  select(c?: string) { return this.rec("select", c); }
  insert(v: unknown) { return this.rec("insert", v); }
  update(v: unknown) { return this.rec("update", v); }
  eq(c: string, v: unknown) { return this.rec("eq", c, v); }
  in(c: string, v: unknown) { return this.rec("in", c, v); }
  limit(n: number) { return this.rec("limit", n); }
  maybeSingle() { return this.rec("maybeSingle"); }
  single() { return this.rec("single"); }
  rpc(name: string, args: unknown) { return this.rec("rpc", name, args); }
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    try { resolve(this.responder(this.calls)); } catch (e) { reject?.(e); }
  }
}

export function createFakeSupabase(responder: (calls: BuilderCall[]) => unknown) {
  return {
    client: {
      from: (t: string) => new QueryBuilder(responder),
      rpc: (name: string, args: unknown) => new QueryBuilder(responder),
    },
    callsLog: [] as BuilderCall[],
  };
}