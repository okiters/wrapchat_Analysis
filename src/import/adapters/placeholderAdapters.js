function notReady(platform, sourceFormat) {
  const label = `${platform[0].toUpperCase()}${platform.slice(1)} ${sourceFormat.toUpperCase()}`;
  return {
    id: `${platform}:${sourceFormat}`,
    platform,
    sourceFormat,
    parse() {
      throw new Error(`${label} imports are detected, but this parser is not ready yet. For now, please import a supported WhatsApp .txt export.`);
    },
  };
}

export const telegramJsonAdapter = Object.freeze(notReady("telegram", "json"));
export const instagramJsonAdapter = Object.freeze(notReady("instagram", "json"));
export const instagramHtmlAdapter = Object.freeze(notReady("instagram", "html"));
