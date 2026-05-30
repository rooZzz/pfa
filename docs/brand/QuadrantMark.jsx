/* =================================================================
   PFA — "The Quadrant" logomark.  Drop-in React component.
   One geometry; colors are props so every treatment shares it.
   The plumb dot is a real transparent hole (fill-rule evenodd),
   so the mark sits on any background.

   Usage:
     <QuadrantMark size={32} />                       // clay, default
     <QuadrantMark size={32} fill="#221a15" />        // monochrome ink
     <QuadrantMark size={32} fill="var(--accent)" />  // theme token
   ================================================================= */
export function QuadrantMark({ size = 32, fill = "#b8673e", title, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill={fill}
        fillRule="evenodd"
        d="M12 12 L52 12 A40 40 0 0 1 12 52 Z M20.3 25.5 a5.2 5.2 0 1 0 10.4 0 a5.2 5.2 0 1 0 -10.4 0 Z"
      />
    </svg>
  );
}

/* Full lockup: mark + serif wordmark + mono descriptor.
   Relies on the PFA type tokens (Newsreader / IBM Plex Mono). */
export function PfaLockup({ markSize = 40, fill = "#b8673e", descriptor = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: markSize * 0.36 }}>
      <QuadrantMark size={markSize} fill={fill} title="PFA" />
      <span style={{ display: "flex", flexDirection: "column", gap: markSize * 0.07, lineHeight: 1 }}>
        <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontWeight: 500, fontSize: markSize * 0.9, letterSpacing: "0.01em", color: "var(--ink-strong, #221a15)" }}>PFA</span>
        {descriptor ? (
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: markSize * 0.22, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--ink-muted, #7a6a5d)" }}>Personal Finance Assistant</span>
        ) : null}
      </span>
    </span>
  );
}
