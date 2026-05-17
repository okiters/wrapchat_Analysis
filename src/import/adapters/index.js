import { IMPORT_FORMATS } from "../importDetector";
import { whatsappTextAdapter } from "./whatsappTextAdapter";
import {
  instagramHtmlAdapter,
  instagramJsonAdapter,
  telegramJsonAdapter,
} from "./placeholderAdapters";

const ADAPTERS_BY_FORMAT = Object.freeze({
  [IMPORT_FORMATS.WHATSAPP_TEXT]: whatsappTextAdapter,
  [IMPORT_FORMATS.TELEGRAM_JSON]: telegramJsonAdapter,
  [IMPORT_FORMATS.INSTAGRAM_JSON]: instagramJsonAdapter,
  [IMPORT_FORMATS.INSTAGRAM_HTML]: instagramHtmlAdapter,
});

export function getImportAdapter(detectedFormat) {
  return ADAPTERS_BY_FORMAT[detectedFormat?.id] || null;
}
