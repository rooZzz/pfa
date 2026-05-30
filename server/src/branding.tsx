import type { ReactNode } from "react";

const MARK_PATH =
  "M12 12 L52 12 A40 40 0 0 1 12 52 Z M20.3 25.5 a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z";

const MARK_STYLE = `
.pfa-mark-path { fill: #b8673e; }
@media (prefers-color-scheme: dark) { .pfa-mark-path { fill: #de8c5d; } }
:root[data-theme="dark"] .pfa-mark-path { fill: #de8c5d; }
`;

export function QuadrantMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <style>{MARK_STYLE}</style>
      <path className="pfa-mark-path" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

export function Masthead({
  title,
  sub,
  lead,
  action,
  titleSize,
  tight,
}: {
  title: ReactNode;
  sub?: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  titleSize?: string;
  tight?: boolean;
}) {
  return (
    <div className="screen-head" style={tight ? { marginBottom: 0 } : undefined}>
      <div className="row">
        <QuadrantMark />
        {lead}
        <div>
          <div
            className="screen-title"
            style={titleSize ? { fontSize: titleSize } : undefined}
          >
            {title}
          </div>
          {sub ? <div className="screen-sub">{sub}</div> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
