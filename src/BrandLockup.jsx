import wrapchatLogo from "../assets/WrapchatLogo_main_2.svg";
const wrapchatLogoTransparent = wrapchatLogo;

export default function BrandLockup({
  subtitle,
  subtitleMarginBottom = 0,
  title = "WrapChat",
  logoSize = 72,
  titleSize = 44,
  titleLetterSpacing = -3,
  inline = false,
  logoSrc = wrapchatLogo,
  accentColor = null,
}) {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: inline ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: inline ? 14 : 0,
        }}
      >
        <img
          src={logoSrc}
          alt=""
          aria-hidden="true"
          style={{
            width: logoSize,
            height: logoSize,
            objectFit: "contain",
            marginBottom: inline ? 0 : 14,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            color: accentColor || "#fff",
            letterSpacing: titleLetterSpacing,
            lineHeight: 1,
            textAlign: "center",
            width: inline ? "auto" : "100%",
          }}
        >
          {title}
        </div>
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.5)",
            marginTop: 8,
            marginBottom: subtitleMarginBottom,
            textAlign: "center",
            fontWeight: 500,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

export { wrapchatLogoTransparent };
