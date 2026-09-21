// A render error used to blank the page: React unmounts the tree and the only
// trace is in the console. A spectator gets a page that says what broke, and
// the operator gets the message without opening devtools.
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly message?: string;
  readonly stack?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {};

  public static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return stack === undefined ? { message } : { message, stack };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("render failed", error, info.componentStack);
  }

  public override render(): ReactNode {
    const { message, stack } = this.state;
    if (message === undefined) return this.props.children;

    return (
      <div className="flex min-h-full flex-col items-start gap-4 bg-void px-6 py-16 font-sans text-chalk">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em]">
          This page stopped rendering
        </h1>
        <p className="max-w-[70ch] text-[15px] text-mist">
          The error is below. Reloading usually helps; if it does not, the fault is in the page rather
          than in your browser.
        </p>
        <pre className="max-w-full overflow-x-auto rounded-md bg-pit p-4 text-xs text-mist">
          {message}
          {stack === undefined ? "" : `\n\n${stack}`}
        </pre>
        <a
          href="/"
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-void shadow-[0_3px_0_var(--color-brand-lo)]"
        >
          Back to the arena
        </a>
      </div>
    );
  }
}
