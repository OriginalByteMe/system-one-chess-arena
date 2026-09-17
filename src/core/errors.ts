/** Thrown by a module that has its contract and tests but no body yet. */
export class NotImplemented extends Error {
  constructor(subject: string) {
    super(`not implemented: ${subject}`);
    this.name = "NotImplemented";
  }
}

/** Thrown when input that must be trusted turns out not to be. */
export class ContractViolation extends Error {
  constructor(subject: string, detail: string) {
    super(`contract violation in ${subject}: ${detail}`);
    this.name = "ContractViolation";
  }
}
