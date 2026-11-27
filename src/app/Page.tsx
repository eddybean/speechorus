// A screen of the main pane, chosen from the left rail (D-54). It has no close button: the rail leads back.
import type { ReactNode } from "react";

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page" role="region" aria-label={title}>
      <header>
        <h2>{title}</h2>
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}
