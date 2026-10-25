import { describe, expect, it } from "vitest";

import { clientCommandSchema } from "./index";

describe("client command contract", () => {
  it("accepts normalized movement intent", () => {
    expect(clientCommandSchema.safeParse({ type: "move", seq: 1, dx: -1, dy: 1 }).success).toBe(true);
  });

  it("rejects coordinates disguised as movement intent", () => {
    expect(clientCommandSchema.safeParse({ type: "move", seq: 2, dx: 48, dy: 0 }).success).toBe(false);
  });
});
