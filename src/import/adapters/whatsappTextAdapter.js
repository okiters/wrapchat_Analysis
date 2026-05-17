import { parseWhatsAppExport, toAnalysisMessages } from "../whatsappParser";
import { normalizeMessageForAnalysis, normalizeParsedChat } from "../normalizedSchema";

export const whatsappTextAdapter = Object.freeze({
  id: "whatsapp:text",
  platform: "whatsapp",
  sourceFormat: "txt",

  parse(text, { fileName = null } = {}) {
    const parsed = parseWhatsAppExport(text);
    const analysisMessages = toAnalysisMessages(parsed)
      .map((message, index) => normalizeMessageForAnalysis(message, {
        platform: "whatsapp",
        sourceMessageIndex: index,
      }))
      .filter(Boolean);

    return normalizeParsedChat({
      platform: "whatsapp",
      sourceFormat: "txt",
      parserId: "whatsapp:text",
      fileName,
      participants: parsed.participants,
      messages: analysisMessages,
      metadata: {
        ...parsed.metadata,
        originalFormat: parsed.metadata?.format || null,
      },
      formatDetected: parsed.formatDetected,
      tooShort: parsed.tooShort,
    });
  },
});
