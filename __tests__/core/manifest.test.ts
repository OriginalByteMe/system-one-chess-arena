import { describe, expect, test } from "bun:test";
import { ContractViolation } from "../../src/core/errors.ts";
import {
  buildManifest,
  manifestVersion,
  parseManifest,
} from "../../src/core/manifest.ts";
import type { ManifestFields } from "../../src/core/types.ts";

const BASE_FIELDS: ManifestFields = {
  name: "test-player",
  model: "test-model",
  playstyle: "Attack the centre, then protect the king.",
  strategies: ["attack", "defend"],
  features: ["materialBalance", "kingSafety"],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 750, maxCostUsd: 0.02 },
  hierarchical: true,
};

function validRaw(): Record<string, unknown> {
  return {
    ...BASE_FIELDS,
    budget: { ...BASE_FIELDS.budget },
    version: manifestVersion(BASE_FIELDS),
  };
}

function expectContractViolation(raw: unknown): void {
  expect(() => parseManifest(raw)).toThrow(ContractViolation);
}

describe("manifestVersion", () => {
  test("is independent of object key order when every value is identical", () => {
    const reordered: ManifestFields = {
      hierarchical: true,
      budget: { maxCostUsd: 0.02, maxMs: 750 },
      fallback: "first-legal",
      historyPlies: 8,
      features: ["materialBalance", "kingSafety"],
      strategies: ["attack", "defend"],
      playstyle: "Attack the centre, then protect the king.",
      model: "test-model",
      name: "test-player",
    };

    expect(manifestVersion(reordered)).toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when playstyle whitespace changes the text", () => {
    const changed: ManifestFields = {
      ...BASE_FIELDS,
      playstyle: "Attack the centre,  then protect the king.",
    };

    expect(manifestVersion(changed)).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when name changes", () => {
    expect(manifestVersion({ ...BASE_FIELDS, name: "renamed-player" })).not.toBe(
      manifestVersion(BASE_FIELDS),
    );
  });

  test("changes when model changes", () => {
    expect(manifestVersion({ ...BASE_FIELDS, model: "other-model" })).not.toBe(
      manifestVersion(BASE_FIELDS),
    );
  });

  test("changes when playstyle changes", () => {
    expect(
      manifestVersion({ ...BASE_FIELDS, playstyle: "Defend every piece." }),
    ).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when one strategy changes", () => {
    expect(
      manifestVersion({ ...BASE_FIELDS, strategies: ["attack", "simplify"] }),
    ).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when one feature changes", () => {
    expect(
      manifestVersion({
        ...BASE_FIELDS,
        features: ["materialBalance", "mobility"],
      }),
    ).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when historyPlies changes", () => {
    expect(manifestVersion({ ...BASE_FIELDS, historyPlies: 9 })).not.toBe(
      manifestVersion(BASE_FIELDS),
    );
  });

  test("changes when fallback changes", () => {
    expect(
      manifestVersion({ ...BASE_FIELDS, fallback: "random-legal" }),
    ).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when budget.maxMs changes", () => {
    expect(
      manifestVersion({
        ...BASE_FIELDS,
        budget: { ...BASE_FIELDS.budget, maxMs: 751 },
      }),
    ).not.toBe(manifestVersion(BASE_FIELDS));
  });

  test("changes when hierarchical changes", () => {
    expect(manifestVersion({ ...BASE_FIELDS, hierarchical: false })).not.toBe(
      manifestVersion(BASE_FIELDS),
    );
  });

  test("distinguishes manifests whose only difference is name", () => {
    const alpha = manifestVersion({ ...BASE_FIELDS, name: "alpha" });
    const beta = manifestVersion({ ...BASE_FIELDS, name: "beta" });

    expect(alpha).not.toBe(beta);
  });
});

describe("buildManifest", () => {
  test("preserves every field and adds the matching derived version", () => {
    const manifest = buildManifest(BASE_FIELDS);

    expect(manifest).toEqual({
      ...BASE_FIELDS,
      version: manifestVersion(BASE_FIELDS),
    });
    expect(manifest.version).toBe(manifestVersion(BASE_FIELDS));
  });
});

describe("parseManifest", () => {
  test("parses a valid JSON object into a deep-equal manifest", () => {
    const expected = buildManifest(BASE_FIELDS);
    const raw: unknown = JSON.parse(JSON.stringify(expected));

    expect(parseManifest(raw)).toEqual(expected);
  });

  test("rejects a non-object value", () => {
    expectContractViolation("not-a-manifest");
  });

  test("rejects null", () => {
    expectContractViolation(null);
  });

  test("rejects a manifest missing name", () => {
    const { name: omittedName, ...raw } = validRaw();
    void omittedName;

    expectContractViolation(raw);
  });

  test.each(["", "player one", "player/one"])(
    "rejects a name that cannot be embedded in a game ID: %p",
    (name) => {
      expectContractViolation({ ...validRaw(), name });
    },
  );

  test("rejects strategies that are not an array", () => {
    expectContractViolation({ ...validRaw(), strategies: "attack" });
  });

  test("rejects an empty strategies array", () => {
    expectContractViolation({ ...validRaw(), strategies: [] });
  });

  test("rejects an unknown strategy label", () => {
    expectContractViolation({
      ...validRaw(),
      strategies: ["attack", "counter-punch"],
    });
  });

  test("rejects an unknown feature key", () => {
    expectContractViolation({
      ...validRaw(),
      features: ["materialBalance", "initiative"],
    });
  });

  test("rejects negative historyPlies", () => {
    expectContractViolation({ ...validRaw(), historyPlies: -1 });
  });

  test("rejects fractional historyPlies", () => {
    expectContractViolation({ ...validRaw(), historyPlies: 0.1 });
  });

  test("rejects an unknown fallback value", () => {
    expectContractViolation({ ...validRaw(), fallback: "resign" });
  });

  test("rejects a manifest missing budget.maxMs", () => {
    expectContractViolation({
      ...validRaw(),
      budget: { maxCostUsd: 0.02 },
    });
  });

  test.each([0, -1])("rejects budget.maxMs %p", (maxMs) => {
    expectContractViolation({
      ...validRaw(),
      budget: { maxMs, maxCostUsd: 0.02 },
    });
  });

  test("rejects negative budget.maxCostUsd", () => {
    expectContractViolation({
      ...validRaw(),
      budget: { maxMs: 750, maxCostUsd: -0.01 },
    });
  });

  test("accepts zero historyPlies and budget.maxCostUsd", () => {
    const fields: ManifestFields = {
      ...BASE_FIELDS,
      historyPlies: 0,
      budget: { maxMs: 750, maxCostUsd: 0 },
    };
    const manifest = buildManifest(fields);

    expect(parseManifest(manifest)).toEqual(manifest);
  });

  test("rejects a version that disagrees with the fields", () => {
    expectContractViolation({ ...validRaw(), version: "wrong-version" });
  });

  test("rejects extra unexpected fields", () => {
    expectContractViolation({ ...validRaw(), unexpected: true });
  });
});
