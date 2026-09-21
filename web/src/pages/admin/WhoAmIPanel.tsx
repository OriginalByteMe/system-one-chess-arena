// Who is signed in, from the same Access assertion the API already verified.
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { whoami, type AdminIdentity } from "../../admin-api.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly identity: AdminIdentity };

export function WhoAmIPanel(): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    whoami()
      .then((identity) => {
        if (live) setState({ kind: "ready", identity });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "error", message: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card>
      <CardHead title="Signed in" />
      {state.kind === "loading" && <p className="text-sm text-mist">Checking Access…</p>}
      {state.kind === "error" && <p className="text-sm text-live">{state.message}</p>}
      {state.kind === "ready" && (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-mist">Email</dt>
            <dd className="text-chalk">{state.identity.email}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-mist">Access subject</dt>
            <dd className="tabular text-mist">{state.identity.sub}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
