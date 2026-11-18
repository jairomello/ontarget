import { describe, expect, it } from "bun:test";
import { CORE_VERSION } from "../src/index";

describe("core", () => {
  it("expõe a versão do pacote", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });
});
