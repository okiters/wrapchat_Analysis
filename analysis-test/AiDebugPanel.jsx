import { useMemo, useState } from "react";

function pillStyle(active) {
  return {
    border: `1px solid ${active ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: active ? 800 : 700,
    color: "#fff",
    background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
    cursor: "pointer",
    transition: "all 0.15s",
  };
}

export default function AiDebugPanel({
  enabled = false,
  title = "Local AI inspection",
  description = "Builds the exact request bundle locally without calling Claude.",
  relationshipOptions = [],
  selectedRelationshipType = null,
  onRelationshipTypeChange = () => {},
  exportDisabled = false,
  disabledReason = "",
  jsonText = "",
  onExport = () => {},
  onCopy = () => {},
  onDownload = () => {},
}) {
  const [open, setOpen] = useState(false);
  const hasPreview = Boolean(jsonText);
  const previewText = useMemo(() => jsonText || "", [jsonText]);

  if (!enabled) return null;

  return (
    <div
      style={{
        width: "100%",
        marginTop: 12,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 18,
        padding: "14px 14px 12px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.42)" }}>
        Dev / Debug
      </div>
      <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: -0.2 }}>
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.58)" }}>
        {description}
      </div>

      {relationshipOptions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.42)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Relationship type
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {relationshipOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className="wc-btn"
                style={pillStyle(selectedRelationshipType === option.id)}
                onClick={() => onRelationshipTypeChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className="wc-btn"
          style={{
            borderRadius: 999,
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 800,
            color: exportDisabled ? "rgba(255,255,255,0.35)" : "#fff",
            background: exportDisabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.14)",
            cursor: exportDisabled ? "default" : "pointer",
            transition: "all 0.15s",
          }}
        >
          Export AI Debug JSON
        </button>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasPreview}
          className="wc-btn"
          style={{
            borderRadius: 999,
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 800,
            color: hasPreview ? "#fff" : "rgba(255,255,255,0.35)",
            background: hasPreview ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            cursor: hasPreview ? "pointer" : "default",
          }}
        >
          Copy AI Debug JSON
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!hasPreview}
          className="wc-btn"
          style={{
            borderRadius: 999,
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 800,
            color: hasPreview ? "#fff" : "rgba(255,255,255,0.35)",
            background: hasPreview ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.12)",
            cursor: hasPreview ? "pointer" : "default",
          }}
        >
          Download JSON
        </button>
      </div>

      {disabledReason && (
        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.52)" }}>
          {disabledReason}
        </div>
      )}

      {hasPreview && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="wc-btn"
            onClick={() => setOpen(value => !value)}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
            JSON Preview
          </button>
          {open && (
            <pre
              style={{
                marginTop: 10,
                marginBottom: 0,
                maxHeight: 260,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: "12px 13px",
                borderRadius: 12,
                background: "rgba(7,11,16,0.72)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 11,
                lineHeight: 1.55,
                color: "rgba(255,255,255,0.88)",
              }}
            >
              {previewText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
