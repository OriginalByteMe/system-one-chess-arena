// Gate: the codebase declares its types up front, so `any` is a defect.
// Also rejects the usual ways people smuggle it back in.
import { Glob } from "bun";

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly rule: string;
}

const RULES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "any-annotation", pattern: /:\s*any\b/ },
  { name: "any-assertion", pattern: /\bas\s+any\b/ },
  { name: "any-generic", pattern: /<\s*any\s*[,>]/ },
  { name: "any-array", pattern: /\bany\s*\[\]/ },
  { name: "double-assertion", pattern: /\bas\s+unknown\s+as\b/ },
  { name: "ts-suppression", pattern: /@ts-(ignore|expect-error|nocheck)/ },
];

const ROOTS = ["src", "scripts", "__tests__", "test-workers", "web"] as const;
const offences: Offence[] = [];

for (const root of ROOTS) {
  // Scanning from the repo root means an absent directory is simply no matches.
  const glob = new Glob(`${root}/**/*.{ts,tsx}`);
  for await (const file of glob.scan({ cwd: ".", onlyFiles: true })) {
    const source = await Bun.file(file).text();
    const lines = source.split("\n");
    for (const [index, text] of lines.entries()) {
      const lead = text.trimStart();
      if (lead.startsWith("//") || lead.startsWith("/*") || lead.startsWith("*")) continue;
      for (const rule of RULES) {
        if (rule.pattern.test(text)) {
          offences.push({ file, line: index + 1, text: text.trim(), rule: rule.name });
        }
      }
    }
  }
}

if (offences.length > 0) {
  for (const offence of offences) {
    console.error(`${offence.file}:${offence.line}  [${offence.rule}]  ${offence.text}`);
  }
  console.error(`\n${offences.length} type-safety offence(s).`);
  process.exit(1);
}

console.log("no-any: clean");
