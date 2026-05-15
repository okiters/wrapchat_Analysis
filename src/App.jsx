import { useState, useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import _updateNotesRaw from "../docs/update-notes.md?raw";
import { DA, Geo, WaveLines, PrimaryButton, GhostButton, BackIcon, ForwardIcon } from "./theme.jsx";
import html2canvas from "html2canvas";
import { supabase } from "./supabase";
import { processImportedChatFile } from "./import/fileProcessing";
import {
  buildCombinedDataset,
  buildDatasetFromParsedChat,
  detectOtherParticipantMismatches,
  toAnalysisMessagesFromDataset,
} from "./import/datasetBuilder";
import { applyApprovedMerges, normalizeDisplayName } from "./utils/identityMerge";
import { MIN_MESSAGES } from "./import/whatsappParser";
import BrandLockup, { wrapchatLogoTransparent } from "./BrandLockup";
import AiDebugPanel from "../analysis-test/AiDebugPanel.jsx";
import {
  ACCESS_MODES,
  DEFAULT_ACCESS_MODE,
  getAccessMode,
  getAccessModeLabel,
  isOpenMode,
  setAccessMode,
} from "./accessMode";
import {
  CREDIT_BUNDLES,
  QUICK_READ_TRIAL_CONFIG,
  REPORT_PACKS,
  REPORT_PACK_ORDER,
  canUserRunReports,
  deductCreditsAmount,
  estimateAnalysesLeft,
  getCreditBundleById,
  getBundleMatch,
  getPackCreditCost,
  getReportCreditCost,
  getTotalCreditCostBundled,
} from "./reportCredits";
import {
  buildDebugAnalysisExport,
  createAiDebugFileName,
  createAiRawDebugFileName,
  downloadTextFile,
  downloadJsonFile,
  prepareConnectionDigestRequest,
  prepareCoreAnalysisARequest,
  prepareGrowthDigestRequest,
  prepareCoreAnalysisBRequest,
  prepareRiskDigestRequest,
  serializeDebugAnalysisExport,
} from "../analysis-test/aiDebugHelpers.js";
import partnerIcon from "../assets/partner.svg";
import datingIcon from "../assets/dating.svg";
import exIcon from "../assets/ex.svg";
import familyIcon from "../assets/family.svg";
import friendIcon from "../assets/friend.svg";
import colleagueIcon from "../assets/colleage.svg";
import otherIcon from "../assets/other.svg";
import cardShareIcon from "../assets/card-share.svg";
import sumShareIcon from "../assets/sum-share.svg";
import { buildTrialPrompt, deriveTrialReport } from "./trialReport";

// Provided by App during the results phase; Shell reads it to show the close button.
// null means "no close button" (upload, auth, loading, etc.)
const CloseResultsContext = createContext(null);
const ShareResultsContext = createContext(null);
const FeedbackContext = createContext(null);

// Provided by Slide; Shell reads it to animate only its content area.
const SlideContext = createContext({ dir: "fwd", id: 0 });

// Provided by Shell so inner components (AICard etc.) can auto-adopt the section palette.
const SectionPaletteContext = createContext(null);

// UI language preference — language codes are manual, "auto" follows detected chat lang.
// uiLang is the resolved code ("en","tr","es","pt","ar","fr","de","it").
const UILanguageContext = createContext({ uiLang: "en", uiLangPref: "en", updateUiLangPref: () => {} });
function useUILanguage() { return useContext(UILanguageContext); }
function useT() {
  const { uiLang } = useUILanguage();
  return (key, vars) => translateUI(uiLang, key, vars);
}

function isAdminUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function GearIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6.9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function SolidStarIcon({ size = 13, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" focusable="false">
      <path d="M12 2.1 15.1 8.4 22 9.4 17 14.3 18.2 21.1 12 17.9 5.8 21.1 7 14.3 2 9.4 8.9 8.4 12 2.1Z" />
    </svg>
  );
}

const FEEDBACK_OPTIONS = [
  "Nothing. Very accurate.",
  "Events are mixing",
  "Wrong person",
  "Didn't happen",
  "Tone misread",
  "Overclaiming",
  "Missing context",
  "Other",
];
const POSITIVE_FEEDBACK_OPTION = "Nothing. Very accurate.";

function getFeedbackSentiment(option) {
  return option === POSITIVE_FEEDBACK_OPTION ? "positive" : "negative";
}

const ADMIN_EMAILS = Array.from(new Set(
  String(import.meta.env.VITE_ADMIN_EMAILS || import.meta.env.VITE_ADMIN_EMAIL || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
));

// ─────────────────────────────────────────────────────────────────
// LANGUAGE DETECTION  — heuristic only, no external dependency.
// Call detectLanguage(messages) → { code, label, confidence }.
// Upgrade this block freely without touching any other section.
// ─────────────────────────────────────────────────────────────────

// Human-readable labels for every supported language code.
const LANG_META = {
  en: "English",
  tr: "Turkish",
  es: "Spanish",
  pt: "Portuguese",
  ar: "Arabic",
  fr: "French",
  de: "German",
  it: "Italian",
};

const UI_TRANSLATIONS = {
  en: {
    "quips.duo.obsessed": [
      `"{name}, you might want to check your screen time."`,
      `"{name} is carrying this conversation on pure texting stamina."`,
      `"Not obsessed, just extremely available. Sure, {name}."`,
    ],
    "quips.duo.responseBalanced": [
      `"Both of you are equally responsive. No ghosts here."`,
      `"Neither of you keeps the other waiting. Refreshing."`,
      `"Both responsive, both showing up. This is what balance looks like."`,
    ],
    "quips.duo.ghost": [
      `"{name} was 'busy'. Sure."`,
      `"{name}: read at 14:32. Replied at... eventually."`,
      `"{name} treats replies like a limited resource."`,
    ],
    "quips.duo.lastWord": [
      `"{name} sends a message. The chat decides not to continue."`,
      `"Last seen: {name}'s message, unanswered."`,
      `"{name} has a gift for sending the final word."`,
    ],
    "quips.duo.streak100": [
      `"{streak} days. That's not a streak, that's a lifestyle."`,
      `"Over {streak} consecutive days. Whatever this is, it's real."`,
      `"{streak} days straight. That's serious consistency."`,
    ],
    "quips.duo.streak30": [
      `"{streak} days without a gap. That kind of consistency is rare."`,
      `"A whole month-plus of showing up. That means something."`,
      `"No gaps. No excuses. Just {streak} days straight."`,
    ],
    "quips.duo.streak10": [
      `"{streak} days in a row. Not bad at all."`,
      `"Okay, that's actually kind of cute."`,
      `"A solid run. Something was clearly working during those {streak} days."`,
    ],
    "quips.duo.streakShort": [
      `"{streak} days. Short but real."`,
      `"Even a {streak}-day streak is something."`,
      `"{streak} days of not missing each other still counts."`,
    ],
    "quips.duo.convStarter": [
      `"Someone is always thinking of the other one first."`,
      `"{name} is always the one who breaks the silence first."`,
      `"The first text keeps coming from {name}. That says a lot."`,
    ],
    "quips.duo.messageLengthSimilar": [
      `"Almost identical message lengths. Suspiciously balanced."`,
      `"No novelist here, no texter either. Just two people typing about the same amount."`,
      `"Balanced. No essays, no one-word replies. Suspiciously normal."`,
    ],
    "quips.duo.messageLengthDifferent": [
      `"{novelist} treats every text like a letter to posterity."`,
      `"Somewhere {novelist} is still typing."`,
      `"{texter} replies. {novelist} responds. There's a difference."`,
    ],
    "quips.group.mainCharacter": [
      `"{name}, this is basically your personal blog."`,
      `"{name} came here to talk and is absolutely doing that."`,
      `"Without {name} this chat would be a graveyard."`,
    ],
    "quips.group.ghost": [
      `"{name} is here in spirit. Only in spirit."`,
      `"{name} joined the group and immediately disappeared into witness protection."`,
      `"A silent observer. A lurker. A mystery. {name}."`,
    ],
    "quips.group.lastWord": [
      `"{name} sends a message. The group doesn't respond. Classic."`,
      `"After {name}'s message, the group goes quiet every time."`,
      `"{name} has a habit of sending messages into the void."`,
    ],
    "quips.group.streak100": [
      `"{streak} days without a single gap. This group is built different."`,
      `"Over {streak} consecutive days. That's not a group chat, that's a commitment."`,
      `"Whatever keeps this group going, bottle it."`,
    ],
    "quips.group.streak30": [
      `"{streak} days of showing up. That's a real group."`,
      `"Not a single day off. This group has commitment in reverse."`,
      `"Most group chats go quiet after two weeks. This one didn't."`,
    ],
    "quips.group.streak10": [
      `"{streak} days in a row. The group was alive."`,
      `"You all actually like each other. Surprising."`,
      `"{streak} consecutive days. That's more than most groups manage."`,
    ],
    "quips.group.streakShort": [
      `"{streak} days. Small but it counts."`,
      `"A {streak}-day run still means something was happening."`,
      `"Even {streak} days in a row takes effort."`,
    ],
    "quips.group.novelist": [
      `"{name} types like the word limit doesn't exist."`,
      `"{name} sends messages with full plot development."`,
      `"If there is an essay in the group, {name} wrote it."`,
    ],
  },
  tr: {
    "Choose your language": "Dilini seç",
    "English": "İngilizce",
    "Auto-detect": "Otomatik algıla",
    "Continue": "Devam et",
    "Back": "Geri",
    "Next": "İleri",
    "See summary": "Özeti gör",
    "Done": "Bitti",
    "Start over": "Baştan başla",
    "Share": "Paylaş",
    "What's off about this?": "Burada yanlış olan ne?",
    "Optional note": "İsteğe bağlı not",
    "Cancel": "İptal",
    "Submit": "Gönder",
    "Sending…": "Gönderiliyor…",
    "Got it, thank you.": "Tamamdır, teşekkürler.",
    "Events are mixing": "Olaylar karışmış",
    "Wrong person": "Yanlış kişi",
    "Didn't happen": "Hiç yaşanmadı",
    "Tone misread": "Ton yanlış okunmuş",
    "Overclaiming": "Fazla iddialı",
    "Missing context": "Bağlam eksik",
    "Other": "Diğer",
    "The Roast": "Kavrulma",
    "The Lovely": "Tatlı Taraf",
    "The Funny": "Komik Taraf",
    "The Stats": "İstatistikler",
    "Insight": "İçgörü",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Toksisite Raporu",
    "Love Language": "Sevgi Dili",
    "Growth Report": "Gelişim Raporu",
    "Accountability": "Sorumluluk",
    "Energy Report": "Enerji Raporu",
    "Choose your report": "Raporunu seç",
    "Who is this chat with?": "Bu sohbet kiminle?",
    "This helps the AI frame the analysis correctly.": "Bu, yapay zekanın analizi doğru çerçevelemesine yardımcı olur.",
    "Partner": "Partner",
    "Dating": "Flört",
    "Ex": "Eski sevgili",
    "Related": "Akraba",
    "Friend": "Arkadaş",
    "Colleague": "İş arkadaşı",
    "Romantic partner or spouse": "Romantik partner ya da eş",
    "Seeing each other or early stages": "Görüşüyorsunuz ya da ilişkinin başları",
    "Former romantic partner": "Eski romantik partner",
    "Parent, sibling or relative": "Ebeveyn, kardeş ya da akraba",
    "Close friend or bestie": "Yakın arkadaş ya da kanka",
    "Coworker or professional contact": "İş arkadaşı ya da profesyonel tanıdık",
    "Someone you know": "Tanıdığın biri",
    "Reading your messages...": "Mesajların okunuyor...",
    "Finding the patterns...": "Örüntüler bulunuyor...",
    "Figuring out who's funny...": "Kimin komik olduğu çözülüyor...",
    "Detecting the drama...": "Dramalar tespit ediliyor...",
    "Reading between the lines...": "Satır araları okunuyor...",
    "Almost done...": "Neredeyse bitti...",
    "Upload different file": "Farklı bir dosya yükle",
    "Upload your chat": "Sohbetini yükle",
    "Reading your chat…": "Sohbetin okunuyor…",
    "My Results": "Sonuçlarım",
    "Settings": "Ayarlar",
    "Delete my account": "Hesabımı sil",
    "Relationship": "İlişki",
    "Report Type": "Rapor Türü",
    "Are you sure you want to delete your account?": "Hesabınızı silmek istediğinizden emin misiniz?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Tüm kayıtlı sonuçların silinecek. Bu işlem WrapChat hesabını kalıcı olarak siler ve geri alınamaz.",
    "Delete account": "Hesabı sil",
    "Deleting...": "Siliniyor...",
    "Edit": "Düzenle",
    "Your chats, unwrapped.": "Sohbetlerinin şifresi çözülüyor.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Grup ya da ikili sohbet otomatik algılanır. Sohbetin yapay zekâ ile analiz edilir ve asla saklanmaz. Yalnızca sonuçlar kaydedilir.",
    "UI language": "Arayüz dili",
    "Report language": "Rapor dili",
    "auto": "otomatik",
    "changed": "değişti",
    "Who's more obsessed?": "Kim daha takıntılı?",
    "The Ghost Award": "Hayalet Ödülü",
    "Response times": "Yanıt süreleri",
    "Balanced": "Dengeli",
    "The Last Word": "Son Sözü Söyleyen",
    "Your longest streak": "En uzun seriniz",
    "The Kindest One": "En Nazik Olan",
    "The Hype Person": "Gaz Veren Kişi",
    "The Funny One": "En Komik Olan",
    "Spirit emojis": "Ruh emojileri",
    "Group spirit emoji": "Grubun ruh emojisi",
    "Most used emojis": "En çok kullanılan emojiler",
    "Most used words": "En çok kullanılan kelimeler",
    "Stats": "İstatistikler",
    "How you connect": "Nasıl bağlanıyorsunuz",
    "Two reads from the AI.": "Yapay zekadan iki yorum.",
    "The vibe": "Sohbet havası",
    "My Results": "Sonuçlarım",
    "Upgrade": "Yükselt",
    "Top 10 most used words": "En çok kullanılan 10 kelime",
    "Signature phrases": "İmza cümleler",
    "Message length": "Mesaj uzunluğu",
    "The Novelist vs The Texter": "Roman yazarı ve kısa mesajcı",
    "The Novelist": "Roman yazarı",
    "Media and links": "Medya ve linkler",
    "What you actually talk about": "Aslında ne konuşuyorsunuz",
    "The Drama Report": "Drama Raporu",
    "What's really going on": "Aslında neler oluyor",
    "Chat vibe": "Sohbet havası",
    "Relationship reading": "İlişki yorumu",
    "Evidence log": "Kanıt dökümü",
    "What the chat shows": "Sohbetin gösterdiği şey",
    "Toxicity scorecard": "Toksisite puan kartı",
    "Tension snapshot": "Gerilim özeti",
    "What keeps repeating": "Sürekli tekrar eden şey",
    "Toxicity report": "Toksisite raporu",
    "The Main Character": "Ana karakter",
    "The Ghost": "Hayalet",
    "Longest active streak": "En uzun aktif seri",
    "Group roles": "Grup rolleri",
    "Most missed member": "En çok özlenen üye",
    "The group read": "Grup yorumu",
    "Group vibe": "Grup havası",
    "Group pattern read": "Grup örüntü yorumu",
    "Support and strain": "Destek ve yük",
    "Chat Health Score": "Sohbet Sağlık Puanı",
    "Individual health scores": "Bireysel sağlık puanları",
    "Who apologises more": "Kim daha çok özür diliyor",
    "Red flag moments": "Kırmızı bayrak anları",
    "Conflict pattern": "Çatışma örüntüsü",
    "Power balance": "Güç dengesi",
    "The verdict": "Son karar",
    "Love language compatibility": "Sevgi dili uyumu",
    "The language gap": "Dil farkı",
    "Most loving moment": "En sevgi dolu an",
    "Then vs Now": "O zaman ve şimdi",
    "Who changed more": "Kim daha çok değişti",
    "What changed in the chat": "Sohbette ne değişti",
    "Relationship trajectory": "İlişkinin gidişatı",
    "The arc": "Hikâye akışı",
    "Promises made": "Verilen sözler",
    "Most notable broken promise": "En dikkat çeken tutulmayan söz",
    "Most notable kept promise": "En dikkat çeken tutulan söz",
    "The overall verdict": "Genel karar",
    "Net energy scores": "Net enerji puanları",
    "Energy compatibility": "Enerji uyumu",
    "Most energising moment": "En enerji veren an",
    "Most draining moment": "En yoran an",
    "How they do it": "Bunu nasıl yapıyor",
    "Drops lines like": "Şöyle cümleler kuruyor",
    "The sweetest moment": "En tatlı an",
    "Why this person scores highest": "Bu kişi neden en yüksek puanı aldı",
    "How arguments unfold": "Tartışmalar nasıl ilerliyor",
    "Power dynamic": "Güç dinamiği",
    "Final read": "Son yorum",
    "Score breakdown": "Puan dökümü",
    "Do they speak the same language?": "Aynı dili konuşuyorlar mı?",
    "The moment": "O an",
    "Compatibility read": "Uyum yorumu",
    "How they changed": "Nasıl değiştiler",
    "Topics that appeared": "Ortaya çıkan konular",
    "Topics that faded": "Azalan konular",
    "What the data shows": "Verinin gösterdiği",
    "Overall verdict": "Genel karar",
    "Pattern": "Örüntü",
    "Positive energy": "Pozitif enerji",
    "Draining patterns": "Yoran örüntüler",
    "Most active 3 months": "En aktif 3 ay",
    "avg chars": "ort. karakter",
    "longest message": "en uzun mesaj",
    "msgs": "mesaj",
    "Photos & videos": "Fotoğraflar ve videolar",
    "Voice memos": "Sesli notlar",
    "Links shared": "Paylaşılan linkler",
    "Your relationship, in data.": "İlişkin verilerle önünde.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Sohbet dışa aktarımını okur ve aslında neler olduğunu gösterir. Kim varlık gösteriyor. Kim kayboluyor. Sohbeti kim taşıyor.",
    "Start with your chat.": "Sohbetinle başla.",
    "Upload. Analyse. See it clearly.": "Yükle. Analiz et. Net gör.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Altı rapor. Toksisite, sevgi dilleri, sorumluluk, enerji, gelişim ve tam sohbet özetin. Sonuçlar bir dakikadan kısa sürede.",
    "Open your messaging app": "Mesajlaşma uygulamanı aç",
    "Tap the chat you want to analyse": "Analiz etmek istediğin sohbete dokun",
    "Tap ··· menu → More → Export Chat": "··· menüsüne dokun → Daha fazla → Sohbeti dışa aktar",
    "Choose Without Media": "Medya olmadan seç",
    "Save the .txt file to your device": ".txt dosyasını cihazına kaydet",
    "Toxicity": "Toksisite",
    "Love Languages": "Sevgi Dilleri",
    "Energy": "Enerji",
    "Growth": "Gelişim",
    "Chat Wrapped": "Sohbet Özeti",
    "General Wrapped": "Genel Özet",
    "The full Wrapped-style deep dive — stats, AI insights, and your chat personality.": "Wrapped tarzı tam derin inceleme: istatistikler, yapay zekâ içgörüleri ve sohbet kişiliğin.",
    "Red flags, power imbalances, who apologises more, conflict patterns, health scores.": "Kırmızı bayraklar, güç dengesizlikleri, kimin daha çok özür dilediği, çatışma örüntüleri ve sağlık puanları.",
    "Love Language Report": "Sevgi Dili Raporu",
    "How each person shows affection, mapped to the 5 love languages. Works for friends too.": "Her kişinin sevgisini nasıl gösterdiğini 5 sevgi diline göre haritalar. Arkadaşlıklar için de çalışır.",
    "First 3 months vs last 3 months — are you growing together or drifting apart?": "İlk 3 ay ve son 3 ay karşılaştırması: beraber mi büyüyorsunuz, yoksa uzaklaşıyor musunuz?",
    "Accountability Report": "Sorumluluk Raporu",
    "Promises made in the chat and whether they were followed through. Receipts for both.": "Sohbette verilen sözler ve tutulup tutulmadıkları. Her iki taraf için de kanıtlar.",
    "Who brings good energy vs drains it — net energy score per person.": "Kim iyi enerji getiriyor, kim tüketiyor: kişi başına net enerji puanı.",
    "quips.duo.obsessed": [
      `"{name}, ekran sürene bir bakman gerekebilir."`,
      `"{name} bu sohbeti saf mesajlaşma dayanıklılığıyla taşıyor."`,
      `"Takıntı değil, sadece aşırı müsait. Tabii {name}."`,
    ],
    "quips.duo.responseBalanced": [
      `"İkiniz de aynı derecede hızlı dönüyorsunuz. Burada hayalet yok."`,
      `"Kimse diğerini bekletmiyor. Ferahlatıcı."`,
      `"İkiniz de cevap veriyor, ikiniz de varlık gösteriyor. Denge böyle bir şey."`,
    ],
    "quips.duo.ghost": [
      `"{name} 'meşguldüm' dedi. Tabii."`,
      `"{name}: mesajı okudu, sonra... bir ara cevap verdi."`,
      `"{name} cevapları sınırlı kaynak gibi kullanıyor."`,
    ],
    "quips.duo.lastWord": [
      `"{name} mesaj atıyor. Sohbet devam etmemeye karar veriyor."`,
      `"Son görülen: {name}'in cevapsız mesajı."`,
      `"{name} son sözü söyleme konusunda özel yetenekli."`,
    ],
    "quips.duo.streak100": [
      `"{streak} gün. Buna seri değil, yaşam tarzı denir."`,
      `"{streak} gün üst üste. Bu her neyse gerçek."`,
      `"{streak} gün boyunca kesintisiz. Ciddi bir tutarlılık."`,
    ],
    "quips.duo.streak30": [
      `"{streak} gün aralıksız. Böyle bir istikrar nadir."`,
      `"Bir aydan fazla süre boyunca sürekli var olmak bir şey anlatır."`,
      `"Bahane yok, boşluk yok. Sadece {streak} gün üst üste."`,
    ],
    "quips.duo.streak10": [
      `"{streak} gün üst üste. Hiç fena değil."`,
      `"Tamam, bu aslında biraz tatlı."`,
      `"O {streak} gün boyunca bir şeyler net şekilde iyi gidiyordu."`,
    ],
    "quips.duo.streakShort": [
      `"{streak} gün. Kısa ama gerçek."`,
      `"Bir {streak} günlük seri bile bir şeydir."`,
      `"{streak} gün boyunca birbirini kaçırmamak yine sayılır."`,
    ],
    "quips.duo.convStarter": [
      `"Birisi hep önce diğerini düşünüyor."`,
      `"{name} sessizliği ilk bozan kişi olmaya devam ediyor."`,
      `"İlk mesajın sürekli {name}'den gelmesi çok şey söylüyor."`,
    ],
    "quips.duo.messageLengthSimilar": [
      `"Mesaj uzunlukları neredeyse aynı. Şüpheli derecede dengeli."`,
      `"Burada ne romancı var ne de tek kelimelik mesajcı. Sadece benzer uzunlukta yazan iki kişi."`,
      `"Dengeli. Ne destan ne tek kelimelik cevap. Şüpheli derecede normal."`,
    ],
    "quips.duo.messageLengthDifferent": [
      `"{novelist} her mesajı gelecek nesillere mektup gibi görüyor."`,
      `"Bir yerlerde {novelist} hâlâ yazıyor."`,
      `"{texter} cevap veriyor. {novelist} ise yanıt değil, paragraf gönderiyor."`,
    ],
    "quips.group.mainCharacter": [
      `"{name}, bu resmen senin kişisel blogun."`,
      `"{name} konuşmaya gelmiş ve gerçekten konuşuyor."`,
      `"{name} olmasa bu sohbet mezarlık olurdu."`,
    ],
    "quips.group.ghost": [
      `"{name} sadece ruhen burada."`,
      `"{name} gruba katıldı ve anında kayıplara karıştı."`,
      `"Sessiz gözlemci. Gizemli izleyici. {name}."`,
    ],
    "quips.group.lastWord": [
      `"{name} mesaj atıyor. Grup cevap vermiyor. Klasik."`,
      `"{name}'in mesajından sonra grup her seferinde sessizleşiyor."`,
      `"{name} mesajları boşluğa göndermeyi alışkanlık hâline getirmiş."`,
    ],
    "quips.group.streak100": [
      `"{streak} gün tek bir boşluk bile olmadan. Bu grup farklı."`,
      `"{streak} gün üst üste. Bu grup sohbetten çok taahhüt."`,
      `"Bu grubu ayakta tutan şeyi şişeleyip satmak lazım."`,
    ],
    "quips.group.streak30": [
      `"{streak} gün boyunca ortadasınız. Bu gerçek bir grup."`,
      `"Tek bir gün bile boş yok. Bu grubun tersinden bağlılık sorunu var."`,
      `"Çoğu grup iki haftada susar. Bu grup susmadı."`,
    ],
    "quips.group.streak10": [
      `"{streak} gün üst üste. Grup yaşıyormuş."`,
      `"Demek ki hepiniz birbirinizi gerçekten seviyorsunuz. Şaşırtıcı."`,
      `"{streak} gün üst üste. Çoğu grubun becerdiğinden fazla."`,
    ],
    "quips.group.streakShort": [
      `"{streak} gün. Küçük ama sayılır."`,
      `"Bir {streak} günlük seri bile grupta bir şeyler olduğunu gösterir."`,
      `"Arka arkaya {streak} gün bile emek ister."`,
    ],
    "quips.group.novelist": [
      `"{name} sanki kelime sınırı yokmuş gibi yazıyor."`,
      `"{name} mesaj değil, tam hikâye gönderiyor."`,
      `"Grupta bir deneme yazısı varsa onu {name} yazmıştır."`,
    ],
    // ── Missing strings added ──
    "Red flag {index}": "Kırmızı bayrak {index}",
    "This pattern showed up enough to feel worth watching.": "Bu örüntü dikkat çekecek kadar sık karşımıza çıktı.",
    "Evidence": "Kanıt",
    "{pct}% of all messages came from {name}.": "Tüm mesajların %{pct}'i {name}'den geldi.",
    "{name} avg reply:": "{name} ort. yanıt:",
    "Sends the last message that nobody replies to — {count} times.": "Yanıtsız kalan son mesajı gönderen kişi — {count} kez.",
    "Sends the last message that nobody replies to.": "Yanıtsız kalan son mesajı gönderen kişi.",
    "{count} days": "{count} gün",
    "Texted every single day for {count} days straight.": "{count} gün boyunca her gün mesajlaştınız.",
    "Top 3 most active months": "En aktif 3 ay",
    "{month} was your month. Something was going on.": "{month} sizin ayınızdı. Bir şeyler oluyordu.",
    "Who always reaches out first?": "Her zaman ilk kim yazıyor?",
    "Started {pct} of all conversations.": "Tüm konuşmaların %{pct}'ini başlattı.",
    "These two emojis basically ARE this chat.": "Bu iki emoji bu sohbeti tam olarak özetliyor.",
    "The phrases that define each of you.": "Her birinizi tanımlayan cümleler.",
    "Biggest topic": "En büyük konu",
    "Most tense moment": "En gergin an",
    "A chaotic, wholesome connection.": "Kaotik ama sağlıklı bir bağ.",
    "Powered by AI — your messages never left your device.": "Yapay zekâ destekli — mesajların hiçbir zaman cihazını terk etmedi.",
    "Observed pattern": "Gözlemlenen örüntü",
    "Concrete example": "Somut örnek",
    "Main topic": "Ana konu",
    "Pattern note": "Örüntü notu",
    "The strongest pattern is shown above.": "En belirgin örüntü yukarıda gösterilmektedir.",
    "Overall read": "Genel yorum",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Bu mod sana karar vermek için değil, örüntüleri ve örnekleri göstermek için tasarlandı.",
    "{count} messages total. Why are they even here?": "Toplam {count} mesaj. Neden buradalar ki?",
    "The group was most alive in {month}.": "Grup en çok {month} ayında aktifti.",
    "The group kept the chat alive for {count} days straight.": "Grup, sohbeti {count} gün boyunca kesintisiz canlı tuttu.",
    "Started {pct} of all conversations. The engine of this group.": "Tüm konuşmaların %{pct}'ini başlattı. Bu grubun motoru.",
    "Why {name} is the hype": "{name} neden gaz veriyor",
    "This one emoji basically summarises the entire group energy.": "Bu tek emoji grubun tüm enerjisini özetliyor.",
    "Their longest message was mostly about \"{topic}\".": "En uzun mesajı büyük ölçüde \"{topic}\" hakkındaydı.",
    "The inside joke": "Grup içi şaka",
    "When they go quiet, the group feels it.": "Sessiz kaldığında, grup bunu hissediyor.",
    "Group dynamic": "Grup dinamiği",
    "Chaotic. Wholesome. Somehow still going.": "Kaotik. Sağlıklı. Bir şekilde hâlâ devam ediyor.",
    "Who keeps it going": "Kim devam ettiriyor",
    "{name} started {pct} of conversations.": "{name} konuşmaların %{pct}'ini başlattı.",
    "The group shares the conversation starts.": "Grup konuşma başlatmayı paylaşıyor.",
    "Who goes quiet": "Kim sessizleşiyor",
    "{name} is the least active member in the sampled history.": "{name}, örneklenen geçmişte en az aktif üye.",
    "No clear ghost in this sample.": "Bu örnekte belirgin bir hayalet yok.",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "10 üzerinden — çatışma örüntüleri, iletişim tarzı ve genel dinamiğe göre.",
    "Verdict": "Karar",
    "Overall chat health score.": "Genel sohbet sağlık puanı.",
    "Reflects patterns in this sample — not a final judgment.": "Bu örnekteki örüntüleri yansıtır — kesin bir yargı değildir.",
    "{name}'s love language": "{name}'in sevgi dili",
    "How they show it": "Bunu nasıl gösteriyor",
    "Early messages": "Erken mesajlar",
    "Recent messages": "Son mesajlar",
    "promises": "söz",
    "{name}'s accountability": "{name}'in sorumluluğu",
    "kept": "tutuldu",
    "broken": "bozuldu",
    "{name}'s energy": "{name}'in enerjisi",
    "messages": "mesaj",
    "Skip": "Geç",
    "Log out": "Çıkış yap",
    "Feedback Inbox": "Geri Bildirim Kutusu",
    "Large group detected — analysing the top {cap} members out of {count}.": "Büyük grup algılandı — {count} üyeden en aktif {cap} tanesi analiz ediliyor.",
  },
  es: {
    "Choose your language": "Elige tu idioma",
    "English": "Inglés",
    "Auto-detect": "Detección automática",
    "Continue": "Continuar",
    "Back": "Atrás",
    "Next": "Siguiente",
    "See summary": "Ver resumen",
    "Done": "Listo",
    "Start over": "Empezar de nuevo",
    "Share": "Compartir",
    "What's off about this?": "¿Qué está mal aquí?",
    "Optional note": "Nota opcional",
    "Cancel": "Cancelar",
    "Submit": "Enviar",
    "Sending…": "Enviando…",
    "Got it, thank you.": "Entendido, gracias.",
    "Events are mixing": "Se mezclan los eventos",
    "Wrong person": "Persona equivocada",
    "Didn't happen": "No ocurrió",
    "Tone misread": "Tono mal interpretado",
    "Overclaiming": "Afirma demasiado",
    "Missing context": "Falta contexto",
    "Other": "Otro",
    "The Roast": "La Quemada",
    "The Lovely": "Lo Tierno",
    "The Funny": "Lo Divertido",
    "The Stats": "Las Estadísticas",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Informe de Toxicidad",
    "Love Language": "Lenguaje del Amor",
    "Growth Report": "Informe de Evolución",
    "Accountability": "Responsabilidad",
    "Energy Report": "Informe de Energía",
    "Choose your report": "Elige tu informe",
    "Who is this chat with?": "¿Con quién es este chat?",
    "This helps the AI frame the analysis correctly.": "Esto ayuda a la IA a enfocar bien el análisis.",
    "Partner": "Pareja",
    "Dating": "Saliendo",
    "Ex": "Ex",
    "Related": "Familia",
    "Friend": "Amigo",
    "Colleague": "Colega",
    "Romantic partner or spouse": "Pareja romántica o cónyuge",
    "Seeing each other or early stages": "Conociéndose o en etapas iniciales",
    "Former romantic partner": "Expareja romántica",
    "Parent, sibling or relative": "Padre, hermano o familiar",
    "Close friend or bestie": "Amigo cercano o mejor amigo",
    "Coworker or professional contact": "Compañero de trabajo o contacto profesional",
    "Someone you know": "Alguien que conoces",
    "Reading your messages...": "Leyendo tus mensajes...",
    "Finding the patterns...": "Buscando los patrones...",
    "Figuring out who's funny...": "Viendo quién es el gracioso...",
    "Detecting the drama...": "Detectando el drama...",
    "Reading between the lines...": "Leyendo entre líneas...",
    "Almost done...": "Casi listo...",
    "Upload different file": "Subir otro archivo",
    "Upload your chat": "Sube tu chat",
    "Reading your chat…": "Leyendo tu chat…",
    "My Results": "Mis resultados",
    "Settings": "Ajustes",
    "Delete my account": "Eliminar mi cuenta",
    "Relationship": "Relación",
    "Report Type": "Tipo de informe",
    "Are you sure you want to delete your account?": "¿Estás seguro de que quieres eliminar tu cuenta?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Todos tus resultados guardados se perderán. Esto elimina permanentemente tu cuenta de WrapChat y no se puede deshacer.",
    "Delete account": "Eliminar cuenta",
    "Deleting...": "Eliminando...",
    "Edit": "Editar",
    "Your chats, unwrapped.": "Tus chats, al descubierto.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Se detecta automáticamente si es grupo o dúo. Tu chat se analiza con IA y nunca se guarda. Solo se guardan los resultados.",
    "UI language": "Idioma de la interfaz",
    "Report language": "Idioma del informe",
    "auto": "auto",
    "changed": "cambiado",
    "quips.duo.obsessed": [`"{name}, quizá deberías revisar tu tiempo de pantalla."`,`"{name} está sosteniendo esta conversación con pura resistencia al texto."`,`"No es obsesión, solo demasiada disponibilidad. Claro, {name}."`],
    "quips.duo.responseBalanced": [`"Ambos responden igual de rápido. No hay fantasmas aquí."`,`"Nadie deja esperando a la otra persona. Se agradece."`,`"Los dos aparecen y responden. Así se ve el equilibrio."`],
    "quips.duo.ghost": [`"Claro, {name} estaba 'ocupado'."`,`"{name}: leyó el mensaje y respondió... eventualmente."`,`"{name} trata las respuestas como un recurso limitado."`],
    "quips.duo.lastWord": [`"{name} manda un mensaje y la conversación termina ahí."`,`"Última escena: el mensaje de {name}, sin respuesta."`,`"{name} tiene talento para poner la última palabra."`],
    "quips.duo.streak100": [`"{streak} días. Eso no es una racha, es un estilo de vida."`,`"Más de {streak} días seguidos. Lo que sea esto, es real."`,`"{streak} días seguidos. Eso es consistencia seria."`],
    "quips.duo.streak30": [`"{streak} días sin huecos. Eso es raro."`,`"Más de un mes apareciendo. Eso significa algo."`,`"Sin pausas, sin excusas. Solo {streak} días seguidos."`],
    "quips.duo.streak10": [`"{streak} días seguidos. Nada mal."`,`"Vale, eso sí es un poco tierno."`,`"Algo estaba funcionando en esos {streak} días."`],
    "quips.duo.streakShort": [`"{streak} días. Corto, pero real."`,`"Incluso una racha de {streak} días cuenta."`,`"{streak} días sin dejar de hablar también suma."`],
    "quips.duo.convStarter": [`"Alguien piensa primero en la otra persona cada vez."`,`"{name} siempre rompe el silencio primero."`,`"El primer mensaje sigue viniendo de {name}. Eso dice mucho."`],
    "quips.duo.messageLengthSimilar": [`"Mensajes casi idénticos. Sospechosamente equilibrado."`,`"Aquí no hay novelista ni minimalista. Solo dos personas escribiendo parecido."`,`"Equilibrado. Sin ensayos, sin respuestas de una palabra."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} trata cada mensaje como una carta para la posteridad."`,`"En algún lugar, {novelist} sigue escribiendo."`,`"{texter} responde. {novelist} redacta."`],
    "quips.group.mainCharacter": [`"{name}, esto es básicamente tu blog personal."`,`"{name} vino a hablar y claramente lo está haciendo."`,`"Sin {name}, este chat sería un cementerio."`],
    "quips.group.ghost": [`"{name} está aquí solo en espíritu."`,`"{name} entró al grupo y desapareció al instante."`,`"Observador silencioso. Misterio total. {name}."`],
    "quips.group.lastWord": [`"{name} manda un mensaje. El grupo no responde. Clásico."`,`"Después del mensaje de {name}, el grupo se calla cada vez."`,`"{name} tiene la costumbre de lanzar mensajes al vacío."`],
    "quips.group.streak100": [`"{streak} días sin un solo hueco. Este grupo es distinto."`,`"Más de {streak} días seguidos. Esto ya es compromiso."`,`"Lo que mantiene vivo a este grupo debería venderse."`],
    "quips.group.streak30": [`"{streak} días apareciendo. Eso es un grupo de verdad."`,`"Ni un día libre. Este grupo va en serio."`,`"La mayoría de los grupos mueren en dos semanas. Este no."`],
    "quips.group.streak10": [`"{streak} días seguidos. El grupo estaba vivo."`,`"Parece que sí se caen bien. Sorpresa."`,`"{streak} días seguidos. Más que la mayoría de los grupos."`],
    "quips.group.streakShort": [`"{streak} días. Poco, pero cuenta."`,`"Una racha de {streak} días igual significa algo."`,`"Incluso {streak} días seguidos requieren ganas."`],
    "quips.group.novelist": [`"{name} escribe como si no existiera límite de palabras."`,`"{name} manda mensajes con desarrollo completo de trama."`,`"Si hay un ensayo en el grupo, lo escribió {name}."`],
    "msgs": "msgs",
    "Red flag {index}": "Señal de alerta {index}",
    "This pattern showed up enough to feel worth watching.": "Este patrón apareció lo suficiente como para prestarle atención.",
    "Evidence": "Evidencia",
    "Who's more obsessed?": "¿Quién está más obsesionado?",
    "{pct}% of all messages came from {name}.": "El {pct}% de todos los mensajes vino de {name}.",
    "Response times": "Tiempos de respuesta",
    "Balanced": "Equilibrado",
    "{name} avg reply:": "{name} respuesta prom.:",
    "The Ghost Award": "El Premio Fantasma",
    "What's really going on": "Lo que realmente está pasando",
    "The Last Word": "La Última Palabra",
    "Sends the last message that nobody replies to — {count} times.": "Envía el último mensaje que nadie responde — {count} veces.",
    "Sends the last message that nobody replies to.": "Envía el último mensaje que nadie responde.",
    "Your longest streak": "Tu racha más larga",
    "{count} days": "{count} días",
    "Texted every single day for {count} days straight.": "Mensajes cada día durante {count} días seguidos.",
    "The Kindest One": "La Persona Más Amable",
    "The sweetest moment": "El momento más tierno",
    "Top 3 most active months": "Los 3 meses más activos",
    "{month} was your month. Something was going on.": "{month} fue vuestro mes. Algo estaba pasando.",
    "Who always reaches out first?": "¿Quién siempre escribe primero?",
    "Started {pct} of all conversations.": "Inició el {pct}% de todas las conversaciones.",
    "The Funny One": "El Más Gracioso",
    "Drops lines like": "Suelta frases como",
    "Spirit emojis": "Emojis espíritu",
    "These two emojis basically ARE this chat.": "Estos dos emojis básicamente SON este chat.",
    "Top 10 most used words": "Las 10 palabras más usadas",
    "Signature phrases": "Frases características",
    "The phrases that define each of you.": "Las frases que definen a cada uno.",
    "avg chars": "caract. prom.",
    "longest message": "mensaje más largo",
    "Media and links": "Medios y enlaces",
    "Photos & videos": "Fotos y vídeos",
    "Voice memos": "Notas de voz",
    "Links shared": "Enlaces compartidos",
    "What you actually talk about": "De qué habláis realmente",
    "Biggest topic": "Tema principal",
    "Most tense moment": "El momento más tenso",
    "The Drama Report": "El Informe de Drama",
    "How they do it": "Cómo lo hace",
    "Chat vibe": "Ambiente del chat",
    "A chaotic, wholesome connection.": "Una conexión caótica y sana.",
    "Powered by AI — your messages never left your device.": "Impulsado por IA — tus mensajes nunca salieron de tu dispositivo.",
    "Relationship reading": "Lectura de la relación",
    "Observed pattern": "Patrón observado",
    "Concrete example": "Ejemplo concreto",
    "Evidence log": "Registro de evidencias",
    "What the chat shows": "Lo que muestra el chat",
    "Toxicity scorecard": "Tarjeta de toxicidad",
    "Why this person scores highest": "Por qué esta persona puntúa más alto",
    "Tension snapshot": "Instantánea de tensión",
    "What keeps repeating": "Lo que sigue repitiéndose",
    "Main topic": "Tema principal",
    "Pattern note": "Nota sobre el patrón",
    "The strongest pattern is shown above.": "El patrón más fuerte se muestra arriba.",
    "Toxicity report": "Informe de toxicidad",
    "Overall read": "Lectura general",
    "Score breakdown": "Desglose de puntuación",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Este modo sirve para mostrar patrones y ejemplos, no para decidir por ti.",
    "The Main Character": "El Personaje Principal",
    "The Ghost": "El Fantasma",
    "{count} messages total. Why are they even here?": "{count} mensajes en total. ¿Por qué están aquí?",
    "The group was most alive in {month}.": "El grupo estuvo más activo en {month}.",
    "Longest active streak": "Racha activa más larga",
    "The group kept the chat alive for {count} days straight.": "El grupo mantuvo el chat vivo durante {count} días seguidos.",
    "The Hype Person": "El Animador del Grupo",
    "Started {pct} of all conversations. The engine of this group.": "Inició el {pct}% de todas las conversaciones. El motor del grupo.",
    "Why {name} is the hype": "Por qué {name} anima el grupo",
    "Group spirit emoji": "Emoji espíritu del grupo",
    "This one emoji basically summarises the entire group energy.": "Este emoji resume básicamente toda la energía del grupo.",
    "The Novelist": "El Novelista",
    "Their longest message was mostly about \"{topic}\".": "Su mensaje más largo trató principalmente sobre \"{topic}\".",
    "The inside joke": "El chiste interno",
    "Most missed member": "El miembro más echado de menos",
    "When they go quiet, the group feels it.": "Cuando se calla, el grupo lo nota.",
    "The group read": "La lectura del grupo",
    "Group dynamic": "Dinámica del grupo",
    "Group vibe": "Ambiente del grupo",
    "Chaotic. Wholesome. Somehow still going.": "Caótico. Sano. De alguna forma sigue adelante.",
    "Group pattern read": "Lectura del patrón del grupo",
    "Support and strain": "Apoyo y tensión",
    "Who keeps it going": "Quién lo mantiene vivo",
    "{name} started {pct} of conversations.": "{name} inició el {pct}% de las conversaciones.",
    "The group shares the conversation starts.": "El grupo comparte el inicio de las conversaciones.",
    "Who goes quiet": "Quién se calla",
    "{name} is the least active member in the sampled history.": "{name} es el miembro menos activo en el historial analizado.",
    "No clear ghost in this sample.": "No hay un fantasma claro en esta muestra.",
    "Chat Health Score": "Puntuación de Salud del Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Sobre 10 — basado en patrones de conflicto, estilo de comunicación y dinámica general.",
    "Verdict": "Veredicto",
    "Individual health scores": "Puntuaciones individuales de salud",
    "Who apologises more": "Quién se disculpa más",
    "Red flag moments": "Momentos de alerta",
    "Conflict pattern": "Patrón de conflicto",
    "How arguments unfold": "Cómo se desarrollan las discusiones",
    "Power balance": "Equilibrio de poder",
    "Power dynamic": "Dinámica de poder",
    "The verdict": "El veredicto",
    "Overall chat health score.": "Puntuación general de salud del chat.",
    "Final read": "Lectura final",
    "Reflects patterns in this sample — not a final judgment.": "Refleja patrones en esta muestra — no es un juicio definitivo.",
    "{name}'s love language": "El lenguaje del amor de {name}",
    "How they show it": "Cómo lo muestra",
    "The language gap": "La brecha del lenguaje",
    "Do they speak the same language?": "¿Hablan el mismo idioma?",
    "Most loving moment": "El momento más amoroso",
    "The moment": "El momento",
    "Love language compatibility": "Compatibilidad del lenguaje del amor",
    "Compatibility read": "Lectura de compatibilidad",
    "Then vs Now": "Antes vs Ahora",
    "Early messages": "Mensajes tempranos",
    "Recent messages": "Mensajes recientes",
    "Who changed more": "Quién cambió más",
    "How they changed": "Cómo cambiaron",
    "What changed in the chat": "Qué cambió en el chat",
    "Topics that appeared": "Temas que aparecieron",
    "Topics that faded": "Temas que desaparecieron",
    "Relationship trajectory": "Trayectoria de la relación",
    "What the data shows": "Lo que muestran los datos",
    "The arc": "El arco",
    "Promises made": "Promesas hechas",
    "promises": "promesas",
    "Overall verdict": "Veredicto general",
    "{name}'s accountability": "Responsabilidad de {name}",
    "kept": "cumplidas",
    "broken": "incumplidas",
    "Pattern": "Patrón",
    "Most notable broken promise": "La promesa incumplida más notable",
    "Most notable kept promise": "La promesa cumplida más notable",
    "Net energy scores": "Puntuaciones netas de energía",
    "Energy compatibility": "Compatibilidad de energía",
    "{name}'s energy": "La energía de {name}",
    "Positive energy": "Energía positiva",
    "Draining patterns": "Patrones agotadores",
    "Most energising moment": "El momento más energizante",
    "Most draining moment": "El momento más agotador",
    "messages": "mensajes",
    "Your relationship, in data.": "Tu relación, en datos.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lee tu chat y te muestra lo que realmente pasa. Quién aparece. Quién desaparece. Quién lleva la conversación.",
    "Skip": "Omitir",
    "Start with your chat.": "Empieza con tu chat.",
    "Upload. Analyse. See it clearly.": "Sube. Analiza. Vélo claramente.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Seis informes. Toxicidad, lenguajes del amor, responsabilidad, energía, crecimiento y tu chat completo resumido. Resultados en menos de un minuto.",
    "Log out": "Cerrar sesión",
    "Feedback Inbox": "Bandeja de comentarios",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grupo grande detectado — analizando los {cap} miembros más activos de {count}.",
  },
  pt: {
    "Choose your language": "Escolha seu idioma",
    "English": "Inglês",
    "Auto-detect": "Detecção automática",
    "Continue": "Continuar",
    "Back": "Voltar",
    "Next": "Próximo",
    "See summary": "Ver resumo",
    "Done": "Concluir",
    "Start over": "Começar de novo",
    "Share": "Compartilhar",
    "What's off about this?": "O que está errado aqui?",
    "Optional note": "Observação opcional",
    "Cancel": "Cancelar",
    "Submit": "Enviar",
    "Sending…": "Enviando…",
    "Got it, thank you.": "Entendi, obrigada.",
    "Events are mixing": "Os eventos se misturaram",
    "Wrong person": "Pessoa errada",
    "Didn't happen": "Não aconteceu",
    "Tone misread": "Tom mal interpretado",
    "Overclaiming": "Exagero na conclusão",
    "Missing context": "Falta contexto",
    "Other": "Outro",
    "The Roast": "A Zoeira",
    "The Lovely": "O Fofo",
    "The Funny": "O Engraçado",
    "The Stats": "As Estatísticas",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Relatório de Toxicidade",
    "Love Language": "Linguagem do Amor",
    "Growth Report": "Relatório de Crescimento",
    "Accountability": "Responsabilidade",
    "Energy Report": "Relatório de Energia",
    "Choose your report": "Escolha seu relatório",
    "Who is this chat with?": "Com quem é esta conversa?",
    "This helps the AI frame the analysis correctly.": "Isso ajuda a IA a enquadrar a análise corretamente.",
    "Partner": "Parceiro",
    "Dating": "Ficando",
    "Ex": "Ex",
    "Related": "Família",
    "Friend": "Amigo",
    "Colleague": "Colega",
    "Romantic partner or spouse": "Parceiro romântico ou cônjuge",
    "Seeing each other or early stages": "Se conhecendo ou no começo",
    "Former romantic partner": "Ex-parceiro romântico",
    "Parent, sibling or relative": "Pai, mãe, irmão ou parente",
    "Close friend or bestie": "Amigo próximo ou melhor amigo",
    "Coworker or professional contact": "Colega de trabalho ou contato profissional",
    "Someone you know": "Alguém que você conhece",
    "Reading your messages...": "Lendo suas mensagens...",
    "Finding the patterns...": "Encontrando os padrões...",
    "Figuring out who's funny...": "Descobrindo quem é engraçado...",
    "Detecting the drama...": "Detectando o drama...",
    "Reading between the lines...": "Lendo nas entrelinhas...",
    "Almost done...": "Quase pronto...",
    "Upload different file": "Enviar outro arquivo",
    "Upload your chat": "Envie sua conversa",
    "Reading your chat…": "Lendo sua conversa…",
    "My Results": "Meus resultados",
    "Settings": "Configurações",
    "Delete my account": "Excluir minha conta",
    "Relationship": "Relacionamento",
    "Report Type": "Tipo de relatório",
    "Are you sure you want to delete your account?": "Tem certeza de que deseja excluir sua conta?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Todos os seus resultados salvos serão perdidos. Isso exclui permanentemente sua conta WrapChat e não pode ser desfeito.",
    "Delete account": "Excluir conta",
    "Deleting...": "Excluindo...",
    "Edit": "Editar",
    "Your chats, unwrapped.": "Seus chats, revelados.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Grupo ou dupla detectado automaticamente. Sua conversa é analisada por IA e nunca armazenada. Apenas os resultados são salvos.",
    "UI language": "Idioma da interface",
    "Report language": "Idioma do relatório",
    "auto": "auto",
    "changed": "alterado",
    "quips.duo.obsessed": [`"{name}, talvez seja bom conferir seu tempo de tela."`,`"{name} está carregando essa conversa no puro fôlego de digitação."`,`"Não é obsessão, é só disponibilidade demais. Claro, {name}."`],
    "quips.duo.responseBalanced": [`"Os dois respondem no mesmo ritmo. Nada de fantasmas aqui."`,`"Ninguém deixa o outro esperando. Raro e bonito."`,`"Os dois aparecem e respondem. Isso sim é equilíbrio."`],
    "quips.duo.ghost": [`"Claro, {name} estava 'ocupado'."`,`"{name}: leu a mensagem e respondeu... eventualmente."`,`"{name} trata resposta como recurso escasso."`],
    "quips.duo.lastWord": [`"{name} manda uma mensagem e a conversa morre ali."`,`"Última cena: a mensagem de {name}, sem resposta."`,`"{name} tem dom para dar a última palavra."`],
    "quips.duo.streak100": [`"{streak} dias. Isso não é sequência, é estilo de vida."`,`"Mais de {streak} dias seguidos. O que quer que seja isso, é real."`,`"{streak} dias seguidos. Consistência séria."`],
    "quips.duo.streak30": [`"{streak} dias sem pausa. Isso é raro."`,`"Mais de um mês aparecendo. Isso significa alguma coisa."`,`"Sem falhas, sem desculpas. Só {streak} dias seguidos."`],
    "quips.duo.streak10": [`"{streak} dias seguidos. Nada mal."`,`"Ok, isso é bem fofo."`,`"Alguma coisa estava funcionando nesses {streak} dias."`],
    "quips.duo.streakShort": [`"{streak} dias. Curto, mas real."`,`"Até uma sequência de {streak} dias conta."`,`"{streak} dias sem se perder de vista já dizem algo."`],
    "quips.duo.convStarter": [`"Alguém está sempre pensando no outro primeiro."`,`"{name} é sempre quem quebra o silêncio."`,`"A primeira mensagem continua vindo de {name}. Isso diz muito."`],
    "quips.duo.messageLengthSimilar": [`"Mensagens quase iguais. Equilíbrio suspeito."`,`"Sem novelista, sem minimalista. Só duas pessoas escrevendo parecido."`,`"Equilibrado. Sem textão, sem resposta de uma palavra."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} trata cada mensagem como carta para a posteridade."`,`"Em algum lugar, {novelist} ainda está digitando."`,`"{texter} responde. {novelist} desenvolve."`],
    "quips.group.mainCharacter": [`"{name}, isso aqui é basicamente seu blog pessoal."`,`"{name} veio para falar e claramente está falando."`,`"Sem {name}, esse grupo virava cemitério."`],
    "quips.group.ghost": [`"{name} está aqui só em espírito."`,`"{name} entrou no grupo e sumiu."`,`"Observador silencioso. Mistério total. {name}."`],
    "quips.group.lastWord": [`"{name} manda uma mensagem. O grupo não responde. Clássico."`,`"Depois da mensagem de {name}, o grupo silencia."`,`"{name} tem o hábito de mandar mensagem para o vazio."`],
    "quips.group.streak100": [`"{streak} dias sem uma única pausa. Esse grupo é diferente."`,`"Mais de {streak} dias seguidos. Isso já é compromisso."`,`"O que mantém esse grupo vivo merecia virar produto."`],
    "quips.group.streak30": [`"{streak} dias aparecendo. Isso é grupo de verdade."`,`"Nem um dia de folga. Esse grupo leva a sério."`,`"A maioria dos grupos morre em duas semanas. Esse não."`],
    "quips.group.streak10": [`"{streak} dias seguidos. O grupo estava vivo."`,`"Vocês realmente gostam uns dos outros. Surpreendente."`,`"{streak} dias seguidos. Mais do que a maioria dos grupos consegue."`],
    "quips.group.streakShort": [`"{streak} dias. Pequeno, mas conta."`,`"Uma sequência de {streak} dias ainda diz algo."`,`"Até {streak} dias seguidos exigem esforço."`],
    "quips.group.novelist": [`"{name} escreve como se não existisse limite de palavras."`,`"{name} manda mensagem com arco completo de história."`,`"Se há um ensaio no grupo, foi {name} que escreveu."`],
    "msgs": "msgs",
    "Red flag {index}": "Sinal de alerta {index}",
    "This pattern showed up enough to feel worth watching.": "Este padrão apareceu vezes suficientes para valer atenção.",
    "Evidence": "Evidência",
    "Who's more obsessed?": "Quem está mais obcecado?",
    "{pct}% of all messages came from {name}.": "{pct}% de todas as mensagens vieram de {name}.",
    "Response times": "Tempos de resposta",
    "Balanced": "Equilibrado",
    "{name} avg reply:": "{name} resp. média:",
    "The Ghost Award": "O Prêmio Fantasma",
    "What's really going on": "O que está realmente acontecendo",
    "The Last Word": "A Última Palavra",
    "Sends the last message that nobody replies to — {count} times.": "Manda a última mensagem que ninguém responde — {count} vezes.",
    "Sends the last message that nobody replies to.": "Manda a última mensagem que ninguém responde.",
    "Your longest streak": "Sua maior sequência",
    "{count} days": "{count} dias",
    "Texted every single day for {count} days straight.": "Mensagens todos os dias por {count} dias seguidos.",
    "The Kindest One": "A Pessoa Mais Gentil",
    "The sweetest moment": "O momento mais doce",
    "Top 3 most active months": "Os 3 meses mais ativos",
    "{month} was your month. Something was going on.": "{month} foi o mês de vocês. Algo estava acontecendo.",
    "Who always reaches out first?": "Quem sempre escreve primeiro?",
    "Started {pct} of all conversations.": "Iniciou {pct}% de todas as conversas.",
    "The Funny One": "O Mais Engraçado",
    "Drops lines like": "Solta frases como",
    "Spirit emojis": "Emojis espírito",
    "These two emojis basically ARE this chat.": "Esses dois emojis basicamente SÃO esse chat.",
    "Top 10 most used words": "As 10 palavras mais usadas",
    "Signature phrases": "Frases características",
    "The phrases that define each of you.": "As frases que definem cada um de vocês.",
    "avg chars": "caract. méd.",
    "longest message": "mensagem mais longa",
    "Media and links": "Mídia e links",
    "Photos & videos": "Fotos e vídeos",
    "Voice memos": "Notas de voz",
    "Links shared": "Links compartilhados",
    "What you actually talk about": "O que vocês realmente falam",
    "Biggest topic": "Tema principal",
    "Most tense moment": "O momento mais tenso",
    "The Drama Report": "O Relatório de Drama",
    "How they do it": "Como fazem isso",
    "Chat vibe": "Vibe do chat",
    "A chaotic, wholesome connection.": "Uma conexão caótica e saudável.",
    "Powered by AI — your messages never left your device.": "Alimentado por IA — suas mensagens nunca saíram do seu dispositivo.",
    "Relationship reading": "Leitura do relacionamento",
    "Observed pattern": "Padrão observado",
    "Concrete example": "Exemplo concreto",
    "Evidence log": "Registro de evidências",
    "What the chat shows": "O que o chat mostra",
    "Toxicity scorecard": "Cartão de toxicidade",
    "Why this person scores highest": "Por que esta pessoa tem a pontuação mais alta",
    "Tension snapshot": "Retrato da tensão",
    "What keeps repeating": "O que fica se repetindo",
    "Main topic": "Tema principal",
    "Pattern note": "Nota sobre o padrão",
    "The strongest pattern is shown above.": "O padrão mais forte é mostrado acima.",
    "Toxicity report": "Relatório de toxicidade",
    "Overall read": "Leitura geral",
    "Score breakdown": "Detalhamento da pontuação",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Este modo serve para mostrar padrões e exemplos, não para decidir por você.",
    "The Main Character": "O Personagem Principal",
    "The Ghost": "O Fantasma",
    "{count} messages total. Why are they even here?": "{count} mensagens no total. Por que estão aqui mesmo?",
    "The group was most alive in {month}.": "O grupo esteve mais ativo em {month}.",
    "Longest active streak": "Maior sequência ativa",
    "The group kept the chat alive for {count} days straight.": "O grupo manteve o chat vivo por {count} dias seguidos.",
    "The Hype Person": "O Animador do Grupo",
    "Started {pct} of all conversations. The engine of this group.": "Iniciou {pct}% de todas as conversas. O motor do grupo.",
    "Why {name} is the hype": "Por que {name} anima o grupo",
    "Group spirit emoji": "Emoji espírito do grupo",
    "This one emoji basically summarises the entire group energy.": "Esse emoji basicamente resume toda a energia do grupo.",
    "The Novelist": "O Romancista",
    "Their longest message was mostly about \"{topic}\".": "Sua mensagem mais longa foi principalmente sobre \"{topic}\".",
    "The inside joke": "A piada interna",
    "Most missed member": "O membro que mais faz falta",
    "When they go quiet, the group feels it.": "Quando ficam em silêncio, o grupo sente.",
    "The group read": "A leitura do grupo",
    "Group dynamic": "Dinâmica do grupo",
    "Group vibe": "Vibe do grupo",
    "Chaotic. Wholesome. Somehow still going.": "Caótico. Saudável. De algum jeito ainda está rolando.",
    "Group pattern read": "Leitura do padrão do grupo",
    "Support and strain": "Apoio e tensão",
    "Who keeps it going": "Quem mantém vivo",
    "{name} started {pct} of conversations.": "{name} iniciou {pct}% das conversas.",
    "The group shares the conversation starts.": "O grupo divide os inícios das conversas.",
    "Who goes quiet": "Quem fica em silêncio",
    "{name} is the least active member in the sampled history.": "{name} é o membro menos ativo no histórico analisado.",
    "No clear ghost in this sample.": "Sem fantasma claro nesta amostra.",
    "Chat Health Score": "Pontuação de Saúde do Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "De 10 — baseado em padrões de conflito, estilo de comunicação e dinâmica geral.",
    "Verdict": "Veredicto",
    "Individual health scores": "Pontuações individuais de saúde",
    "Who apologises more": "Quem pede mais desculpas",
    "Red flag moments": "Momentos de alerta",
    "Conflict pattern": "Padrão de conflito",
    "How arguments unfold": "Como as discussões se desenvolvem",
    "Power balance": "Equilíbrio de poder",
    "Power dynamic": "Dinâmica de poder",
    "The verdict": "O veredicto",
    "Overall chat health score.": "Pontuação geral de saúde do chat.",
    "Final read": "Leitura final",
    "Reflects patterns in this sample — not a final judgment.": "Reflete padrões nesta amostra — não é um julgamento final.",
    "{name}'s love language": "A linguagem do amor de {name}",
    "How they show it": "Como demonstra",
    "The language gap": "A diferença de linguagem",
    "Do they speak the same language?": "Falam a mesma linguagem?",
    "Most loving moment": "O momento mais amoroso",
    "The moment": "O momento",
    "Love language compatibility": "Compatibilidade de linguagem do amor",
    "Compatibility read": "Leitura de compatibilidade",
    "Then vs Now": "Antes vs Agora",
    "Early messages": "Mensagens iniciais",
    "Recent messages": "Mensagens recentes",
    "Who changed more": "Quem mudou mais",
    "How they changed": "Como mudaram",
    "What changed in the chat": "O que mudou no chat",
    "Topics that appeared": "Temas que surgiram",
    "Topics that faded": "Temas que sumiram",
    "Relationship trajectory": "Trajetória do relacionamento",
    "What the data shows": "O que os dados mostram",
    "The arc": "O arco",
    "Promises made": "Promessas feitas",
    "promises": "promessas",
    "Overall verdict": "Veredicto geral",
    "{name}'s accountability": "Responsabilidade de {name}",
    "kept": "cumpridas",
    "broken": "quebradas",
    "Pattern": "Padrão",
    "Most notable broken promise": "A promessa quebrada mais notável",
    "Most notable kept promise": "A promessa cumprida mais notável",
    "Net energy scores": "Pontuações líquidas de energia",
    "Energy compatibility": "Compatibilidade de energia",
    "{name}'s energy": "A energia de {name}",
    "Positive energy": "Energia positiva",
    "Draining patterns": "Padrões desgastantes",
    "Most energising moment": "O momento mais energizante",
    "Most draining moment": "O momento mais desgastante",
    "messages": "mensagens",
    "Your relationship, in data.": "Seu relacionamento, em dados.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lê seu chat e mostra o que está realmente acontecendo. Quem aparece. Quem some. Quem carrega a conversa.",
    "Skip": "Pular",
    "Start with your chat.": "Comece com seu chat.",
    "Upload. Analyse. See it clearly.": "Envie. Analise. Veja com clareza.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Seis relatórios. Toxicidade, linguagens do amor, responsabilidade, energia, crescimento e seu chat completo resumido. Resultados em menos de um minuto.",
    "Log out": "Sair",
    "Feedback Inbox": "Caixa de feedback",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grupo grande detectado — analisando os {cap} membros mais ativos de {count}.",
  },
  ar: {
    "Choose your language": "اختر لغتك",
    "English": "الإنجليزية",
    "Auto-detect": "كشف تلقائي",
    "Continue": "متابعة",
    "Back": "رجوع",
    "Next": "التالي",
    "See summary": "عرض الملخص",
    "Done": "تم",
    "Start over": "ابدأ من جديد",
    "Share": "مشاركة",
    "What's off about this?": "ما غير الصحيح هنا؟",
    "Optional note": "ملاحظة اختيارية",
    "Cancel": "إلغاء",
    "Submit": "إرسال",
    "Sending…": "جارٍ الإرسال…",
    "Got it, thank you.": "وصلت، شكرًا لك.",
    "Events are mixing": "الأحداث مختلطة",
    "Wrong person": "الشخص غير صحيح",
    "Didn't happen": "لم يحدث",
    "Tone misread": "تم فهم النبرة بشكل خاطئ",
    "Overclaiming": "استنتاج مبالغ فيه",
    "Missing context": "السياق ناقص",
    "Other": "أخرى",
    "The Roast": "التحميص",
    "The Lovely": "اللطيف",
    "The Funny": "المضحك",
    "The Stats": "الإحصاءات",
    "Insight": "رؤية",
    "WrapChat": "WrapChat",
    "Toxicity Report": "تقرير السمية",
    "Love Language": "لغة الحب",
    "Growth Report": "تقرير التطور",
    "Accountability": "المساءلة",
    "Energy Report": "تقرير الطاقة",
    "Choose your report": "اختر تقريرك",
    "Who is this chat with?": "مع من هذه المحادثة؟",
    "This helps the AI frame the analysis correctly.": "هذا يساعد الذكاء الاصطناعي على فهم التحليل بشكل صحيح.",
    "Partner": "شريك",
    "Dating": "مواعدة",
    "Ex": "حبيب سابق",
    "Related": "عائلة",
    "Friend": "صديق",
    "Colleague": "زميل",
    "Romantic partner or spouse": "شريك عاطفي أو زوج/زوجة",
    "Seeing each other or early stages": "تعارف أو بداية العلاقة",
    "Former romantic partner": "شريك عاطفي سابق",
    "Parent, sibling or relative": "أب أو أم أو أخ أو قريب",
    "Close friend or bestie": "صديق مقرب أو أعز صديق",
    "Coworker or professional contact": "زميل عمل أو جهة اتصال مهنية",
    "Someone you know": "شخص تعرفه",
    "Reading your messages...": "جارٍ قراءة رسائلك...",
    "Finding the patterns...": "جارٍ العثور على الأنماط...",
    "Figuring out who's funny...": "جارٍ معرفة من هو المضحك...",
    "Detecting the drama...": "جارٍ رصد الدراما...",
    "Reading between the lines...": "جارٍ القراءة بين السطور...",
    "Almost done...": "اقتربنا من الانتهاء...",
    "Upload different file": "ارفع ملفًا آخر",
    "Upload your chat": "ارفع محادثتك",
    "Reading your chat…": "جارٍ قراءة محادثتك…",
    "My Results": "نتائجي",
    "Settings": "الإعدادات",
    "Delete my account": "حذف حسابي",
    "Relationship": "العلاقة",
    "Report Type": "نوع التقرير",
    "Are you sure you want to delete your account?": "هل أنت متأكد أنك تريد حذف حسابك؟",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "ستفقد جميع نتائجك المحفوظة. سيتم حذف حساب WrapChat الخاص بك بشكل دائم ولا يمكن التراجع عن ذلك.",
    "Delete account": "حذف الحساب",
    "Deleting...": "جارٍ الحذف...",
    "Edit": "تعديل",
    "Your chats, unwrapped.": "محادثاتك كما هي.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "يتم اكتشاف المجموعة أو المحادثة الثنائية تلقائيًا. يتم تحليل محادثتك بالذكاء الاصطناعي ولا يتم حفظها أبدًا. يتم حفظ النتائج فقط.",
    "UI language": "لغة الواجهة",
    "Report language": "لغة التقرير",
    "auto": "تلقائي",
    "changed": "تم التغيير",
    "quips.duo.obsessed": [`"{name}، ربما عليك مراجعة وقت الشاشة."`,`"{name} يحمل هذه المحادثة بقوة الأصابع فقط."`,`"ليس هوسًا، فقط حضور زائد جدًا. طبعًا يا {name}."`],
    "quips.duo.responseBalanced": [`"كلاكما يرد بالسرعة نفسها. لا أشباح هنا."`,`"لا أحد يترك الآخر منتظرًا. شيء جميل فعلًا."`,`"كلاكما حاضر ويرد. هكذا يبدو التوازن."`],
    "quips.duo.ghost": [`"أكيد كان {name} 'مشغولًا'."`,`"{name}: قرأ الرسالة ورد... في وقت ما لاحقًا."`,`"{name} يتعامل مع الردود كأنها مورد محدود."`],
    "quips.duo.lastWord": [`"{name} يرسل رسالة وتنتهي المحادثة هناك."`,`"آخر ما شوهد: رسالة {name} بلا رد."`,`"{name} لديه موهبة في قول الكلمة الأخيرة."`],
    "quips.duo.streak100": [`"{streak} يومًا. هذه ليست سلسلة بل أسلوب حياة."`,`"أكثر من {streak} يومًا متتاليًا. أيًا كان هذا فهو حقيقي."`,`"{streak} يومًا متتاليًا. هذا ثبات جاد."`],
    "quips.duo.streak30": [`"{streak} يومًا بلا انقطاع. هذا نادر."`,`"أكثر من شهر من الحضور المستمر. هذا يعني شيئًا."`,`"لا فجوات ولا أعذار. فقط {streak} يومًا متتاليًا."`],
    "quips.duo.streak10": [`"{streak} أيام متتالية. ليس سيئًا أبدًا."`,`"حسنًا، هذا لطيف فعلًا."`,`"كان هناك شيء يسير بشكل جيد خلال {streak} أيام."`],
    "quips.duo.streakShort": [`"{streak} أيام. قصيرة لكنها حقيقية."`,`"حتى سلسلة من {streak} أيام تُحسب."`,`"{streak} أيام من عدم الانقطاع ما زالت تعني شيئًا."`],
    "quips.duo.convStarter": [`"هناك من يفكر في الآخر أولًا كل مرة."`,`"{name} هو دائمًا من يكسر الصمت أولًا."`,`"الرسالة الأولى ما زالت تأتي من {name}. هذا يقول الكثير."`],
    "quips.duo.messageLengthSimilar": [`"طول الرسائل متقارب جدًا. توازن مريب."`,`"لا روائي هنا ولا مقتصد. فقط شخصان يكتبان بالمقدار نفسه تقريبًا."`,`"متوازن. لا مقالات طويلة ولا ردود بكلمة واحدة."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} يتعامل مع كل رسالة كأنها رسالة للتاريخ."`,`"في مكان ما، ما زال {novelist} يكتب."`,`"{texter} يرد، أما {novelist} فيكتب فصلًا."`],
    "quips.group.mainCharacter": [`"{name}، هذه المدونة الشخصية الخاصة بك تقريبًا."`,`"{name} جاء ليتكلم وهو يفعل ذلك فعلًا."`,`"من دون {name} يصبح هذا الشات مقبرة."`],
    "quips.group.ghost": [`"{name} موجود بالروح فقط."`,`"{name} دخل المجموعة ثم اختفى فورًا."`,`"مراقب صامت. لغز كامل. {name}."`],
    "quips.group.lastWord": [`"{name} يرسل رسالة. المجموعة لا ترد. كلاسيكي."`,`"بعد رسالة {name} تصمت المجموعة كل مرة."`,`"{name} اعتاد إرسال الرسائل إلى الفراغ."`],
    "quips.group.streak100": [`"{streak} يومًا بلا أي انقطاع. هذه المجموعة مختلفة."`,`"أكثر من {streak} يومًا متتاليًا. هذا التزام حقيقي."`,`"ما يُبقي هذه المجموعة حية يستحق أن يُباع."`],
    "quips.group.streak30": [`"{streak} يومًا من الظهور المستمر. هذه مجموعة حقيقية."`,`"ولا يوم راحة واحد. هذه المجموعة تأخذ الأمر بجدية."`,`"معظم المجموعات تموت خلال أسبوعين. هذه لا."`],
    "quips.group.streak10": [`"{streak} أيام متتالية. كانت المجموعة حية فعلًا."`,`"يبدو أنكم فعلًا تحبون بعضكم. مفاجأة."`,`"{streak} أيام متتالية. أكثر مما تفعله معظم المجموعات."`],
    "quips.group.streakShort": [`"{streak} أيام. قليل لكنه يُحسب."`,`"حتى سلسلة من {streak} أيام تعني أن شيئًا ما كان يحدث."`,`"حتى {streak} أيام متتالية تحتاج جهدًا."`],
    "quips.group.novelist": [`"{name} يكتب وكأنه لا يوجد حد للكلمات."`,`"{name} يرسل رسائل فيها تطور كامل للحبكة."`,`"إذا كان هناك مقال في المجموعة فقد كتبه {name}."`],
    "msgs": "رسائل",
    "Red flag {index}": "علامة تحذير {index}",
    "This pattern showed up enough to feel worth watching.": "ظهر هذا النمط بما يكفي ليستحق الانتباه.",
    "Evidence": "دليل",
    "Who's more obsessed?": "من هو الأكثر هوساً؟",
    "{pct}% of all messages came from {name}.": "{pct}٪ من جميع الرسائل جاءت من {name}.",
    "Response times": "أوقات الرد",
    "Balanced": "متوازن",
    "{name} avg reply:": "متوسط رد {name}:",
    "The Ghost Award": "جائزة الشبح",
    "What's really going on": "ما الذي يحدث فعلاً",
    "The Last Word": "الكلمة الأخيرة",
    "Sends the last message that nobody replies to — {count} times.": "يرسل آخر رسالة لا يرد عليها أحد — {count} مرة.",
    "Sends the last message that nobody replies to.": "يرسل آخر رسالة لا يرد عليها أحد.",
    "Your longest streak": "أطول سلسلة لك",
    "{count} days": "{count} أيام",
    "Texted every single day for {count} days straight.": "تراسلتم كل يوم لمدة {count} أيام متتالية.",
    "The Kindest One": "أكثرهم لطفاً",
    "The sweetest moment": "أجمل لحظة",
    "Top 3 most active months": "أكثر 3 أشهر نشاطاً",
    "{month} was your month. Something was going on.": "{month} كان شهركم. كان ثمة شيء يحدث.",
    "Who always reaches out first?": "من يكتب أولاً دائماً؟",
    "Started {pct} of all conversations.": "بدأ {pct}٪ من جميع المحادثات.",
    "The Funny One": "الأكثر طرافة",
    "Drops lines like": "يلقي عبارات مثل",
    "Spirit emojis": "رموز الروح",
    "These two emojis basically ARE this chat.": "هذان الرمزان هما هذا الدردشة بالأساس.",
    "Top 10 most used words": "أكثر 10 كلمات استخداماً",
    "Signature phrases": "العبارات المميزة",
    "The phrases that define each of you.": "العبارات التي تُعرّف كل واحد منكم.",
    "avg chars": "متوسط الأحرف",
    "longest message": "أطول رسالة",
    "Media and links": "الوسائط والروابط",
    "Photos & videos": "الصور ومقاطع الفيديو",
    "Voice memos": "الرسائل الصوتية",
    "Links shared": "الروابط المشاركة",
    "What you actually talk about": "ما الذي تتحدثون عنه فعلاً",
    "Biggest topic": "الموضوع الرئيسي",
    "Most tense moment": "اللحظة الأشد توتراً",
    "The Drama Report": "تقرير الدراما",
    "How they do it": "كيف يفعل ذلك",
    "Chat vibe": "أجواء المحادثة",
    "A chaotic, wholesome connection.": "تواصل فوضوي لكنه صحي.",
    "Powered by AI — your messages never left your device.": "مدعوم بالذكاء الاصطناعي — رسائلك لم تغادر جهازك قط.",
    "Relationship reading": "قراءة العلاقة",
    "Observed pattern": "النمط الملاحظ",
    "Concrete example": "مثال ملموس",
    "Evidence log": "سجل الأدلة",
    "What the chat shows": "ما تُظهره المحادثة",
    "Toxicity scorecard": "بطاقة السمية",
    "Why this person scores highest": "لماذا حصل هذا الشخص على أعلى نقاط",
    "Tension snapshot": "لقطة التوتر",
    "What keeps repeating": "ما يتكرر باستمرار",
    "Main topic": "الموضوع الرئيسي",
    "Pattern note": "ملاحظة النمط",
    "The strongest pattern is shown above.": "النمط الأقوى موضح أعلاه.",
    "Toxicity report": "تقرير السمية",
    "Overall read": "القراءة العامة",
    "Score breakdown": "تفصيل النقاط",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "هذا الوضع مصمم لإظهار الأنماط والأمثلة، وليس لاتخاذ القرار نيابةً عنك.",
    "The Main Character": "الشخصية الرئيسية",
    "The Ghost": "الشبح",
    "{count} messages total. Why are they even here?": "{count} رسالة إجمالاً. لماذا هم هنا أصلاً؟",
    "The group was most alive in {month}.": "كانت المجموعة في أوج نشاطها في {month}.",
    "Longest active streak": "أطول سلسلة نشاط",
    "The group kept the chat alive for {count} days straight.": "حافظت المجموعة على استمرار الدردشة لمدة {count} أيام متتالية.",
    "The Hype Person": "محرك الحماس",
    "Started {pct} of all conversations. The engine of this group.": "بدأ {pct}٪ من جميع المحادثات. محرك هذه المجموعة.",
    "Why {name} is the hype": "لماذا {name} هو مصدر الحماس",
    "Group spirit emoji": "رمز روح المجموعة",
    "This one emoji basically summarises the entire group energy.": "هذا الرمز يلخص بشكل أساسي طاقة المجموعة بأكملها.",
    "The Novelist": "كاتب الروايات",
    "Their longest message was mostly about \"{topic}\".": "كانت رسالتهم الأطول تتناول بشكل رئيسي \"{topic}\".",
    "The inside joke": "النكتة الداخلية",
    "Most missed member": "العضو الأكثر افتقاداً",
    "When they go quiet, the group feels it.": "حين يصمتون، تشعر المجموعة بذلك.",
    "The group read": "قراءة المجموعة",
    "Group dynamic": "ديناميكية المجموعة",
    "Group vibe": "أجواء المجموعة",
    "Chaotic. Wholesome. Somehow still going.": "فوضوي. صحي. ولا يزال مستمراً بطريقة ما.",
    "Group pattern read": "قراءة نمط المجموعة",
    "Support and strain": "الدعم والضغط",
    "Who keeps it going": "من يُبقيها مستمرة",
    "{name} started {pct} of conversations.": "بدأ {name} {pct}٪ من المحادثات.",
    "The group shares the conversation starts.": "تُشارك المجموعة في بدء المحادثات.",
    "Who goes quiet": "من يصمت",
    "{name} is the least active member in the sampled history.": "{name} هو العضو الأقل نشاطاً في السجل المحلل.",
    "No clear ghost in this sample.": "لا يوجد شبح واضح في هذه العينة.",
    "Chat Health Score": "نقاط صحة المحادثة",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "من 10 — بناءً على أنماط الصراع وأسلوب التواصل والديناميكية العامة.",
    "Verdict": "الحكم",
    "Individual health scores": "نقاط الصحة الفردية",
    "Who apologises more": "من يعتذر أكثر",
    "Red flag moments": "لحظات الإنذار",
    "Conflict pattern": "نمط الصراع",
    "How arguments unfold": "كيف تتطور الخلافات",
    "Power balance": "توازن القوى",
    "Power dynamic": "ديناميكية القوة",
    "The verdict": "الحكم",
    "Overall chat health score.": "نقاط الصحة العامة للمحادثة.",
    "Final read": "القراءة النهائية",
    "Reflects patterns in this sample — not a final judgment.": "يعكس أنماطاً في هذه العينة — وليس حكماً نهائياً.",
    "{name}'s love language": "لغة الحب عند {name}",
    "How they show it": "كيف يُظهر ذلك",
    "The language gap": "الفجوة اللغوية",
    "Do they speak the same language?": "هل يتحدثان اللغة ذاتها؟",
    "Most loving moment": "أكثر لحظة حنواً",
    "The moment": "اللحظة",
    "Love language compatibility": "توافق لغة الحب",
    "Compatibility read": "قراءة التوافق",
    "Then vs Now": "الماضي مقابل الحاضر",
    "Early messages": "الرسائل الأولى",
    "Recent messages": "الرسائل الأخيرة",
    "Who changed more": "من تغير أكثر",
    "How they changed": "كيف تغيروا",
    "What changed in the chat": "ما الذي تغير في المحادثة",
    "Topics that appeared": "الموضوعات التي ظهرت",
    "Topics that faded": "الموضوعات التي تلاشت",
    "Relationship trajectory": "مسار العلاقة",
    "What the data shows": "ما تُظهره البيانات",
    "The arc": "القوس",
    "Promises made": "الوعود المُعطاة",
    "promises": "وعود",
    "Overall verdict": "الحكم العام",
    "{name}'s accountability": "مسؤولية {name}",
    "kept": "مُوفَّى بها",
    "broken": "مُخلَف بها",
    "Pattern": "النمط",
    "Most notable broken promise": "الوعد المُخلَف الأبرز",
    "Most notable kept promise": "الوعد المُوفَّى الأبرز",
    "Net energy scores": "نقاط الطاقة الصافية",
    "Energy compatibility": "توافق الطاقة",
    "{name}'s energy": "طاقة {name}",
    "Positive energy": "طاقة إيجابية",
    "Draining patterns": "أنماط مُستنزِفة",
    "Most energising moment": "أكثر لحظة محفزة للطاقة",
    "Most draining moment": "أكثر لحظة مُستنزِفة",
    "messages": "رسائل",
    "Your relationship, in data.": "علاقتك، في بيانات.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "يقرأ محادثتك ويُريك ما يحدث فعلاً. من يظهر. من يختفي. من يحمل المحادثة.",
    "Skip": "تخطي",
    "Start with your chat.": "ابدأ بمحادثتك.",
    "Upload. Analyse. See it clearly.": "ارفع. حلّل. انظر بوضوح.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "ستة تقارير. السمية، لغات الحب، المسؤولية، الطاقة، النمو، وملخص محادثتك الكاملة. نتائج في أقل من دقيقة.",
    "Log out": "تسجيل الخروج",
    "Feedback Inbox": "صندوق التعليقات",
    "Large group detected — analysing the top {cap} members out of {count}.": "تم اكتشاف مجموعة كبيرة — يتم تحليل أكثر {cap} أعضاء نشاطاً من أصل {count}.",
  },
  fr: {
    "Choose your language": "Choisissez votre langue",
    "English": "Anglais",
    "Auto-detect": "Détection automatique",
    "Continue": "Continuer",
    "Back": "Retour",
    "Next": "Suivant",
    "See summary": "Voir le résumé",
    "Done": "Terminé",
    "Start over": "Recommencer",
    "Share": "Partager",
    "What's off about this?": "Qu'est-ce qui ne va pas ici ?",
    "Optional note": "Note facultative",
    "Cancel": "Annuler",
    "Submit": "Envoyer",
    "Sending…": "Envoi…",
    "Got it, thank you.": "Bien noté, merci.",
    "Events are mixing": "Les événements sont mélangés",
    "Wrong person": "Mauvaise personne",
    "Didn't happen": "Ça ne s'est pas produit",
    "Tone misread": "Le ton est mal interprété",
    "Overclaiming": "Conclusion trop poussée",
    "Missing context": "Contexte manquant",
    "Other": "Autre",
    "The Roast": "Le Roast",
    "The Lovely": "Le Doux",
    "The Funny": "Le Drôle",
    "The Stats": "Les Stats",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Rapport de Toxicité",
    "Love Language": "Langage de l'Amour",
    "Growth Report": "Rapport d'Évolution",
    "Accountability": "Responsabilité",
    "Energy Report": "Rapport d'Énergie",
    "Choose your report": "Choisissez votre rapport",
    "Who is this chat with?": "Avec qui est ce chat ?",
    "This helps the AI frame the analysis correctly.": "Cela aide l'IA à cadrer correctement l'analyse.",
    "Partner": "Partenaire",
    "Dating": "Fréquentation",
    "Ex": "Ex",
    "Related": "Famille",
    "Friend": "Ami",
    "Colleague": "Collègue",
    "Romantic partner or spouse": "Partenaire romantique ou conjoint",
    "Seeing each other or early stages": "Vous vous voyez ou c'est le début",
    "Former romantic partner": "Ancien partenaire romantique",
    "Parent, sibling or relative": "Parent, frère, sœur ou proche",
    "Close friend or bestie": "Ami proche ou meilleur ami",
    "Coworker or professional contact": "Collègue ou contact professionnel",
    "Someone you know": "Quelqu'un que vous connaissez",
    "Reading your messages...": "Lecture de vos messages...",
    "Finding the patterns...": "Recherche des schémas...",
    "Figuring out who's funny...": "On cherche qui est drôle...",
    "Detecting the drama...": "Détection du drama...",
    "Reading between the lines...": "Lecture entre les lignes...",
    "Almost done...": "Presque fini...",
    "Upload different file": "Téléverser un autre fichier",
    "Upload your chat": "Téléversez votre chat",
    "Reading your chat…": "Lecture de votre chat…",
    "My Results": "Mes résultats",
    "Settings": "Paramètres",
    "Delete my account": "Supprimer mon compte",
    "Relationship": "Relation",
    "Report Type": "Type de rapport",
    "Are you sure you want to delete your account?": "Êtes-vous sûr de vouloir supprimer votre compte ?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Tous vos résultats enregistrés seront perdus. Ceci supprime définitivement votre compte WrapChat et ne peut pas être annulé.",
    "Delete account": "Supprimer le compte",
    "Deleting...": "Suppression...",
    "Edit": "Modifier",
    "Your chats, unwrapped.": "Vos chats, déballés.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Groupe ou duo détecté automatiquement. Votre chat est analysé par l'IA et n'est jamais stocké. Seuls les résultats sont enregistrés.",
    "UI language": "Langue de l'interface",
    "Report language": "Langue du rapport",
    "auto": "auto",
    "changed": "modifié",
    "quips.duo.obsessed": [`"{name}, tu devrais peut-être regarder ton temps d'écran."`,`"{name} porte cette conversation à la seule force des pouces."`,`"Pas obsédé, juste très disponible. Bien sûr, {name}."`],
    "quips.duo.responseBalanced": [`"Vous répondez tous les deux au même rythme. Pas de fantôme ici."`,`"Personne ne fait attendre l'autre. C'est rare."`,`"Vous êtes présents tous les deux. Voilà à quoi ressemble l'équilibre."`],
    "quips.duo.ghost": [`"Bien sûr, {name} était 'occupé'."`,`"{name} : a lu le message et a répondu... plus tard."`,`"{name} traite les réponses comme une ressource limitée."`],
    "quips.duo.lastWord": [`"{name} envoie un message et la conversation s'arrête là."`,`"Dernière image : le message de {name}, sans réponse."`,`"{name} a un vrai talent pour avoir le dernier mot."`],
    "quips.duo.streak100": [`"{streak} jours. Ce n'est plus une série, c'est un mode de vie."`,`"Plus de {streak} jours d'affilée. Quoi que ce soit, c'est réel."`,`"{streak} jours d'affilée. Une vraie régularité."`],
    "quips.duo.streak30": [`"{streak} jours sans trou. C'est rare."`,`"Plus d'un mois de présence continue. Ça veut dire quelque chose."`,`"Pas de pause, pas d'excuse. Juste {streak} jours d'affilée."`],
    "quips.duo.streak10": [`"{streak} jours d'affilée. Pas mal du tout."`,`"Bon, c'est franchement mignon."`,`"Quelque chose marchait clairement pendant ces {streak} jours."`],
    "quips.duo.streakShort": [`"{streak} jours. Court, mais réel."`,`"Même une série de {streak} jours compte."`,`"{streak} jours sans se manquer, ça compte aussi."`],
    "quips.duo.convStarter": [`"Quelqu'un pense toujours à l'autre en premier."`,`"{name} est toujours celui qui brise le silence en premier."`,`"Le premier message vient encore de {name}. Ça en dit long."`],
    "quips.duo.messageLengthSimilar": [`"Longueur des messages presque identique. Suspectement équilibré."`,`"Pas de romancier ici, pas de minimaliste non plus. Juste deux personnes qui écrivent pareil."`,`"Équilibré. Ni romans, ni réponses en un mot."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} traite chaque texto comme une lettre à la postérité."`,`"Quelque part, {novelist} est encore en train d'écrire."`,`"{texter} répond. {novelist} développe."`],
    "quips.group.mainCharacter": [`"{name}, ce groupe est pratiquement ton blog personnel."`,`"{name} est venu parler, et ça se voit."`,`"Sans {name}, ce chat serait un cimetière."`],
    "quips.group.ghost": [`"{name} n'est là qu'en esprit."`,`"{name} a rejoint le groupe puis a disparu."`,`"Observateur silencieux. Mystère complet. {name}."`],
    "quips.group.lastWord": [`"{name} envoie un message. Le groupe ne répond pas. Classique."`,`"Après le message de {name}, le groupe se tait à chaque fois."`,`"{name} a l'habitude d'envoyer des messages dans le vide."`],
    "quips.group.streak100": [`"{streak} jours sans une seule pause. Ce groupe est à part."`,`"Plus de {streak} jours d'affilée. Là, on parle d'engagement."`,`"Ce qui garde ce groupe vivant devrait être mis en bouteille."`],
    "quips.group.streak30": [`"{streak} jours de présence. C'est un vrai groupe."`,`"Pas un seul jour de pause. Ce groupe est investi."`,`"La plupart des groupes meurent en deux semaines. Pas celui-ci."`],
    "quips.group.streak10": [`"{streak} jours d'affilée. Le groupe était vivant."`,`"Vous vous aimez vraiment bien. Surprise."`,`"{streak} jours d'affilée. Plus que la plupart des groupes."`],
    "quips.group.streakShort": [`"{streak} jours. Petit, mais ça compte."`,`"Même une série de {streak} jours veut dire quelque chose."`,`"Même {streak} jours d'affilée demandent un effort."`],
    "quips.group.novelist": [`"{name} écrit comme s'il n'y avait aucune limite de mots."`,`"{name} envoie des messages avec un vrai arc narratif."`,`"S'il y a une dissertation dans le groupe, c'est {name} qui l'a écrite."`],
    "msgs": "msgs",
    "Red flag {index}": "Signal d'alerte {index}",
    "This pattern showed up enough to feel worth watching.": "Ce schéma est apparu assez souvent pour mériter attention.",
    "Evidence": "Preuve",
    "Who's more obsessed?": "Qui est le plus obsédé ?",
    "{pct}% of all messages came from {name}.": "{pct}% de tous les messages viennent de {name}.",
    "Response times": "Temps de réponse",
    "Balanced": "Équilibré",
    "{name} avg reply:": "{name} rép. moy. :",
    "The Ghost Award": "Le Prix Fantôme",
    "What's really going on": "Ce qui se passe vraiment",
    "The Last Word": "Le Dernier Mot",
    "Sends the last message that nobody replies to — {count} times.": "Envoie le dernier message sans réponse — {count} fois.",
    "Sends the last message that nobody replies to.": "Envoie le dernier message sans réponse.",
    "Your longest streak": "Votre plus longue série",
    "{count} days": "{count} jours",
    "Texted every single day for {count} days straight.": "Messages chaque jour pendant {count} jours d'affilée.",
    "The Kindest One": "La Personne La Plus Gentille",
    "The sweetest moment": "Le moment le plus doux",
    "Top 3 most active months": "Les 3 mois les plus actifs",
    "{month} was your month. Something was going on.": "{month} était votre mois. Il se passait quelque chose.",
    "Who always reaches out first?": "Qui écrit toujours en premier ?",
    "Started {pct} of all conversations.": "A lancé {pct}% de toutes les conversations.",
    "The Funny One": "Le Plus Drôle",
    "Drops lines like": "Balance des vannes comme",
    "Spirit emojis": "Emojis esprits",
    "These two emojis basically ARE this chat.": "Ces deux emojis SONT littéralement ce chat.",
    "Top 10 most used words": "Les 10 mots les plus utilisés",
    "Signature phrases": "Phrases caractéristiques",
    "The phrases that define each of you.": "Les phrases qui définissent chacun de vous.",
    "avg chars": "caract. moy.",
    "longest message": "message le plus long",
    "Media and links": "Médias et liens",
    "Photos & videos": "Photos et vidéos",
    "Voice memos": "Notes vocales",
    "Links shared": "Liens partagés",
    "What you actually talk about": "De quoi vous parlez vraiment",
    "Biggest topic": "Sujet principal",
    "Most tense moment": "Le moment le plus tendu",
    "The Drama Report": "Le Rapport Drama",
    "How they do it": "Comment ils le font",
    "Chat vibe": "Ambiance du chat",
    "A chaotic, wholesome connection.": "Un lien chaotique mais sain.",
    "Powered by AI — your messages never left your device.": "Alimenté par l'IA — vos messages n'ont jamais quitté votre appareil.",
    "Relationship reading": "Lecture de la relation",
    "Observed pattern": "Schéma observé",
    "Concrete example": "Exemple concret",
    "Evidence log": "Journal de preuves",
    "What the chat shows": "Ce que montre le chat",
    "Toxicity scorecard": "Tableau de toxicité",
    "Why this person scores highest": "Pourquoi cette personne a le score le plus élevé",
    "Tension snapshot": "Aperçu de la tension",
    "What keeps repeating": "Ce qui se répète",
    "Main topic": "Sujet principal",
    "Pattern note": "Note sur le schéma",
    "The strongest pattern is shown above.": "Le schéma le plus fort est affiché ci-dessus.",
    "Toxicity report": "Rapport de toxicité",
    "Overall read": "Lecture globale",
    "Score breakdown": "Détail des scores",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Ce mode est conçu pour faire ressortir des schémas et des exemples, pas pour décider à votre place.",
    "The Main Character": "Le Personnage Principal",
    "The Ghost": "Le Fantôme",
    "{count} messages total. Why are they even here?": "{count} messages au total. Pourquoi sont-ils là d'ailleurs ?",
    "The group was most alive in {month}.": "Le groupe était le plus actif en {month}.",
    "Longest active streak": "Plus longue série active",
    "The group kept the chat alive for {count} days straight.": "Le groupe a maintenu le chat vivant pendant {count} jours d'affilée.",
    "The Hype Person": "L'Animateur du Groupe",
    "Started {pct} of all conversations. The engine of this group.": "A lancé {pct}% de toutes les conversations. Le moteur de ce groupe.",
    "Why {name} is the hype": "Pourquoi {name} anime le groupe",
    "Group spirit emoji": "Emoji esprit du groupe",
    "This one emoji basically summarises the entire group energy.": "Cet emoji résume à lui seul toute l'énergie du groupe.",
    "The Novelist": "Le Romancier",
    "Their longest message was mostly about \"{topic}\".": "Leur message le plus long portait surtout sur \"{topic}\".",
    "The inside joke": "La blague interne",
    "Most missed member": "Le membre qui manque le plus",
    "When they go quiet, the group feels it.": "Quand ils se taisent, le groupe le ressent.",
    "The group read": "La lecture du groupe",
    "Group dynamic": "Dynamique du groupe",
    "Group vibe": "Ambiance du groupe",
    "Chaotic. Wholesome. Somehow still going.": "Chaotique. Sain. Et pourtant toujours là.",
    "Group pattern read": "Lecture du schéma du groupe",
    "Support and strain": "Soutien et tension",
    "Who keeps it going": "Qui maintient le groupe en vie",
    "{name} started {pct} of conversations.": "{name} a lancé {pct}% des conversations.",
    "The group shares the conversation starts.": "Le groupe partage les débuts de conversation.",
    "Who goes quiet": "Qui se tait",
    "{name} is the least active member in the sampled history.": "{name} est le membre le moins actif dans l'historique analysé.",
    "No clear ghost in this sample.": "Pas de fantôme évident dans cet échantillon.",
    "Chat Health Score": "Score de Santé du Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Sur 10 — basé sur les schémas de conflit, le style de communication et la dynamique générale.",
    "Verdict": "Verdict",
    "Individual health scores": "Scores de santé individuels",
    "Who apologises more": "Qui s'excuse le plus",
    "Red flag moments": "Moments d'alerte",
    "Conflict pattern": "Schéma de conflit",
    "How arguments unfold": "Comment les disputes se déroulent",
    "Power balance": "Équilibre du pouvoir",
    "Power dynamic": "Dynamique du pouvoir",
    "The verdict": "Le verdict",
    "Overall chat health score.": "Score de santé global du chat.",
    "Final read": "Lecture finale",
    "Reflects patterns in this sample — not a final judgment.": "Reflète des schémas dans cet échantillon — pas un jugement définitif.",
    "{name}'s love language": "Le langage de l'amour de {name}",
    "How they show it": "Comment ils le montrent",
    "The language gap": "Le fossé de langage",
    "Do they speak the same language?": "Parlent-ils le même langage ?",
    "Most loving moment": "Le moment le plus tendre",
    "The moment": "Le moment",
    "Love language compatibility": "Compatibilité de langage de l'amour",
    "Compatibility read": "Lecture de compatibilité",
    "Then vs Now": "Avant vs Maintenant",
    "Early messages": "Messages du début",
    "Recent messages": "Messages récents",
    "Who changed more": "Qui a le plus changé",
    "How they changed": "Comment ils ont changé",
    "What changed in the chat": "Ce qui a changé dans le chat",
    "Topics that appeared": "Sujets apparus",
    "Topics that faded": "Sujets disparus",
    "Relationship trajectory": "Trajectoire de la relation",
    "What the data shows": "Ce que montrent les données",
    "The arc": "L'arc",
    "Promises made": "Promesses faites",
    "promises": "promesses",
    "Overall verdict": "Verdict général",
    "{name}'s accountability": "La responsabilité de {name}",
    "kept": "tenues",
    "broken": "brisées",
    "Pattern": "Schéma",
    "Most notable broken promise": "La promesse brisée la plus notable",
    "Most notable kept promise": "La promesse tenue la plus notable",
    "Net energy scores": "Scores d'énergie nets",
    "Energy compatibility": "Compatibilité d'énergie",
    "{name}'s energy": "L'énergie de {name}",
    "Positive energy": "Énergie positive",
    "Draining patterns": "Schémas épuisants",
    "Most energising moment": "Le moment le plus énergisant",
    "Most draining moment": "Le moment le plus épuisant",
    "messages": "messages",
    "Your relationship, in data.": "Votre relation, en données.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Lit votre chat et vous montre ce qui se passe vraiment. Qui est présent. Qui disparaît. Qui porte la conversation.",
    "Skip": "Passer",
    "Start with your chat.": "Commencez par votre chat.",
    "Upload. Analyse. See it clearly.": "Importez. Analysez. Voyez clairement.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Six rapports. Toxicité, langages de l'amour, responsabilité, énergie, croissance et votre chat complet résumé. Résultats en moins d'une minute.",
    "Log out": "Se déconnecter",
    "Feedback Inbox": "Boîte de retours",
    "Large group detected — analysing the top {cap} members out of {count}.": "Grand groupe détecté — analyse des {cap} membres les plus actifs sur {count}.",
  },
  de: {
    "Choose your language": "Wähle deine Sprache",
    "English": "Englisch",
    "Auto-detect": "Automatisch erkennen",
    "Continue": "Weiter",
    "Back": "Zurück",
    "Next": "Weiter",
    "See summary": "Zusammenfassung ansehen",
    "Done": "Fertig",
    "Start over": "Neu starten",
    "Share": "Teilen",
    "What's off about this?": "Was stimmt hier nicht?",
    "Optional note": "Optionale Notiz",
    "Cancel": "Abbrechen",
    "Submit": "Senden",
    "Sending…": "Wird gesendet…",
    "Got it, thank you.": "Verstanden, danke.",
    "Events are mixing": "Ereignisse werden vermischt",
    "Wrong person": "Falsche Person",
    "Didn't happen": "Ist nicht passiert",
    "Tone misread": "Ton falsch gelesen",
    "Overclaiming": "Zu starke Behauptung",
    "Missing context": "Kontext fehlt",
    "Other": "Andere",
    "The Roast": "Der Roast",
    "The Lovely": "Das Süße",
    "The Funny": "Das Lustige",
    "The Stats": "Die Stats",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Toxizitätsbericht",
    "Love Language": "Liebessprache",
    "Growth Report": "Entwicklungsbericht",
    "Accountability": "Verlässlichkeit",
    "Energy Report": "Energiebericht",
    "Choose your report": "Wähle deinen Bericht",
    "Who is this chat with?": "Mit wem ist dieser Chat?",
    "This helps the AI frame the analysis correctly.": "Das hilft der KI, die Analyse richtig einzuordnen.",
    "Partner": "Partner",
    "Dating": "Dating",
    "Ex": "Ex",
    "Related": "Familie",
    "Friend": "Freund",
    "Colleague": "Kollege",
    "Romantic partner or spouse": "Romantischer Partner oder Ehepartner",
    "Seeing each other or early stages": "Ihr trefft euch oder seid in der Anfangsphase",
    "Former romantic partner": "Ehemaliger romantischer Partner",
    "Parent, sibling or relative": "Elternteil, Geschwisterteil oder Verwandte",
    "Close friend or bestie": "Enge Freundin oder bester Freund",
    "Coworker or professional contact": "Arbeitskollege oder beruflicher Kontakt",
    "Someone you know": "Jemand, den du kennst",
    "Reading your messages...": "Deine Nachrichten werden gelesen...",
    "Finding the patterns...": "Muster werden gefunden...",
    "Figuring out who's funny...": "Es wird herausgefunden, wer lustig ist...",
    "Detecting the drama...": "Drama wird erkannt...",
    "Reading between the lines...": "Zwischen den Zeilen lesen...",
    "Almost done...": "Fast fertig...",
    "Upload different file": "Andere Datei hochladen",
    "Upload your chat": "Chat hochladen",
    "Reading your chat…": "Dein Chat wird gelesen…",
    "My Results": "Meine Ergebnisse",
    "Settings": "Einstellungen",
    "Delete my account": "Mein Konto löschen",
    "Relationship": "Beziehung",
    "Report Type": "Berichtstyp",
    "Are you sure you want to delete your account?": "Bist du sicher, dass du dein Konto löschen möchtest?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Alle deine gespeicherten Ergebnisse werden gelöscht. Dies löscht dein WrapChat-Konto dauerhaft und kann nicht rückgängig gemacht werden.",
    "Delete account": "Konto löschen",
    "Deleting...": "Wird gelöscht...",
    "Edit": "Bearbeiten",
    "Your chats, unwrapped.": "Deine Chats, aufgedeckt.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Gruppe oder Duo wird automatisch erkannt. Dein Chat wird von KI analysiert und nie gespeichert. Nur die Ergebnisse werden gespeichert.",
    "UI language": "Oberflächensprache",
    "Report language": "Berichtssprache",
    "auto": "auto",
    "changed": "geändert",
    "quips.duo.obsessed": [`"{name}, du solltest vielleicht mal auf deine Bildschirmzeit schauen."`,`"{name} trägt diese Unterhaltung nur mit Tipp-Ausdauer."`,`"Nicht besessen, nur sehr verfügbar. Klar, {name}."`],
    "quips.duo.responseBalanced": [`"Ihr antwortet beide gleich schnell. Keine Geister hier."`,`"Niemand lässt die andere Person warten. Erfrischend."`,`"Ihr seid beide da und antwortet beide. So sieht Balance aus."`],
    "quips.duo.ghost": [`"Klar, {name} war 'beschäftigt'."`,`"{name}: Nachricht gelesen und... irgendwann geantwortet."`,`"{name} behandelt Antworten wie eine begrenzte Ressource."`],
    "quips.duo.lastWord": [`"{name} schickt eine Nachricht. Danach ist Schluss."`,`"Zuletzt gesehen: die unbeantwortete Nachricht von {name}."`,`"{name} hat Talent für das letzte Wort."`],
    "quips.duo.streak100": [`"{streak} Tage. Das ist kein Streak mehr, das ist ein Lebensstil."`,`"Mehr als {streak} Tage am Stück. Was auch immer das ist, es ist echt."`,`"{streak} Tage in Folge. Das ist ernsthafte Konstanz."`],
    "quips.duo.streak30": [`"{streak} Tage ohne Lücke. Das ist selten."`,`"Mehr als einen Monat lang konsequent da sein. Das bedeutet etwas."`,`"Keine Pausen, keine Ausreden. Nur {streak} Tage am Stück."`],
    "quips.duo.streak10": [`"{streak} Tage in Folge. Gar nicht schlecht."`,`"Okay, das ist tatsächlich ziemlich süß."`,`"Irgendetwas lief in diesen {streak} Tagen ziemlich gut."`],
    "quips.duo.streakShort": [`"{streak} Tage. Kurz, aber echt."`,`"Auch ein {streak}-Tage-Streak zählt."`,`"{streak} Tage lang nicht abreißen zu lassen, zählt auch."`],
    "quips.duo.convStarter": [`"Jemand denkt immer zuerst an die andere Person."`,`"{name} ist immer die Person, die zuerst die Stille bricht."`,`"Die erste Nachricht kommt immer wieder von {name}. Das sagt einiges."`],
    "quips.duo.messageLengthSimilar": [`"Fast identische Nachrichtenlängen. Verdächtig ausgeglichen."`,`"Kein Romanautor, kein Kurztexter. Einfach zwei Menschen mit ähnlicher Länge."`,`"Ausgeglichen. Keine Romane, keine Ein-Wort-Antworten."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} behandelt jede Nachricht wie einen Brief an die Nachwelt."`,`"Irgendwo tippt {novelist} immer noch."`,`"{texter} antwortet. {novelist} formuliert aus."`],
    "quips.group.mainCharacter": [`"{name}, das hier ist im Grunde dein persönlicher Blog."`,`"{name} ist gekommen, um zu reden, und macht genau das."`,`"Ohne {name} wäre dieser Chat ein Friedhof."`],
    "quips.group.ghost": [`"{name} ist nur im Geiste hier."`,`"{name} ist der Gruppe beigetreten und sofort verschwunden."`,`"Stiller Beobachter. Komplettes Rätsel. {name}."`],
    "quips.group.lastWord": [`"{name} schickt eine Nachricht. Die Gruppe antwortet nicht. Klassiker."`,`"Nach der Nachricht von {name} wird die Gruppe jedes Mal still."`,`"{name} schickt Nachrichten gern ins Leere."`],
    "quips.group.streak100": [`"{streak} Tage ohne eine einzige Pause. Diese Gruppe ist anders."`,`"Mehr als {streak} Tage am Stück. Das ist echtes Commitment."`,`"Was diese Gruppe am Leben hält, sollte man abfüllen."`],
    "quips.group.streak30": [`"{streak} Tage lang präsent. Das ist eine echte Gruppe."`,`"Kein einziger freier Tag. Diese Gruppe meint es ernst."`,`"Die meisten Gruppen sterben nach zwei Wochen. Diese nicht."`],
    "quips.group.streak10": [`"{streak} Tage in Folge. Die Gruppe war lebendig."`,`"Ihr mögt euch offenbar wirklich. Überraschend."`,`"{streak} Tage in Folge. Mehr als die meisten Gruppen schaffen."`],
    "quips.group.streakShort": [`"{streak} Tage. Klein, aber zählt."`,`"Auch ein {streak}-Tage-Lauf sagt etwas aus."`,`"Selbst {streak} Tage in Folge brauchen Einsatz."`],
    "quips.group.novelist": [`"{name} schreibt, als gäbe es kein Wortlimit."`,`"{name} schickt Nachrichten mit kompletter Handlung."`,`"Wenn es in der Gruppe einen Essay gibt, hat ihn {name} geschrieben."`],
    "msgs": "Nachr.",
    "Red flag {index}": "Warnsignal {index}",
    "This pattern showed up enough to feel worth watching.": "Dieses Muster tauchte oft genug auf, um es im Blick zu behalten.",
    "Evidence": "Beleg",
    "Who's more obsessed?": "Wer ist besessener?",
    "{pct}% of all messages came from {name}.": "{pct}% aller Nachrichten kamen von {name}.",
    "Response times": "Antwortzeiten",
    "Balanced": "Ausgeglichen",
    "{name} avg reply:": "{name} Ø Antwort:",
    "The Ghost Award": "Der Geister-Award",
    "What's really going on": "Was wirklich los ist",
    "The Last Word": "Das Letzte Wort",
    "Sends the last message that nobody replies to — {count} times.": "Schickt die letzte Nachricht, auf die niemand antwortet — {count} Mal.",
    "Sends the last message that nobody replies to.": "Schickt die letzte Nachricht, auf die niemand antwortet.",
    "Your longest streak": "Eure längste Serie",
    "{count} days": "{count} Tage",
    "Texted every single day for {count} days straight.": "Jeden Tag Nachrichten für {count} Tage am Stück.",
    "The Kindest One": "Die Freundlichste Person",
    "The sweetest moment": "Der süßeste Moment",
    "Top 3 most active months": "Die 3 aktivsten Monate",
    "{month} was your month. Something was going on.": "{month} war euer Monat. Da war was los.",
    "Who always reaches out first?": "Wer schreibt immer als Erstes?",
    "Started {pct} of all conversations.": "Hat {pct}% aller Gespräche begonnen.",
    "The Funny One": "Die Lustigste Person",
    "Drops lines like": "Bringt Sprüche wie",
    "Spirit emojis": "Geist-Emojis",
    "These two emojis basically ARE this chat.": "Diese zwei Emojis SIND im Grunde dieser Chat.",
    "Top 10 most used words": "Die 10 meistgenutzten Wörter",
    "Signature phrases": "Charakteristische Phrasen",
    "The phrases that define each of you.": "Die Phrasen, die jeden von euch definieren.",
    "avg chars": "Ø Zeichen",
    "longest message": "längste Nachricht",
    "Media and links": "Medien und Links",
    "Photos & videos": "Fotos & Videos",
    "Voice memos": "Sprachmemos",
    "Links shared": "Geteilte Links",
    "What you actually talk about": "Worüber ihr wirklich redet",
    "Biggest topic": "Hauptthema",
    "Most tense moment": "Der angespannteste Moment",
    "The Drama Report": "Der Drama-Bericht",
    "How they do it": "Wie sie es machen",
    "Chat vibe": "Chat-Stimmung",
    "A chaotic, wholesome connection.": "Eine chaotische, gesunde Verbindung.",
    "Powered by AI — your messages never left your device.": "KI-gestützt — deine Nachrichten haben dein Gerät nie verlassen.",
    "Relationship reading": "Beziehungsanalyse",
    "Observed pattern": "Beobachtetes Muster",
    "Concrete example": "Konkretes Beispiel",
    "Evidence log": "Belegprotokoll",
    "What the chat shows": "Was der Chat zeigt",
    "Toxicity scorecard": "Toxizitätskarte",
    "Why this person scores highest": "Warum diese Person am höchsten punktet",
    "Tension snapshot": "Spannungsmoment",
    "What keeps repeating": "Was sich wiederholt",
    "Main topic": "Hauptthema",
    "Pattern note": "Musternotiz",
    "The strongest pattern is shown above.": "Das stärkste Muster ist oben dargestellt.",
    "Toxicity report": "Toxizitätsbericht",
    "Overall read": "Gesamteinschätzung",
    "Score breakdown": "Punkteaufschlüsselung",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Dieser Modus soll Muster und Beispiele aufzeigen, nicht die Entscheidung für dich treffen.",
    "The Main Character": "Die Hauptfigur",
    "The Ghost": "Der Geist",
    "{count} messages total. Why are they even here?": "{count} Nachrichten insgesamt. Warum sind sie überhaupt hier?",
    "The group was most alive in {month}.": "Die Gruppe war im {month} am aktivsten.",
    "Longest active streak": "Längste aktive Serie",
    "The group kept the chat alive for {count} days straight.": "Die Gruppe hielt den Chat {count} Tage am Stück am Leben.",
    "The Hype Person": "Die Stimmungsmacherin",
    "Started {pct} of all conversations. The engine of this group.": "Hat {pct}% aller Gespräche begonnen. Der Motor dieser Gruppe.",
    "Why {name} is the hype": "Warum {name} die Stimmung macht",
    "Group spirit emoji": "Gruppen-Geist-Emoji",
    "This one emoji basically summarises the entire group energy.": "Dieses eine Emoji fasst die gesamte Gruppenenergie zusammen.",
    "The Novelist": "Der Romanautor",
    "Their longest message was mostly about \"{topic}\".": "Ihre längste Nachricht handelte hauptsächlich von \"{topic}\".",
    "The inside joke": "Der Insider",
    "Most missed member": "Das am meisten vermisste Mitglied",
    "When they go quiet, the group feels it.": "Wenn sie still werden, spürt die Gruppe es.",
    "The group read": "Die Gruppenanalyse",
    "Group dynamic": "Gruppendynamik",
    "Group vibe": "Gruppenatmosphäre",
    "Chaotic. Wholesome. Somehow still going.": "Chaotisch. Gesund. Irgendwie läuft es noch.",
    "Group pattern read": "Gruppenmmusteranalyse",
    "Support and strain": "Unterstützung und Belastung",
    "Who keeps it going": "Wer hält es am Laufen",
    "{name} started {pct} of conversations.": "{name} hat {pct}% der Gespräche begonnen.",
    "The group shares the conversation starts.": "Die Gruppe teilt sich die Gesprächseröffnungen.",
    "Who goes quiet": "Wer wird still",
    "{name} is the least active member in the sampled history.": "{name} ist das inaktivste Mitglied im analysierten Verlauf.",
    "No clear ghost in this sample.": "Kein eindeutiger Geist in dieser Stichprobe.",
    "Chat Health Score": "Chat-Gesundheits-Score",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Von 10 — basierend auf Konfliktmustern, Kommunikationsstil und Gesamtdynamik.",
    "Verdict": "Urteil",
    "Individual health scores": "Individuelle Gesundheits-Scores",
    "Who apologises more": "Wer entschuldigt sich öfter",
    "Red flag moments": "Warnsignal-Momente",
    "Conflict pattern": "Konfliktmuster",
    "How arguments unfold": "Wie Streitigkeiten eskalieren",
    "Power balance": "Machtgleichgewicht",
    "Power dynamic": "Machtdynamik",
    "The verdict": "Das Urteil",
    "Overall chat health score.": "Gesamt-Gesundheits-Score des Chats.",
    "Final read": "Abschließende Einschätzung",
    "Reflects patterns in this sample — not a final judgment.": "Spiegelt Muster in dieser Stichprobe wider — kein endgültiges Urteil.",
    "{name}'s love language": "{name}s Liebessprache",
    "How they show it": "Wie sie es zeigen",
    "The language gap": "Die Sprach-Lücke",
    "Do they speak the same language?": "Sprechen sie dieselbe Sprache?",
    "Most loving moment": "Der liebevollste Moment",
    "The moment": "Der Moment",
    "Love language compatibility": "Kompatibilität der Liebessprachen",
    "Compatibility read": "Kompatibilitätsanalyse",
    "Then vs Now": "Damals vs Heute",
    "Early messages": "Frühe Nachrichten",
    "Recent messages": "Aktuelle Nachrichten",
    "Who changed more": "Wer hat sich mehr verändert",
    "How they changed": "Wie sie sich verändert haben",
    "What changed in the chat": "Was sich im Chat verändert hat",
    "Topics that appeared": "Themen, die auftauchten",
    "Topics that faded": "Themen, die verschwanden",
    "Relationship trajectory": "Beziehungsverlauf",
    "What the data shows": "Was die Daten zeigen",
    "The arc": "Der Bogen",
    "Promises made": "Gemachte Versprechen",
    "promises": "Versprechen",
    "Overall verdict": "Gesamturteil",
    "{name}'s accountability": "{name}s Verlässlichkeit",
    "kept": "gehalten",
    "broken": "gebrochen",
    "Pattern": "Muster",
    "Most notable broken promise": "Das auffälligste gebrochene Versprechen",
    "Most notable kept promise": "Das auffälligste gehaltene Versprechen",
    "Net energy scores": "Netto-Energie-Scores",
    "Energy compatibility": "Energiekompatibilität",
    "{name}'s energy": "{name}s Energie",
    "Positive energy": "Positive Energie",
    "Draining patterns": "Kräftezehrende Muster",
    "Most energising moment": "Der energiereichste Moment",
    "Most draining moment": "Der erschöpfendste Moment",
    "messages": "Nachrichten",
    "Your relationship, in data.": "Deine Beziehung, in Daten.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Liest deinen Chat-Export und zeigt dir, was wirklich los ist. Wer da ist. Wer ghostet. Wer das Gespräch trägt.",
    "Skip": "Überspringen",
    "Start with your chat.": "Fang mit deinem Chat an.",
    "Upload. Analyse. See it clearly.": "Hochladen. Analysieren. Klar sehen.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Sechs Berichte. Toxizität, Liebessprachen, Verlässlichkeit, Energie, Wachstum und dein vollständiger Chat zusammengefasst. Ergebnisse in weniger als einer Minute.",
    "Log out": "Abmelden",
    "Feedback Inbox": "Feedback-Postfach",
    "Large group detected — analysing the top {cap} members out of {count}.": "Große Gruppe erkannt — die {cap} aktivsten Mitglieder von {count} werden analysiert.",
  },
  it: {
    "Choose your language": "Scegli la tua lingua",
    "English": "Inglese",
    "Auto-detect": "Rilevamento automatico",
    "Continue": "Continua",
    "Back": "Indietro",
    "Next": "Avanti",
    "See summary": "Vedi riepilogo",
    "Done": "Fatto",
    "Start over": "Ricomincia",
    "Share": "Condividi",
    "What's off about this?": "Cosa non torna qui?",
    "Optional note": "Nota facoltativa",
    "Cancel": "Annulla",
    "Submit": "Invia",
    "Sending…": "Invio in corso…",
    "Got it, thank you.": "Ricevuto, grazie.",
    "Events are mixing": "Gli eventi si stanno confondendo",
    "Wrong person": "Persona sbagliata",
    "Didn't happen": "Non è successo",
    "Tone misread": "Tono interpretato male",
    "Overclaiming": "Conclusione esagerata",
    "Missing context": "Manca contesto",
    "Other": "Altro",
    "The Roast": "Il Roast",
    "The Lovely": "Il Tenero",
    "The Funny": "Il Divertente",
    "The Stats": "Le Statistiche",
    "Insight": "Insight",
    "WrapChat": "WrapChat",
    "Toxicity Report": "Report Tossicità",
    "Love Language": "Linguaggio dell'Amore",
    "Growth Report": "Report Evoluzione",
    "Accountability": "Affidabilità",
    "Energy Report": "Report Energia",
    "Choose your report": "Scegli il tuo report",
    "Who is this chat with?": "Con chi è questa chat?",
    "This helps the AI frame the analysis correctly.": "Questo aiuta l'IA a inquadrare correttamente l'analisi.",
    "Partner": "Partner",
    "Dating": "Frequentazione",
    "Ex": "Ex",
    "Related": "Famiglia",
    "Friend": "Amico",
    "Colleague": "Collega",
    "Romantic partner or spouse": "Partner romantico o coniuge",
    "Seeing each other or early stages": "Vi frequentate o siete alle prime fasi",
    "Former romantic partner": "Ex partner romantico",
    "Parent, sibling or relative": "Genitore, fratello, sorella o parente",
    "Close friend or bestie": "Amico stretto o migliore amico",
    "Coworker or professional contact": "Collega o contatto professionale",
    "Someone you know": "Qualcuno che conosci",
    "Reading your messages...": "Sto leggendo i tuoi messaggi...",
    "Finding the patterns...": "Sto trovando gli schemi...",
    "Figuring out who's funny...": "Sto capendo chi è il più divertente...",
    "Detecting the drama...": "Sto rilevando il drama...",
    "Reading between the lines...": "Sto leggendo tra le righe...",
    "Almost done...": "Quasi fatto...",
    "Upload different file": "Carica un file diverso",
    "Upload your chat": "Carica la tua chat",
    "Reading your chat…": "Sto leggendo la tua chat…",
    "My Results": "I miei risultati",
    "Settings": "Impostazioni",
    "Delete my account": "Elimina il mio account",
    "Relationship": "Relazione",
    "Report Type": "Tipo di report",
    "Are you sure you want to delete your account?": "Sei sicuro di voler eliminare il tuo account?",
    "All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.": "Tutti i tuoi risultati salvati andranno persi. Questo elimina definitivamente il tuo account WrapChat e non può essere annullato.",
    "Delete account": "Elimina account",
    "Deleting...": "Eliminazione...",
    "Edit": "Modifica",
    "Your chats, unwrapped.": "Le tue chat, svelate.",
    "Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.": "Gruppo o duo rilevato automaticamente. La tua chat viene analizzata dall'IA e non viene mai archiviata. Vengono salvati solo i risultati.",
    "UI language": "Lingua interfaccia",
    "Report language": "Lingua del report",
    "auto": "auto",
    "changed": "modificato",
    "quips.duo.obsessed": [`"{name}, forse dovresti controllare il tuo tempo schermo."`,`"{name} sta reggendo questa conversazione con pura resistenza da tastiera."`,`"Non è ossessione, è solo troppa disponibilità. Certo, {name}."`],
    "quips.duo.responseBalanced": [`"Rispondete entrambi allo stesso ritmo. Nessun fantasma qui."`,`"Nessuno lascia l'altro in attesa. Rinfrescante."`,`"Entrambi rispondete, entrambi ci siete. Questo è equilibrio."`],
    "quips.duo.ghost": [`"Certo, {name} era 'occupato'."`,`"{name}: ha letto il messaggio e ha risposto... alla fine."`,`"{name} tratta le risposte come una risorsa limitata."`],
    "quips.duo.lastWord": [`"{name} manda un messaggio e la conversazione finisce lì."`,`"Ultima scena: il messaggio di {name}, senza risposta."`,`"{name} ha un talento naturale per l'ultima parola."`],
    "quips.duo.streak100": [`"{streak} giorni. Non è una streak, è uno stile di vita."`,`"Più di {streak} giorni di fila. Qualunque cosa sia, è reale."`,`"{streak} giorni consecutivi. È una costanza seria."`],
    "quips.duo.streak30": [`"{streak} giorni senza buchi. È raro."`,`"Più di un mese di presenza costante. Significa qualcosa."`,`"Niente pause, niente scuse. Solo {streak} giorni di fila."`],
    "quips.duo.streak10": [`"{streak} giorni di fila. Niente male."`,`"Ok, questo è davvero carino."`,`"Qualcosa funzionava chiaramente in quei {streak} giorni."`],
    "quips.duo.streakShort": [`"{streak} giorni. Breve ma vero."`,`"Anche una streak di {streak} giorni conta."`,`"{streak} giorni senza sparire contano comunque."`],
    "quips.duo.convStarter": [`"Qualcuno pensa sempre all'altra persona per primo."`,`"{name} è sempre quello che rompe il silenzio per primo."`,`"Il primo messaggio continua ad arrivare da {name}. Dice molto."`],
    "quips.duo.messageLengthSimilar": [`"Lunghezze quasi identiche. Sospettosamente equilibrato."`,`"Niente romanziere, niente minimalista. Solo due persone che scrivono più o meno uguale."`,`"Equilibrato. Niente poemi, niente risposte da una parola."`],
    "quips.duo.messageLengthDifferent": [`"{novelist} tratta ogni messaggio come una lettera ai posteri."`,`"Da qualche parte {novelist} sta ancora scrivendo."`,`"{texter} risponde. {novelist} sviluppa."`],
    "quips.group.mainCharacter": [`"{name}, questo è praticamente il tuo blog personale."`,`"{name} è venuto qui per parlare, e si vede."`,`"Senza {name}, questa chat sarebbe un cimitero."`],
    "quips.group.ghost": [`"{name} è qui solo spiritualmente."`,`"{name} è entrato nel gruppo ed è sparito subito."`,`"Osservatore silenzioso. Mistero totale. {name}."`],
    "quips.group.lastWord": [`"{name} manda un messaggio. Il gruppo non risponde. Classico."`,`"Dopo il messaggio di {name}, il gruppo si zittisce ogni volta."`,`"{name} ha l'abitudine di mandare messaggi nel vuoto."`],
    "quips.group.streak100": [`"{streak} giorni senza una sola pausa. Questo gruppo è diverso."`,`"Più di {streak} giorni di fila. Qui si parla di impegno."`,`"Quello che tiene vivo questo gruppo andrebbe imbottigliato."`],
    "quips.group.streak30": [`"{streak} giorni di presenza. Questo è un vero gruppo."`,`"Nemmeno un giorno di pausa. Questo gruppo fa sul serio."`,`"La maggior parte dei gruppi muore dopo due settimane. Questo no."`],
    "quips.group.streak10": [`"{streak} giorni di fila. Il gruppo era vivo."`,`"Vi piacete davvero. Sorprendente."`,`"{streak} giorni di fila. Più di quanto facciano la maggior parte dei gruppi."`],
    "quips.group.streakShort": [`"{streak} giorni. Poco, ma conta."`,`"Anche una streak di {streak} giorni significa qualcosa."`,`"Perfino {streak} giorni di fila richiedono impegno."`],
    "quips.group.novelist": [`"{name} scrive come se non esistesse un limite di parole."`,`"{name} manda messaggi con uno sviluppo completo della trama."`,`"Se c'è un saggio nel gruppo, lo ha scritto {name}."`],
    "msgs": "msg",
    "Red flag {index}": "Segnale d'allarme {index}",
    "This pattern showed up enough to feel worth watching.": "Questo schema è apparso abbastanza da meritare attenzione.",
    "Evidence": "Prova",
    "Who's more obsessed?": "Chi è più ossessionato?",
    "{pct}% of all messages came from {name}.": "Il {pct}% di tutti i messaggi è venuto da {name}.",
    "Response times": "Tempi di risposta",
    "Balanced": "Equilibrato",
    "{name} avg reply:": "{name} risp. media:",
    "The Ghost Award": "Il Premio Fantasma",
    "What's really going on": "Cosa sta succedendo davvero",
    "The Last Word": "L'Ultima Parola",
    "Sends the last message that nobody replies to — {count} times.": "Manda l'ultimo messaggio a cui nessuno risponde — {count} volte.",
    "Sends the last message that nobody replies to.": "Manda l'ultimo messaggio a cui nessuno risponde.",
    "Your longest streak": "La tua serie più lunga",
    "{count} days": "{count} giorni",
    "Texted every single day for {count} days straight.": "Messaggi ogni giorno per {count} giorni di fila.",
    "The Kindest One": "La Persona Più Gentile",
    "The sweetest moment": "Il momento più dolce",
    "Top 3 most active months": "I 3 mesi più attivi",
    "{month} was your month. Something was going on.": "{month} era il vostro mese. Stava succedendo qualcosa.",
    "Who always reaches out first?": "Chi scrive sempre per primo?",
    "Started {pct} of all conversations.": "Ha avviato il {pct}% di tutte le conversazioni.",
    "The Funny One": "Il Più Divertente",
    "Drops lines like": "Lascia cadere frasi come",
    "Spirit emojis": "Emoji spirito",
    "These two emojis basically ARE this chat.": "Queste due emoji SONO fondamentalmente questa chat.",
    "Top 10 most used words": "Le 10 parole più usate",
    "Signature phrases": "Frasi caratteristiche",
    "The phrases that define each of you.": "Le frasi che definiscono ognuno di voi.",
    "avg chars": "car. medi",
    "longest message": "messaggio più lungo",
    "Media and links": "Media e link",
    "Photos & videos": "Foto e video",
    "Voice memos": "Note vocali",
    "Links shared": "Link condivisi",
    "What you actually talk about": "Di cosa parlate davvero",
    "Biggest topic": "Argomento principale",
    "Most tense moment": "Il momento più teso",
    "The Drama Report": "Il Rapporto Drama",
    "How they do it": "Come lo fanno",
    "Chat vibe": "Atmosfera della chat",
    "A chaotic, wholesome connection.": "Un legame caotico ma sano.",
    "Powered by AI — your messages never left your device.": "Alimentato dall'IA — i tuoi messaggi non hanno mai lasciato il tuo dispositivo.",
    "Relationship reading": "Lettura della relazione",
    "Observed pattern": "Schema osservato",
    "Concrete example": "Esempio concreto",
    "Evidence log": "Registro delle prove",
    "What the chat shows": "Cosa mostra la chat",
    "Toxicity scorecard": "Scheda della tossicità",
    "Why this person scores highest": "Perché questa persona ha il punteggio più alto",
    "Tension snapshot": "Istantanea della tensione",
    "What keeps repeating": "Cosa continua a ripetersi",
    "Main topic": "Argomento principale",
    "Pattern note": "Nota sullo schema",
    "The strongest pattern is shown above.": "Lo schema più forte è mostrato sopra.",
    "Toxicity report": "Rapporto sulla tossicità",
    "Overall read": "Lettura generale",
    "Score breakdown": "Dettaglio del punteggio",
    "This mode is meant to surface patterns and examples, not make the decision for you.": "Questa modalità serve a evidenziare schemi ed esempi, non a decidere per te.",
    "The Main Character": "Il Personaggio Principale",
    "The Ghost": "Il Fantasma",
    "{count} messages total. Why are they even here?": "{count} messaggi in totale. Perché ci sono qui?",
    "The group was most alive in {month}.": "Il gruppo era più attivo a {month}.",
    "Longest active streak": "Serie attiva più lunga",
    "The group kept the chat alive for {count} days straight.": "Il gruppo ha tenuto la chat viva per {count} giorni di fila.",
    "The Hype Person": "L'Animatore del Gruppo",
    "Started {pct} of all conversations. The engine of this group.": "Ha avviato il {pct}% di tutte le conversazioni. Il motore del gruppo.",
    "Why {name} is the hype": "Perché {name} anima il gruppo",
    "Group spirit emoji": "Emoji spirito del gruppo",
    "This one emoji basically summarises the entire group energy.": "Questa emoji riassume praticamente tutta l'energia del gruppo.",
    "The Novelist": "Il Romanziere",
    "Their longest message was mostly about \"{topic}\".": "Il loro messaggio più lungo riguardava principalmente \"{topic}\".",
    "The inside joke": "La battuta interna",
    "Most missed member": "Il membro più rimpianto",
    "When they go quiet, the group feels it.": "Quando tacciono, il gruppo lo sente.",
    "The group read": "La lettura del gruppo",
    "Group dynamic": "Dinamica del gruppo",
    "Group vibe": "Atmosfera del gruppo",
    "Chaotic. Wholesome. Somehow still going.": "Caotico. Sano. In qualche modo ancora attivo.",
    "Group pattern read": "Lettura dello schema del gruppo",
    "Support and strain": "Supporto e tensione",
    "Who keeps it going": "Chi lo mantiene vivo",
    "{name} started {pct} of conversations.": "{name} ha avviato il {pct}% delle conversazioni.",
    "The group shares the conversation starts.": "Il gruppo condivide i punti di partenza delle conversazioni.",
    "Who goes quiet": "Chi si fa silenzioso",
    "{name} is the least active member in the sampled history.": "{name} è il membro meno attivo nella cronologia analizzata.",
    "No clear ghost in this sample.": "Nessun fantasma evidente in questo campione.",
    "Chat Health Score": "Punteggio di Salute della Chat",
    "Out of 10 — based on conflict patterns, communication style, and overall dynamic.": "Su 10 — basato su schemi di conflitto, stile di comunicazione e dinamica generale.",
    "Verdict": "Verdetto",
    "Individual health scores": "Punteggi di salute individuali",
    "Who apologises more": "Chi si scusa di più",
    "Red flag moments": "Momenti di allarme",
    "Conflict pattern": "Schema di conflitto",
    "How arguments unfold": "Come si sviluppano le discussioni",
    "Power balance": "Equilibrio del potere",
    "Power dynamic": "Dinamica del potere",
    "The verdict": "Il verdetto",
    "Overall chat health score.": "Punteggio generale di salute della chat.",
    "Final read": "Lettura finale",
    "Reflects patterns in this sample — not a final judgment.": "Riflette schemi in questo campione — non è un giudizio definitivo.",
    "{name}'s love language": "Il linguaggio dell'amore di {name}",
    "How they show it": "Come lo mostrano",
    "The language gap": "Il divario di linguaggio",
    "Do they speak the same language?": "Parlano la stessa lingua?",
    "Most loving moment": "Il momento più amorevole",
    "The moment": "Il momento",
    "Love language compatibility": "Compatibilità del linguaggio dell'amore",
    "Compatibility read": "Lettura della compatibilità",
    "Then vs Now": "Prima vs Ora",
    "Early messages": "Messaggi iniziali",
    "Recent messages": "Messaggi recenti",
    "Who changed more": "Chi è cambiato di più",
    "How they changed": "Come sono cambiati",
    "What changed in the chat": "Cosa è cambiato nella chat",
    "Topics that appeared": "Argomenti apparsi",
    "Topics that faded": "Argomenti scomparsi",
    "Relationship trajectory": "Traiettoria della relazione",
    "What the data shows": "Cosa mostrano i dati",
    "The arc": "L'arco",
    "Promises made": "Promesse fatte",
    "promises": "promesse",
    "Overall verdict": "Verdetto generale",
    "{name}'s accountability": "L'affidabilità di {name}",
    "kept": "mantenute",
    "broken": "infrante",
    "Pattern": "Schema",
    "Most notable broken promise": "La promessa infranta più significativa",
    "Most notable kept promise": "La promessa mantenuta più significativa",
    "Net energy scores": "Punteggi netti di energia",
    "Energy compatibility": "Compatibilità energetica",
    "{name}'s energy": "L'energia di {name}",
    "Positive energy": "Energia positiva",
    "Draining patterns": "Schemi logoranti",
    "Most energising moment": "Il momento più energizzante",
    "Most draining moment": "Il momento più logorante",
    "messages": "messaggi",
    "Your relationship, in data.": "La tua relazione, in dati.",
    "Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.": "Legge la tua chat e ti mostra cosa sta succedendo davvero. Chi è presente. Chi sparisce. Chi porta avanti la conversazione.",
    "Skip": "Salta",
    "Start with your chat.": "Inizia con la tua chat.",
    "Upload. Analyse. See it clearly.": "Carica. Analizza. Vedi chiaramente.",
    "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.": "Sei report. Tossicità, linguaggi dell'amore, affidabilità, energia, crescita e la tua chat completa riassunta. Risultati in meno di un minuto.",
    "Log out": "Esci",
    "Feedback Inbox": "Casella di feedback",
    "Large group detected — analysing the top {cap} members out of {count}.": "Gruppo grande rilevato — analisi dei {cap} membri più attivi su {count}.",
  },
};

const SUPPORTED_UI_LANGS = new Set(Object.keys(LANG_META));
function normalizeUiLangPref(value) {
  const pref = String(value || "").trim().toLowerCase();
  if (pref === "auto") return "auto";
  if (pref === "english") return "en";
  return SUPPORTED_UI_LANGS.has(pref) ? pref : "en";
}
function normalizeUiLangCode(value) {
  const code = String(value || "en").trim().toLowerCase();
  return SUPPORTED_UI_LANGS.has(code) ? code : "en";
}
function resolveUiLang(uiLangPref, detectedCode) {
  const pref = normalizeUiLangPref(uiLangPref);
  return pref === "auto" ? normalizeUiLangCode(detectedCode) : normalizeUiLangCode(pref);
}
function isReliableDetectedLanguage(detectedLang) {
  const code = normalizeUiLangCode(detectedLang?.code);
  return code !== "en" || Number(detectedLang?.confidence || 0) >= LANG_CONFIDENCE_MIN;
}

function formatUITranslation(value, vars = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}
function translateUI(lang, key, vars = {}) {
  const code = normalizeUiLangCode(lang);
  const raw = UI_TRANSLATIONS[code]?.[key] ?? UI_TRANSLATIONS.en?.[key] ?? key;
  if (Array.isArray(raw)) return raw.map(item => formatUITranslation(item, vars));
  return formatUITranslation(raw, vars);
}

const CONTROL_TRANSLATIONS = {
  tr: {
    "Words of Affirmation": "Onay sözleri",
    "Acts of Service": "Hizmet davranışları",
    "Receiving Gifts": "Hediye alma",
    "Quality Time": "Kaliteli zaman",
    "Physical Touch": "Fiziksel temas",
    "Mixed": "Karışık",
    "net positive": "net pozitif",
    "mixed": "karışık",
    "net draining": "net yorucu",
    "deeper": "daha derin",
    "shallower": "daha yüzeysel",
    "about the same": "hemen hemen aynı",
    "closer": "yakınlaşan",
    "drifting": "uzaklaşan",
    "stable": "stabil",
    "Balanced": "Dengeli",
    "Shared": "Paylaşılan",
    "Tie": "Berabere",
    "None clearly identified": "Belirgin biri yok",
    "Both equally": "İkisi de eşit",
  },
  es: {
    "Words of Affirmation": "Palabras de afirmacion",
    "Acts of Service": "Actos de servicio",
    "Receiving Gifts": "Recibir regalos",
    "Quality Time": "Tiempo de calidad",
    "Physical Touch": "Contacto fisico",
    "Mixed": "Mixto",
    "net positive": "neto positivo",
    "mixed": "mixto",
    "net draining": "neto agotador",
    "deeper": "mas profundo",
    "shallower": "mas superficial",
    "about the same": "casi igual",
    "closer": "mas cerca",
    "drifting": "alejandose",
    "stable": "estable",
    "Balanced": "Equilibrado",
    "Shared": "Compartido",
    "Tie": "Empate",
    "None clearly identified": "No se identifica claramente",
    "Both equally": "Ambos por igual",
  },
  pt: {
    "Words of Affirmation": "Palavras de afirmacao",
    "Acts of Service": "Atos de servico",
    "Receiving Gifts": "Receber presentes",
    "Quality Time": "Tempo de qualidade",
    "Physical Touch": "Toque fisico",
    "Mixed": "Misto",
    "net positive": "net positivo",
    "mixed": "misto",
    "net draining": "net desgastante",
    "deeper": "mais profundo",
    "shallower": "mais superficial",
    "about the same": "quase igual",
    "closer": "mais proximos",
    "drifting": "se afastando",
    "stable": "estavel",
    "Balanced": "Equilibrado",
    "Shared": "Compartilhado",
    "Tie": "Empate",
    "None clearly identified": "Ninguem claramente identificado",
    "Both equally": "Ambos igualmente",
  },
  ar: {
    "Words of Affirmation": "كلمات التقدير",
    "Acts of Service": "افعال الخدمة",
    "Receiving Gifts": "تلقي الهدايا",
    "Quality Time": "وقت نوعي",
    "Physical Touch": "اللمس الجسدي",
    "Mixed": "مختلط",
    "net positive": "ايجابي صافي",
    "mixed": "مختلط",
    "net draining": "مستنزف صافي",
    "deeper": "اعمق",
    "shallower": "اكثر سطحية",
    "about the same": "تقريبا نفسه",
    "closer": "اكثر قربا",
    "drifting": "يبتعد",
    "stable": "مستقر",
    "Balanced": "متوازن",
    "Shared": "مشترك",
    "Tie": "تعادل",
    "None clearly identified": "لا يوجد شخص محدد بوضوح",
    "Both equally": "كلاهما بالتساوي",
  },
  fr: {
    "Words of Affirmation": "Paroles valorisantes",
    "Acts of Service": "Actes de service",
    "Receiving Gifts": "Recevoir des cadeaux",
    "Quality Time": "Temps de qualite",
    "Physical Touch": "Contact physique",
    "Mixed": "Mixte",
    "net positive": "net positif",
    "mixed": "mixte",
    "net draining": "net epuisant",
    "deeper": "plus profond",
    "shallower": "plus superficiel",
    "about the same": "a peu pres pareil",
    "closer": "plus proches",
    "drifting": "s'eloignent",
    "stable": "stable",
    "Balanced": "Equilibre",
    "Shared": "Partage",
    "Tie": "Egalite",
    "None clearly identified": "Aucune personne clairement identifiee",
    "Both equally": "Les deux egalement",
  },
  de: {
    "Words of Affirmation": "Worte der Bestatigung",
    "Acts of Service": "Hilfsbereite Taten",
    "Receiving Gifts": "Geschenke bekommen",
    "Quality Time": "Gemeinsame Zeit",
    "Physical Touch": "Korperliche Beruhrung",
    "Mixed": "Gemischt",
    "net positive": "klar positiv",
    "mixed": "gemischt",
    "net draining": "klar belastend",
    "deeper": "tiefer",
    "shallower": "oberflachlicher",
    "about the same": "ungefahr gleich",
    "closer": "naher",
    "drifting": "driften auseinander",
    "stable": "stabil",
    "Balanced": "Ausgeglichen",
    "Shared": "Geteilt",
    "Tie": "Unentschieden",
    "None clearly identified": "Niemand klar erkennbar",
    "Both equally": "Beide gleichermassen",
  },
  it: {
    "Words of Affirmation": "Parole di conferma",
    "Acts of Service": "Atti di servizio",
    "Receiving Gifts": "Ricevere regali",
    "Quality Time": "Tempo di qualita",
    "Physical Touch": "Contatto fisico",
    "Mixed": "Misto",
    "net positive": "netto positivo",
    "mixed": "misto",
    "net draining": "netto drenante",
    "deeper": "piu profondo",
    "shallower": "piu superficiale",
    "about the same": "piu o meno uguale",
    "closer": "piu vicini",
    "drifting": "si stanno allontanando",
    "stable": "stabile",
    "Balanced": "Equilibrato",
    "Shared": "Condiviso",
    "Tie": "Parita",
    "None clearly identified": "Nessuno chiaramente identificato",
    "Both equally": "Entrambi allo stesso modo",
  },
};

function translateControlValue(lang, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const code = normalizeUiLangCode(lang);
  return CONTROL_TRANSLATIONS[code]?.[text] || text;
}

function useControlT() {
  const { uiLang } = useUILanguage();
  return (value) => translateControlValue(uiLang, value);
}

// High-frequency stopwords that are strongly characteristic of each language.
// Overlap with other languages is intentional — scoring across all languages
// simultaneously lets the distribution decide rather than strict rules.
const LANG_WORDS = {
  en: new Set(["the","and","you","that","this","with","have","from","they","just","okay","yeah","dont","cant","what","your","for","but","not","its","was","are","like","know","sure","well","going","hey","haha","will","when","yes","really","need","want","come","time","good","got","been","about","get"]),
  tr: new Set(["bir","bu","ne","ben","sen","var","yok","ama","çok","nasıl","tamam","şimdi","evet","hayır","iyi","güzel","dedi","geldi","gidiyor","bilmiyorum","oldu","olur","neden","abi","canım","tabi","hani","yani","artık","bak","dur","gel","git","şey","bence","aslında","belki","seni","beni","çünkü"]),
  es: new Set(["que","los","las","con","una","del","para","por","pero","este","esto","están","tengo","gracias","hola","estoy","bien","también","cuando","porque","después","ahora","todo","muy","más","hay","así","hacer","voy","estar","quiero","puedo","sabe","siempre","nada","algo","claro","bueno","pues"]),
  pt: new Set(["que","com","uma","para","isso","você","está","tudo","então","também","quando","porque","minha","nossa","agora","aqui","depois","quero","posso","acho","fazer","vou","hoje","gente","cara","obrigado","obrigada","beleza","saudade","não","sim","né","bom","tá","oi","boa","legal","kkkk"]),
  fr: new Set(["les","des","une","est","pas","plus","avec","pour","dans","mais","bien","merci","voilà","aussi","quoi","moi","toi","mon","ton","son","sur","oui","non","très","tout","même","comme","quand","parce","alors","après","encore","rien","ça","je","tu","bonsoir","bonjour","salut","super"]),
  de: new Set(["und","die","der","das","ich","nicht","ist","mit","für","eine","bitte","danke","schon","auch","habe","nein","ja","gut","sehr","wenn","aber","noch","nur","mal","wie","was","wir","du","es","so","dann","doch","jetzt","muss","kann","hier","also","okay","klar","alles","hallo"]),
  it: new Set(["che","non","con","una","per","del","sono","hai","grazie","ciao","cosa","bene","anche","però","tutto","adesso","quando","perché","molto","come","così","dopo","poi","ancora","più","mio","tuo","suo","dove","vuoi","fare","questo","bella","bello","dai","sì","no","vero","comunque"]),
};

// Arabic block — unambiguous; ı/ğ/ş/İ are Turkish-only among supported languages
const ARABIC_RE        = /[\u0600-\u06FF]/;
const TURKISH_CHAR_RE  = /[ğışİ]/;

const LANG_DETECT_SAMPLE  = 250;  // max messages to inspect
const LANG_CONFIDENCE_MIN = 0.30; // fallback to English below this share

// Returns { code: string, label: string, confidence: number (0–1) }
function detectLanguage(messages) {
  // Evenly-spaced sample to cover the whole chat timeline
  const n      = messages.length;
  const step   = n > LANG_DETECT_SAMPLE ? Math.floor(n / LANG_DETECT_SAMPLE) : 1;
  const sample = [];
  for (let i = 0; i < n && sample.length < LANG_DETECT_SAMPLE; i += step) sample.push(messages[i]);

  const scores = { en: 0, tr: 0, es: 0, pt: 0, ar: 0, fr: 0, de: 0, it: 0 };

  for (const { body } of sample) {
    if (!body || /^<(Voice|Media) omitted>$/i.test(body) || body.startsWith("http")) continue;

    // Arabic block: strong signal — skip further scoring for this message
    if (ARABIC_RE.test(body)) { scores.ar += 6; continue; }

    // Turkish-specific characters not found in other listed languages
    if (TURKISH_CHAR_RE.test(body)) scores.tr += 3;

    const words = body.toLowerCase().replace(/[^\p{L}\s]/gu, "").split(/\s+/);
    for (const w of words) {
      if (w.length < 2) continue;
      for (const [code, wordSet] of Object.entries(LANG_WORDS)) {
        if (wordSet.has(w)) scores[code] += 1;
      }
    }
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topCode, topScore] = entries[0];
  const total = Object.values(scores).reduce((s, v) => s + v, 0);

  if (total === 0 || topScore === 0) return { code: "en", label: "English", confidence: 0 };

  const confidence = topScore / total;
  if (confidence < LANG_CONFIDENCE_MIN) return { code: "en", label: "English", confidence };
  return { code: topCode, label: LANG_META[topCode] ?? "English", confidence };
}

// ─────────────────────────────────────────────────────────────────
// LARGE-GROUP CAP
// ─────────────────────────────────────────────────────────────────
const GROUP_PARTICIPANT_THRESHOLD = 20; // above this, cap is applied
const GROUP_PARTICIPANT_CAP       = 10; // keep this many top senders

function capLargeGroup(messages) {
  const countByName = {};
  messages.forEach(m => { countByName[m.name] = (countByName[m.name] || 0) + 1; });
  const allNames = Object.keys(countByName);
  if (allNames.length <= GROUP_PARTICIPANT_THRESHOLD) {
    return { messages, cappedGroup: false, originalParticipantCount: allNames.length };
  }
  const topNames = new Set(
    Object.entries(countByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUP_PARTICIPANT_CAP)
      .map(([n]) => n)
  );
  return {
    messages: messages.filter(m => topNames.has(m.name)),
    cappedGroup: true,
    originalParticipantCount: allNames.length,
  };
}

function userProvidedDisplayName(user) {
  const meta = user?.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    meta.display_name ||
    ""
  ).trim();
}

function hasUserProvidedDisplayName(user) {
  return Boolean(userProvidedDisplayName(user));
}

function namesWithoutCurrentUser(names = [], user = null) {
  const normalizedUser = normalizeDisplayName(userProvidedDisplayName(user));
  const cleanNames = (Array.isArray(names) ? names : [])
    .map(name => String(name || "").trim())
    .filter(Boolean);
  if (!normalizedUser) return cleanNames;
  const otherNames = cleanNames.filter(name => normalizeDisplayName(name) !== normalizedUser);
  return otherNames.length ? otherNames : cleanNames;
}

function compactNamesLabel(names = [], maxVisible = 2) {
  const cleanNames = [...new Set((Array.isArray(names) ? names : [])
    .map(name => String(name || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))];
  if (!cleanNames.length) return "";
  if (cleanNames.length <= maxVisible) return cleanNames.join(", ");
  return `${cleanNames.slice(0, maxVisible).join(", ")} +${cleanNames.length - maxVisible}`;
}

function getParticipantDisplayTitle(dataset, mathData = null, user = null) {
  const datasetNames = Array.isArray(dataset?.participants)
    ? dataset.participants.map(participant => participant.displayName)
    : [];
  const mathNames = Array.isArray(mathData?.names) ? mathData.names : [];
  const names = namesWithoutCurrentUser(datasetNames.length ? datasetNames : mathNames, user);
  return compactNamesLabel(names) || dataset?.combinedMeta?.displayTitle || "WrapChat result";
}

function detectParticipantConsistencyMismatch(dataset, user) {
  return detectOtherParticipantMismatches(dataset, userProvidedDisplayName(user));
}

function applyAutomaticParticipantMerges(dataset) {
  const suggestions = dataset?.mergeState?.suggestions || [];
  if (!suggestions.length) return dataset;
  const autoIds = suggestions
    .filter(suggestion => {
      const reason = String(suggestion?.reason || "");
      const confidence = Number(suggestion?.confidence) || 0;
      return reason === "normalized-name-match" || reason === "phone-match" || confidence >= 0.96;
    })
    .map(suggestion => suggestion.id);
  if (!autoIds.length) return dataset;
  return applyApprovedMerges(dataset, autoIds, suggestions);
}

function getReviewableMergeSuggestions(dataset) {
  const approvedIds = new Set((dataset?.mergeState?.approved || []).map(suggestion => suggestion.id));
  return (dataset?.mergeState?.suggestions || []).filter(suggestion => !approvedIds.has(suggestion.id));
}
// ─────────────────────────────────────────────────────────────────
// LOCAL MATH
// ─────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([

  // ── English ──
  "i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "yourself","he","him","his","she","her","hers","they","them","their","theirs",
  "it","its","what","which","who","whom","this","that","these","those",
  "am","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","shall","should","may","might","must","can","could",
  "a","an","the","and","but","or","nor","so","yet","either","neither",
  "not","nor","as","at","by","for","in","of","on","to","up","with","from",
  "into","through","during","such","than","too","very","just","because",
  "if","while","although","though","since","about","get","got","im",
  // Missing short prepositions / particles
  "off","out","per","via","upon","onto","else","amid","plus",
  // Contractions (apostrophes stripped during normalisation)
  "youre","theyre","ive","ill","hes","shes","weve","youve","lets",
  "doesnt","didnt","wouldnt","shouldnt","couldnt","cant","wont",
  "isnt","arent","wasnt","werent","hasnt","havent","hadnt",
  "thats","theres","whats","whos","theyve",
  // Informal / chat-speak contractions
  "gonna","gotta","wanna",
  // Common affirmation / negation fillers
  "yeah","yep","yup","nope",

  // ── Turkish ──
  "bir","bu","şu","o","ve","ile","de","da","ki","mi","mı","mu","mü",
  "ben","sen","biz","siz","onlar","beni","seni","onu","bize","size","onlara",
  "için","ama","fakat","lakin","ya","veya","gibi","kadar","daha","en","çok",
  "az","ne","nasıl","neden","çünkü","eğer","ise","değil","var","yok","olan",
  "oldu","olacak","oluyor","olmuş","işte","şey","diye","bile","hem","hiç","sana","bana","artık",
  "tam","şimdi","aslında","bence","galiba","olur","olmaz","misin","mısın","musun","müsün",
  "benim","senin","bizim","şöyle","böyle","öyle","burada","orada","nerede","nereye",
  "olsa","olsun","olabilir","oldum","oldun","olduk","olmuşum","miyim","mıyım","muyum","müyüm",
  "miyiz","mıyız","muyuz","müyüz","benle","senle","bizle","bende","sende","bizde",
  // Missing postpositional connectors
  "sonra","önce","beri","karşı","göre","rağmen","doğru","boyunca",
  // Informal location contractions (short forms of burada / şurada)
  "burda","şurda",
  // Connector adverbs (parallel to English: even, only, however)
  "hatta","sadece","ancak",

  // ── Spanish ──
  "yo","tú","él","ella","nosotros","ellos","ellas","me","te","se",
  "lo","la","los","las","le","les","un","una","el","y","o","pero",
  "que","si","en","de","a","con","por","para","sin","sobre","entre",
  "como","muy","también","tampoco","ya","ahora","entonces","pues","porque",
  "cuando","donde","estoy","estás","está","estamos","están","ser","estar","hay",
  "eso","esa","ese","aquí","allí","desde","hasta","aún","todavía","nunca","siempre",
  "algo","nada","soy","eres","es","somos","son","tengo","tienes","tiene","hacer","hecho",
  // Missing prepositions / connectors
  "esto","ante","contra","hacia","según","durante","tras","mediante",
  "además","aunque","mientras","sino","excepto","salvo","inclusive","después",

  // ── Portuguese ──
  "eu","tu","ele","ela","nós","eles","elas","me","te","se","um","uma",
  "o","a","os","as","e","ou","mas","que","não","em","de","com","por",
  "para","sem","sobre","entre","como","muito","também","já","agora","então",
  "porque","quando","onde","estou","está","estamos","estão","ser","estar",
  "isso","essa","esse","aqui","ali","desde","até","ainda","nunca","sempre",
  "algo","nada","sou","és","somos","são","tenho","tens","tem","fazer","feito",
  // Missing prepositions / contracted article forms
  "das","dos","nos","nas","pelo","pela","pelos","pelas","num","numa",
  "antes","depois","durante","contra","segundo","mediante","exceto",
  // Laugh tokens (no semantic content)
  "kkk","kkkk","kkkkk",

  // ── French ──
  "je","tu","il","elle","nous","vous","ils","elles","me","te","se",
  "le","la","les","lui","leur","un","une","des","du","de","et","ou",
  "mais","que","qui","dont","si","ne","pas","plus","très","aussi",
  "encore","toujours","jamais","comment","pourquoi","tout","rien","alors",
  "maintenant","parce","quand","où","être","avoir","est","suis","sommes",
  "sont","fait","ça","ceci","cela","ici","depuis","jusqu","déjà","quelque",
  "chose","personne","fois","vais","vas","va","avons","avez","ont","faire",
  // Missing prepositions / connectors
  "sur","sous","vers","entre","avant","après","pendant","contre",
  "selon","sans","avec","car","lors","dès","afin","malgré","parmi",
  // Discourse fillers (zero semantic content in chat context)
  "quoi","donc","bref","enfin","ben","ouais","nan","genre",

  // ── German ──
  "ich","du","er","sie","es","wir","ihr","mich","dich","sich","uns",
  "euch","mir","dir","ihm","ihnen","ein","eine","einen","einem","einer",
  "eines","der","die","das","den","dem","des","und","oder","aber","weil",
  "dass","wenn","ob","nicht","kein","keine","auch","noch","schon","nur",
  "so","sehr","jetzt","dann","also","halt","mal","warum","wie","was","ist",
  "bin","bist","sind","hat","haben","werden","hier","dort","vielleicht",
  "eigentlich","irgendwie","etwas","nichts","immer","nie","heute","morgen",
  "gestern","werde","wirst","wird","mache","machen","gemacht","kannst","können",
  // Missing prepositions / connectors (the "auf/mit/an" class)
  "auf","bei","von","aus","nach","vor","über","unter","ohne","durch",
  "seit","bis","ins","ans","zum","zur","vom","beim","denn","wann",
  "zwar","damit","dafür","dabei","danach","darum","dazu","daher","davon",
  "gegen","statt","trotz","während","außer","gegenüber","entlang",

  // ── Italian ──
  "io","tu","lui","lei","noi","voi","loro","mi","ti","si","ci","vi",
  "lo","la","li","le","gli","un","una","il","i","e","o","ma","perché",
  "che","se","non","in","di","a","con","per","su","tra","fra","come",
  "più","molto","anche","ancora","sempre","mai","tutto","niente","ora","poi",
  "allora","quando","dove","sono","sei","è","siamo","siete","fare","fatto",
  "questo","questa","quello","qui","lì","certo","forse","comunque","già",
  "qualcosa","nessuno","oggi","domani","ieri","sto","sta","stiamo","stanno",
  "avere","ho","hai","ha","abbiamo","hanno",
  // Missing prepositions / contracted article forms (del/della/nel/sul class)
  "del","dei","delle","degli","della","dello",
  "nel","nei","nella","nelle","negli","nello",
  "sul","sulla","sulle","sugli",
  "dal","dalla","dalle","dagli","dallo",
  "alla","alle","agli","allo",
  "senza","dopo","prima","contro","durante","invece","tranne",
  "oppure","eppure","tuttavia","però","verso","circa","presso",

  // ── Arabic ──
  "أنا","أنت","هو","هي","نحن","أنتم","هم","في","من","إلى","على","مع",
  "عن","هذا","هذه","ذلك","تلك","التي","الذي","و","أو","لكن","لأن","إذا",
  "لا","ما","كيف","لماذا","متى","أين","كل","بعض","هنا","هناك",
  "اي","إيه","ليش","عشان","يعني","بس","طيب","كان","كنت","كانت","يكون",
  "انا","انت","انتي","إنت","إنتي","احنا","هما","فيه","فيها","علي","عليه",
  "عليها","منه","منها","لك","لكم","عندي","عندك","عادي","برضه","كمان",
  "كذا","هكذا","وين","فين","ليه",
  // Relative pronoun + missing prepositions / connectors
  "اللي","بعد","قبل","خلال","حول","ضد","رغم","حتى","بدون","فوق","تحت","بين","أمام","خلف","بجانب",

  // ── WhatsApp UI — English ──
  "image omitted","video omitted","audio omitted","voice omitted",
  "sticker omitted","gif omitted","document omitted","contact omitted",
  "media omitted","photo omitted","file omitted","location omitted",
  "poll omitted","this message was deleted","you deleted this message",
  "missed voice call","missed video call","message deleted",
  "edited","forwarded","forwarded many times",
  "call","voice","omitted","missed","missed call","voice call",
  "voice message","call omitted","missed voice","missed video","waiting","ringing",
  "click back","answered other","other device","called back",
  "no answer","declined","cancelled","incoming call","outgoing call",
  "missed group call","group call","tap to call back","tap to video call back",
  "answered","incoming","outgoing","tap",

  // ── WhatsApp UI — Turkish ──
  "görüntü silindi","video silindi","ses silindi","belge silindi",
  "konum silindi","çıkartma","bu mesaj silindi","mesaj silindi",
  "cevapsız sesli arama","cevapsız görüntülü arama","düzenlendi","iletildi",
  "arama","sesli","atlandı","cevapsız","sesli arama","görüntülü arama",
  "sesli mesaj","arama atlandı","cevapsız arama","bekliyor","çalıyor",
  "sesli not","görüntülü not",
  "gelen arama","giden arama","grup araması","cevaplandı","reddedildi",
  "iptal edildi","geri ara","yanıt yok","başka cihaz","geri aramak için dokun",

  // ── WhatsApp UI — Spanish ──
  "imagen omitida","video omitido","audio omitido","documento omitido",
  "ubicación omitida","este mensaje fue eliminado","editado","reenviado",
  "llamada","voz","omitido","perdida","llamada perdida","llamada de voz",
  "mensaje de voz","nota de voz","llamada omitida","esperando","sonando",
  "llamada entrante","llamada saliente","llamada grupal","contestado","rechazada",
  "cancelada","sin respuesta","otro dispositivo","toca para volver a llamar",

  // ── WhatsApp UI — Portuguese ──
  "imagem ocultada","vídeo ocultado","áudio ocultado","documento ocultado",
  "esta mensagem foi apagada","editada","encaminhada",
  "chamada","voz","omitido","perdida","chamada perdida","chamada de voz",
  "mensagem de voz","nota de voz","chamada omitida","aguardando","chamando",
  "chamada recebida","chamada efetuada","chamada em grupo","atendida","recusada",
  "cancelada","sem resposta","outro dispositivo","toque para ligar de volta",

  // ── WhatsApp UI — French ──
  "image omise","vidéo omise","audio omis","document omis",
  "ce message a été supprimé","modifié","transféré",
  "appel","voix","omis","manqué","appel manqué","appel vocal",
  "message vocal","note vocale","appel omis","en attente","sonnerie",
  "appel entrant","appel sortant","appel de groupe","répondu","refusé",
  "annulé","sans réponse","autre appareil","appuyez pour rappeler",

  // ── WhatsApp UI — German ──
  "bild weggelassen","video weggelassen","audio weggelassen","dokument weggelassen",
  "diese nachricht wurde gelöscht","bearbeitet","weitergeleitet",
  "anruf","sprache","weggelassen","verpasst","verpasster anruf","sprachanruf",
  "sprachnachricht","sprachnotiz","anruf weggelassen","wartend","klingelt",
  "eingehender anruf","ausgehender anruf","gruppenanruf","angenommen","abgelehnt",
  "abgebrochen","keine antwort","anderes gerät","tippen um zurückzurufen",

  // ── WhatsApp UI — Italian ──
  "immagine omessa","video omesso","audio omesso","documento omesso",
  "questo messaggio è stato eliminato","modificato","inoltrato",
  "chiamata","voce","omessa","persa","chiamata persa","chiamata vocale",
  "messaggio vocale","nota vocale","chiamata omessa","in attesa","squillando",
  "chiamata in arrivo","chiamata in uscita","chiamata di gruppo","risposto","rifiutata",
  "annullata","nessuna risposta","altro dispositivo","tocca per richiamare",

  // ── WhatsApp UI — Arabic ──
  "تم حذف هذه الرسالة","صورة محذوفة","فيديو محذوف","صوت محذوف",
  "مستند محذوف","تم التعديل","تمت إعادة التوجيه",
  "مكالمة","صوت","محذوف","فائتة","مكالمة فائتة","مكالمة صوتية",
  "رسالة صوتية","مكالمة محذوفة","في الانتظار","يرن",
  "مكالمة واردة","مكالمة صادرة","مكالمة جماعية","تم الرد","مرفوضة",
  "ملغاة","لا إجابة","جهاز آخر","اضغط للرد",
]);

const TOKEN_STOP_WORDS = new Set(
  Array.from(STOP_WORDS).flatMap(term =>
    String(term || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  )
);

const WA_NOISE_WORDS = new Set([
  "image","images","video","videos","audio","voice","sticker","gif","document","documents",
  "contact","contacts","media","photo","photos","file","files","location","poll","call","calls",
  "missed","omitted","deleted","message","messages","edited","forwarded","attached",
  // Additional call/system artifacts
  "ringing","waiting","connecting","incoming","outgoing","answered","declined","cancelled",
  // Malformed export artifacts
  "null","undefined","nan",
  // Common URL fragment that survives normalisation
  "www","http","https","com","org","net",
]);

const TOKEN_WA_NOISE_WORDS = new Set(
  Array.from(WA_NOISE_WORDS).flatMap(term =>
    String(term || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  )
);

const ROMANCE_RE = /\b(love you|luv you|miss you|my love|baby|babe|bb|darling|good night love|good morning love|kiss you|date night|come over|sleep well|xoxo|sevgilim|askim|aşkım|canim|canım|ozledim|özledim|tatlim|tatlım|bebegim|bebeğim)\b/i;
const FRIEND_RE = /\b(bestie|bro|broski|dude|girl|sis|mate|homie|kanka|knk|abi|abla)\b/i;
const WORK_RE = /\b(meeting|deadline|project|client|invoice|brief|office|shift|deck|review this|sunum|mesai|müşteri|musteri|patron|toplantı|toplanti)\b/i;
const DATE_RE = /\b(date|dinner tonight|movie night|see you tonight|come over|valentine|anniversary)\b/i;
const FLIRTY_EMOJI_RE = /(❤️|❤|💕|💖|💗|💘|😍|🥰|😘|💋)/;

const CONTROL_RE = /\b(where are you|who are you with|why are you online|why were you online|why didn't you reply|why dont you reply|why didn't you answer|why didnt you answer|answer me|pick up|call me now|send me your location|share your location|send your location|reply now|reply to me|neredesin|nerde kaldın|kimlesin|kimleydin|neden cevap vermedin|niye cevap vermedin|cevap ver|cvp ver|aç telefonu|telefonu aç|konum at|konumunu at|konum paylaş|konumunu paylaş)\b/i;
const AGGRO_RE = /\b(stupid|idiot|shut up|hate you|leave me alone|you're crazy|you are crazy|disgusting|pathetic|annoying|i'm sick of this|i am sick of this|salak|gerizekal[ıi]|aptal|mal|siktir|siktir git|defol|yeter|bıktım|biktim|nefret ediyorum|manyak|saçma|sacma)\b/i;
const BREAKUP_RE = /\b(it'?s over|we'?re done|i'?m done|im done|done with you|break up|breakup|goodbye forever|don't text me|dont text me|blocked you|bitti|bitsin|ayrıl|ayrilelim|ayrılalım|beni arama|yazma bana|engelledim|sildim seni)\b/i;
const APOLOGY_RE = /\b(sorry|i'm sorry|i am sorry|my fault|forgive me|özür dilerim|ozur dilerim|affet|hata bendeydi|haklısın|haklisin)\b/i;
const SUPPORT_RE = /\b(i'm here|i am here|here for you|got you|proud of you|take care|rest up|go rest|get some rest|drink water|eat something|text me when you|get home safe|call me if|let me know if|i can help|i'll help|i will help|i'll come|i will come|feel better|hope you feel better|hope it gets better|sending love|yanındayım|yanindayim|buradayım|buradayim|iyi misin|iyi mısın|kendine iyi bak|dinlen|uyu biraz|su iç|su ic|bir şey yedin mi|bir sey yedin mi|haber ver|arayayım|arayim|gelirim|yardım ederim|yardim ederim|geçer|gecer|hallolur|hallederiz)\b/i;
const GRATITUDE_RE = /\b(thank you|thanks|thank u|appreciate it|you’re the best|you're the best|sağ ol|sag ol|saol|teşekkür|tesekkur|iyi ki varsın|iyi ki varsin)\b/i;
const DISTRESS_RE = /\b(sad|cry|crying|tired|stressed|anxious|scared|worried|hurt|hard|difficult|broken|lost|alone|upset|angry|panic|panicking|faint|fainted|feel sick|bad day|burnt out|hasta|üzgün|uzgun|stresli|yorgun|yalnız|yalniz|korktum|kötü|kotu|bayıl|bayil|ağla|agla|yardım|yardim)\b/i;
const LAUGH_RE = new RegExp(
  [
    // Standard laugh patterns
    "\\b(ha(ha)+|haha+|hahaha+|lol+|lmao+|lmfao+|hehe+|heh|hah|ahaha+|ahahah+|ahahha+|heheheh+)\\b",
    // Death-laugh expressions
    "\\b(im dead|i'm dead|dying|dead|ded|i'm deceased)\\b",
    // Turkish/universal random keyboard mash (4+ chars of consonant clusters)
    "\\b([sşkdgjfhbnmzxcvwq]{4,})\\b",
    // Emojis
    "[😂💀🤣]",
  ].join("|"),
  "i"
);
const HEART_REPLY_RE = /(❤️|❤|💕|💖|💗|💘|🥰|😘|🤍|🫶|🥺)/;

function isKeyboardMashLaugh(body = "") {
  const b = String(body || "").trim();
  if (!b || /\s/.test(b)) return false;
  if (!/^[a-zçğıöşü]{8,}$/i.test(b)) return false;
  const vowelRatio = (b.match(/[aeiouöüıi]/gi) || []).length / b.length;
  return vowelRatio < 0.3;
}

function isLaughReaction(body = "") {
  const b = String(body || "").trim().toLowerCase();
  return LAUGH_RE.test(b) || isKeyboardMashLaugh(b);
}



const RELATIONSHIP_SIGNAL_LIMIT = 16;
const RELATIONSHIP_SIGNAL_PER_LABEL_LIMIT = 4;
const RELATIONSHIP_SIGNAL_DEFS = [
  { key: "father", category: "family", specificRelationship: "father and child", re: /\b(baba|babam|babamsın|babaciğim|babacım|dad|daddy|father|papá|pai|أبي|papa|vater|papà|padre)\b/i },
  { key: "mother", category: "family", specificRelationship: "mother and child", re: /\b(anne|annem|annemsin|anneciğim|annecim|mom|mum|mama|mother|mamá|mãe|أمي|maman|mutter|mamma|madre)\b/i },
  { key: "grandparent", category: "family", specificRelationship: "grandparent and grandchild", re: /\b(anneannem|babaanne(m)?|dedem|dedeciğim|grandma|grandmother|grandpa|granddad|grandfather|abuela|abuelo|avó|avô|جدتي|جدي|grand[- ]m[eè]re|grand[- ]p[eè]re|großmutter|großvater|nonna|nonno)\b/i },
  { key: "sibling", category: "family", specificRelationship: "siblings", re: /\b(kız kardeşim|erkek kardeşim|sister|brother|hermana|hermano|irmã|irmão|أختي|أخي|sœur|frère|schwester|bruder|sorella|fratello)\b/i },
  { key: "cousin", category: "family", specificRelationship: "cousins", re: /\b(kuzi+|kuzim|kuzenimi|kuzenimsin|kuzenim|kuzeniz|kuzen|cousin|cousins|cousing|primo|prima|cousine|vetter|kusine|cugino|cugina)\b/i },
  { key: "aunt-uncle", category: "family", specificRelationship: "aunt/uncle and niece/nephew", re: /\b(teyzem|halam|amcam|dayım|aunt|auntie|uncle|tía|tia|tío|tio|خالتي|عمتي|عمي|خالي|tante|oncle|onkel|zia|zio)\b/i },
  { key: "spouse", category: "partner", specificRelationship: "spouses", re: /\b(kocam|karım|eşim|husband|hubby|my husband|wife|wifey|my wife|spouse|esposo|marido|esposa|زوجي|زوجتي|mari|femme|ehemann|ehefrau|marito|moglie)\b/i },
  { key: "partner", category: "partner", specificRelationship: "partners", re: /\b(partner|sevgilim|my partner|mon partenaire|compañero|companheiro)\b/i },
  { key: "dating", category: "dating", specificRelationship: "dating", re: /\b(erkek arkadaşım|kız arkadaşım|boyfriend|girlfriend|seeing each other|date|dating|novio|novia|namorado|namorada|petit ami|petite amie|ragazzo|ragazza)\b/i },
  { key: "ex", category: "ex", specificRelationship: "exes", re: /\b(ex|exim|eski sevgili|former partner|old boyfriend|old girlfriend)\b/i },
  { key: "best-friend", category: "friend", specificRelationship: "best friends", re: /\b(best friend|bestie|bff)\b/i },
  { key: "friend", category: "friend", specificRelationship: "close friends", re: /\b(arkadaşım|friend|friends|amigo|amiga|ami|amico|amica)\b/i },
  { key: "boss", category: "colleague", specificRelationship: "boss and employee", re: /\b(müdürüm|patronum|boss|manager|chef|vorgesetzter|capo)\b/i },
  { key: "colleague", category: "colleague", specificRelationship: "colleagues", re: /\b(iş arkadaşım|meslektaşım|colleague|coworker|co-worker|collègue|kollege|collega)\b/i },
];

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldScanRelationshipSignal(selectedCategory, signalCategory) {
  const category = normalizeSelectedRelationshipType(selectedCategory || "other");
  if (!category || category === "other" || category === "unknown") return true;
  return category === signalCategory;
}

function getRelationshipUsageHint(body, matchedText) {
  const text = String(body || "");
  const token = String(matchedText || "").trim();
  if (!token) return "unclear";

  const escaped = escapeRegex(token);
  const directAddressRe = new RegExp(`^\\s*(?:hey|hi|ya|yo|ah|ayy)?\\s*${escaped}(?:[\\s,!?]|$)`, "i");
  const directAddressEndRe = new RegExp(`(?:^|[\\s,!?])${escaped}[.!?]*\\s*$`, "i");
  const identityRe = new RegExp(`\\b(you(?:'re| are)?|sen(?:in)?|sana|seni|siz(?:in)?|u)\\b.{0,18}${escaped}|${escaped}.{0,18}\\b(you(?:'re| are)?|sen(?:in)?|sana|seni|siz(?:in)?|u)\\b`, "i");
  const possessiveBeforeRe = new RegExp(`\\b(my|our|his|her|their|benim|bizim|onun)\\s+${escaped}\\b`, "i");
  const explicitPairRe = new RegExp(`\\b(my|benim)\\s+${escaped}\\b.{0,18}\\b(you|u|sen|sın|sin|sun|sün)\\b|\\b(you(?:'re| are)?|sen(?:in)?|siz(?:in)?)\\b.{0,18}\\b(my|benim)\\s+${escaped}\\b`, "i");
  const thirdPartyVerbRe = new RegExp(`\\b${escaped}\\b.{0,24}\\b(called|came|said|told|arrived|yazdı|geldi|aradı|dedi|söyledi)\\b`, "i");
  const shortAddressLike = text.length <= 40 && new RegExp(`\\b${escaped}\\b`, "i").test(text) && !possessiveBeforeRe.test(text);

  if (directAddressRe.test(text) || directAddressEndRe.test(text) || identityRe.test(text) || explicitPairRe.test(text) || shortAddressLike) {
    return "likely direct address";
  }
  if (possessiveBeforeRe.test(text) || thirdPartyVerbRe.test(text)) return "likely third-party mention";
  return "unclear from this line alone";
}

function relationshipUsagePriority(usageHint) {
  switch (String(usageHint || "").toLowerCase()) {
    case "likely direct address":
      return 3;
    case "unclear from this line alone":
      return 2;
    case "likely third-party mention":
      return 1;
    default:
      return 0;
  }
}

function detectRelationship(messages, userSelectedCategory = null) {
  const snippets = [];

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg?.body || /^<(Voice|Media) omitted>$/.test(msg.body)) continue;

    for (const def of RELATIONSHIP_SIGNAL_DEFS) {
      if (!shouldScanRelationshipSignal(userSelectedCategory, def.category)) continue;
      const match = msg.body.match(def.re);
      if (!match?.[0]) continue;

      const start = Math.max(0, i - 2);
      const end = Math.min(messages.length - 1, i + 2);
      const matchedText = match[0];
      const usageHint = getRelationshipUsageHint(msg.body, matchedText);
      const context = messages.slice(start, end + 1)
        .map(m => `[${formatEvidenceDate(m.date)}] ${m.name}: ${m.body}`)
        .join("\n");

      snippets.push({
        key: def.key,
        category: def.category,
        specificRelationship: def.specificRelationship,
        matchedText,
        usageHint,
        speaker: msg.name,
        date: formatEvidenceDate(msg.date),
        quote: cleanQuote(msg.body, 120),
        context,
        index: i,
      });
    }
  }

  if (!snippets.length) return null;

  const ranked = snippets
    .sort((a, b) => {
      const priorityDiff = relationshipUsagePriority(b.usageHint) - relationshipUsagePriority(a.usageHint);
      if (priorityDiff) return priorityDiff;
      const cousinBoostA = a.specificRelationship === "cousins" ? 1 : 0;
      const cousinBoostB = b.specificRelationship === "cousins" ? 1 : 0;
      if (cousinBoostA !== cousinBoostB) return cousinBoostB - cousinBoostA;
      if (a.specificRelationship !== b.specificRelationship) {
        return a.specificRelationship.localeCompare(b.specificRelationship);
      }
      return a.index - b.index;
    });

  const selected = [];
  const perLabelCounts = new Map();

  for (const snippet of ranked) {
    const labelKey = snippet.specificRelationship;
    const used = perLabelCounts.get(labelKey) || 0;
    if (used >= RELATIONSHIP_SIGNAL_PER_LABEL_LIMIT) continue;
    perLabelCounts.set(labelKey, used + 1);
    selected.push(snippet);
    if (selected.length >= RELATIONSHIP_SIGNAL_LIMIT) break;
  }

  return selected.map(({ index, ...snippet }) => snippet);
}

const RELATIONSHIP_CONTEXT_CACHE = new Map();

function normalizeSelectedRelationshipType(value) {
  const label = String(value || "").trim().toLowerCase();
  if (!label) return "other";
  if (label === "related") return "family";
  return ["partner", "dating", "ex", "family", "friend", "colleague", "other", "unknown"].includes(label)
    ? label
    : label;
}

function defaultSpecificRelationship(userSelectedType) {
  const type = normalizeSelectedRelationshipType(userSelectedType);
  return {
    partner: "partners",
    dating: "dating",
    ex: "exes",
    family: "family members",
    friend: "close friends",
    colleague: "colleagues",
    other: "someone they know",
  }[type] || "someone they know";
}

function allowedSpecificRelationships(category) {
  const type = normalizeSelectedRelationshipType(category);
  return {
    partner: ["spouses", "partners"],
    dating: ["dating"],
    ex: ["exes"],
    family: [
      "father and child",
      "mother and child",
      "siblings",
      "cousins",
      "grandparent and grandchild",
      "aunt/uncle and niece/nephew",
      "family members",
    ],
    friend: ["best friends", "close friends"],
    colleague: ["boss and employee", "colleagues"],
    other: ["someone they know"],
    unknown: ["someone they know"],
  }[type] || ["someone they know"];
}

function inferRelationshipCategoryFromSpecific(specific, fallback = "other") {
  const label = String(specific || "").toLowerCase();
  const safeFallback = normalizeSelectedRelationshipType(fallback);
  if (!label) return safeFallback;
  if (/partner|spouse|dating|ex/.test(label)) return /ex/.test(label) ? "ex" : (/dating/.test(label) ? "dating" : "partner");
  if (/friend/.test(label)) return "friend";
  if (/colleague|boss|employee|coworker|work/.test(label)) return "colleague";
  if (/father|mother|sibling|cousin|grandparent|aunt|uncle|family/.test(label)) return "family";
  return safeFallback;
}

function normalizeRelationshipCategory(value, fallback = "other") {
  const label = String(value || "").trim().toLowerCase();
  const safeFallback = normalizeSelectedRelationshipType(fallback);
  if (!label) return safeFallback;
  if (label === "related") return "family";
  if (["partner", "dating", "ex", "family", "friend", "colleague", "other", "unknown"].includes(label)) return label;
  if (/partner|spouse|wife|husband/.test(label)) return "partner";
  if (/dating|boyfriend|girlfriend/.test(label)) return "dating";
  if (/ex/.test(label)) return "ex";
  if (/friend/.test(label)) return "friend";
  if (/colleague|coworker|boss|employee|work/.test(label)) return "colleague";
  if (/family|father|mother|sibling|cousin|grandparent|aunt|uncle/.test(label)) return "family";
  return safeFallback;
}

function normalizeRelationshipSpecificLabel(value, fallbackCategory = "other") {
  const raw = String(value || "").trim();
  const label = raw.toLowerCase();
  const safeFallback = normalizeSelectedRelationshipType(fallbackCategory);
  if (!label) return defaultSpecificRelationship(safeFallback);
  if (/father|dad/.test(label) && (/child|daughter|son/.test(label) || label === "father")) return "father and child";
  if (/mother|mom|mum/.test(label) && (/child|daughter|son/.test(label) || label === "mother")) return "mother and child";
  if (/grandmother|grandfather|grandma|grandpa|grandparent/.test(label)) return "grandparent and grandchild";
  if (/sibling|brother|sister/.test(label)) return "siblings";
  if (/cousin/.test(label)) return "cousins";
  if (/aunt|uncle|niece|nephew/.test(label)) return "aunt/uncle and niece/nephew";
  if (/boss|employee|manager|direct report/.test(label)) return "boss and employee";
  if (/colleague|coworker|workmate/.test(label)) return "colleagues";
  if (/best friend/.test(label)) return "best friends";
  if (/friend|bestie/.test(label)) return "close friends";
  if (/husband|wife|spouse|married/.test(label)) return "spouses";
  if (/partner/.test(label)) return "partners";
  if (/boyfriend|girlfriend|dating|seeing each other/.test(label)) return "dating";
  if (/ex/.test(label)) return "exes";
  if (/family/.test(label)) return "family members";
  if (/other|unclear|unknown/.test(label)) return defaultSpecificRelationship(safeFallback);
  return raw;
}

function coerceRelationshipCategory(value, userSelectedType, fallback = "other") {
  const selected = normalizeSelectedRelationshipType(userSelectedType);
  if (["partner", "dating", "ex", "family", "friend", "colleague", "other"].includes(selected)) {
    return selected;
  }
  return normalizeRelationshipCategory(value, fallback);
}

function coerceRelationshipSpecificLabel(value, category) {
  const lockedCategory = normalizeSelectedRelationshipType(category);
  const normalized = normalizeRelationshipSpecificLabel(value, lockedCategory);

  switch (lockedCategory) {
    case "partner":
      return normalized === "spouses" ? "spouses" : "partners";
    case "dating":
      return "dating";
    case "ex":
      return "exes";
    case "family":
      return [
        "father and child",
        "mother and child",
        "siblings",
        "cousins",
        "grandparent and grandchild",
        "aunt/uncle and niece/nephew",
        "family members",
      ].includes(normalized) ? normalized : "family members";
    case "friend":
      return normalized === "best friends" ? "best friends" : "close friends";
    case "colleague":
      return normalized === "boss and employee" ? "boss and employee" : "colleagues";
    case "other":
    case "unknown":
    default:
      return "someone they know";
  }
}

function defaultRelationshipStatusLabel(category, specificRelationship) {
  const specific = coerceRelationshipSpecificLabel(specificRelationship, category);
  return {
    spouses: "Spouses",
    partners: "Partners",
    dating: "Dating",
    exes: "Exes",
    "father and child": "Father and child",
    "mother and child": "Mother and child",
    siblings: "Siblings",
    cousins: "Cousins",
    "grandparent and grandchild": "Grandparent and grandchild",
    "aunt/uncle and niece/nephew": "Aunt/uncle and niece/nephew",
    "family members": "Family members",
    "best friends": "Best friends",
    "close friends": "Close friends",
    "boss and employee": "Boss and employee",
    colleagues: "Colleagues",
    "someone they know": "Someone they know",
  }[specific] || "Someone they know";
}

function sanitizeRelationshipStatus(value, category, specificRelationship) {
  const text = String(value || "").trim();
  const label = text.toLowerCase();
  const lockedCategory = normalizeSelectedRelationshipType(category);
  const fallback = defaultRelationshipStatusLabel(lockedCategory, specificRelationship);

  if (!text) return fallback;

  switch (lockedCategory) {
    case "family":
      return /(family|father|mother|parent|sibling|brother|sister|cousin|grandparent|grandma|grandpa|aunt|uncle|niece|nephew|dad|mom|mum)/.test(label) ? text : fallback;
    case "partner":
      return /(partner|spouse|married|husband|wife)/.test(label) ? text : fallback;
    case "dating":
      return /(dating|seeing each other|seeing|boyfriend|girlfriend|romantic|situationship|talking stage)/.test(label) ? text : fallback;
    case "ex":
      return /\bex\b|former/.test(label) ? text : "Exes";
    case "friend":
      return /(friend|bestie|platonic)/.test(label) ? text : fallback;
    case "colleague":
      return /(colleague|cowork|co-worker|boss|employee|work)/.test(label) ? text : fallback;
    case "other":
    case "unknown":
    default:
      return text || fallback;
  }
}

function buildRelationshipLine(relationshipContext, userSelectedType) {
  const category = coerceRelationshipCategory(relationshipContext?.category, userSelectedType, userSelectedType || "other");
  const specific = coerceRelationshipSpecificLabel(
    relationshipContext?.specificRelationship || defaultSpecificRelationship(category),
    category
  );
  const confidence = relationshipContext?.confidence || "low";
  const reasoning = relationshipContext?.reasoning || `Use the user-selected relationship type "${userSelectedType}" as a hard boundary. Only refine within that category; never switch into a different one.`;
  const evidence = relationshipContext?.evidence ? `Strongest evidence: ${relationshipContext.evidence}.` : "";
  const warning = relationshipContext?.endearmentWarning
    ? `IMPORTANT ENDEARMENT WARNING: ${relationshipContext.endearmentWarning}. Do not interpret that word as a literal family title.`
    : "";
  return `CONFIRMED RELATIONSHIP: Describe the two participants as ${specific} (category: ${category}, confidence: ${confidence}). ${reasoning} ${evidence} ${warning} The user-selected category is the top-priority boundary. Never replace it with a different romance, family, friendship, or work label.`;
}

async function confirmRelationship(snippets, names, userSelectedType) {
  if (!snippets || !snippets.length || names.length < 2) return null;
  const selectedCategory = normalizeSelectedRelationshipType(userSelectedType || "other");
  const allowedSpecifics = allowedSpecificRelationships(selectedCategory);

  const snippetText = snippets
    .map((s, i) => [
      `SNIPPET ${i + 1}`,
      `Matched relationship word: "${s.matchedText}"`,
      `Suggested category: ${s.category}`,
      `Suggested specific label: ${s.specificRelationship}`,
      `Usage hint: ${s.usageHint}`,
      `Signal line (${s.date} | ${s.speaker}): "${s.quote}"`,
      "Nearby chat context:",
      s.context,
    ].join("\n"))
    .join("\n\n");

  const system = `You are a relationship analyst. You will be shown short excerpts from a WhatsApp chat between ${names[0]} and ${names[1]}. Your only job is to determine the most specific relationship label for these two specific people from relationship call-names used inside the chat.

CRITICAL RULES:
- The snippets were selected only because they contain relationship call-names like dad, cousin, husband, friend, boss, and similar labels.
- A relationship word does NOT automatically prove the relationship between the two chat participants. It may refer to a third person.
- Direct addressing matters most. Examples: "dad, where are you?", "you are my cousin", "goodnight husband".
- Third-party references do NOT confirm the relationship. Examples: "my cousin called", "dad said that", "my friend is coming".
- Use the nearby context to decide whether the matched word is being used for the other participant or for someone else.
- The user selected "${selectedCategory}" as the relationship category. Stay inside that category. Do not switch to a different category.
- Allowed specific labels inside "${selectedCategory}": ${allowedSpecifics.join(" / ")}.
- Pick the most specific allowed label only when the wording supports it. Otherwise fall back to the broadest allowed label for that category.
- Confidence should be "high" only for explicit direct-address evidence or repeated unambiguous evidence. Use "medium" for decent but not perfect support. Use "low" if the evidence is thin or mostly indirect.

STYLE:
Keep reasoning plain, short, and evidence-based. Do not use the em dash punctuation mark.

Return ONLY a JSON object with no extra text:
{
  "category": "one of: partner / dating / ex / family / friend / colleague / other / unknown",
  "specificRelationship": "one of: spouses / partners / dating / exes / father and child / mother and child / siblings / cousins / grandparent and grandchild / aunt/uncle and niece/nephew / family members / best friends / close friends / colleagues / boss and employee / someone they know / unclear",
  "confidence": "high / medium / low",
  "reasoning": "one sentence explaining the key evidence",
  "evidence": "a short quote or paraphrase from the strongest direct-address snippet",
  "endearmentWarning": "if any keyword appears to be used as a term of endearment rather than a literal title, name it here, e.g. 'kızım is used as affection not literal daughter'. Otherwise null."
}`;

  const userContent = `Here are relationship-call snippets from a chat between ${names[0]} and ${names[1]}. The user selected relationship type is "${selectedCategory}". Use these snippets to confirm the most specific relationship label inside that category.\n\n${snippetText}`;

  try {
    const raw = await callClaude(system, userContent, 300, "relationship");
    const parsed = raw && typeof raw === "object"
      ? raw
      : tryParseJsonText(String(raw || ""));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    console.warn("[confirmRelationship] failed:", e);
    return null;
  }
}

async function resolveRelationshipContext(messages, names, userSelectedType) {
  if (!Array.isArray(messages) || messages.length < 2 || !Array.isArray(names) || names.length < 2) return null;
  const selectedCategory = normalizeSelectedRelationshipType(userSelectedType || "other");
  const cacheKey = getRelationshipContextCacheKey(messages, names, userSelectedType);

  if (RELATIONSHIP_CONTEXT_CACHE.has(cacheKey)) {
    return RELATIONSHIP_CONTEXT_CACHE.get(cacheKey);
  }

  const snippets = detectRelationship(messages, userSelectedType);
  if (!snippets?.length) {
    RELATIONSHIP_CONTEXT_CACHE.set(cacheKey, null);
    return null;
  }

  const raw = await confirmRelationship(snippets, names, userSelectedType);
  const rawCategory = normalizeRelationshipCategory(
    raw?.category,
    inferRelationshipCategoryFromSpecific(raw?.specificRelationship, selectedCategory)
  );
  const category = coerceRelationshipCategory(rawCategory, selectedCategory, selectedCategory);
  const normalizedSpecific = normalizeRelationshipSpecificLabel(raw?.specificRelationship, category);
  const specificRelationship = coerceRelationshipSpecificLabel(raw?.specificRelationship, category);
  const categoryWasCoerced = rawCategory !== category;
  const specificWasCoerced = normalizedSpecific !== specificRelationship;
  const context = {
    category,
    specificRelationship,
    confidence: ["high", "medium", "low"].includes(String(raw?.confidence || "").toLowerCase())
      ? String(raw.confidence).toLowerCase()
      : (snippets?.length ? "medium" : "low"),
    reasoning: categoryWasCoerced || specificWasCoerced
      ? `The user selected "${selectedCategory}" as the relationship category, so the analysis stays in that category and describes them as ${specificRelationship}.`
      : String(raw?.reasoning || `The strongest relationship call-name snippets fit ${specificRelationship} inside the selected ${selectedCategory} category.`).trim(),
    evidence: String(raw?.evidence || snippets?.[0]?.quote || "").trim(),
    endearmentWarning: raw?.endearmentWarning ? String(raw.endearmentWarning).trim() : null,
  };

  RELATIONSHIP_CONTEXT_CACHE.set(cacheKey, context);
  return context;
}

function getRelationshipContextCacheKey(messages, names, userSelectedType) {
  if (!Array.isArray(messages) || messages.length < 2 || !Array.isArray(names) || names.length < 2) return "";
  const selectedCategory = normalizeSelectedRelationshipType(userSelectedType || "other");
  return [
    selectedCategory,
    names.slice(0, 2).join("|"),
    messages.length,
    +messages[0]?.date || 0,
    +messages[messages.length - 1]?.date || 0,
  ].join("::");
}

function peekResolvedRelationshipContext(messages, names, userSelectedType) {
  const cacheKey = getRelationshipContextCacheKey(messages, names, userSelectedType);
  if (!cacheKey) return null;
  return RELATIONSHIP_CONTEXT_CACHE.has(cacheKey) ? RELATIONSHIP_CONTEXT_CACHE.get(cacheKey) : null;
}

const DUO_CONTENT_SCREENS = 20;
const GROUP_CONTENT_SCREENS = 19;
const LOADING_STEPS = ["Reading your messages...","Finding the patterns...","Figuring out who's funny...","Detecting the drama...","Reading between the lines...","Almost done..."];
const MODE_META = {
  casual: {
    label: "Casual Analysis",
    short: "Casual",
    blurb: "Funny, sweet, and stats-heavy chat wrap.",
  },
  redflags: {
    label: "Red Flags Spotter",
    short: "Red Flags",
    blurb: "Relationship status, toxicity, and warning signs.",
  },
};
const DUO_CASUAL_SCREENS = 17;
const DUO_REDFLAG_SCREENS = 7;
const GROUP_CASUAL_SCREENS = 17;
const GROUP_REDFLAG_SCREENS = 6;

function isPassiveAggressive(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.length <= 20 && /^(fine|whatever|ok then|okay then|sure|k|kk|nvm|never mind|forget it|sen bilirsin|tamam ya|boşver|bosver|neyse|aynen|bravo|peki)$/.test(trimmed);
}

function capsBurst(body) {
  const upper = body.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  return upper.length >= 5 && /[!?]{2,}/.test(body);
}

function normalizeRedFlags(flags) {
  if (!Array.isArray(flags)) return [];
  return flags.map((flag, i) => {
    if (typeof flag === "string") {
      return { title: `Red flag ${i + 1}`, detail: flag };
    }
    if (flag && typeof flag === "object") {
      const title = String(flag.title || flag.label || flag.flag || `Red flag ${i + 1}`).trim();
      const detail = String(flag.detail || flag.reason || flag.description || "").trim();
      const evidence = String(flag.evidence || flag.example || "").trim();
      if (!title && !detail) return null;
      return { title: title || `Red flag ${i + 1}`, detail, evidence };
    }
    return null;
  }).filter(Boolean).slice(0, 3);
}

function normalizeTimeline(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === "string") {
      return { date: `Point ${i + 1}`, title: item, detail: "" };
    }
    if (!item || typeof item !== "object") return null;
    return {
      date: String(item.date || item.when || `Point ${i + 1}`).trim(),
      title: String(item.title || item.label || item.observation || `Point ${i + 1}`).trim(),
      detail: String(item.detail || item.description || item.quote || "").trim(),
    };
  }).filter(Boolean).slice(0, 5);
}

const VALID_MOMENT_TYPES = new Set(["funny","sweet","awkward","chaotic","signature","tension","care","conflict"]);

function normalizeMemorableMoments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (!item || typeof item !== "object") return null;
    const type = VALID_MOMENT_TYPES.has(item.type) ? item.type : "signature";
    const title = String(item.title || "").trim();
    const read  = String(item.read  || "").trim();
    if (!title && !read) return null;
    return {
      type,
      date:   String(item.date   || "").trim(),
      people: Array.isArray(item.people)
        ? item.people.filter(p => typeof p === "string" && p.trim()).map(p => p.trim())
        : [],
      title,
      quote:  String(item.quote  || "").trim(),
      setup:  String(item.setup  || "").trim(),
      read,
    };
  }).filter(Boolean).slice(0, 6);
}

function formatEvidenceDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cleanQuote(body, max = 72) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function formatGap(gapMin) {
  if (gapMin < 60) return `${Math.round(gapMin)}m`;
  const hours = Math.floor(gapMin / 60);
  const mins = Math.round(gapMin % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function spotDynamics({ messages, namesAll, namesSorted, msgCounts, starterCount, isGroup }) {
  const tracked = new Set(namesAll);
  const stats = {};
  namesAll.forEach(name => {
    stats[name] = {
      control: 0,
      aggression: 0,
      breakup: 0,
      passive: 0,
      apology: 0,
      doubleText: 0,
      delayedReplies: 0,
      caps: 0,
    };
  });

  const evidence = {
    control: [],
    aggression: [],
    breakup: [],
    passive: [],
    apology: [],
    delayed: [],
    doubleText: [],
    romance: [],
    friendship: [],
    work: [],
  };

  const recordEvidence = (kind, item) => {
    if (!evidence[kind]) evidence[kind] = [];
    const key = `${item.ts}-${item.title}-${item.detail}`;
    if (evidence[kind].some(existing => existing.key === key)) return;
    evidence[kind].push({ ...item, key });
  };

  const messageEvidence = (message, title, detail, weight = 1) => ({
    ts: +message.date,
    date: formatEvidenceDate(message.date),
    title,
    detail,
    quote: cleanQuote(message.body),
    weight,
  });

  let romance = 0;
  let friendship = 0;
  let work = 0;

  for (const message of messages) {
    if (!tracked.has(message.name)) continue;
    const body = message.body.trim();
    const sender = stats[message.name];
    if (CONTROL_RE.test(body)) {
      sender.control++;
      recordEvidence("control", messageEvidence(message, `${message.name} pushed for an immediate reply or update.`, `"${cleanQuote(body)}"`, 5));
    }
    if (AGGRO_RE.test(body) || capsBurst(body)) {
      sender.aggression++;
      if (capsBurst(body)) sender.caps++;
      recordEvidence("aggression", messageEvidence(message, `${message.name} used escalated or hostile wording.`, `"${cleanQuote(body)}"`, 5));
    }
    if (BREAKUP_RE.test(body)) {
      sender.breakup++;
      recordEvidence("breakup", messageEvidence(message, `${message.name} used exit or breakup wording.`, `"${cleanQuote(body)}"`, 6));
    }
    if (APOLOGY_RE.test(body)) {
      sender.apology++;
      recordEvidence("apology", messageEvidence(message, `${message.name} apologized after tension.`, `"${cleanQuote(body)}"`, 2));
    }
    if (isPassiveAggressive(body)) {
      sender.passive++;
      recordEvidence("passive", messageEvidence(message, `${message.name} replied with a clipped shutdown message.`, `"${cleanQuote(body)}"`, 3));
    }

    if (!isGroup) {
      if (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body)) {
        romance++;
        recordEvidence("romance", messageEvidence(message, `${message.name} used romantic language or couple-coded affection.`, `"${cleanQuote(body)}"`, 2));
      }
      if (FRIEND_RE.test(body)) {
        friendship++;
        recordEvidence("friendship", messageEvidence(message, `${message.name} used clearly platonic language.`, `"${cleanQuote(body)}"`, 1));
      }
      if (WORK_RE.test(body)) {
        work++;
        recordEvidence("work", messageEvidence(message, `${message.name} brought the chat back to work or logistics.`, `"${cleanQuote(body)}"`, 1));
      }
    }
  }

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (!tracked.has(prev.name) || !tracked.has(curr.name)) continue;
    const gapMin = (curr.date - prev.date) / 60000;

    if (curr.name === prev.name && gapMin < 180) {
      stats[curr.name].doubleText++;
      recordEvidence("doubleText", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} sent another message before getting a reply.`,
        detail: `"${cleanQuote(curr.body)}"`,
        weight: 2,
      });
      continue;
    }

    if (curr.name !== prev.name && gapMin > (isGroup ? 360 : 240)) {
      stats[curr.name].delayedReplies++;
      recordEvidence("delayed", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} replied after a long gap.`,
        detail: `${formatGap(gapMin)} after ${prev.name}'s message: "${cleanQuote(prev.body, 54)}"`,
        weight: 3,
      });
    }
  }

  const totals = Object.values(stats).reduce((acc, item) => {
    Object.entries(item).forEach(([key, value]) => {
      acc[key] = (acc[key] || 0) + value;
    });
    return acc;
  }, {});

  const topBy = key => [...namesAll].sort((a, b) => (stats[b]?.[key] || 0) - (stats[a]?.[key] || 0))[0] || namesSorted[0];
  const totalMessages = msgCounts.reduce((sum, count) => sum + count, 0) || 1;
  const leadShare = msgCounts[0] / totalMessages;
  const leadStarter = Object.entries(starterCount || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || namesSorted[0];
  const firstEvidence = kind => (evidence[kind] || []).sort((a, b) => b.weight - a.weight || b.ts - a.ts)[0];

  const flagPool = [];
  const pushFlag = (score, title, detail, sample) => {
    flagPool.push({
      score,
      title,
      detail,
      evidence: sample ? `${sample.date} • ${sample.detail}` : "",
    });
  };

  if (totals.control >= (isGroup ? 2 : 1)) {
    const name = topBy("control");
    pushFlag(
      totals.control * 4,
      "Reply pressure",
      `${name} used immediate-reply or location-check language ${totals.control} time${totals.control === 1 ? "" : "s"} in the sampled chat.`,
      firstEvidence("control")
    );
  }

  if (totals.aggression + totals.caps >= (isGroup ? 2 : 1)) {
    const name = topBy("aggression");
    pushFlag(
      (totals.aggression + totals.caps) * 4,
      "Escalated wording",
      `${name} is responsible for most of the hostile wording or all-caps escalation moments in the sample.`,
      firstEvidence("aggression")
    );
  }

  if (totals.breakup >= 1) {
    pushFlag(
      totals.breakup * 5,
      isGroup ? "Exit threats" : "Breakup language",
      isGroup
        ? `The group includes explicit “I’m done” or leave-the-chat style wording instead of simple cooling-off messages.`
        : `The chat includes explicit “we’re done” or end-of-relationship wording, which points to instability rather than a one-off disagreement.`,
      firstEvidence("breakup")
    );
  }

  if (!isGroup && totals.apology >= 3 && totals.control + totals.aggression + totals.breakup + totals.passive >= 2) {
    pushFlag(
      totals.apology * 2 + totals.aggression * 2,
      "Conflict-reset cycle",
      `There are repeated apologies after tense moments, which suggests the conflict pattern returns instead of fully resolving.`,
      firstEvidence("apology")
    );
  }

  if (!isGroup) {
    const chaser = topBy("doubleText");
    if ((stats[chaser]?.doubleText || 0) >= 5 || leadShare >= 0.64) {
      pushFlag(
        (stats[chaser]?.doubleText || 0) + leadShare * 5,
        "Uneven pursuit",
        `${chaser} does substantially more follow-up messaging, so the effort balance in the conversation looks uneven.`,
        firstEvidence("doubleText")
      );
    }

    const ghoster = topBy("delayedReplies");
    if ((stats[ghoster]?.delayedReplies || 0) >= 3) {
      pushFlag(
        (stats[ghoster]?.delayedReplies || 0) * 2,
        "Long reply gaps",
        `${ghoster} is the person most associated with multi-hour reply gaps after emotionally charged messages.`,
        firstEvidence("delayed")
      );
    }

    if (romance >= 6 && totals.control + totals.aggression + totals.breakup >= 2) {
      pushFlag(
        romance + totals.control + totals.aggression + totals.breakup,
        "Affection mixed with conflict",
        `The chat shows clear romantic cues, but those sit alongside pressure, escalation, or breakup language often enough to matter.`,
        firstEvidence("romance") || firstEvidence("breakup")
      );
    }
  } else {
    const loudest = namesSorted[0];
    if (leadShare >= 0.46) {
      pushFlag(
        leadShare * 10,
        "Dominant voice",
        `${loudest} sends such a large share of the messages that the group’s tone is heavily shaped by one person.`,
        firstEvidence("doubleText") || firstEvidence("aggression")
      );
    }

    if ((starterCount?.[leadStarter] || 0) >= 5) {
      pushFlag(
        (starterCount?.[leadStarter] || 0) * 0.8,
        "Single-person reactivation",
        `${leadStarter} is repeatedly the one restarting the chat, which suggests the group depends on one engine to stay active.`
      );
    }
  }

  if (flagPool.length < 3 && totals.passive >= 2) {
    pushFlag(
      totals.passive * 2,
      "Shutdown replies",
      `The chat contains multiple clipped replies like “fine” or “whatever,” which usually close the conversation without resolving the issue.`,
      firstEvidence("passive")
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      leadShare * 4,
      isGroup ? "Participation imbalance" : "Message imbalance",
      isGroup
        ? `A small number of people carry most of the momentum, so quieter members can disappear from the actual dynamic.`
        : `${namesSorted[0]} sends a much larger share of the messages, which is a factual imbalance in effort even before tone is considered.`
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      1,
      isGroup ? "Unstable group tone" : "Mixed signals",
      isGroup
        ? `The tone shifts fast across the sample, which makes the group dynamic feel inconsistent even when no single fight dominates.`
        : `The tone and pacing change enough across the sample that the relationship looks unclear from the chat alone.`
    );
  }

  const redFlags = flagPool
    .sort((a, b) => b.score - a.score)
    .filter((flag, index, arr) => arr.findIndex(other => other.title === flag.title) === index)
    .slice(0, 3)
    .map(({ title, detail, evidence: sample }) => ({ title, detail, evidence: sample }));

  const toxicityScores = {};
  namesAll.forEach(name => {
    const item = stats[name];
    toxicityScores[name] =
      item.control * 4 +
      item.aggression * 5 +
      item.breakup * 4 +
      item.passive * 2 +
      item.caps * 2 +
      item.delayedReplies * 1.5 +
      Math.max(item.doubleText - 2, 0) * 0.4;
  });

  const toxicRank = [...namesAll].sort((a, b) => toxicityScores[b] - toxicityScores[a]);
  const topToxic = toxicRank[0] || namesSorted[0];
  const runnerUp = toxicRank[1] || topToxic;
  const toxicPerson = toxicityScores[topToxic] - toxicityScores[runnerUp] < 2 ? "Tie" : topToxic;

  let toxicReason = isGroup
    ? "The highest-risk behaviours are spread across the group rather than clearly owned by one person."
    : "The risk signals are fairly shared, so the chat does not point to one clearly more toxic person.";

  if (toxicPerson !== "Tie") {
    const winner = stats[toxicPerson];
    const drivers = [];
    if (winner.control) drivers.push(`${winner.control} control/reply-pressure message${winner.control === 1 ? "" : "s"}`);
    if (winner.aggression || winner.caps) drivers.push(`${winner.aggression + winner.caps} escalated wording moment${winner.aggression + winner.caps === 1 ? "" : "s"}`);
    if (winner.breakup) drivers.push(`${winner.breakup} breakup/exit threat${winner.breakup === 1 ? "" : "s"}`);
    if (winner.passive) drivers.push(`${winner.passive} shutdown ${winner.passive === 1 ? "reply" : "replies"}`);
    if (winner.delayedReplies) drivers.push(`${winner.delayedReplies} long reply gap${winner.delayedReplies === 1 ? "" : "s"}`);
    toxicReason = `${toxicPerson} has the highest toxicity score because the sampled chat shows ${drivers.slice(0, 3).join(", ")} from them.`;
  }

  let relationshipStatus = null;
  let relationshipStatusWhy = null;
  let statusEvidence = null;

  if (!isGroup) {
    const conflict = totals.control + totals.aggression + totals.breakup + totals.passive;
    const romanceExample = firstEvidence("romance");
    const friendExample = firstEvidence("friendship");
    const workExample = firstEvidence("work");

    if (work >= Math.max(romance, friendship) + 3) {
      relationshipStatus = "Coworkers who overshare";
      relationshipStatusWhy = `The sample contains noticeably more work/logistics cues (${work}) than romantic ones (${romance}).`;
      statusEvidence = workExample ? `${workExample.date} • ${workExample.detail}` : "";
    } else if (romance >= 8 && conflict >= 4) {
      relationshipStatus = "On-and-off romance";
      relationshipStatusWhy = `There are strong romantic cues (${romance}) alongside repeated conflict markers (${conflict}), which points to attachment with instability.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 8) {
      relationshipStatus = "Probably dating";
      relationshipStatusWhy = `The chat shows repeated romantic language (${romance} cues) and very little purely work-style or platonic framing.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 4 && friendship >= 2) {
      relationshipStatus = "Situationship territory";
      relationshipStatusWhy = `The sample mixes romantic cues (${romance}) with platonic framing (${friendship}), so the connection looks emotionally close but not fully defined.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (friendship >= romance + 2) {
      relationshipStatus = "Close friends";
      relationshipStatusWhy = `The chat leans more on comfort and platonic language (${friendship} cues) than overt romantic signals (${romance}).`;
      statusEvidence = friendExample ? `${friendExample.date} • ${friendExample.detail}` : "";
    } else {
      relationshipStatus = "Complicated, but not official";
      relationshipStatusWhy = "The sample shows emotional closeness, but the wording is too mixed to point cleanly to friendship, dating, or a purely practical relationship.";
      statusEvidence = romanceExample?.detail || friendExample?.detail || workExample?.detail || "";
    }
  }

  const evidenceTimeline = Object.values(evidence)
    .flat()
    .sort((a, b) => b.weight - a.weight || b.ts - a.ts)
    .slice(0, 5)
    .map(item => ({ date: item.date, title: item.title, detail: item.detail }));

  const maxToxicity = Math.max(...Object.values(toxicityScores), 0);
  const toxicityLevel = maxToxicity >= 18 ? "Heated" : maxToxicity >= 9 ? "Tense" : "Healthy";
  const toxicityBreakdown = toxicRank.slice(0, Math.min(isGroup ? 4 : 2, toxicRank.length)).map(name => {
    const item = stats[name];
    const reasons = [];
    if (item.control) reasons.push(`${item.control} control`);
    if (item.aggression || item.caps) reasons.push(`${item.aggression + item.caps} escalation`);
    if (item.breakup) reasons.push(`${item.breakup} exit threat`);
    if (item.passive) reasons.push(`${item.passive} shutdown`);
    if (item.delayedReplies) reasons.push(`${item.delayedReplies} long-gap reply`);
    return `${name}: ${Math.round(toxicityScores[name])} points${reasons.length ? ` • ${reasons.join(", ")}` : ""}`;
  });
  const toxicityReport =
    toxicityLevel === "Heated"
      ? `High toxicity signal. The chat contains repeated pressure, escalation, or exit-style language that goes beyond one isolated argument.`
      : toxicityLevel === "Tense"
        ? `Moderate toxicity signal. There are repeated patterns worth paying attention to, even if the sample is not hostile all the time.`
        : `Low toxicity signal. The sample has some tension markers, but they appear limited or inconsistent rather than dominant.`;

  return {
    relationshipStatus,
    relationshipStatusWhy,
    statusEvidence,
    toxicPerson,
    toxicReason,
    redFlags,
    toxicityScores,
    evidenceTimeline,
    toxicityLevel,
    toxicityReport,
    toxicityBreakdown,
  };
}

function localStats(messages) {
  if (!messages.length) return null;
  const rawNames = [...new Set(messages.map(m => m.name))];
  const byNameRaw = {};
  rawNames.forEach(n => (byNameRaw[n] = []));
  messages.forEach(m => byNameRaw[m.name]?.push(m));
  // Filter out group name — any "sender" with fewer than 3 messages is likely the group name or a system entry
  const namesAll = rawNames.filter(n => byNameRaw[n].length >= 3);
  const isGroup  = namesAll.length > 2;
  const byName   = {};
  namesAll.forEach(n => (byName[n] = byNameRaw[n]));
  const namesSorted = [...namesAll].sort((a,b) => byName[b].length - byName[a].length);

  const wordFreq = {};
  const bigramFreq = {};
  const NOISE_RE = /media omitted|image omitted|video omitted|voice omitted|audio omitted|<media|<attached|end-to-end encrypted|messages and calls are end-to-end|security code (has )?changed/i;
  messages.forEach(({body}) => {
    if (NOISE_RE.test(body) || body.startsWith("http")) return;
    const words = body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).filter(w => w.length>2 && !TOKEN_STOP_WORDS.has(w) && !TOKEN_WA_NOISE_WORDS.has(w) && !/^\d+$/.test(w) && !w.startsWith("http") && w !== "www");
    for (let i=0;i<words.length;i++){
      wordFreq[words[i]]=(wordFreq[words[i]]||0)+1;
      if (i<words.length-1){const bg=`${words[i]} ${words[i+1]}`;bigramFreq[bg]=(bigramFreq[bg]||0)+1;}
    }
  });
  const topWords = Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topBigrams = Object.entries(bigramFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const STICKER_RE = /sticker omitted/i;
  // Non-global version used for .test() inside extractEmoji.
  const _emojiTestRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
  // Global version used as fallback when Intl.Segmenter is unavailable.
  const _emojiMatchRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  // Lone modifier/component codepoints that have no visible glyph on their own:
  // skin tone modifiers (U+1F3FB–U+1F3FF), variation selectors (U+FE0F/FE0E), ZWJ (U+200D).
  const _componentOnlyRe = /^[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{FE0E}\u{200D}]$/u;
  const isRenderableEmoji = (e) =>
    !_componentOnlyRe.test(e) &&
    [...e].every(cp => { const c = cp.codePointAt(0); return c !== undefined && !(c >= 0xE000 && c <= 0xF8FF); });
  // Intl.Segmenter splits text into grapheme clusters so multi-codepoint emoji
  // (e.g. 👋🏽 = hand + skin tone) are kept together as one unit.
  const _seg = typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  const extractEmoji = (text) => {
    if (_seg) {
      return [..._seg.segment(text)].map(s => s.segment).filter(s => _emojiTestRe.test(s) && isRenderableEmoji(s));
    }
    _emojiMatchRe.lastIndex = 0;
    return (text.match(_emojiMatchRe) || []).filter(isRenderableEmoji);
  };
  const emojiFreq = {};
  messages.forEach(({body}) => {
    if (STICKER_RE.test(body)) return;
    extractEmoji(body).forEach(e => (emojiFreq[e] = (emojiFreq[e] || 0) + 1));
  });
  const spiritEmojiAll = Object.entries(emojiFreq).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  const spiritByName = {};
  namesAll.forEach(n => {
    const ef = {};
    byName[n].forEach(({body}) => {
      if (STICKER_RE.test(body)) return;
      extractEmoji(body).forEach(e => (ef[e] = (ef[e] || 0) + 1));
    });
    spiritByName[n] = Object.entries(ef).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  });

  const mediaByName = {}, linkByName = {}, voiceByName = {};
  namesAll.forEach(n => {
    mediaByName[n] = byName[n].filter(m => /media omitted|image omitted|video omitted/i.test(m.body)).length;
    linkByName[n]  = byName[n].filter(m => m.body.includes("http")).length;
    voiceByName[n] = byName[n].filter(m => /voice omitted|audio omitted/i.test(m.body)).length;
  });

  const peakHourByName = {};
  namesAll.forEach(n => {
    const h = new Array(24).fill(0);  // fresh array per person
    byName[n].forEach(m => { if(m.hour>=0 && m.hour<24) h[m.hour]++; });
    const maxVal = Math.max(...h);
    peakHourByName[n] = maxVal > 0 ? h.indexOf(maxVal) : 12; // default noon if no data
  });
  const fmtHour = h => h===0?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`;

  const avgLenByName = {}, maxLenByName = {};
  namesAll.forEach(n => {
    const msgs = byName[n].filter(m => !/media omitted|voice omitted|audio omitted/i.test(m.body) && !m.body.startsWith("http"));
    avgLenByName[n] = msgs.length ? Math.round(msgs.reduce((s,m)=>s+m.body.length,0)/msgs.length) : 0;
    maxLenByName[n] = msgs.length ? Math.max(...msgs.map(m=>m.body.length)) : 0;
  });

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthFreq = {};
  messages.forEach(m => { const k=`${m.year}-${String(m.month).padStart(2,"0")}`; monthFreq[k]=(monthFreq[k]||0)+1; });
  const topMonths = Object.entries(monthFreq).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]) => { const [y,mo]=k.split("-"); return [`${MONTHS[+mo]} ${y}`,v]; });

  const daySet  = new Set(messages.map(m=>m.date.toDateString()));
  const dayList = [...daySet].map(d=>new Date(d)).sort((a,b)=>a-b);
  let maxStreak=1, cur=1;
  for(let i=1;i<dayList.length;i++){cur=(dayList[i]-dayList[i-1])/86400000===1?cur+1:1;if(cur>maxStreak)maxStreak=cur;}

  const starterCount = {};
  namesAll.forEach(n=>(starterCount[n]=0));
  const firstByDay = {};
  messages.forEach(m=>{const d=m.date.toDateString();if(!firstByDay[d])firstByDay[d]=m;});
  Object.values(firstByDay).forEach(m=>{if(m.name in starterCount)starterCount[m.name]++;});
  const topStarterEntry = Object.entries(starterCount).sort((a,b)=>b[1]-a[1])[0];
  const starterPct = topStarterEntry?`${Math.round((topStarterEntry[1]/Object.keys(firstByDay).length)*100)}%`:"50%";

  const killerCount = {};
  namesAll.forEach(n=>(killerCount[n]=0));
  for(let i=0;i<messages.length-1;i++){if((messages[i+1].date-messages[i].date)/60000>120)killerCount[messages[i].name]++;}
  const topKillerEntry = Object.entries(killerCount).sort((a,b)=>b[1]-a[1])[0];

  let ghostAvg=["?","?"], ghostName=namesSorted[0], ghostEqual=false;
  if(!isGroup && namesAll.length>=2){
    const rt={};namesAll.forEach(n=>(rt[n]=[]));
    for(let i=1;i<messages.length;i++){
      const prev=messages[i-1],curr=messages[i];
      if(curr.name!==prev.name && curr.name in rt){const d=(curr.date-prev.date)/60000;if(d>1&&d<1440)rt[curr.name].push(d);}
    }
    const rawAvgMin=n=>{const a=rt[n]||[];return a.length?Math.round(a.reduce((s,t)=>s+t,0)/a.length):0;};
    const fmtMinutes=mins=>{if(!mins)return"instant";return mins<60?`${mins}m`:`${Math.floor(mins/60)}h ${mins%60}m`;};
    const fmt=n=>fmtMinutes(rawAvgMin(n));
    const a0=fmt(namesSorted[0]),a1=fmt(namesSorted[1]||namesSorted[0]);
    ghostAvg=[a0,a1];
    const raw0=rawAvgMin(namesSorted[0]),raw1=rawAvgMin(namesSorted[1]);
    ghostName=raw0>=raw1?namesSorted[0]:namesSorted[1];
    ghostEqual=raw0>0&&raw1>0&&Math.abs(raw0-raw1)<30;
  }

  // ── Therapist detection ──
  // Who sends their longest replies in response to emotional or heavy messages?
  // Emotional triggers: messages with feeling words OR messages >120 chars
  const EMOTIONAL = /sad|miss|cry|tired|stressed|anxious|scared|worried|hurt|sorry|hard|difficult|broken|lost|alone|upset|angry|feel|pain|help|support|struggling/i;
  const therapistScore = {};
  namesAll.forEach(n => (therapistScore[n] = []));
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i-1], curr = messages[i];
    if (curr.name === prev.name) continue;
    if (!(curr.name in therapistScore)) continue;
    const prevIsEmotional = EMOTIONAL.test(prev.body) || prev.body.length > 120;
    if (prevIsEmotional && curr.body.length > 60 && !/media omitted|voice omitted|audio omitted|<attached/i.test(curr.body)) {
      therapistScore[curr.name].push(curr.body.length);
    }
  }
  // Score = avg length of emotional replies × number of them (weighted)
  const therapistRank = {};
  namesAll.forEach(n => {
    const arr = therapistScore[n];
    therapistRank[n] = arr.length > 0 ? (arr.reduce((s,v)=>s+v,0)/arr.length) * Math.log(arr.length+1) : 0;
  });
  const therapist = [...namesAll].sort((a,b) => therapistRank[b]-therapistRank[a])[0] || namesAll[0];
  const therapistCount = therapistScore[therapist]?.length || 0;

  const sigWordByName = {};
  namesAll.forEach(n=>{
    const wf={};
    byName[n].forEach(({body})=>{
      if(NOISE_RE.test(body)||body.startsWith("http"))return;
      body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{if(w.length>2&&!TOKEN_STOP_WORDS.has(w)&&!TOKEN_WA_NOISE_WORDS.has(w)&&!/^\d+$/.test(w)&&!w.startsWith("http")&&w!=="www")wf[w]=(wf[w]||0)+1;});
    });
    sigWordByName[n]=Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||"...";
  });

  // ── Funniest person — who CAUSED laugh reactions ──
  const laughCausedBy = {};
  namesAll.forEach(n => (laughCausedBy[n] = 0));
  for (let i = 0; i < messages.length - 1; i++) {
    const curr = messages[i], next = messages[i+1];
    if (curr.name === next.name) continue;
    if (!(curr.name in laughCausedBy)) continue;
    if (isLaughReaction(next.body)) laughCausedBy[curr.name]++;
  }
  const funniestPerson = !isGroup && namesAll.length >= 2
    ? [...namesAll].sort((a,b) => laughCausedBy[b] - laughCausedBy[a])[0]
    : namesAll[0];

  const msgCounts = namesSorted.map(n => byName[n].length);
  const dynamics = spotDynamics({
    messages,
    namesAll,
    namesSorted,
    msgCounts,
    starterCount,
    isGroup,
  });

  return {
    analysisVersion: LOCAL_STATS_VERSION,
    isGroup, names: namesSorted,
    msgCounts,
    topWords, topBigrams, spiritEmoji: isGroup?[spiritEmojiAll]:namesSorted.map(n=>spiritByName[n]||"💬"),
    avgMsgLen: namesSorted.map(n=>avgLenByName[n]),
    maxMsgLen: namesSorted.map(n=>maxLenByName[n]),
    mediaCounts: namesSorted.map(n=>mediaByName[n]),
    linkCounts: namesSorted.map(n=>linkByName[n]),
    voiceCounts: namesSorted.map(n=>voiceByName[n]),
    peakHour: namesSorted.map(n=>fmtHour(peakHourByName[n])),
    signatureWord: namesSorted.map(n=>sigWordByName[n]),
    ghostAvg, ghostName, ghostEqual, streak: maxStreak, funniestPerson, laughCausedBy,
    topMonths: topMonths.length?topMonths:[["This month",messages.length]],
    convStarter: topStarterEntry?.[0]||namesSorted[0], convStarterPct: starterPct,
    convKiller: topKillerEntry?.[0]||namesSorted[0], convKillerCount: topKillerEntry?.[1]||0,
    mainChar:     isGroup?namesSorted[0]:null,
    ghost:        isGroup?namesSorted[namesSorted.length-1]:null,
    novelist:     isGroup?[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]:null,
    novelistMaxLen: isGroup?maxLenByName[[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]]||0:0,
    novelistLongestTopic: (() => {
      if (!isGroup) return null;
      const nov = [...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0];
      const msgs = (byName[nov]||[]).filter(m=>!/media omitted|voice omitted|audio omitted|<attached/i.test(m.body)&&!m.body.startsWith("http"));
      const longest = msgs.sort((a,b)=>b.body.length-a.body.length)[0];
      if (!longest) return null;
      const wf = {};
      longest.body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{
        if(w.length>3&&!TOKEN_STOP_WORDS.has(w)&&!TOKEN_WA_NOISE_WORDS.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;
      });
      return Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    })(),
    hype:         isGroup?topStarterEntry?.[0]||namesAll[0]:null,
    photographer: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p||null; })():null,
    photographerIsVoice: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p&&voiceByName[p]>mediaByName[p]; })():false,
    voiceChampion: isGroup?[...namesAll].sort((a,b)=>voiceByName[b]-voiceByName[a])[0]:null,
    linkDumper:   isGroup?[...namesAll].sort((a,b)=>linkByName[b]-linkByName[a])[0]:null,
    therapist:    isGroup?therapist:null,
    therapistCount: isGroup?therapistCount:0,
    nightOwl:     isGroup?[...namesAll].sort((a,b)=>peakHourByName[b]-peakHourByName[a])[0]:null,
    earlyBird:    isGroup?[...namesAll].sort((a,b)=>peakHourByName[a]-peakHourByName[b])[0]:null,
    mostHyped:    isGroup?namesSorted[1]||namesSorted[0]:null,
    totalMessages: messages.length,
    relationshipStatus: dynamics.relationshipStatus,
    relationshipStatusWhy: dynamics.relationshipStatusWhy,
    statusEvidence: dynamics.statusEvidence,
    toxicPerson: dynamics.toxicPerson,
    toxicReason: dynamics.toxicReason,
    redFlags: dynamics.redFlags,
    toxicityScores: namesSorted.map(name => Math.round(dynamics.toxicityScores[name] || 0)),
    evidenceTimeline: dynamics.evidenceTimeline,
    toxicityLevel: dynamics.toxicityLevel,
    toxicityReport: dynamics.toxicityReport,
    toxicityBreakdown: dynamics.toxicityBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────
// EVENT-BASED SAMPLING PIPELINE
// ─────────────────────────────────────────────────────────────────

const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Format a single message line — timestamp always includes speaker name
function formatMessageLine(m) {
  const d  = m.date;
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `[${ts}] ${m.name}: ${m.body}`;
}

// Flat formatter kept for growth analysis early/late contiguous slices
function formatForAI(messages) {
  return messages.map(formatMessageLine).join("\n");
}

// Assign an event score and tag set to every message position.
// Higher score = more valuable to anchor a context window on.
function scoreMessages(messages) {
  return messages.map((msg, i) => {
    let score = 0;
    const tags = [];
    // Skip pure media placeholders for signal detection
    const body = /^<(Voice|Media) omitted>$/.test(msg.body) ? "" : msg.body;
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    // Reply-gap signal — long silences often bracket important exchanges
    if (i > 0) {
      const gapMin = (msg.date - messages[i - 1].date) / 60000;
      if (gapMin > 240)     { score += 4; tags.push("long-gap"); }
      else if (gapMin > 60) { score += 2; tags.push("gap"); }
    }

    // Conflict signals
    if (body && (CONTROL_RE.test(body) || AGGRO_RE.test(body) || BREAKUP_RE.test(body))) {
      score += 6; tags.push("conflict");
    }

    // Apology clusters
    if (body && APOLOGY_RE.test(body)) {
      score += 4; tags.push("apology");
    }

    // Romantic / affection spikes
    if (body && (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body))) {
      score += 4; tags.push("affection");
    }

    // Care / support signals
    if (body && SUPPORT_RE.test(body)) {
      score += 5; tags.push("support");
    }
    if (body && prev && prev.name !== msg.name && DISTRESS_RE.test(prev.body) && (SUPPORT_RE.test(body) || body.length > 90)) {
      score += 7; tags.push("care-response");
    }
    if (
      body && prev && prev.name !== msg.name &&
      (GRATITUDE_RE.test(body) || HEART_REPLY_RE.test(body)) &&
      (SUPPORT_RE.test(prev.body) || DISTRESS_RE.test(prev.body))
    ) {
      score += 3; tags.push("care-followup");
    }

    // Long message — likely something substantive
    if (body.length > 200) { score += 2; tags.push("long-msg"); }

    // Laugh-trigger: this message caused a laugh reaction from a DIFFERENT speaker
    // in the next 1–3 messages. Preserving these windows (with their tail) lets
    // Claude see exactly whose line made someone laugh — not just what sounds funny.
    for (let j = i + 1; j <= Math.min(i + 4, messages.length - 1); j++) {
      const reactionBody = messages[j].body || "";
      if (messages[j].name !== msg.name && isLaughReaction(reactionBody)) {
        const isHardLaugh = /\b[ŞSKDGJFHBNMZXCVWQÇÖÜİ]{4,}\b/.test(reactionBody) || /😂.*😂|🤣|💀/i.test(reactionBody);
        const boost = isHardLaugh ? 9 : 6;
        score += boost;
        tags.push(isHardLaugh ? "laugh-trigger-hard" : "laugh-trigger");
        break;
      }
    }

    // Energising back-and-forth bursts are often useful for "fun" and chemistry reads.
    if (
      body && next && next.name !== msg.name &&
      body.length > 8 && body.length < 140 &&
      (next.date - msg.date) / 60000 < 8 &&
      /!|\?|😂|🤣|💀|❤️|❤|💕|🥰/.test(body + next.body)
    ) {
      score += 2; tags.push("energy-burst");
    }

    return { score, tags };
  });
}

// Merge overlapping or adjacent [start, end, tags[]] intervals
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [[...sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], sorted[i][1]);
      last[2] = [...new Set([...(last[2] || []), ...(sorted[i][2] || [])])];
    } else {
      out.push([...sorted[i]]);
    }
  }
  return out;
}

// Human-readable label for a chunk header, derived from its tag set
function chunkLabel(tags = []) {
  if (tags.includes("accountability-kept")) return "kept commitment";
  if (tags.includes("accountability-broken")) return "missed commitment";
  if (tags.includes("accountability-promise")) return "commitment";
  if (tags.includes("energy-high"))   return "positive energy";
  if (tags.includes("energy-low"))    return "draining energy";
  if (tags.includes("conflict"))      return "conflict";
  if (tags.includes("apology"))       return "apology";
  if (tags.includes("laugh-trigger-hard") || tags.includes("laugh-trigger")) return "funny moment";
  if (tags.includes("care-response") || tags.includes("support")) return "care moment";
  if (tags.includes("affection"))     return "affection";
  if (tags.includes("long-gap"))      return "after silence";
  if (tags.includes("long-msg"))      return "long message";
  return "excerpt";
}

// Build the ordered list of [startIdx, endIdx, tags[]] windows to send to Claude.
//
// Two-pass strategy:
//   1. Event windows  — anchor on high-scoring messages, include enough surrounding
//      context that speaker direction and laugh reactions are unambiguous.
//   2. Timeline fill  — add short baseline windows for time buckets not yet covered,
//      so Claude always sees something from every major period of the chat.
function buildChunks(messages) {
  if (!messages.length) return [];

  const CONTEXT_BEFORE      = 4;   // lines before each event center
  const CONTEXT_AFTER       = 5;   // lines after event center (default)
  const CONTEXT_AFTER_LAUGH = 8;   // extended tail for laugh-trigger windows
                                   //   — captures the reaction(s) that follow the funny line
  const CONTEXT_AFTER_CARE  = 7;   // keep the support response and the gratitude / reaction after it
  const EVENT_SCORE_MIN     = 4;   // minimum score to qualify as an event center
  const MAX_EVENT_WINDOWS   = 55;  // hard cap on event-based windows
  const TIMELINE_BUCKETS    = 28;  // time segments for baseline coverage
  const LINES_PER_BUCKET    = 5;   // messages per uncovered timeline window
  const MSG_LINE_LIMIT      = 1400; // hard cap on total message lines (headers not counted)

  const n      = messages.length;
  const scores = scoreMessages(messages);

  // ── Pass 1: event windows ──
  // Sort all candidates by descending score, then limit density so we never
  // take more than one event center within any 8-message neighbourhood.
  const candidates = scores
    .map((s, i) => ({ i, score: s.score, tags: s.tags }))
    .filter(x => x.score >= EVENT_SCORE_MIN)
    .sort((a, b) => b.score - a.score);

  const takenCenters  = new Set();
  const eventWindows  = [];
  const addEventWindow = (c) => {
    if (takenCenters.has(c.i)) return false;
    for (let k = Math.max(0, c.i - 4); k <= Math.min(n - 1, c.i + 4); k++) takenCenters.add(k);
    const after = (c.tags.includes("laugh-trigger-hard") || c.tags.includes("laugh-trigger"))
      ? CONTEXT_AFTER_LAUGH
      : (c.tags.includes("care-response") || c.tags.includes("support") || c.tags.includes("care-followup"))
        ? CONTEXT_AFTER_CARE
        : CONTEXT_AFTER;
    eventWindows.push([
      Math.max(0, c.i - CONTEXT_BEFORE),
      Math.min(n - 1, c.i + after),
      c.tags,
    ]);
    return true;
  };

  let preservedFunny = 0;
  let preservedCare = 0;
  for (const c of candidates) {
    if ((c.tags.includes("laugh-trigger-hard") || c.tags.includes("laugh-trigger")) && preservedFunny < 8) {
      if (addEventWindow(c)) preservedFunny += 1;
    }
  }
  for (const c of candidates) {
    if ((c.tags.includes("care-response") || c.tags.includes("support")) && preservedCare < 8) {
      if (addEventWindow(c)) preservedCare += 1;
    }
  }
  for (const c of candidates) {
    if (takenCenters.has(c.i)) continue;
    addEventWindow(c);
    if (eventWindows.length >= MAX_EVENT_WINDOWS) break;
  }

  // ── Pass 2: timeline fill ──
  // Divide the chat's time span into equal buckets.  Any bucket with no event
  // coverage gets a short window centred on its midpoint message.
  const firstTs = messages[0].date.getTime();
  const lastTs  = messages[n - 1].date.getTime();
  const span    = Math.max(lastTs - firstTs, 1);

  const mergedEvents = mergeIntervals(eventWindows);
  const coveredSet   = new Set();
  mergedEvents.forEach(([s, e]) => { for (let k = s; k <= e; k++) coveredSet.add(k); });

  const timelineWindows = [];
  for (let b = 0; b < TIMELINE_BUCKETS; b++) {
    const lo = firstTs + (b / TIMELINE_BUCKETS) * span;
    const hi = firstTs + ((b + 1) / TIMELINE_BUCKETS) * span;
    const bucket = [];
    for (let i = 0; i < n; i++) {
      const ts = messages[i].date.getTime();
      if (ts >= lo && ts < hi) bucket.push(i);
    }
    if (!bucket.length || bucket.some(i => coveredSet.has(i))) continue;
    const center = bucket[Math.floor(bucket.length / 2)];
    timelineWindows.push([
      Math.max(0, center - 2),
      Math.min(n - 1, center + LINES_PER_BUCKET - 1),
      ["timeline"],
    ]);
  }

  // ── Merge, sort, enforce line budget ──
  const all = mergeIntervals([...eventWindows, ...timelineWindows])
    .sort((a, b) => a[0] - b[0]);

  let msgLines = 0;
  const result = [];
  for (const chunk of all) {
    const sz = chunk[1] - chunk[0] + 1;
    if (msgLines + sz > MSG_LINE_LIMIT) break;
    result.push(chunk);
    msgLines += sz;
  }
  return result;
}

// Render chunks as windowed text with ━━━ separators.
// Each header tells Claude: isolated excerpt, date, type of signal.
// Speaker name is always present on every message line — attribution is unambiguous.
function formatChunksForAI(messages, chunks) {
  const total = chunks.length;
  const parts = [];
  chunks.forEach(([start, end, tags], idx) => {
    const d       = messages[start].date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]}`;
    parts.push(`\n━━━ WINDOW ${idx + 1}/${total} · ${dateStr} · ${chunkLabel(tags)} ━━━`);
    for (let i = start; i <= end; i++) parts.push(formatMessageLine(messages[i]));
  });
  return parts.join("\n");
}

// Main entry point — replaces the old smartSample(messages,N) + formatForAI(sample) pair.
// Short chats (≤600 messages) are delivered in full as a single window.
function buildSampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildChunks(messages));
}

const ENERGY_KEYWORDS = Object.freeze({
  highEnergy: Object.freeze({
    en: ["love", "happy", "excited", "proud", "thank you", "thanks", "miss you", "perfect", "amazing", "fun", "funny", "laugh", "hahaha", "lol", "lmao", "yay", "can't wait", "so sweet", "cute", "best", "great", "good news"],
    tr: ["seviyorum", "mutlu", "heyecan", "gurur", "teşekkür", "tesekkur", "özledim", "ozledim", "mükemmel", "mukemmel", "harika", "komik", "güldüm", "guldum", "hahaha", "ahahah", "çok tatlı", "cok tatli", "en iyi", "iyi haber"],
    es: ["amo", "feliz", "emocion", "orgullo", "gracias", "te extraño", "perfecto", "increible", "divertido", "risa", "jajaja", "lol", "que lindo", "me encanta", "genial", "buenas noticias"],
    pt: ["amo", "feliz", "animado", "orgulho", "obrigado", "obrigada", "saudade", "perfeito", "incrivel", "divertido", "risada", "kkkk", "haha", "que fofo", "adorei", "otimo", "boa noticia"],
    ar: ["احب", "أحب", "سعيد", "مبسوط", "متحمس", "فخور", "شكرا", "شكرًا", "اشتقت", "ممتاز", "رائع", "حلو", "ضحك", "هههه", "جميل", "خبر حلو"],
    fr: ["aime", "heureux", "heureuse", "content", "contente", "excite", "fier", "fiere", "merci", "tu me manques", "parfait", "incroyable", "drole", "haha", "mdr", "trop mignon", "genial", "bonne nouvelle"],
    de: ["liebe", "glucklich", "glücklich", "freue", "stolz", "danke", "vermiss", "perfekt", "unglaublich", "lustig", "haha", "lol", "suss", "süß", "super", "toll", "gute nachricht"],
    it: ["amo", "felice", "contento", "contenta", "emozionato", "orgoglioso", "grazie", "mi manchi", "perfetto", "incredibile", "divertente", "rido", "ahaha", "lol", "che carino", "adoro", "bella notizia"],
  }),
  lowEnergy: Object.freeze({
    en: ["tired", "exhausted", "drained", "sad", "angry", "annoyed", "upset", "stress", "stressed", "anxious", "sorry", "fight", "argue", "hurt", "cry", "crying", "ignored", "lonely", "overwhelmed", "can't do this"],
    tr: ["yorgun", "bitkin", "tükendim", "tukendim", "üzgün", "uzgun", "kızgın", "kizgin", "sinir", "stres", "kaygı", "kaygi", "üzgünüm", "uzgunum", "kavga", "tartış", "tartis", "kırıldım", "kirildim", "ağlı", "agli", "yalnız", "yalniz", "bunaldım"],
    es: ["cansado", "cansada", "agotado", "triste", "enojado", "molesto", "estres", "ansioso", "ansiosa", "perdon", "pelea", "discutir", "dolido", "lloro", "llorando", "ignorado", "solo", "sola", "abrumado"],
    pt: ["cansado", "cansada", "exausto", "triste", "irritado", "chateado", "estresse", "ansioso", "ansiosa", "desculpa", "briga", "discutir", "machucado", "chorar", "chorando", "ignorado", "sozinho", "sobrecarregado"],
    ar: ["تعبان", "مرهق", "حزين", "زعلان", "غاضب", "متضايق", "توتر", "قلق", "اسف", "آسف", "مشكلة", "خناق", "وجع", "بكاء", "ابكي", "تجاهل", "وحيد", "ضغط"],
    fr: ["fatigue", "fatigué", "fatiguee", "epuise", "triste", "enerve", "stress", "angoisse", "desole", "desolee", "dispute", "mal", "pleure", "ignore", "seul", "seule", "deborde"],
    de: ["mude", "müde", "erschopft", "erschöpft", "traurig", "wutend", "wütend", "genervt", "stress", "gestresst", "angst", "sorry", "streit", "verletzt", "weine", "ignoriert", "allein", "uberfordert", "überfordert"],
    it: ["stanco", "stanca", "esausto", "triste", "arrabbiato", "arrabbiata", "stress", "ansioso", "ansiosa", "scusa", "litigio", "discutere", "ferito", "piango", "ignorato", "solo", "sola", "sopraffatto"],
  }),
});

const ENERGY_POSITIVE_EXCLUDE_KEYWORDS = Object.freeze({
  en: ["sex", "sexual", "horny", "nude", "naked", "creepy", "awkward", "weird", "sarcasm", "sarcastic", "kidding", "jk", "whatever", "shut up"],
  tr: ["seks", "cinsel", "azgın", "azgin", "çıplak", "ciplak", "garip", "tuhaf", "rahatsız", "rahatsiz", "alay", "sarkazm", "şaka", "saka", "neyse", "sus"],
  es: ["sexo", "sexual", "caliente", "desnudo", "desnuda", "raro", "incomodo", "incómodo", "sarcasmo", "sarcastico", "broma", "da igual", "callate"],
  pt: ["sexo", "sexual", "tesao", "tesão", "nu", "nua", "estranho", "esquisito", "desconfortavel", "sarcasmo", "sarcastico", "brincadeira", "tanto faz", "cala a boca"],
  ar: ["جنس", "جنسي", "عارية", "غريب", "مريب", "محرج", "سخرية", "امزح", "مزح", "اخرس"],
  fr: ["sexe", "sexuel", "nu", "nue", "bizarre", "genant", "gênant", "malaisant", "sarcasme", "sarcastique", "blague", "tais-toi"],
  de: ["sex", "sexuell", "nackt", "komisch", "unheimlich", "peinlich", "sarkasmus", "sarkastisch", "spass", "spaß", "egal", "halt die klappe"],
  it: ["sesso", "sessuale", "nudo", "nuda", "strano", "inquietante", "imbarazzante", "sarcasmo", "sarcastico", "scherzo", "zitto", "zitta"],
});

function normalizeEnergyText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function flattenEnergyTerms(group) {
  return Object.values(group).flat().map(normalizeEnergyText).filter(Boolean);
}

const ENERGY_HIGH_TERMS = flattenEnergyTerms(ENERGY_KEYWORDS.highEnergy);
const ENERGY_LOW_TERMS = flattenEnergyTerms(ENERGY_KEYWORDS.lowEnergy);
const ENERGY_POSITIVE_EXCLUDE_TERMS = flattenEnergyTerms(ENERGY_POSITIVE_EXCLUDE_KEYWORDS);

function countEnergyMatches(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function scoreEnergyMessage(msg, index, messages) {
  const body = /^<(Voice|Media) omitted>$/.test(msg?.body || "") ? "" : (msg?.body || "");
  const text = normalizeEnergyText(body);
  if (!text || text.length < 3) return null;

  const highMatches = countEnergyMatches(text, ENERGY_HIGH_TERMS);
  const lowMatches = countEnergyMatches(text, ENERGY_LOW_TERMS);
  if (!highMatches && !lowMatches) return null;

  const expressive =
    (/[!?]{1,3}/.test(body) ? 2 : 0) +
    (/(😂|🤣|💀|❤️|❤|💕|🥰|😍|😭|✨|🔥)/.test(body) ? 3 : 0) +
    (body.length >= 24 && body.length <= 220 ? 2 : 0) +
    (body.length > 220 ? 1 : 0);
  const next = messages[index + 1];
  const quickReplyBoost = next && next.name !== msg.name && (next.date - msg.date) / 60000 < 10 ? 1 : 0;
  const hasPositiveBlock = ENERGY_POSITIVE_EXCLUDE_TERMS.some(term => text.includes(term));
  const highScore = highMatches * 5 + expressive + quickReplyBoost - (hasPositiveBlock ? 99 : 0);
  const lowScore = lowMatches * 5 + expressive + quickReplyBoost;
  const tags = [];
  if (highScore > 0 && highScore >= lowScore) tags.push("energy-high");
  if (lowScore > 0) tags.push("energy-low");
  if (expressive >= 3) tags.push("expressive");
  if (!tags.includes("energy-high") && !tags.includes("energy-low")) return null;

  return {
    i: index,
    score: Math.max(highScore, lowScore),
    tags,
  };
}

function buildEnergyChunks(messages) {
  if (!messages.length) return [];
  const n = messages.length;
  const MSG_LINE_LIMIT = 1400;
  const energyCandidates = messages
    .map((msg, index) => scoreEnergyMessage(msg, index, messages))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const windows = [];
  const taken = new Set();
  const addCandidateWindow = (candidate) => {
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k++) {
      if (taken.has(k)) return false;
    }
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k++) taken.add(k);
    windows.push([
      Math.max(0, candidate.i - 4),
      Math.min(n - 1, candidate.i + 6),
      candidate.tags,
    ]);
    return true;
  };

  let highCount = 0;
  let lowCount = 0;
  for (const candidate of energyCandidates) {
    if (candidate.tags.includes("energy-high") && highCount < 12 && addCandidateWindow(candidate)) highCount += 1;
  }
  for (const candidate of energyCandidates) {
    if (candidate.tags.includes("energy-low") && lowCount < 12 && addCandidateWindow(candidate)) lowCount += 1;
  }
  for (const candidate of energyCandidates) {
    if (windows.length >= 42) break;
    addCandidateWindow(candidate);
  }

  const baseline = buildChunks(messages);
  const mergedEnergy = mergeIntervals(windows);
  const covered = new Set();
  mergedEnergy.forEach(([start, end]) => {
    for (let i = start; i <= end; i += 1) covered.add(i);
  });

  let lines = 0;
  const selected = [];
  for (const chunk of mergedEnergy) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  const baselineFill = baseline.filter(([start, end]) => {
    for (let i = start; i <= end; i += 1) {
      if (covered.has(i)) return false;
    }
    return true;
  });
  for (const chunk of baselineFill) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) break;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

function buildEnergySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildEnergyChunks(messages));
}

const ACCOUNTABILITY_KEYWORDS = Object.freeze({
  commitments: Object.freeze({
    en: ["i will", "i'll", "i can", "i'll do", "i'm going to", "i promise", "promise", "let's", "we will", "we'll", "i booked", "i ordered", "i sent", "i'll bring", "i'll call", "i'll send", "i'll pick", "i'll pay"],
    tr: ["yapacağım", "yapacagim", "ederim", "gideceğim", "gidecegim", "söz", "soz", "hallederim", "ararım", "ararim", "gönderirim", "gonderirim", "alırım", "alirim", "getiririm", "bakarım", "bakarim"],
    es: ["voy a", "prometo", "te prometo", "puedo", "lo hago", "lo hare", "lo haré", "mando", "envio", "envío", "llamo", "traigo", "pago", "reservé", "reserve"],
    pt: ["vou", "prometo", "eu faço", "eu faco", "posso", "mando", "envio", "ligo", "trago", "pago", "reservei", "comprei"],
    ar: ["سأ", "راح", "هعمل", "هسوي", "اوعد", "أوعد", "وعد", "ابعت", "أبعت", "ارسل", "أرسل", "اجيب", "أجيب", "اتصل", "أدفع"],
    fr: ["je vais", "je peux", "je promets", "promis", "j'envoie", "j'appelle", "je ramene", "je ramène", "je paie", "j'ai reserve", "j'ai réservé"],
    de: ["ich werde", "ich kann", "versprochen", "ich verspreche", "ich schicke", "ich rufe", "ich bringe", "ich zahle", "ich habe gebucht", "ich buche"],
    it: ["farò", "faro", "posso", "prometto", "mando", "invio", "chiamo", "porto", "pago", "ho prenotato", "prenoto"],
  }),
  followThrough: Object.freeze({
    en: ["done", "did it", "finished", "sent it", "booked", "ordered", "paid", "got it", "handled", "completed", "on my way", "i'm here", "i called"],
    tr: ["bitti", "yaptım", "yaptim", "gönderdim", "gonderdim", "aldım", "aldim", "ödedim", "odedim", "hallettim", "geliyorum", "geldim", "aradım", "aradim"],
    es: ["hecho", "lo hice", "terminé", "termine", "enviado", "reservé", "reserve", "pagado", "lo tengo", "ya voy", "llegué", "llegue", "llamé", "llame"],
    pt: ["feito", "fiz", "terminei", "enviei", "reservei", "paguei", "consegui", "estou indo", "cheguei", "liguei"],
    ar: ["خلص", "عملت", "سويت", "ارسلت", "أرسلت", "حجزت", "دفعت", "جبت", "وصلت", "اتصلت"],
    fr: ["fait", "je l'ai fait", "termine", "terminé", "envoye", "envoyé", "reserve", "réservé", "paye", "payé", "j'arrive", "je suis la", "appelé"],
    de: ["erledigt", "gemacht", "fertig", "geschickt", "gebucht", "bezahlt", "hab es", "bin unterwegs", "bin da", "angerufen"],
    it: ["fatto", "l'ho fatto", "finito", "inviato", "prenotato", "pagato", "preso", "arrivo", "sono qui", "ho chiamato"],
  }),
  delayOrExcuse: Object.freeze({
    en: ["sorry", "forgot", "late", "delayed", "can't", "cannot", "couldn't", "busy", "tomorrow", "later", "not yet", "i missed", "rain check", "reschedule", "postpone"],
    tr: ["pardon", "özür", "ozur", "unuttum", "geç", "gec", "geciktim", "yapamam", "yoğunum", "yogunum", "yarın", "yarin", "sonra", "daha değil", "erteleyelim"],
    es: ["perdón", "perdon", "olvidé", "olvide", "tarde", "no puedo", "ocupado", "ocupada", "mañana", "manana", "luego", "todavía no", "todavia no", "reprogramar"],
    pt: ["desculpa", "esqueci", "atrasado", "atrasada", "não posso", "nao posso", "ocupado", "ocupada", "amanhã", "amanha", "depois", "ainda não", "remarcar"],
    ar: ["اسف", "آسف", "نسيت", "متأخر", "اتأخرت", "مش قادر", "ما اقدر", "مشغول", "بكرة", "بعدين", "لسه", "نأجل"],
    fr: ["desole", "désolé", "oublie", "oublié", "retard", "je peux pas", "occupe", "occupé", "demain", "plus tard", "pas encore", "reporter"],
    de: ["sorry", "vergessen", "spät", "verspätet", "kann nicht", "beschäftigt", "morgen", "später", "noch nicht", "verschieben"],
    it: ["scusa", "dimenticato", "tardi", "ritardo", "non posso", "occupato", "occupata", "domani", "dopo", "non ancora", "rimandare"],
  }),
  cancellation: Object.freeze({
    en: ["cancel", "can't make it", "not coming", "skip", "forget it", "never mind", "called off"],
    tr: ["iptal", "gelemem", "gelmiyorum", "boşver", "bosver", "vazgeç", "vazgec"],
    es: ["cancelar", "cancelo", "no voy", "no puedo ir", "olvidalo", "déjalo", "dejalo"],
    pt: ["cancelar", "cancelei", "não vou", "nao vou", "não consigo ir", "deixa", "esquece"],
    ar: ["الغاء", "إلغاء", "مش جاي", "مش هاجي", "خلينا نلغي", "انسى"],
    fr: ["annuler", "j'annule", "je viens pas", "je ne viens pas", "laisse tomber"],
    de: ["absagen", "abgesagt", "komme nicht", "schaffe es nicht", "vergiss es"],
    it: ["annullare", "annullo", "non vengo", "non riesco", "lascia stare"],
  }),
});

const ACCOUNTABILITY_WEAK_COMMITMENT_TERMS = [
  "sometime", "one day", "maybe", "should hang", "we should", "eventually",
  "bir ara", "belki", "algún día", "algun dia", "talvez", "un jour", "irgendwann", "prima o poi",
].map(normalizeEnergyText);

function flattenAccountabilityTerms(group) {
  return Object.values(group).flat().map(normalizeEnergyText).filter(Boolean);
}

const ACCOUNTABILITY_COMMITMENT_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.commitments);
const ACCOUNTABILITY_FOLLOW_THROUGH_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.followThrough);
const ACCOUNTABILITY_DELAY_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.delayOrExcuse);
const ACCOUNTABILITY_CANCEL_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.cancellation);

function scoreAccountabilityMessage(msg, index, messages) {
  const body = /^<(Voice|Media) omitted>$/.test(msg?.body || "") ? "" : (msg?.body || "");
  const text = normalizeEnergyText(body);
  if (!text || text.length < 4) return null;

  const commitmentMatches = countEnergyMatches(text, ACCOUNTABILITY_COMMITMENT_TERMS);
  const followMatches = countEnergyMatches(text, ACCOUNTABILITY_FOLLOW_THROUGH_TERMS);
  const delayMatches = countEnergyMatches(text, ACCOUNTABILITY_DELAY_TERMS);
  const cancelMatches = countEnergyMatches(text, ACCOUNTABILITY_CANCEL_TERMS);
  if (!commitmentMatches && !followMatches && !delayMatches && !cancelMatches) return null;

  const hasSpecificity = (
    /\b(today|tonight|tomorrow|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at \d|by \d|\d{1,2}:\d{2})\b/i.test(body) ||
    /\b(bugun|bugün|yarin|yarın|aksam|akşam|sabah|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar)\b/i.test(body) ||
    /\b(hoy|mañana|manana|noche|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i.test(body) ||
    /\b(hoje|amanhã|amanha|noite|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i.test(body) ||
    /\b(aujourd'hui|demain|soir|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(body) ||
    /\b(heute|morgen|abend|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(body) ||
    /\b(oggi|domani|sera|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\b/i.test(body)
  );
  const weakCommitment = ACCOUNTABILITY_WEAK_COMMITMENT_TERMS.some(term => text.includes(term));
  const nearby = messages.slice(Math.max(0, index - 3), Math.min(messages.length, index + 5));
  const nearbyFollow = nearby.some(item => item !== msg && countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_FOLLOW_THROUGH_TERMS));
  const nearbyDelay = nearby.some(item => item !== msg && (
    countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_DELAY_TERMS) ||
    countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_CANCEL_TERMS)
  ));

  const tags = [];
  if (commitmentMatches) tags.push("accountability-promise");
  if (followMatches || nearbyFollow) tags.push("accountability-kept");
  if (delayMatches || cancelMatches || nearbyDelay) tags.push("accountability-broken");
  const quoteShape = body.length >= 12 && body.length <= 240 ? 2 : 0;
  const score =
    commitmentMatches * 6 +
    followMatches * 5 +
    delayMatches * 4 +
    cancelMatches * 6 +
    (hasSpecificity ? 4 : 0) +
    (nearbyFollow ? 2 : 0) +
    (nearbyDelay ? 2 : 0) +
    quoteShape -
    (weakCommitment && !hasSpecificity ? 5 : 0);

  if (score < 4) return null;
  return { i: index, score, tags: [...new Set(tags)] };
}

function buildAccountabilityChunks(messages) {
  if (!messages.length) return [];
  const n = messages.length;
  const MSG_LINE_LIMIT = 1400;
  const candidates = messages
    .map((msg, index) => scoreAccountabilityMessage(msg, index, messages))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const windows = [];
  const taken = new Set();
  const addWindow = (candidate) => {
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k += 1) {
      if (taken.has(k)) return false;
    }
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k += 1) taken.add(k);
    windows.push([
      Math.max(0, candidate.i - 5),
      Math.min(n - 1, candidate.i + 7),
      candidate.tags,
    ]);
    return true;
  };

  let promiseCount = 0;
  let keptCount = 0;
  let brokenCount = 0;
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-promise") && promiseCount < 12 && addWindow(candidate)) promiseCount += 1;
  }
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-kept") && keptCount < 10 && addWindow(candidate)) keptCount += 1;
  }
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-broken") && brokenCount < 10 && addWindow(candidate)) brokenCount += 1;
  }
  for (const candidate of candidates) {
    if (windows.length >= 44) break;
    addWindow(candidate);
  }

  const baseline = buildChunks(messages);
  const focused = mergeIntervals(windows);
  const covered = new Set();
  focused.forEach(([start, end]) => {
    for (let i = start; i <= end; i += 1) covered.add(i);
  });

  let lines = 0;
  const selected = [];
  for (const chunk of focused) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  for (const chunk of baseline) {
    const overlapsFocused = (() => {
      for (let i = chunk[0]; i <= chunk[1]; i += 1) {
        if (covered.has(i)) return true;
      }
      return false;
    })();
    if (overlapsFocused) continue;
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) break;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

function buildAccountabilitySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildAccountabilityChunks(messages));
}

async function callClaude(systemPrompt, userContent, maxTokens = 1500, schemaMode = "analysis") {
  let { data: { session } } = await supabase.auth.getSession();
  const isExpired = session && session.expires_at && (session.expires_at * 1000) < Date.now();
  if (!session || isExpired) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session;
    } catch (refreshErr) {
      console.warn("[callClaude] refreshSession threw:", refreshErr?.message);
    }
  }
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens, schema_mode: schemaMode }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      let detail = "";
      let parsed = null;
      try {
        const text = await res.text();
        parsed = tryParseJsonText(text);
        if (parsed && typeof parsed === "object") {
          console.error("[callClaude] edge function error payload:", parsed);
        }
        detail = String(parsed?.error || text || "").trim();
      } catch {
        // Fall back to the status code below.
      }
      const err = new Error(detail || `Edge function error ${res.status}`);
      if (parsed && typeof parsed === "object") {
        err.debug = parsed;
        const preview = [parsed.parse_error_context, parsed.cleaned_preview_end, parsed.raw_preview_end]
          .filter(Boolean)
          .join("\n\n");
        if (preview) err.message = `${detail || `Edge function error ${res.status}`}\n${preview}`;
      }
      throw err;
    }
    const raw = await res.json();
    return extractClaudePayload(raw);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Analysis timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callClaudeRawText(systemPrompt, userContent, maxTokens = 1500) {
  let { data: { session } } = await supabase.auth.getSession();
  const isExpired = session && session.expires_at && (session.expires_at * 1000) < Date.now();
  if (!session || isExpired) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session;
    } catch (refreshErr) {
      console.warn("[callClaudeRawText] refreshSession threw:", refreshErr?.message);
    }
  }
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens, schema_mode: "raw_text" }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        const parsed = tryParseJsonText(text);
        if (parsed && typeof parsed === "object") {
          console.error("[callClaudeRawText] edge function error payload:", parsed);
        }
        detail = String(parsed?.error || text || "").trim();
      } catch {
        // Fall back to the status code below.
      }
      throw new Error(detail || `Edge function error ${res.status}`);
    }
    return await res.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Analysis timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function tryParseJsonText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function userFacingAnalysisError(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "The AI analysis didn't come through. Please try again.";
  if (message.includes("timed out")) return "The AI took too long to answer. Please try again.";
  if (/parse_failed/i.test(message)) return "The AI returned malformed JSON. Check the console for the raw preview and try again.";
  if (/invalid_response_shape|output_limit_reached/i.test(message)) return "The AI answer was cut off before it finished. Please try again.";
  if (/ANTHROPIC_API_KEY secret not set/i.test(message)) return "The AI server isn't configured correctly yet.";
  if (/Analysis failed/i.test(message) || /Edge function error 502/i.test(message)) return "The AI provider failed to return a usable answer. Please try again.";
  if (/AI returned an empty analysis/i.test(message)) return "The AI answered, but the result was empty. Please try again.";
  if (/Missing required fields/i.test(message)) return "The analysis request was incomplete. Please try again.";
  if (/failed to fetch|networkerror|load failed/i.test(message.toLowerCase())) return "The app couldn't reach the AI server. Check your connection and try again.";
  return message;
}

function isAnalysisPayload(value) {
  return !!(
    value &&
    typeof value === "object" &&
    (
      Array.isArray(value.people) ||
      (value.shared && typeof value.shared === "object") ||
      (value.meta && typeof value.meta === "object")
    )
  );
}

function extractClaudePayload(raw) {
  const queue = [raw];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const parsed = tryParseJsonText(current);
      if (parsed) queue.unshift(parsed);
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach(item => queue.push(item));
      continue;
    }

    if (typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (isAnalysisPayload(current)) return current;

    [
      "analysis",
      "result",
      "data",
      "payload",
      "parsed",
      "json",
      "response",
      "output",
      "completion",
      "choices",
      "choice",
      "candidate",
      "candidates",
      "answer",
      "artifact",
      "text",
      "content",
      "message",
      "messages",
      "delta",
      "raw",
      "body",
    ].forEach(key => {
      if (key in current) queue.push(current[key]);
    });
  }

  return raw;
}

const CORE_ANALYSIS_VERSION = 2;
const LOCAL_STATS_VERSION = 3;
const CORE_ANALYSIS_CACHE_VERSION = 6;
const CORE_A_MAX_TOKENS = 3200;
const CORE_B_MAX_TOKENS = 2600;
const HOMEPAGE_VERSION = "67537";
const HOMEPAGE_VERSION_LABEL = (_updateNotesRaw.match(/^## (v\d+\.\d+)/m) || [])[1] ?? "v?";

function buildRelationshipContextBlock(relType) {
  const relCtx = relContextStr(relType);
  return relCtx
    ? ` RELATIONSHIP CONTEXT: ${relCtx}. Frame all analysis, tone, and language accordingly. Treat the user-selected relationship category as a hard boundary. Do not label a partner dynamic as friendship or chosen family. Do not label a family dynamic as romantic. Do not label an ex dynamic as family, friendship, or current romance.`
    : "";
}

function buildLangInstruction(chatLang) {
  if (!chatLang || chatLang === "en") return "";
  const label = LANG_META[chatLang];
  if (!label) return "";
  return `\n\nOUTPUT LANGUAGE: Write all free-text fields (sentences, summaries, descriptions, examples, context, verdicts, reasons, and analysis) directly and natively in ${label}. Do NOT draft in English first and then translate, compose every sentence directly in ${label} from scratch. The JSON structure and all key names must remain exactly as specified in the schema.\n\nThe following fields are schema-critical control tokens, reproduce them EXACTLY as listed here, with zero translation:\n- "language" (careStyle): must be one of exactly: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed\n- "depthChange": must be one of exactly: deeper / shallower / about the same\n- "trajectory": must be one of exactly: closer / drifting / stable\n- "type" (energy): must be one of exactly: net positive / mixed / net draining\n- "dramaStarter": a first name as written in the chat, or exactly "Shared", or exactly "None clearly identified"\n- "toxicPerson": a first name as written in the chat, or exactly "Tie", or exactly "None clearly identified"\n- "funniestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "kindestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "whoChangedMore": a first name as written in the chat, or exactly "Both equally"\n- "powerHolder": a first name as written in the chat, or exactly "Balanced"\n- "person" in promise/apology fields: a first name as written in the chat, or exactly "None clearly identified"\n- All "name" fields: the exact first name as it appears in the chat\nDo NOT translate, paraphrase, or modify these control tokens under any circumstances. All descriptive text fields, everything else, must be written natively in ${label}.`;
}

function buildAnalystSystemPrompt(role, relationshipType, extraRules = "", chatLang = "en", relationshipLine = "") {
  return `PRIORITY RULES: READ FIRST, OVERRIDE EVERYTHING ELSE:

1. RELATIONSHIP LABEL: ${relationshipLine || `Use the user-selected relationship type "${relationshipType}". Never override it. Cousins are not father-daughter. Friends are not partners. Use only the confirmed label, never infer relationship from tone, warmth, or emoji use.`}

2. FUNNY ATTRIBUTION, LAUGH TYPES:
   Keyboard mashes (random consonant clusters like 'skdjfhsdf', 'ŞUHAJDADGHKFD', 'fjdksj') are LAUGH REACTIONS, not jokes. They mean the person is laughing.
   UPPERCASE keyboard mashes (e.g. 'ŞUHAJDADGHKFD', 'SKDJFHDF') = extremely hard laughter.
   lowercase keyboard mashes (e.g. 'skdjfhsdf') = regular laughter.
   😂 💀 🤣 lol lmao haha 'im dead' = laugh reactions.
   The FUNNY PERSON is whoever sent the line that triggered the laugh reaction, never the person doing the laughing.
   If Aslı sends 'ŞUHAJDADGHKFD' after Ozge's message, Ozge is funny. Aslı is the audience.

3. DIRECTION OF ACTIONS: The actor is always the sender of that exact message line. Never reverse who did what to whom.

4. SIGNATURE PHRASES: signaturePhrases must be actual repeated text phrases or expressions, never emojis alone, never keyboard mashes, never laugh sounds. Only real words or short sentences that a person uses repeatedly.

5. DRAMA SCOPE: dramaStarter and dramaContext must consider ALL drama in the chat, not just conflict between the two participants. This includes personal dramas they share with each other about third parties, work stress, relationship issues, life problems. The drama starter is whoever brings drama into the conversation most often, regardless of whether it is directed at the other person.

6. TRANSLATION: Never translate quoted messages. Reproduce all quotes exactly as written in the chat in their original language. Do not add translations in parentheses.

7. GEOGRAPHY: Never claim participants live in different cities, countries or continents unless the chat explicitly and literally states this.

8. SPECIFICITY: Prefer real names, recurring people, places, repeated situations, and actual phrasing from the chat when they make the line more recognizable.

9. CONTROLLED INTERPRETATION: You may compress clearly supported patterns into short reads like "easy flow", "awkwardness", "chaos", "natural ghosting", or "therapist mode", or similarly compact grounded tags, only when repeated or concrete evidence supports them. Never infer motives, inner states, diagnoses, or emotional certainty.

You are WrapChat, ${role}. Be specific, grounded, and evidence-led.

INTERPRETATION RULE:
You are allowed to interpret patterns when they are supported by repeated behavior, even if the chat does not explicitly name the pattern. Do not stay at surface description. Convert behavior into a short, natural insight. Keep interpretations soft and grounded, never diagnostic or absolute.

PUNCTUATION:
Never use the em dash punctuation mark in any user-facing text field. Use commas, semicolons, periods, or natural sentence flow instead.

Reference real patterns, real phrases, and real moments from the chat instead of generic observations. Be conservative before singling out one person: if the evidence is mixed, close, or mostly based on tone, prefer balanced labels like "Tie", "Shared", "Balanced", or "None clearly identified" instead of over-assigning blame. Do not pile onto the loudest or most active person unless multiple distinct examples support it. Keep the tone honest but not cruel, mocking, or absolute. Avoid repetitive wording across fields: if two answers overlap, make them distinct in angle and concrete detail rather than repeating the same judgment. When negative and positive evidence coexist, acknowledge both. Return ONLY valid JSON with no markdown fences or explanation outside the JSON. Never embed literal newline characters inside a JSON string value, keep every string on a single line.${buildRelationshipContextBlock(relationshipType)}${extraRules ? ` ${extraRules}` : ""}${buildLangInstruction(chatLang)}`;
}

const CORE_A_WRITING_STYLE = `WRITING STYLE:
Write like an observant friend who has read the entire chat and formed specific opinions, not an analyst, not a therapist, not a report generator.

VOICE:
- Warm, perceptive, and lightly playful
- Slightly ironic when the chat supports it, but never cruel, mocking, or judgmental
- Emotionally aware, but grounded in actual behavior
- The output should feel like "you were already thinking this, now someone said it clearly"

SPECIFICITY:
- Use real names, recurring topics, repeated situations, places, timing patterns, or short exact quotes when possible
- Avoid generic statements that could apply to any random chat
- Every insight should feel like it belongs only to this chat

PATTERN FOCUS:
- Do not only summarize what happened
- Identify the recurring pattern, role, or dynamic behind the behavior
- Assign soft roles when clearly supported, such as "the planner", "the therapist friend", "the chaos-bringer", "the one who disappears", "the emotional translator"
- Do not force roles if evidence is weak

COINED MICRO-PHRASES:
- When natural, compress a pattern into a short memorable phrase
- Examples: "natural ghosting", "friendship dependency", "low-effort check-ins", "emotional admin", "accidental disappearing act"
- Do not overdo this. Use it only when it makes the insight sharper

STRUCTURE:
Each free-text insight should usually follow:
specific observation + recurring pattern or concrete moment + short interpretation

Good examples:
- "Maya keeps bringing the chaos, and Alex keeps translating it into something manageable, very therapist-friend energy."
- "The slow replies are not pure ghosting, they feel more like timing chaos, one person is mid-crisis while the other arrives six hours later."
- "Their sweetest moments are not dramatic speeches, they are tiny check-ins that say, 'I know your life, and I am still here.'"

BAD examples:
- "They have a strong connection."
- "This shows that they support each other."
- "Overall, their communication is healthy."
- "It seems like they care about each other."

TONE CONTROL:
- No therapy language
- No diagnosis
- No advice
- No moralizing
- No over-explaining
- No "this shows that", "it seems like", "overall", "in general", "the analysis suggests"
- State observations directly when supported by evidence

PUNCTUATION RULE:
- Do not use the em dash punctuation mark
- Prefer commas, semicolons, periods, or natural sentence flow
- The tone should feel like spoken thought, not polished editorial prose

COMPRESSION:
- Keep text compact but layered
- Prefer one strong sentence over two weak generic sentences
- Avoid filler and repeated ideas

ANTI-GENERIC RULE:
Before finalizing any free-text field, check whether it could fit another random chat. If yes, rewrite it with specific evidence, names, or a more precise dynamic.

ANTI-REPETITION: sweetMoment and mostLovingMoment must describe different events — sweetMoment is a specific act of care or support, mostLovingMoment is a warm affectionate exchange or emotional closeness; they must not reference the same message. tensionMoment and dramaContext must describe different events — tensionMoment is the sharpest single spike, dramaContext is the recurring pattern. vibeOneLiner and relationshipSummary must not be near-identical — vibeOneLiner captures the overall feel in one memorable line, relationshipSummary describes the ongoing dynamic in human terms. toxicityReport and groupDynamic must not paraphrase each other — groupDynamic is the social energy read, toxicityReport is the final health verdict. relationshipSummary and relationshipStatusWhy must take different angles — relationshipStatusWhy explains the label choice, relationshipSummary describes the dynamic. Each evidenceTimeline entry must reference a distinct event. No two fields across the full output should describe the same moment or quote the same line. SIGNATURE PHRASES: Before assigning a phrase to a person, verify it by checking which sender's lines it appears on. signaturePhrases[0] must be a phrase only person 1 sends, signaturePhrases[1] must be a phrase only person 2 sends, never swap or guess attribution.

MOMENT EXTRACTION:
When a field asks for a funny moment, sweet moment, tension moment, signature phrase, vibe line, or memorable example — prefer one concrete scene from the provided evidence windows over a broad summary. The shape is: what happened + exact phrase or recurring detail + short interpretation. The result should feel like a card someone would screenshot, not a report note.

QUOTE USE:
Use short exact quotes only when they make the insight more recognizable, funny, affectionate, tense, or specific. Never invent quotes. Never translate quotes. One quote per field maximum. If no quote fits naturally, write the observation without one.

DATE RULE:
For all date-bearing fields (evidenceTimeline entries, memorableMoments entries, redFlagMoments entries, notableBroken, notableKept), use approximate period descriptions only — words like 'early on', 'a few months in', 'mid-chat', 'recently', 'toward the end'. Never write a specific calendar date, month name, day number, or year.`;

function buildCoreASystemPrompt(role, relationshipType, extraRules = "", chatLang = "en", relationshipLine = "") {
  return buildAnalystSystemPrompt(role, relationshipType, `${CORE_A_WRITING_STYLE} ${extraRules}`, chatLang, relationshipLine);
}

function clampScore(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function strOr(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanStringArray(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function normalizeNamedScoreRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      name: strOr(item.name, `Person ${i + 1}`),
      score: clampScore(item.score, 5),
      detail: strOr(item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizeApologySummary(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    name: strOr(safe.name, "None clearly identified"),
    count: Math.max(0, Math.round(Number(safe.count) || 0)),
    context: strOr(safe.context),
  };
}

function normalizeMomentRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      date: strOr(item.date, `Moment ${i + 1}`),
      person: strOr(item.person),
      description: strOr(item.description || item.title),
      quote: strOr(item.quote || item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizePromiseMoment(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    person: strOr(safe.person, "None clearly identified"),
    promise: strOr(safe.promise),
    date: strOr(safe.date),
    outcome: strOr(safe.outcome),
  };
}

// Normalize schema-critical enum values that Claude may translate despite instructions.
// Maps common translations back to canonical English control tokens so the app's
// UI mappings (arrowMap, trajMap, love-language labels) keep working.
const LOVE_LANG_CANONICAL = [
  "Words of Affirmation",
  "Acts of Service",
  "Receiving Gifts",
  "Quality Time",
  "Physical Touch",
  "Mixed",
];
function normalizeLoveLanguage(v) {
  const s = String(v || "").trim();
  const exact = LOVE_LANG_CANONICAL.find(l => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const sl = s.toLowerCase();
  if (/affirm|onay|söz|szavak|parole|afirmación|palavras|aff/.test(sl)) return "Words of Affirmation";
  if (/service|servis|hizmet|actes|handlung|servicio|atos|acts/.test(sl)) return "Acts of Service";
  if (/gift|hediye|cadeau|geschenk|regalo|doni/.test(sl)) return "Receiving Gifts";
  if (/quality|nitelik|temps|zeit|tiempo|tempo/.test(sl) && /time|zaman/.test(sl)) return "Quality Time";
  if (/physical|fizik|fisique|körper|físic|fisic|touch|dokunuş/.test(sl)) return "Physical Touch";
  return s; // keep as-is if unrecognized (still renders, just without canonical label)
}
function normalizeDepthChange(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["deeper", "shallower", "about the same"].includes(s)) return s;
  if (/deep|derin|profond|tief|profund|más profund/.test(s)) return "deeper";
  if (/shallow|yüzey|superfic|flach|poco profund/.test(s)) return "shallower";
  if (/same|aynı|même|gleich|igual|stessa/.test(s)) return "about the same";
  return v;
}
function normalizeTrajectory(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["closer", "drifting", "stable"].includes(s)) return s;
  if (/clos|yakın|proche|näher|cerca|vicin/.test(s)) return "closer";
  if (/drift|uzaklaş|éloign|entfern|alej|allontan/.test(s)) return "drifting";
  if (/stable|stabil|estable|stabil/.test(s)) return "stable";
  return v;
}
function normalizeEnergyType(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["net positive", "mixed", "net draining"].includes(s)) return s;
  if (/positive|pozitif|positif|positivo|positiv/.test(s)) return "net positive";
  if (/drain|yoran|épuisant|erschöpf|agotador|sfiancant/.test(s)) return "net draining";
  if (/mixed|karma|mixte|gemischt|mixto|misto/.test(s)) return "mixed";
  return v;
}

function normalizeCorePersonA(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const care = safe.careStyle && typeof safe.careStyle === "object" ? safe.careStyle : {};
  const energy = safe.energy && typeof safe.energy === "object" ? safe.energy : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    summaryRole: strOr(safe.summaryRole),
    careStyle: {
      language: normalizeLoveLanguage(strOr(care.language, "Mixed")),
      languageEmoji: strOr(care.languageEmoji, "💝"),
      examples: Array.isArray(care.examples)
        ? care.examples.filter(s => typeof s === "string" && s.trim()).map(s => s.trim()).join(". ")
        : strOr(care.examples),
      score: clampScore(care.score, 5),
    },
    energy: {
      netScore: clampScore(energy.netScore, 5),
      type: normalizeEnergyType(strOr(energy.type, "mixed")),
      goodNews: strOr(energy.goodNews),
      venting: strOr(energy.venting, "minimal venting"),
      hypeQuote: strOr(energy.hypeQuote),
    },
  };
}

function normalizeCorePersonB(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const health = safe.health && typeof safe.health === "object" ? safe.health : {};
  const accountability = safe.accountability && typeof safe.accountability === "object" ? safe.accountability : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    health: {
      score: clampScore(health.score, 5),
      detail: strOr(health.detail),
      apologyCount: Math.max(0, Math.round(Number(health.apologyCount) || 0)),
      apologyContext: strOr(health.apologyContext),
    },
    accountability: {
      total: Math.max(0, Math.round(Number(accountability.total) || 0)),
      kept: Math.max(0, Math.round(Number(accountability.kept) || 0)),
      broken: Math.max(0, Math.round(Number(accountability.broken) || 0)),
      score: clampScore(accountability.score, 5),
      detail: strOr(accountability.detail),
    },
  };
}

function normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const growth = shared.growth && typeof shared.growth === "object" ? shared.growth : {};
  const lockedRelationshipCategory = coerceRelationshipCategory(
    relationshipContext?.category,
    relationshipType,
    relationshipContext?.category || relationshipType || "other"
  );
  const lockedRelationshipSpecific = coerceRelationshipSpecificLabel(
    relationshipContext?.specificRelationship,
    lockedRelationshipCategory
  );
  const sanitizedRelationshipStatus = sanitizeRelationshipStatus(
    shared.relationshipStatus,
    lockedRelationshipCategory,
    lockedRelationshipSpecific
  );
  const relationshipStatusWasAdjusted = sanitizedRelationshipStatus !== strOr(shared.relationshipStatus);
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, math?.isGroup ? Math.min(math?.names?.length || 0, 6) : 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonA(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "a",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
      relationshipCategory: lockedRelationshipCategory || null,
      relationshipSpecific: lockedRelationshipSpecific,
      relationshipConfidence: strOr(relationshipContext?.confidence, "low"),
      relationshipReasoning: strOr(relationshipContext?.reasoning),
      relationshipEvidence: strOr(relationshipContext?.evidence),
      endearmentWarning: strOr(relationshipContext?.endearmentWarning),
    },
    people,
    shared: {
      vibeOneLiner: strOr(shared.vibeOneLiner),
      biggestTopic: strOr(shared.biggestTopic),
      ghostContext: strOr(shared.ghostContext),
      funniestPerson: strOr(shared.funniestPerson),
      funniestReason: strOr(shared.funniestReason),
      dramaStarter: strOr(shared.dramaStarter),
      dramaContext: strOr(shared.dramaContext),
      signaturePhrases: cleanStringArray(shared.signaturePhrases, 2),
      relationshipStatus: sanitizedRelationshipStatus,
      relationshipStatusWhy: relationshipStatusWasAdjusted
        ? strOr(relationshipContext?.reasoning, `Use the user-selected relationship type "${lockedRelationshipCategory}" as the framing for this chat.`)
        : strOr(shared.relationshipStatusWhy),
      statusEvidence: relationshipStatusWasAdjusted
        ? strOr(shared.statusEvidence || relationshipContext?.evidence)
        : strOr(shared.statusEvidence),
      toxicPerson: strOr(shared.toxicPerson),
      toxicReason: strOr(shared.toxicReason),
      toxicityReport: strOr(shared.toxicityReport),
      redFlags: normalizeRedFlags(shared.redFlags),
      evidenceTimeline: normalizeTimeline(shared.evidenceTimeline),
      relationshipSummary: strOr(shared.relationshipSummary),
      groupDynamic: strOr(shared.groupDynamic),
      tensionMoment: strOr(shared.tensionMoment),
      kindestPerson: strOr(shared.kindestPerson),
      sweetMoment: strOr(shared.sweetMoment),
      mostMissed: strOr(shared.mostMissed),
      insideJoke: strOr(shared.insideJoke),
      hypePersonReason: strOr(shared.hypePersonReason),
      loveLanguageMismatch: strOr(shared.loveLanguageMismatch),
      mostLovingMoment: strOr(shared.mostLovingMoment),
      compatibilityScore: clampScore(shared.compatibilityScore, 5),
      compatibilityRead: strOr(shared.compatibilityRead),
      mostEnergising: strOr(shared.mostEnergising),
      mostDraining: strOr(shared.mostDraining),
      energyCompatibility: strOr(shared.energyCompatibility),
      memorableMoments: normalizeMemorableMoments(shared.memorableMoments),
      growth: {
        thenDepth: strOr(growth.thenDepth),
        nowDepth: strOr(growth.nowDepth),
        depthChange: normalizeDepthChange(strOr(growth.depthChange)),
        whoChangedMore: strOr(growth.whoChangedMore),
        whoChangedHow: strOr(growth.whoChangedHow),
        topicsAppeared: strOr(growth.topicsAppeared),
        topicsDisappeared: strOr(growth.topicsDisappeared),
        trajectory: normalizeTrajectory(strOr(growth.trajectory)),
        trajectoryDetail: strOr(growth.trajectoryDetail),
        arcSummary: strOr(growth.arcSummary),
      },
    },
  };
}

function normalizeConnectionDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
    part: "connection",
  };
}

function normalizeGrowthDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
    part: "growth",
  };
}

function normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const toxicity = shared.toxicity && typeof shared.toxicity === "object" ? shared.toxicity : {};
  const accountability = shared.accountability && typeof shared.accountability === "object" ? shared.accountability : {};
  const lockedRelationshipCategory = coerceRelationshipCategory(
    relationshipContext?.category,
    relationshipType,
    relationshipContext?.category || relationshipType || "other"
  );
  const lockedRelationshipSpecific = coerceRelationshipSpecificLabel(
    relationshipContext?.specificRelationship,
    lockedRelationshipCategory
  );
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonB(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "b",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
      relationshipCategory: lockedRelationshipCategory || null,
      relationshipSpecific: lockedRelationshipSpecific,
      relationshipConfidence: strOr(relationshipContext?.confidence, "low"),
      relationshipReasoning: strOr(relationshipContext?.reasoning),
      relationshipEvidence: strOr(relationshipContext?.evidence),
      endearmentWarning: strOr(relationshipContext?.endearmentWarning),
    },
    people,
    shared: {
      toxicity: {
        chatHealthScore: clampScore(toxicity.chatHealthScore, 5),
        healthScores: normalizeNamedScoreRows(toxicity.healthScores),
        apologiesLeader: normalizeApologySummary(toxicity.apologiesLeader),
        apologiesOther: normalizeApologySummary(toxicity.apologiesOther),
        redFlagMoments: normalizeMomentRows(toxicity.redFlagMoments, 5),
        conflictPattern: strOr(toxicity.conflictPattern),
        powerBalance: strOr(toxicity.powerBalance),
        powerHolder: strOr(toxicity.powerHolder, "Balanced"),
        verdict: strOr(toxicity.verdict),
      },
      accountability: {
        notableBroken: normalizePromiseMoment(accountability.notableBroken),
        notableKept: normalizePromiseMoment(accountability.notableKept),
        comparison: strOr(accountability.comparison),
        followThroughPattern: strOr(accountability.followThroughPattern),
        evidenceQuality: strOr(accountability.evidenceQuality),
        overallVerdict: strOr(accountability.overallVerdict),
      },
    },
  };
}

function normalizeRiskDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
    part: "risk",
  };
}

function attachReportMeta(report, relationshipType, coreAnalysis = null) {
  return {
    ...(report && typeof report === "object" ? report : {}),
    relationshipType: relationshipType ?? null,
    relationshipSpecific: coreAnalysis?.meta?.relationshipSpecific || null,
    relationshipConfidence: coreAnalysis?.meta?.relationshipConfidence || null,
    relationshipEvidence: coreAnalysis?.meta?.relationshipEvidence || null,
    relationshipReasoning: coreAnalysis?.meta?.relationshipReasoning || null,
    ...(coreAnalysis ? { coreAnalysis } : {}),
  };
}

function pickCorePairA(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonA(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonA(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function pickCorePairB(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonB(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonB(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function deriveGeneralReportFromCore(core, math, relationshipType) {
  const shared = core?.shared || {};
  return attachReportMeta({
    funniestPerson: shared.funniestPerson || math?.funniestPerson || "",
    funniestReason: shared.funniestReason,
    ghostContext: shared.ghostContext,
    biggestTopic: shared.biggestTopic,
    dramaStarter: shared.dramaStarter,
    dramaContext: shared.dramaContext,
    signaturePhrase: shared.signaturePhrases?.length ? shared.signaturePhrases : undefined,
    relationshipStatus: shared.relationshipStatus,
    relationshipStatusWhy: shared.relationshipStatusWhy,
    statusEvidence: shared.statusEvidence,
    toxicPerson: shared.toxicPerson,
    toxicReason: shared.toxicReason,
    evidenceTimeline: shared.evidenceTimeline,
    redFlags: shared.redFlags,
    toxicityReport: shared.toxicityReport,
    relationshipSummary: shared.relationshipSummary,
    tensionMoment: shared.tensionMoment,
    kindestPerson: shared.kindestPerson,
    sweetMoment: shared.sweetMoment,
    vibeOneLiner: shared.vibeOneLiner,
    groupDynamic: shared.groupDynamic,
    mostMissed: shared.mostMissed,
    insideJoke: shared.insideJoke,
    hypePersonReason: shared.hypePersonReason,
    memorableMoments: shared.memorableMoments,
  }, relationshipType, core);
}

function deriveEnergyReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      netScore: personA.energy.netScore,
      type: personA.energy.type,
      goodNews: personA.energy.goodNews,
      venting: personA.energy.venting,
      hypeQuote: personA.energy.hypeQuote,
    },
    personB: {
      name: personB.name,
      netScore: personB.energy.netScore,
      type: personB.energy.type,
      goodNews: personB.energy.goodNews,
      venting: personB.energy.venting,
      hypeQuote: personB.energy.hypeQuote,
    },
    mostEnergising: shared.mostEnergising,
    mostDraining: shared.mostDraining,
    compatibility: shared.energyCompatibility,
  }, relationshipType, core);
}

function deriveToxicityReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const shared = core?.shared || {};
  const toxicity = shared.toxicity || {};
  const healthScores = toxicity.healthScores?.length
    ? toxicity.healthScores
    : [personA, personB].map(person => ({
        name: person.name,
        score: person.health.score,
        detail: person.health.detail,
      }));

  const apologyLeader = toxicity.apologiesLeader?.name && toxicity.apologiesLeader.name !== "None clearly identified"
    ? toxicity.apologiesLeader
    : (personA.health.apologyCount >= personB.health.apologyCount
        ? { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext }
        : { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext });
  const apologyOther = toxicity.apologiesOther?.name && toxicity.apologiesOther.name !== "None clearly identified"
    ? toxicity.apologiesOther
    : (apologyLeader.name === personA.name
        ? { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext }
        : { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext });

  return attachReportMeta({
    chatHealthScore: toxicity.chatHealthScore,
    healthScores,
    apologiesLeader: apologyLeader,
    apologiesOther: apologyOther,
    redFlagMoments: toxicity.redFlagMoments,
    conflictPattern: toxicity.conflictPattern,
    powerBalance: toxicity.powerBalance,
    powerHolder: toxicity.powerHolder,
    verdict: toxicity.verdict,
  }, relationshipType, core);
}

function deriveLoveLangReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      language: personA.careStyle.language,
      languageEmoji: personA.careStyle.languageEmoji,
      examples: personA.careStyle.examples,
      score: personA.careStyle.score,
    },
    personB: {
      name: personB.name,
      language: personB.careStyle.language,
      languageEmoji: personB.careStyle.languageEmoji,
      examples: personB.careStyle.examples,
      score: personB.careStyle.score,
    },
    mismatch: shared.loveLanguageMismatch,
    mostLovingMoment: shared.mostLovingMoment,
    compatibilityScore: shared.compatibilityScore,
    compatibilityRead: shared.compatibilityRead,
  }, relationshipType, core);
}

function deriveGrowthReportFromCore(core, math, relationshipType) {
  const growth = core?.shared?.growth || {};
  return attachReportMeta({
    thenDepth: growth.thenDepth,
    nowDepth: growth.nowDepth,
    depthChange: growth.depthChange,
    whoChangedMore: growth.whoChangedMore,
    whoChangedHow: growth.whoChangedHow,
    topicsAppeared: growth.topicsAppeared,
    topicsDisappeared: growth.topicsDisappeared,
    trajectory: growth.trajectory,
    trajectoryDetail: growth.trajectoryDetail,
    arcSummary: growth.arcSummary,
  }, relationshipType, core);
}

function deriveAccountaReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const accountability = core?.shared?.accountability || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      total: personA.accountability.total,
      kept: personA.accountability.kept,
      broken: personA.accountability.broken,
      score: personA.accountability.score,
      detail: personA.accountability.detail,
    },
    personB: {
      name: personB.name,
      total: personB.accountability.total,
      kept: personB.accountability.kept,
      broken: personB.accountability.broken,
      score: personB.accountability.score,
      detail: personB.accountability.detail,
    },
    notableBroken: accountability.notableBroken,
    notableKept: accountability.notableKept,
    comparison: accountability.comparison,
    followThroughPattern: accountability.followThroughPattern,
    evidenceQuality: accountability.evidenceQuality,
    overallVerdict: accountability.overallVerdict,
  }, relationshipType, core);
}

function hasMeaningfulString(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "—" && text !== "..." && text !== "…");
}

function countMeaningfulStrings(values) {
  return values.filter(hasMeaningfulString).length;
}

function hasMeaningfulAnalysisResult(type, result) {
  if (!result || typeof result !== "object") return false;

  switch (type) {
    case "general":
      return countMeaningfulStrings([
        result.vibeOneLiner,
        result.biggestTopic,
        result.ghostContext,
        result.funniestReason,
        result.dramaContext,
        result.relationshipSummary,
        result.groupDynamic,
        result.tensionMoment,
        result.sweetMoment,
      ]) >= 3;
    case "toxicity":
      return countMeaningfulStrings([
        result.verdict,
        result.conflictPattern,
        result.powerBalance,
        result.apologiesLeader?.context,
        result.apologiesOther?.context,
        ...(result.redFlagMoments || []).flatMap(item => [item?.description, item?.quote]),
        ...(result.healthScores || []).map(item => item?.detail),
      ]) >= 3;
    case "lovelang":
      return countMeaningfulStrings([
        result.personA?.examples,
        result.personB?.examples,
        result.mismatch,
        result.mostLovingMoment,
        result.compatibilityRead,
      ]) >= 2;
    case "growth":
      return countMeaningfulStrings([
        result.thenDepth,
        result.nowDepth,
        result.whoChangedHow,
        result.topicsAppeared,
        result.topicsDisappeared,
        result.trajectoryDetail,
        result.arcSummary,
      ]) >= 3;
    case "accounta":
      return countMeaningfulStrings([
        result.personA?.detail,
        result.personB?.detail,
        result.notableBroken?.promise,
        result.notableKept?.promise,
        result.comparison,
        result.followThroughPattern,
        result.evidenceQuality,
        result.overallVerdict,
      ]) >= 2;
    case "energy":
      return countMeaningfulStrings([
        result.personA?.goodNews,
        result.personA?.venting,
        result.personB?.goodNews,
        result.personB?.venting,
        result.mostEnergising,
        result.mostDraining,
        result.compatibility,
      ]) >= 3;
    default:
      return false;
  }
}

async function generateCoreAnalysisA(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = math.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareCoreAnalysisARequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    buildSampleText,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[CoreA] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
}

async function generateConnectionDigest(messages, math, relationshipType, chatLang = "en", options = {}) {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const energyFocus = options?.energyFocus === true;
  const request = prepareConnectionDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    buildSampleText: energyFocus ? buildEnergySampleText : buildSampleText,
    extraConnectionRules: energyFocus
      ? "ENERGY QUOTES: Choose quotes that clearly reflect the emotional tone. For positive energy examples, avoid sexual, sarcastic, awkward, or irrelevant messages."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[ConnectionDigest] chatLang:", chatLang, "| energyFocus:", energyFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeConnectionDigest(raw, math, relationshipType, relationshipContext);
}

async function generateGrowthDigest(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareGrowthDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[GrowthDigest] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeGrowthDigest(raw, math, relationshipType, relationshipContext);
}

async function generateCoreAnalysisB(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareCoreAnalysisBRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt,
    buildRelationshipLine,
    buildSampleText,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_B_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[CoreB] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext);
}

async function generateRiskDigest(messages, math, relationshipType, chatLang = "en", options = {}) {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const accountabilityFocus = options?.accountabilityFocus === true;
  const request = prepareRiskDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt,
    buildRelationshipLine,
    buildSampleText: accountabilityFocus ? buildAccountabilitySampleText : buildSampleText,
    extraRiskRules: accountabilityFocus
      ? "ACCOUNTABILITY FOCUS: Prioritize concrete promise, follow-through, delay, cancellation, apology, excuse, and follow-up windows. For notableBroken and notableKept, pick only meaningful commitments with clear evidence. If no strong broken promise exists, set person to \"None clearly identified\", leave promise/date/outcome plain and non-dramatic, and explain that the chat does not show a clear broken commitment. Make comparison, followThroughPattern, evidenceQuality, and overallVerdict fair to both people and honest about weak evidence."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_B_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[RiskDigest] chatLang:", chatLang, "| accountabilityFocus:", accountabilityFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeRiskDigest(raw, math, relationshipType, relationshipContext);
}

async function generateTrialDigest(messages, math, relType) {
  const { system, userContent, maxTokens } = buildTrialPrompt(messages, math, relType, buildSampleText);
  const raw = await callClaude(system, userContent, maxTokens, "json");
  return deriveTrialReport(raw, math, relType);
}

async function aiAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGeneralReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiToxicityAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveToxicityReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI toxicity failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiLoveLangAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveLoveLangReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI love language failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiGrowthAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateGrowthDigest(messages, math, relationshipType);
    return deriveGrowthReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI growth failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiAccountaAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveAccountaReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI accountability failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiEnergyAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveEnergyReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI energy failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

function getAnalysisFamilyCacheKey(math, relationshipType, family = "core", chatLang = "en") {
  return [
    `core-cache-v${CORE_ANALYSIS_CACHE_VERSION}`,
    family || "core",
    math?.isGroup ? "group" : "duo",
    relationshipType || "none",
    chatLang || "en",
    math?.totalMessages || 0,
    ...(math?.names || []),
  ].join("::");
}

const REPORT_PIPELINES = {
  general:      { strategy: "family", family: "connection", derive: deriveGeneralReportFromCore },
  toxicity:     { strategy: "family", family: "risk",       derive: deriveToxicityReportFromCore },
  lovelang:     { strategy: "family", family: "connection", derive: deriveLoveLangReportFromCore },
  growth:       { strategy: "family", family: "growth",     derive: deriveGrowthReportFromCore },
  accounta:     { strategy: "family", family: "risk",       derive: deriveAccountaReportFromCore },
  energy:       { strategy: "family", family: "connection", derive: deriveEnergyReportFromCore },
  trial_report: { strategy: "trial" },
};

const STORED_RESULT_META_KEYS = new Set(["translations", "displayLanguage", "sourceLanguage", "analysisCacheVersion"]);

const REPORT_TRANSLATION_FIELDS = {
  general: [
    "vibeOneLiner",
    "biggestTopic",
    "ghostContext",
    "funniestReason",
    "dramaContext",
    "relationshipStatus",
    "relationshipStatusWhy",
    "statusEvidence",
    "toxicReason",
    "toxicityReport",
    "relationshipSummary",
    "groupDynamic",
    "tensionMoment",
    "sweetMoment",
    "mostMissed",
    "insideJoke",
    "hypePersonReason",
  ],
  toxicity: [
    "apologiesLeader.context",
    "apologiesOther.context",
    "conflictPattern",
    "powerBalance",
    "verdict",
  ],
  lovelang: [
    "personA.examples",
    "personB.examples",
    "mismatch",
    "mostLovingMoment",
    "compatibilityRead",
  ],
  growth: [
    "thenDepth",
    "nowDepth",
    "whoChangedHow",
    "topicsAppeared",
    "topicsDisappeared",
    "trajectoryDetail",
    "arcSummary",
  ],
  accounta: [
    "personA.detail",
    "personB.detail",
    "notableBroken.promise",
    "notableBroken.outcome",
    "notableKept.promise",
    "notableKept.outcome",
    "comparison",
    "followThroughPattern",
    "evidenceQuality",
    "overallVerdict",
  ],
  energy: [
    "personA.goodNews",
    "personA.venting",
    "personB.goodNews",
    "personB.venting",
    "mostEnergising",
    "mostDraining",
    "compatibility",
  ],
};

const REPORT_TRANSLATION_ARRAY_FIELDS = {
  general: [
    { path: "redFlags", fields: ["title", "detail", "evidence"] },
    { path: "evidenceTimeline", fields: ["title", "detail"] },
  ],
  toxicity: [
    { path: "healthScores", fields: ["detail"] },
    { path: "redFlagMoments", fields: ["description"] },
  ],
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripStoredResultMeta(result) {
  if (!isPlainObject(result)) return {};
  const next = {};
  Object.entries(result).forEach(([key, value]) => {
    if (!STORED_RESULT_META_KEYS.has(key)) next[key] = value;
  });
  return next;
}

function getStoredResultTranslations(result) {
  return isPlainObject(result?.translations) ? result.translations : {};
}

function getStoredResultDisplayLanguage(result) {
  const code = normalizeUiLangCode(result?.displayLanguage || result?.sourceLanguage || "en");
  return LANG_META[code] ? code : "en";
}

function getByPath(source, path) {
  return path.split(".").reduce((acc, part) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(part)) return acc[Number(part)];
    return acc[part];
  }, source);
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isLeaf = i === parts.length - 1;
    const key = /^\d+$/.test(part) ? Number(part) : part;

    if (isLeaf) {
      cursor[key] = value;
      return target;
    }

    const nextIsIndex = /^\d+$/.test(nextPart || "");
    if (cursor[key] == null) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key];
  }
  return target;
}

function mergeTranslatedResult(base, overlay) {
  if (overlay == null) return base;
  if (typeof overlay !== "object") return overlay;

  if (Array.isArray(overlay)) {
    const source = Array.isArray(base) ? [...base] : [];
    overlay.forEach((item, index) => {
      source[index] = mergeTranslatedResult(source[index], item);
    });
    return source;
  }

  const source = isPlainObject(base) ? { ...base } : {};
  Object.entries(overlay).forEach(([key, value]) => {
    source[key] = mergeTranslatedResult(source[key], value);
  });
  return source;
}

function buildStoredResultData(baseResult, displayLanguage = "en", translationOverlay = null, sourceLanguage = "en") {
  const canonical = stripStoredResultMeta(baseResult);
  const lang = normalizeUiLangCode(displayLanguage);
  const sourceLang = normalizeUiLangCode(sourceLanguage);
  const translations = {};
  if (lang !== "en" && isPlainObject(translationOverlay) && Object.keys(translationOverlay).length) {
    translations[lang] = translationOverlay;
  }
  return {
    ...canonical,
    sourceLanguage: sourceLang,
    displayLanguage: lang,
    analysisCacheVersion: CORE_ANALYSIS_CACHE_VERSION,
    translations,
  };
}

function getDisplayResultData(result, preferredLanguage = null) {
  const canonical = stripStoredResultMeta(result);
  const translations = getStoredResultTranslations(result);
  const lang = normalizeUiLangCode(preferredLanguage || getStoredResultDisplayLanguage(result));
  const overlay = isPlainObject(translations[lang]) ? translations[lang] : null;
  return {
    ...mergeTranslatedResult(canonical, overlay),
    sourceLanguage: normalizeUiLangCode(result?.sourceLanguage || "en"),
    displayLanguage: overlay ? lang : normalizeUiLangCode(result?.sourceLanguage || "en"),
    translations,
  };
}

function pushTranslationEntry(entries, path, value) {
  const text = strOr(value);
  if (!text) return;
  entries.push({ path, text });
}

function collectResultTranslationEntries(reportType, result) {
  const canonical = stripStoredResultMeta(result);
  const entries = [];

  (REPORT_TRANSLATION_FIELDS[reportType] || []).forEach(path => {
    pushTranslationEntry(entries, path, getByPath(canonical, path));
  });

  (REPORT_TRANSLATION_ARRAY_FIELDS[reportType] || []).forEach(({ path, fields }) => {
    const list = getByPath(canonical, path);
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      fields.forEach(field => pushTranslationEntry(entries, `${path}.${index}.${field}`, item?.[field]));
    });
  });

  return entries;
}

function normalizeTranslatedEntries(raw, sourceEntries) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const fallbackByPath = Object.fromEntries(sourceEntries.map(item => [item.path, item.text]));
  return items.map(item => {
    const path = strOr(item?.path);
    if (!path || !(path in fallbackByPath)) return null;
    const text = strOr(item?.text, fallbackByPath[path]);
    return { path, text };
  }).filter(Boolean);
}

function buildTranslationOverlay(entries) {
  return entries.reduce((overlay, item) => setByPath(overlay, item.path, item.text), {});
}

async function translateResultOverlay(reportType, result, targetLang = "en") {
  const lang = normalizeUiLangCode(targetLang);
  if (!LANG_META[lang] || lang === "en") return null;

  const sourceEntries = collectResultTranslationEntries(reportType, result);
  if (!sourceEntries.length) return null;

  const system = [
    "You translate saved WrapChat report text into the target language.",
    "Return only valid JSON in the exact schema requested.",
    "Keep every path value mapped to the same path.",
    "Translate natural-language explanations into the target language.",
    "Preserve the original WrapChat tone: specific, natural, lightly playful, and spoken-flow.",
    "Do not make translations more formal, therapeutic, academic, or dramatic.",
    "Do not add the em dash punctuation mark.",
    "Preserve names exactly as written.",
    "If a value contains a direct quote from the chat, keep the quote itself as-is and only translate the surrounding explanation if needed.",
  ].join(" ");

  const userContent = `Target language: ${LANG_META[lang]} (${lang})

Translate the following WrapChat report text fields into ${LANG_META[lang]}. Keep every "path" exactly the same. Return exactly this JSON shape:
{
  "items": [
    { "path": "field.path", "text": "translated text" }
  ]
}

Source items:
${JSON.stringify(sourceEntries, null, 2)}`;

  const raw = await callClaude(system, userContent, 1800, "json");
  const translatedEntries = normalizeTranslatedEntries(raw, sourceEntries);
  if (!translatedEntries.length) return null;
  return buildTranslationOverlay(translatedEntries);
}

// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES  — bold rounded-card aesthetic
// ─────────────────────────────────────────────────────────────────

// Category accent colors — used for inner cards
const PAL = {
  roast:    { bg:"#B83A10", inner:"#E8592A", text:"#fff", accent:"#FF8B6A" },
  lovely:   { bg:"#7A1C48", inner:"#A02860", text:"#fff", accent:"#F08EBF" },
  funny:    { bg:"#4A6A04", inner:"#6E9A08", text:"#fff", accent:"#C8F06A" },
  stats:    { bg:"#083870", inner:"#0E5AAA", text:"#fff", accent:"#6AB4F0" },
  ai:       { bg:"#1A3060", inner:"#2A4A90", text:"#fff", accent:"#8AACF0" },
  finale:   { bg:"#5E1228", inner:"#8A1C3C", text:"#fff", accent:"#F08EBF" },
  upload:   { bg:"#2A1969", inner:"#3D2090", text:"#fff", accent:"#A08AF0" },
  general:  { bg:"#1C0E5A", inner:"#361A96", text:"#fff", accent:"#9B72FF" },
  toxicity: { bg:"#3A0808", inner:"#8A1A1A", text:"#fff", accent:"#FF3C40" },
  lovelang: { bg:"#3D1A2E", inner:"#8B3A5A", text:"#fff", accent:"#FF82B8" },
  growth:   { bg:"#0A2E2E", inner:"#1A6B5A", text:"#fff", accent:"#28EAA8" },
  accounta: { bg:"#0A1A3D", inner:"#1A3A8B", text:"#fff", accent:"#5AADFF" },
  energy:   { bg:"#2E1A0A", inner:"#8B5A1A", text:"#fff", accent:"#FFA030" },
  trial:    { bg:"#0C0D30", inner:"#1A1E72", text:"#fff", accent:"#7A90FF" },
};

const PILL_LABEL = {
  roast:"The Roast", lovely:"The Lovely", funny:"The Funny", stats:"The Stats", ai:"Insight", finale:"WrapChat",
  toxicity:"Toxicity Report", lovelang:"Love Language", growth:"Growth Report", accounta:"Accountability", energy:"Energy Report",
  trial:"Quick Read",
};



function canShareFiles(files) {
  if (!navigator?.share || !files?.length) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't create share image."));
    }, "image/png");
  });
}

function getShareCaptureHeight(el) {
  const rect = el.getBoundingClientRect();
  const panes = Array.from(el.querySelectorAll(".wc-pane"));
  const paneHeight = panes.reduce((max, pane) => Math.max(max, pane.scrollHeight || 0), 0);
  return Math.ceil(Math.max((rect.height || 0) + 72, (el.scrollHeight || 0) + 72, paneHeight + 150));
}

async function waitForShareAssets(el) {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Continue: default fonts are better than a failed share.
    }
  }
  const images = Array.from(el.querySelectorAll("img"));
  await Promise.all(images.map(async img => {
    if (img.complete && img.naturalWidth) return;
    if (typeof img.decode === "function") {
      try {
        await img.decode();
        return;
      } catch {
        // Fall back to load/error listeners below.
      }
    }
    await new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }));
}

async function buildTintedShareLogoMarkup(logoSrc, accentColor) {
  if (!logoSrc) return "";
  try {
    const response = await fetch(logoSrc);
    if (!response.ok) return "";
    const svgText = await response.text();
    return svgText
      .replace(/#6cb9e0/gi, accentColor || "#6cb9e0")
      .replace(/<\?xml[^>]*\?>\s*/i, "")
      .replace(/<svg\b/i, '<svg width="34" height="30"');
  } catch {
    return "";
  }
}

// Captures the active card or summary as a clean PNG.
// Targets the active card or hidden summary render, strips UI chrome, and adds a branded footer.
async function buildShareCanvas(type, logoSrc) {
  const el = document.querySelector(`[data-share-capture="${type}"] .wc-root`)
    || document.querySelector(`[data-share-type="${type}"]`)
    || document.querySelector(".wc-root");
  if (!el) return null;
  await waitForShareAssets(el);

  const rect = el.getBoundingClientRect();
  const width = Math.ceil(rect.width || 420);
  const height = getShareCaptureHeight(el);
  const accentColor = el.dataset.shareAccent || "#6cb9e0";
  const tintedLogoMarkup = await buildTintedShareLogoMarkup(logoSrc, accentColor);
  el.setAttribute("data-share-active", "true");

  try {
    return await html2canvas(el, {
      backgroundColor: null,
      scale: window.devicePixelRatio || 2,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll("[data-share-hide]").forEach(n => { n.style.display = "none"; });
        const root = clonedDoc.querySelector('[data-share-active="true"]');
        if (!root) return;

        const captureStyles = clonedDoc.createElement("style");
        captureStyles.textContent = `
          [data-share-active="true"],
          [data-share-active="true"] * {
            animation: none !important;
            transition: none !important;
          }
          [data-share-active="true"] .wc-fadeup,
          [data-share-active="true"] .wc-fadeup-2,
          [data-share-active="true"] .wc-fadeup-3 {
            opacity: 1 !important;
            transform: none !important;
          }
          [data-share-active="true"] .wc-pane {
            opacity: 1 !important;
            visibility: visible !important;
          }
        `;
        clonedDoc.head.appendChild(captureStyles);

        Object.assign(root.style, {
          width: `${width}px`,
          height: `${height}px`,
          minHeight: `${height}px`,
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
          borderRadius: "32px",
        });

        root.querySelectorAll(".wc-body").forEach(body => {
          Object.assign(body.style, {
            flex: "1 1 auto",
            minHeight: "auto",
            height: "auto",
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          });
        });

        root.querySelectorAll(".wc-pane").forEach(pane => {
          Object.assign(pane.style, {
            position: "relative",
            inset: "auto",
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: "100%",
            height: "auto",
            overflow: "visible",
            transform: "none",
            animation: "none",
            transition: "none",
            willChange: "auto",
          });
        });

        const brand = clonedDoc.createElement("div");
        Object.assign(brand.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          flex: "0 0 auto",
          padding: "8px 20px 26px",
          pointerEvents: "none",
        });
        if (tintedLogoMarkup) {
          const logoWrap = clonedDoc.createElement("div");
          logoWrap.innerHTML = tintedLogoMarkup;
          Object.assign(logoWrap.style, {
            width: "34px",
            height: "30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          });
          const svg = logoWrap.querySelector("svg");
          if (svg) {
            svg.setAttribute("aria-hidden", "true");
            Object.assign(svg.style, {
              display: "block",
              width: "34px",
              height: "30px",
            });
          }
          brand.appendChild(logoWrap);
        }
        root.appendChild(brand);
      },
    });
  } finally {
    el.removeAttribute("data-share-active");
  }
}

function SharePicker({ open, busy, onCard, onSummary, onClose }) {
  if (!open) return null;
  const btnStyle = {
    flex: 1,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: "20px 0",
    color: "#fff",
    cursor: busy ? "wait" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  };
  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}
    >
      <div
        style={{ width:"min(420px,100%)", background:"#111118", border:"1px solid rgba(255,255,255,0.10)", borderRadius:"28px 28px 0 0", padding:"10px 20px 32px", boxShadow:"0 -20px 60px rgba(0,0,0,0.5)", color:"#fff" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width:36, height:4, borderRadius:999, background:"rgba(255,255,255,0.14)", margin:"0 auto 20px" }} />
        <div style={{ fontSize:18, fontWeight:800, letterSpacing:-0.5, marginBottom:16 }}>Share</div>
        <div style={{ display:"flex", gap:12 }}>
          <button className="wc-btn" onClick={onCard} disabled={busy} style={btnStyle}>
            <img src={cardShareIcon} alt="" aria-hidden="true" style={{ width:32, height:32, objectFit:"contain", filter:"brightness(0) invert(1)", opacity: busy ? 0.4 : 0.9 }} />
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Card"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Current screen</span>
          </button>
          <button className="wc-btn" onClick={onSummary} disabled={busy} style={btnStyle}>
            <img src={sumShareIcon} alt="" aria-hidden="true" style={{ width:32, height:32, objectFit:"contain", filter:"brightness(0) invert(1)", opacity: busy ? 0.4 : 0.9 }} />
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Summary"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Results overview</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Converts AI health score (1–10, higher = healthier) to a display label.
// Prefer this over local math toxicityLevel whenever AI data is available.
function chatHealthLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return n >= 7 ? "Healthy" : n >= 4 ? "Tense" : "Heated";
}

// ─────────────────────────────────────────────────────────────────
// REPORT TYPES — shown on the report selection screen
// ─────────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { id:"general",      label:"General Wrapped",       desc:"The full Wrapped-style deep dive — stats, AI insights, and your chat personality.",         palette:"general"  },
  { id:"toxicity",     label:"Toxicity Report",        desc:"Red flags, power imbalances, who apologises more, conflict patterns, health scores.",        palette:"toxicity" },
  { id:"lovelang",     label:"Love Language Report",   desc:"How each person shows affection, mapped to the 5 love languages. Works for friends too.",   palette:"lovelang" },
  { id:"growth",       label:"Growth Report",          desc:"First 3 months vs last 3 months — are you growing together or drifting apart?",             palette:"growth"   },
  { id:"accounta",     label:"Accountability Report",  desc:"Promises made in the chat and whether they were followed through. Receipts for both.",       palette:"accounta" },
  { id:"energy",       label:"Energy Report",          desc:"Who brings good energy vs drains it — net energy score per person.",                         palette:"energy"   },
  { id:"trial_report", label:"Quick Read",             desc:"A quick onboarding gift — vibe, communication pattern, and one key insight.",             palette:"trial"    },
];

const PACK_DEFS = Object.freeze({
  vibe: Object.freeze({
    id: "vibe",
    bundleId: "connection",
    name: "Vibe Pack",
    overline: "analysis",
    desc: "How you two actually connect — your communication style, love language, and the energy you bring each other.",
    reports: Object.freeze(["general", "lovelang", "energy"]),
    tags: Object.freeze(["General Wrapped", "Love Language", "Energy"]),
    cost: REPORT_PACKS.vibe.cost,
    bg: "#2A1460",
    cardBg: "#1E0E48",
    listBg: "#2A1460",
    accent: "#C4AAFF",
    listAccent: "#C4AAFF",
    fg: "#100630",
    inner: "#1E0E48",
    paymentSelectedBg: "#2A1460",
    paymentSelectedBorder: "rgba(196,170,255,0.62)",
  }),
  rf: Object.freeze({
    id: "rf",
    bundleId: "tension",
    name: "Red Flags Pack",
    desc: "What's actually happening under the surface — tension patterns, accountability gaps, and the hard stuff.",
    reports: Object.freeze(["toxicity", "accounta"]),
    tags: Object.freeze(["Toxicity", "Accountability"]),
    cost: REPORT_PACKS.rf.cost,
    bg: "#420C28",
    cardBg: "#32081E",
    listBg: "#420C28",
    accent: "#BE2050",
    listAccent: "#BE2050",
    fg: "#fff",
    inner: "#32081E",
    paymentSelectedBg: "#420C28",
    paymentSelectedBorder: "rgba(190,32,80,0.58)",
  }),
  full: Object.freeze({
    id: "full",
    bundleId: "full",
    name: "Full Read",
    desc: "Every report in one go — connection, tension, and growth. The complete picture of this chat.",
    reports: Object.freeze(["general", "lovelang", "energy", "toxicity", "accounta", "growth"]),
    tags: Object.freeze(["Vibe Pack", "Red Flags", "Growth"]),
    cost: REPORT_PACKS.full.cost,
    bg: "#382208",
    cardBg: "#281808",
    listBg: "#382208",
    accent: "#C8962A",
    listAccent: "#C8962A",
    fg: "#1a0e00",
    inner: "#281808",
    paymentSelectedBg: "#382208",
    paymentSelectedBorder: "rgba(200,150,42,0.58)",
  }),
  growth: Object.freeze({
    id: "growth",
    bundleId: null,
    name: "Growth Report",
    desc: "Standalone temporal analysis — how this chat has changed from early days to now.",
    reports: Object.freeze(["growth"]),
    tags: Object.freeze(["Growth"]),
    cost: REPORT_PACKS.growth.cost,
    bg: "#0E3A1E",
    cardBg: "#0A2C16",
    listBg: "#0E3A1E",
    accent: "#3DC87A",
    listAccent: "#3DC87A",
    fg: "#062e26",
    inner: "#0A2C16",
    paymentSelectedBg: "#0E3A1E",
    paymentSelectedBorder: "rgba(61,200,122,0.55)",
  }),
});

const PACK_ORDER = REPORT_PACK_ORDER;

const REPORT_BUFFER_STYLE = Object.freeze({
  general:  { bg:"#1C0E5A", border:"rgba(155,114,255,0.40)", pillBg:"rgba(155,114,255,0.14)", pillBorder:"rgba(155,114,255,0.32)" },
  lovelang: { bg:"#3D1A2E", border:"rgba(255,130,184,0.38)", pillBg:"rgba(255,130,184,0.14)", pillBorder:"rgba(255,130,184,0.30)" },
  energy:   { bg:"#2E1A0A", border:"rgba(255,160,48,0.35)",  pillBg:"rgba(255,160,48,0.14)",  pillBorder:"rgba(255,160,48,0.28)" },
  toxicity: { bg:"#3A0808", border:"rgba(255,60,64,0.38)",   pillBg:"rgba(255,60,64,0.14)",   pillBorder:"rgba(255,60,64,0.30)" },
  accounta: { bg:"#0A1A3D", border:"rgba(90,173,255,0.35)",  pillBg:"rgba(90,173,255,0.14)",  pillBorder:"rgba(90,173,255,0.28)" },
  growth:   { bg:"#0A2E2E", border:"rgba(40,234,168,0.32)",  pillBg:"rgba(40,234,168,0.14)",  pillBorder:"rgba(40,234,168,0.28)" },
});

function reportTypeMeta(type) {
  return REPORT_TYPES.find(report => report.id === type) || { id:type, label:type, palette:"upload" };
}

function packForReports(types = []) {
  const set = new Set((Array.isArray(types) ? types : [types]).filter(Boolean));
  return PACK_ORDER.map(id => PACK_DEFS[id]).find(pack =>
    pack.reports.length === set.size && pack.reports.every(type => set.has(type))
  ) || null;
}

function packForSavedRows(rows = []) {
  const types = rows.map(row => row.report_type).filter(Boolean);
  return packForReports(types) || (types.length === 1 && types[0] === "growth" ? PACK_DEFS.growth : null);
}

const CREDIT_PACKS = CREDIT_BUNDLES;

function normalizeSelectedReportTypes(types) {
  const selected = new Set(Array.isArray(types) ? types : []);
  return REPORT_TYPES.map(report => report.id).filter(id => selected.has(id));
}

const LEGAL_VERSION = "1.1";

// ─── Legal document text — rendered inline, no external links ───
// Replace the placeholder strings below with the full text from your PDFs.
const TERMS_OF_SERVICE_TEXT = `TERMS OF SERVICE
Version 1.1 — Last updated 2025

PLEASE READ THESE TERMS CAREFULLY BEFORE USING WRAPCHAT.

1. ACCEPTANCE OF TERMS
By accessing or using WrapChat ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

2. DESCRIPTION OF SERVICE
WrapChat is a chat analysis tool that processes chat exports you provide. The Service uses AI to generate reports about communication patterns, relationship dynamics, and related insights from the text you upload.

3. ELIGIBILITY
You must be at least 18 years old to use the Service. By using the Service, you represent that you are at least 18 years of age.

4. YOUR CONTENT
You retain ownership of any chat data you upload. By uploading a chat export, you grant WrapChat a limited licence to process that data for the sole purpose of generating your requested reports. Chat content is analysed in transit and is not stored on our servers beyond what is necessary to produce your results.

5. CONSENT AND THIRD PARTIES
You are responsible for ensuring you have the right to upload any conversation. You should only upload chats in which you are a participant. You must not upload chats belonging to other people without their knowledge and consent. WrapChat is not responsible for any claims arising from your use of third-party data.

6. PROHIBITED USES
You agree not to use the Service to:
- Upload content belonging to others without consent
- Circumvent security or access controls
- Reverse-engineer, copy, or reproduce any part of the Service
- Use the Service for any unlawful purpose
- Attempt to gain unauthorised access to any system or network

7. INTELLECTUAL PROPERTY
All intellectual property rights in the Service, including but not limited to its software, design, and methodology, are owned by WrapChat. Nothing in these Terms grants you any rights in the Service other than the right to use it as expressly set out herein.

8. DISCLAIMER OF WARRANTIES
The Service is provided "as is" and "as available" without any warranties of any kind, express or implied. WrapChat does not warrant that the Service will be uninterrupted, error-free, or that any results generated will be accurate, complete, or reliable.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, WrapChat shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service.

10. CHANGES TO TERMS
WrapChat reserves the right to modify these Terms at any time. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms. Material changes will require explicit re-acceptance.

11. GOVERNING LAW
These Terms shall be governed by and construed in accordance with applicable law. Any disputes shall be resolved through binding arbitration or in the courts of the applicable jurisdiction.

12. CONTACT
For questions about these Terms, contact us at support@wrapchat.app.

By accepting these Terms, you confirm you have read and understood them in full.`;

const PRIVACY_POLICY_TEXT = `PRIVACY POLICY
Version 1.1 — Last updated 2025

This Privacy Policy explains how WrapChat ("we", "us", "our") collects, uses, and protects your information when you use our Service.

1. INFORMATION WE COLLECT

Account Information
When you create an account, we collect your email address, a hashed version of your password, and the display name you provide so we can identify you correctly in uploaded chat exports.

Chat Data
You upload chat exports to generate reports. These chat exports contain messages written by you and other participants. Chat content is transmitted securely and processed solely to generate your requested analysis. Chat text is not stored on our servers after processing is complete.

Usage Data
We may collect anonymised information about how you use the Service, including which report types you generate and general usage patterns. This data cannot be used to identify you and is used only to improve the Service.

Results Data
The reports generated from your analysis (not the underlying chat text) may be stored on your account so you can access them later. You can delete your saved results at any time.

2. HOW WE USE YOUR INFORMATION

We use your information to:
- Provide and operate the Service
- Generate the analysis reports you request
- Maintain and improve the Service
- Communicate with you about your account
- Comply with legal obligations

We do not sell, rent, or share your personal information with third parties for marketing purposes.

3. AI PROCESSING
Your chat content is processed by AI models to generate insights. Excerpts of your chat may be sent to a third-party AI provider (Anthropic) as part of this processing. Anthropic's use of this data is governed by their API usage policies and privacy practices. Chat content processed through the AI pipeline is not used to train AI models under our current agreements.

4. DATA RETENTION
Account data is retained while your account is active. Processed chat content is not retained after your report is generated. Saved report results are retained until you delete them or close your account.

5. DATA SECURITY
We implement industry-standard security measures to protect your data, including encryption in transit (TLS) and at rest. No method of transmission over the internet is 100% secure. We cannot guarantee absolute security but will notify you promptly in the event of a breach affecting your data.

6. YOUR RIGHTS
Depending on your location, you may have rights including:
- Access to the personal data we hold about you
- Correction of inaccurate data
- Deletion of your account and associated data
- Portability of your data in a machine-readable format
- Withdrawal of consent at any time

To exercise these rights, contact us at privacy@wrapchat.app.

7. COOKIES AND TRACKING
The Service uses essential cookies required for authentication and session management. We do not use tracking or advertising cookies.

8. CHILDREN'S PRIVACY
The Service is not directed to individuals under 18. We do not knowingly collect personal information from anyone under 18. If you believe we have inadvertently collected such information, contact us immediately.

9. CHANGES TO THIS POLICY
We may update this Privacy Policy periodically. We will notify you of material changes by requiring re-acceptance within the app. The version number and date at the top of this document will always reflect the most recent update.

10. CONTACT
For privacy-related questions or to exercise your rights:
Email: privacy@wrapchat.app

By accepting this Privacy Policy, you confirm you have read and understood it in full.`;

const SLIDE_MS   = 480;
const SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

function Shell({ sec, prog, total, children, feedback=null, shareType="card", scrollable=true, contentAlign="center", hidePill=false, palette=null, hideChromeButtons=false, hideProgressBar=false }) {
  const p = palette || PAL[sec] || PAL.upload;
  const onClose = useContext(CloseResultsContext);
  const share = useContext(ShareResultsContext);
  const feedbackApi = useContext(FeedbackContext);
  const { dir, id } = useContext(SlideContext);
  const t = useT();

  // Content-only slide animation — chrome (bg, bar, pill, X) stays perfectly still.
  const prevContentRef = useRef(null);
  const prevIdRef      = useRef(id);
  const paneRef        = useRef(null);
  const [exitContent, setExitContent] = useState(null);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      paneRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    if (id !== prevIdRef.current) {
      setExitContent({ node: prevContentRef.current, dir });
      prevIdRef.current = id;
      const t = setTimeout(() => setExitContent(null), SLIDE_MS);
      return () => clearTimeout(t);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = p.bg;
    document.documentElement.style.transition = `background ${SLIDE_MS}ms ${SLIDE_EASE}`;
    document.body.style.transition = `background ${SLIDE_MS}ms ${SLIDE_EASE}`;
    document.documentElement.style.background = p.bg;
    document.body.style.background = p.bg;
  }, [p.bg]);

  prevContentRef.current = children;

  const isFade = dir === "fade";
  const enterFrom = dir === "fwd" ? "100%"  : "-100%";
  const exitTo    = dir === "fwd" ? "-100%" : "100%";
  const paneJustify = contentAlign === "start" ? "flex-start" : "safe center";

  return (
    <SectionPaletteContext.Provider value={p}>
    <>
      <style>{`
        .wc-root * { box-sizing: border-box; }
        @keyframes blink { 0%,80%,100%{opacity:.15} 40%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .wc-fadeup   { animation: fadeUp 0.4s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-2 { animation: fadeUp 0.4s 0.07s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-3 { animation: fadeUp 0.4s 0.14s cubic-bezier(.2,0,.1,1) both; }
        .wc-btn:hover { opacity:0.82; transform:scale(0.98); }
        .wc-exit-pane [data-nav-row="true"] { visibility:hidden; }
        @media (max-width: 430px) { .wc-root { border-radius: 0 !important; } }
        @keyframes wcContentIn {
          from { transform: translateX(var(--wc-enter-from)); }
          to   { transform: translateX(0); }
        }
        @keyframes wcFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="wc-root" data-share-type={shareType} data-share-accent={p.accent} style={{
        width: "min(420px, 100vw)",
        height: "100svh",
        margin: "0 auto",
        background: p.bg,
        transition: `background ${SLIDE_MS}ms ${SLIDE_EASE}`,
        borderRadius: 32,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
        paddingTop: "max(20px, env(safe-area-inset-top, 0px))",
      }}>
        <div data-share-hide style={{ position:"absolute", top:0, left:0, right:0, height:"max(20px, env(safe-area-inset-top, 0px))", background:p.bg, zIndex:4, pointerEvents:"none" }} />
        {/* ── WAVE LINES ── */}
        <WaveLines accent={p.accent} />

        {/* ── STATIC CHROME — never moves ── */}
        {/* Thin progress bar at very top */}
        {!hideProgressBar && (
        <div data-share-hide style={{ position:"absolute", top:"max(20px, env(safe-area-inset-top, 0px))", left:0, right:0, height:3, background:"rgba(255,255,255,0.12)", zIndex:5 }}>
          <div style={{ height:"100%", background:"rgba(255,255,255,0.75)", borderRadius:"0 2px 2px 0", width:`${total>0?Math.round((prog/total)*100):0}%`, transition:"width 0.4s" }} />
        </div>
        )}
        {!hideChromeButtons && share?.onShare && (
          <button
            data-share-hide
            onClick={share.onShare}
            className="wc-btn"
            aria-label={t("Share")}
            disabled={share.busy}
            style={{
              position:"absolute",
              top:"calc(14px + max(20px, env(safe-area-inset-top, 0px)))", left:14,
              minWidth:66, height:30,
              borderRadius:999,
              border:"none",
              background:"rgba(255,255,255,0.12)",
              color:"#fff",
              fontSize:12, lineHeight:1,
              cursor:share.busy ? "wait" : "pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              zIndex:10,
              padding:"0 12px",
              transition:"all 0.15s",
              fontWeight:700,
              letterSpacing:"0.04em",
              opacity:share.busy ? 0.7 : 1,
            }}
          >
            {share.busy ? "Saving…" : t("Share")}
          </button>
        )}
        {feedback?.resultId && feedbackApi?.openFeedback && (
          <div data-share-hide style={{ position:"absolute", top:"calc(14px + max(20px, env(safe-area-inset-top, 0px)))", right:onClose ? 54 : 14, zIndex:11 }}>
            <FeedbackButton onClick={() => feedbackApi.openFeedback(feedback)} />
          </div>
        )}
        {/* Close button */}
        {!hideChromeButtons && onClose && (
          <button
            data-share-hide
            onClick={onClose}
            className="wc-btn"
            aria-label="Close results"
            style={{
              position: "absolute",
              top: "calc(14px + max(20px, env(safe-area-inset-top, 0px)))", right: 14,
              width: 30, height: 30,
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 15, lineHeight: 1,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 10, padding: 0,
              transition: "all 0.15s",
            }}
          >✕</button>
        )}
        {/* Pill label */}
        {!hidePill && PILL_LABEL[sec] && (
          <div style={{ paddingTop:14, display:"flex", justifyContent:"center", position:"relative", zIndex:4 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", color:p.accent, background:`${p.accent}20`, border:`1px solid ${p.accent}50`, padding:"4px 12px", borderRadius:999 }}>
              {t(PILL_LABEL[sec])}
            </div>
          </div>
        )}

        {/* ── SLIDING CONTENT AREA ── */}
        <div className="wc-body" style={{ flex:1, minHeight:0, position:"relative", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {/* Outgoing content */}
          {exitContent && (
            <div data-share-hide className="wc-pane wc-exit-pane" style={{
              position:"absolute", inset:0,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:paneJustify,
              padding:"16px 20px calc(24px + env(safe-area-inset-bottom, 0px))", gap:10,
              transform:isFade ? "none" : `translateX(${exitTo})`,
              opacity:isFade ? 0 : 1,
              transition:isFade ? `opacity 180ms ${SLIDE_EASE}` : `transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
              willChange:isFade ? "opacity" : "transform",
              pointerEvents:"none",
              overflowY:scrollable ? "auto" : "hidden",
            }}>
              {exitContent.node}
            </div>
          )}
          {/* Incoming content */}
          <div ref={paneRef} className="wc-pane" style={{
            position: exitContent ? "absolute" : "relative",
            inset: exitContent ? 0 : "auto",
            flex: exitContent ? "none" : 1,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:paneJustify,
            width:"100%",
            minHeight:0,
            padding:"16px 20px calc(24px + env(safe-area-inset-bottom, 0px))", gap:10,
            animation: exitContent ? (isFade ? `wcFadeIn 220ms ${SLIDE_EASE} both` : `wcContentIn ${SLIDE_MS}ms ${SLIDE_EASE} both`) : "none",
            ["--wc-enter-from"]: enterFrom,
            willChange: exitContent ? (isFade ? "opacity, transform" : "transform") : "auto",
            overflowY:scrollable ? "auto" : "hidden",
            overscrollBehavior:"contain",
          }}>
            {children}
          </div>
        </div>
      </div>
    </>
    </SectionPaletteContext.Provider>
  );
}

// Typography
const T   = ({s=26,children}) => (
  <div className="wc-fadeup" style={{ fontSize:s, fontWeight:900, textAlign:"center", lineHeight:1.1, color:"#fff", letterSpacing:-0.5, width:"100%", marginBottom:4 }}>{children}</div>
);
const Big = ({children}) => (
  <div className="wc-fadeup-2" style={{ fontSize:44, fontWeight:900, textAlign:"center", color:"#fff", letterSpacing:-1.5, width:"100%", lineHeight:1.05, wordBreak:"break-word", margin:"6px 0 2px" }}>{children}</div>
);
const Sub = ({children, mt=6}) => (
  <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.65)", lineHeight:1.6, width:"100%", marginTop:mt, fontWeight:400 }}>{children}</div>
);

// Inner card — the chunky rounded inner panel from the reference
function Card({ children, accent, style={} }) {
  const p = accent || PAL.upload;
  const bg = typeof p === "string" ? p : p.inner;
  return (
    <div className="wc-fadeup-2" style={{ width:"100%", background:bg, borderRadius:24, padding:"16px 18px", ...style }}>
      {children}
    </div>
  );
}
const stableHash = (value) => {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash * 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

// Deterministic pick — stable across rerenders, sharing, and reopening saved reports.
const pick = (arr, key = "") => {
  if (!Array.isArray(arr) || !arr.length) return "";
  const idx = stableHash(`${key}::${arr.join("\u241E")}`) % arr.length;
  return arr[idx];
};

const Quip = ({children}) => <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.82)", background:"rgba(255,255,255,0.07)", padding:"13px 18px", borderRadius:18, width:"100%", lineHeight:1.55, fontStyle:"italic", fontWeight:500 }}>{children}</div>;

function Dots() {
  return (
    <div style={{ display:"flex", gap:6, padding:"4px 0" }}>
      {[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,0.4)",animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
    </div>
  );
}

function AICard({ label, value, loading }) {
  const p = useContext(SectionPaletteContext) || PAL.upload;
  return (
    <div className="wc-fadeup-2" style={{
      background: p.inner,
      border: `1.5px solid ${p.accent}70`,
      borderRadius: 24,
      padding: "18px 20px",
      width: "100%",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:p.accent, marginBottom:10 }}>{label}</div>
      {loading ? <Dots /> : <div style={{ fontSize:15, color:"#fff", lineHeight:1.65, fontWeight:400 }}>{value||"—"}</div>}
    </div>
  );
}

function FeedbackButton({ onClick }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="wc-btn"
      aria-label={t("What's off about this?")}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "all 0.15s",
      }}
    >
      {/* flag icon */}
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ display:"block" }}>
        <path d="M4 21V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M4 4h11l-3 5 3 5H4" fill="rgba(255,255,255,0.15)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function FeedbackSheet({ open, target, selected, note, submitting, onSelect, onNoteChange, onSubmit, onClose }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open && target) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open, target]);

  if (!open || !target) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: `rgba(0,0,0,${visible ? 0.6 : 0})`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        transition: "background 0.28s ease",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(420px, 100vw)",
          display: "flex",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            width: "calc(100% - 12px)",
            maxHeight: "min(72svh, 560px)",
            background: "linear-gradient(180deg, #15151d 0%, #101017 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "28px 28px 0 0",
            padding: "10px 14px calc(16px + env(safe-area-inset-bottom, 0px))",
            boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
            color: "#fff",
            overflowY: "auto",
            transform: visible ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            scrollbarWidth: "thin",
            boxSizing: "border-box",
          }}
        >
          {/* drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.14)", margin: "0 auto 16px" }} />

          {/* header */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, marginBottom: 5, lineHeight: 1.2 }}>{t("What's off about this?")}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              {target.reportType} · card {target.cardIndex}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontWeight: 600, lineHeight: 1.45, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "10px 12px" }}>
              {target.cardTitle}
            </div>
          </div>

          {/* options */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
            {FEEDBACK_OPTIONS.filter(o => o !== POSITIVE_FEEDBACK_OPTION).map(option => {
              const active = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSelect(option)}
                  className="wc-btn"
                  style={{
                    minHeight: 42,
                    border: `1px solid ${active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.10)"}`,
                    borderRadius: 16,
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.25,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)",
                    color: active ? "#fff" : "rgba(255,255,255,0.72)",
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                >
                  {t(option)}
                </button>
              );
            })}
          </div>
          {/* positive option — full width, green tint */}
          {(() => {
            const active = selected === POSITIVE_FEEDBACK_OPTION;
            return (
              <button
                type="button"
                onClick={() => onSelect(POSITIVE_FEEDBACK_OPTION)}
                className="wc-btn"
                style={{
                  width: "100%",
                  minHeight: 42,
                  border: `1px solid ${active ? "rgba(80,200,110,0.55)" : "rgba(80,200,110,0.22)"}`,
                  borderRadius: 16,
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.25,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: active ? "rgba(80,200,110,0.22)" : "rgba(80,200,110,0.08)",
                  color: active ? "#7BE39A" : "rgba(120,210,140,0.80)",
                  textAlign: "center",
                  boxSizing: "border-box",
                  marginBottom: 14,
                }}
              >
                {t(POSITIVE_FEEDBACK_OPTION)}
              </button>
            );
          })()}

          {/* optional note */}
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder={t("Optional note")}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.45,
              color: "#fff",
              outline: "none",
              fontFamily: "inherit",
              marginBottom: 14,
              boxSizing: "border-box",
            }}
          />

          {/* actions */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="wc-btn"
              style={{
                minHeight: 46,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.68)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                padding: "12px 10px",
                borderRadius: 16,
                transition: "all 0.15s",
                boxSizing: "border-box",
              }}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="wc-btn"
              disabled={!selected || submitting}
              style={{
                minHeight: 46,
                padding: "12px 10px",
                borderRadius: 16,
                border: "none",
                background: !selected || submitting ? "rgba(255,255,255,0.08)" : PAL.upload.inner,
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                cursor: !selected || submitting ? "default" : "pointer",
                opacity: !selected || submitting ? 0.45 : 1,
                transition: "all 0.15s",
                letterSpacing: 0.1,
                boxSizing: "border-box",
              }}
            >
              {submitting ? t("Sending…") : t("Submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children }) {
  return <button onClick={onClick} className="wc-btn" style={{ padding:"12px 28px", borderRadius:50, border:"none", background:"rgba(255,255,255,0.15)", color:"#fff", fontSize:15, cursor:"pointer", fontWeight:700, transition:"all 0.15s", flexShrink:0, letterSpacing:0.2 }}>{children}</button>;
}
function Nav({ back, next, showBack=true, nextLabel="Next", showArrow=true }) {
  const t = useT();
  const p = useContext(SectionPaletteContext) || PAL.upload;
  return (
    <div data-share-hide data-nav-row="true" style={{ display:"flex", gap:10, marginTop:8, width:"100%" }}>
      {showBack && (
        <button onClick={back} className="wc-btn" style={{
          flex:1, padding:"14px", borderRadius:999,
          background:"rgba(255,255,255,0.10)", border:"1.5px solid rgba(255,255,255,0.18)",
          fontFamily:"'Nunito Sans',sans-serif", color:"rgba(255,255,255,0.75)",
          fontSize:15, fontWeight:700,
          display:"flex", alignItems:"center", justifyContent:"center", gap:7,
        }}><BackIcon size={13} /> {t("Back")}</button>
      )}
      <button onClick={next} className="wc-btn" style={{
        flex:1, padding:"14px", borderRadius:999,
        background:p.accent, border:"none",
        fontFamily:"'Nunito Sans',sans-serif", color:p.bg,
        fontSize:15, fontWeight:800,
        display:"flex", alignItems:"center", justifyContent:"center", gap:7,
      }}>
        {t(nextLabel)}
        {showArrow && <ForwardIcon size={13} />}
      </button>
    </div>
  );
}
function ScreenHeader({ title, titleNode=null, back, backLabel="Back", action=null }) {
  const t = useT();
  return (
    <div data-share-hide style={{ width:"100%", minHeight:40, display:"grid", gridTemplateColumns:"40px minmax(0, 1fr) 40px", alignItems:"start", columnGap:8, flexShrink:0 }}>
      {back && (
        <button
          type="button"
          onClick={back}
          className="wc-btn"
          aria-label={t(backLabel)}
          style={{
            width:34,
            height:34,
            marginTop:-1,
            border:"none",
            padding:0,
            background:"none",
            color:"rgba(255,255,255,0.74)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            cursor:"pointer",
          }}
        >
          <BackIcon size={14} />
        </button>
      )}
      {!back && <div />}
      <div style={{
        minWidth:0,
        fontSize:28, fontWeight:900, color:"#fff", letterSpacing:-1, lineHeight:1.08,
        textAlign:"left", overflowWrap:"anywhere",
      }}>
        {titleNode ?? t(title)}
      </div>
      <div style={{ width:40, height:34, marginTop:-1, display:"flex", alignItems:"center", justifyContent:"center" }}>{action}</div>
    </div>
  );
}

function SwatchIcon({ inner, accent, size = 48, inset = 9, style = {} }) {
  return (
    <div style={{ width:size, height:size, position:"relative", flexShrink:0, ...style }}>
      <div style={{
        position:"absolute", inset:0,
        borderRadius:Math.round(size * 0.27),
        background:`${accent}20`,
        border:`1.5px solid ${accent}55`,
      }} />
      <div style={{
        position:"absolute", inset,
        borderRadius:Math.round(size * 0.17),
        background:inner || `${accent}38`,
        border:`1px solid ${accent}90`,
        transform:"rotate(-12deg)",
      }} />
    </div>
  );
}

function PackSwatch({ pack, size = 48, inset = 9 }) {
  return (
    <SwatchIcon
      size={size}
      inset={inset}
      inner={`${pack.accent}60`}
      accent={pack.accent}
    />
  );
}

function AnalysisDotsCounter({ credits, activePackIds = null, onAdd, hide = false }) {
  if (hide || !Number.isInteger(credits)) return null;
  const useExplicitPackState = activePackIds && typeof activePackIds === "object";
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6,
      background:"rgba(255,255,255,0.07)",
      border:"1px solid rgba(255,255,255,0.12)",
      borderRadius:999,
      padding:"5px 7px 5px 10px",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {PACK_ORDER.map(id => {
          const pack = PACK_DEFS[id];
          const active = useExplicitPackState ? Boolean(activePackIds[id]) : Math.floor(credits / pack.cost) > 0;
          return (
            <div
              key={id}
              title={`${pack.name}${active ? "" : " — none"}`}
              style={{
                width:8, height:8, borderRadius:"50%",
                background:active ? pack.accent : "rgba(255,255,255,0.16)",
                transition:"all 0.2s",
              }}
            />
          );
        })}
      </div>
      <div style={{ width:1, height:14, background:"rgba(255,255,255,0.12)", margin:"0 1px" }} />
      <button
        type="button"
        onClick={onAdd}
        className="wc-btn"
        aria-label="Unlock more reads"
        style={{
          width:22, height:22, borderRadius:"50%",
          background:"rgba(255,255,255,0.10)",
          border:"1px solid rgba(255,255,255,0.16)",
          display:"flex", alignItems:"center", justifyContent:"center",
          color:"rgba(255,255,255,0.65)",
          fontSize:14, fontWeight:400, lineHeight:1,
          padding:0, flexShrink:0, cursor:"pointer",
        }}
      >
        +
      </button>
    </div>
  );
}

function Bar({ value, max, color, label, delay=0 }) {
  const [w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(Math.round((value/Math.max(max,1))*100)),120+delay);return()=>clearTimeout(t);},[value,max,delay]);
  const lbl = (label||"").split(" ")[0].slice(0,10);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, width:"100%" }}>
      <div style={{ width:58, textAlign:"right", fontSize:13, color:"rgba(255,255,255,0.65)", flexShrink:0, fontWeight:600 }}>{lbl}</div>
      <div style={{ flex:1, minWidth:0, height:32, borderRadius:50, background:"rgba(0,0,0,0.2)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${w}%`, minWidth:w>0?"52px":"0", background:color, borderRadius:50, display:"flex", alignItems:"center", paddingLeft:12, fontSize:13, fontWeight:700, color:"#fff", transition:"width 0.9s cubic-bezier(.4,0,.2,1)", whiteSpace:"nowrap" }}>{value.toLocaleString()}</div>
      </div>
    </div>
  );
}
function MonthBadge({ month, count, medal }) {
  const t = useT();
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center", flex:1, minWidth:80 }}>
      <div style={{ fontSize:26 }}>{medal}</div>
      <div className="" style={{ fontSize:15, fontWeight:800, color:"#fff", marginTop:8, letterSpacing:-0.3 }}>{month}</div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4, fontWeight:500 }}>{count.toLocaleString()} {t("msgs")}</div>
    </div>
  );
}
function Words({ words, bigrams }) {
  const M=["🥇","🥈","🥉"];
  const top5w=(words||[]).slice(0,5);
  const top5b=(bigrams||[]).slice(0,5);
  const combined=[...top5w.map(([w,c])=>({w,c})),...top5b.map(([w,c])=>({w,c}))];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:4 }}>
      {combined.map(({w,c},i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: i<3 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)", borderRadius:14 }}>
          <span style={{ width:26, fontSize:14, flexShrink:0 }}>{M[i]||i+1}</span>
          <span style={{ flex:1, fontWeight:700, color:"#fff", fontSize:15, letterSpacing:-0.2 }}>{w}</span>
          <span style={{ fontSize:13, color:"rgba(255,255,255,0.55)", fontWeight:600 }}>{c.toLocaleString()}x</span>
        </div>
      ))}
    </div>
  );
}
function Cell({ label, value }) {
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:6 }}>{label}</div>
      <div className="" style={{ fontWeight:800, color:"#fff", fontSize:16, wordBreak:"break-word", letterSpacing:-0.3 }}>{value}</div>
    </div>
  );
}
function FlagList({ flags, loading }) {
  const t = useT();
  const items = normalizeRedFlags(flags);
  if (loading && !items.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {items.map((flag, index) => (
        <div key={`${flag.title}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {t("Red flag {index}", { index: index + 1 })}
          </div>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, marginBottom:6 }}>
            {flag.title}
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.78)", lineHeight:1.6 }}>
            {flag.detail || t("This pattern showed up enough to feel worth watching.")}
          </div>
          {flag.evidence && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.5, marginTop:8 }}>
              {t("Evidence")}: {flag.evidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ items, loading }) {
  const entries = normalizeTimeline(items);
  if (loading && !entries.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {entries.map((item, index) => (
        <div key={`${item.date}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {item.date}
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.25, marginBottom:6 }}>
            {item.title}
          </div>
          {item.detail && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TextList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", color:"rgba(255,255,255,0.78)", textAlign:"left", fontSize:13, lineHeight:1.55 }}>
          {item}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MEMORABLE MOMENTS ROW
// ─────────────────────────────────────────────────────────────────
const MOMENT_TYPE_EMOJI = { funny:"😂", sweet:"🫶", awkward:"😬", chaotic:"🌪️", signature:"✨", tension:"⚡", care:"💙", conflict:"🔥" };

function MomentsRow({ moments, loading }) {
  if (loading) return null;
  if (!moments?.length) return null;
  return (
    <div style={{ width:"100%", marginTop:14 }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Moments</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {moments.map((m, i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"12px 14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:m.setup || m.quote ? 5 : 0 }}>
              <span style={{ fontSize:14, lineHeight:1 }}>{MOMENT_TYPE_EMOJI[m.type] || "✨"}</span>
              <span style={{ fontSize:13, fontWeight:700, color:"#fff", lineHeight:1.3 }}>{m.title}</span>
            </div>
            {m.quote && <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontStyle:"italic", marginBottom:4, lineHeight:1.4 }}>"{m.quote}"</div>}
            {m.read && <div style={{ fontSize:13, color:"rgba(255,255,255,0.78)", lineHeight:1.5 }}>{m.read}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DUO SCREENS
// ─────────────────────────────────────────────────────────────────
function DuoScreen({ s, ai, aiLoading, step, back, next, mode, relationshipType, resultId }) {
  const t = useT();
  const total  = s.msgCounts[0]+s.msgCounts[1];
  const pct0   = Math.round((s.msgCounts[0]/total)*100);
  const mMax   = Math.max(...s.msgCounts);
  const nov    = s.avgMsgLen[0]>=s.avgMsgLen[1]?0:1;
  const TOTAL  = mode === "redflags" ? DUO_REDFLAG_SCREENS : DUO_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || (aiLoading ? "..." : s.names[0]);
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const relationshipStatus = ai?.relationshipStatus || s.relationshipStatus || (aiLoading ? "..." : "Complicated");
  const relationshipStatusWhy = ai?.relationshipStatusWhy || s.relationshipStatusWhy;
  const statusEvidence = ai?.statusEvidence || s.statusEvidence;
  const relationshipSpecific = ai?.relationshipSpecific || null;
  const relationshipConfidence = ai?.relationshipConfidence || null;
  const relationshipEvidence = ai?.relationshipEvidence || null;
  const relationshipDetectedLabel = relationshipSpecific
    ? `${relationshipSpecific}${relationshipConfidence ? ` (${relationshipConfidence} confidence)` : ""}`
    : null;
  const relationshipReadTitle = relReadTitle(relationshipType, relationshipSpecific);
  const duoFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("Who's more obsessed?", 1)}>
      <T>{t("Who's more obsessed?")}</T>
      <div style={{width:"100%",marginTop:16}}>
        <Bar value={s.msgCounts[0]} max={mMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.msgCounts[1]} max={mMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Sub mt={14}>{t("{pct}% of all messages came from {name}.", { pct: pct0, name: s.names[0] })}</Sub>
      {(() => {
      const name = s.names[pct0>=50?0:1];
      const q = pick(t("quips.duo.obsessed", { name }), `duo-obsessed|${s.names.join("|")}|${s.totalMessages}|${name}|${pct0}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost Award", 2, !s.ghostEqual)}>
      {s.ghostEqual ? (
        <>
          <T>{t("Response times")}</T>
          <Big>{t("Balanced")}</Big>
          <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          {(() => { const q = pick(t("quips.duo.responseBalanced"), `duo-response-balanced|${s.names.join("|")}|${s.totalMessages}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
        </>
      ) : (
        <>
          <T>{t("The Ghost Award")}</T>
          <Big>{s.ghostName}</Big>
          <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
          {(() => { const q = pick(t("quips.duo.ghost", { name: s.ghostName }), `duo-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghostName}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("The Last Word", 3)}>
      <T>{t("The Last Word")}</T>
      <Big>{s.convKiller}</Big>
      <Sub>{t("Sends the last message that nobody replies to — {count} times.", { count: s.convKillerCount })}</Sub>
      {(() => {
      const q = pick(t("quips.duo.lastWord", { name: s.convKiller }), `duo-last-word|${s.names.join("|")}|${s.totalMessages}|${s.convKiller}|${s.convKillerCount}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("Your longest streak", 4)}>
      <T>{t("Your longest streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("Texted every single day for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.duo.streak100", { streak: s.streak }), `duo-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.duo.streak30", { streak: s.streak }), `duo-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.duo.streak10", { streak: s.streak }), `duo-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.duo.streakShort", { streak: s.streak }), `duo-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("The Kindest One", 5)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("Top 3 most active months", 7)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("{month} was your month. Something was going on.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL} feedback={feedback("Who always reaches out first?", 6)}>
      <T>{t("Who always reaches out first?")}</T>
      <Big>{s.convStarter}</Big>
      <Sub>{t("Started {pct} of all conversations.", { pct: s.convStarterPct })}</Sub>
      {(() => {
      const q = pick(t("quips.duo.convStarter", { name: s.convStarter }), `duo-conv-starter|${s.names.join("|")}|${s.totalMessages}|${s.convStarter}|${s.convStarterPct}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("The Funny One", 8)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Spirit emojis", 9)}>
      <T>{t("Spirit emojis")}</T>
      <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:64,lineHeight:1}}>{s.spiritEmoji[i]}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginTop:8}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("These two emojis basically ARE this chat.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL} feedback={feedback("Top 10 most used words", 10)}>
      <T>{t("Top 10 most used words")}</T>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={11} total={TOTAL} feedback={feedback("Signature phrases", 11)}>
      <T>{t("Signature phrases")}</T>
      <div style={{display:"flex",gap:"1rem",marginTop:16,width:"100%",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{background:"rgba(255,255,255,0.08)",padding:"14px 18px",borderRadius:12,textAlign:"center",flex:1}}>
            {aiLoading?<Dots />:<div style={{fontSize:14,fontWeight:700,color:"#fff",fontStyle:"italic"}}>"{ai?.signaturePhrase?.[i]||s.signatureWord[i]}"</div>}
            <div style={{fontSize:12,color:"rgba(255,255,255,0.42)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("The phrases that define each of you.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Message length", 12)}>
      {(() => {
        const diff = Math.abs(s.avgMsgLen[0] - s.avgMsgLen[1]);
        const ratio = Math.max(...s.avgMsgLen) / Math.max(Math.min(...s.avgMsgLen), 1);
        const isSimilar = diff < 15 || ratio < 1.3;
        const novelist = s.names[nov];
        const texter   = s.names[nov===0?1:0];
        return <>
          <T>{t(isSimilar ? "Message length" : "The Novelist vs The Texter")}</T>
          <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around",alignItems:"center"}}>
            {[0,1].map(i=>(
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:36,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[i]}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>{t("avg chars")}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:1}}>max {(s.maxMsgLen?.[i] ?? 0).toLocaleString()}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4}}>{s.names[i]}</div>
              </div>
            ))}
          </div>
          {(() => {
            const q = isSimilar
              ? pick(t("quips.duo.messageLengthSimilar"), `duo-msg-length-similar|${s.names.join("|")}|${s.totalMessages}|${s.avgMsgLen.join("|")}|${s.maxMsgLen?.join("|") || ""}`)
              : pick(t("quips.duo.messageLengthDifferent", { novelist, texter }), `duo-msg-length-different|${s.names.join("|")}|${s.totalMessages}|${novelist}|${texter}|${s.avgMsgLen.join("|")}|${s.maxMsgLen?.join("|") || ""}`);
            return <Quip>{q}</Quip>;
          })()}
        </>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={13} total={TOTAL} feedback={feedback("Media and links", 13)}>
      <T>{t("Media and links")}</T>
      <div style={{width:"100%",marginTop:16}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Photos & videos")}</div>
        <Bar value={s.mediaCounts[0]} max={Math.max(...s.mediaCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.mediaCounts[1]} max={Math.max(...s.mediaCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Voice memos")}</div>
        <Bar value={s.voiceCounts[0]} max={Math.max(...s.voiceCounts,1)} color="#C880F0" label={s.names[0]} />
        <Bar value={s.voiceCounts[1]} max={Math.max(...s.voiceCounts,1)} color="#9050D0" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>{t("Links shared")}</div>
        <Bar value={s.linkCounts[0]} max={Math.max(...s.linkCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.linkCounts[1]} max={Math.max(...s.linkCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("What you actually talk about", 14)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("The Drama Report", 15)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL} feedback={feedback("What's really going on", 16)}>
      <T>{t("What's really going on")}</T>
      <AICard label={t(relationshipReadTitle)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL} feedback={feedback("Chat vibe", 17)}>
      <T>{t("Chat vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("A chaotic, wholesome connection."))}
      </div>
      <MomentsRow moments={ai?.memorableMoments} loading={aiLoading} />
      <Sub mt={14}>{t("Powered by AI — your messages never left your device.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Relationship reading", 1)}>
      <T>{t("Relationship reading")}</T>
      <Big>{relationshipStatus}</Big>
      {relationshipDetectedLabel && (
        <AICard
          label="Detected relationship"
          value={relationshipDetectedLabel}
          loading={aiLoading && !relationshipDetectedLabel}
        />
      )}
      <AICard label={t("Observed pattern")} value={relationshipStatusWhy} loading={aiLoading && !relationshipStatusWhy} />
      {relationshipEvidence && <AICard label="Why this label" value={relationshipEvidence} loading={false} />}
      <AICard label={t("Concrete example")} value={statusEvidence} loading={aiLoading && !statusEvidence} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={duoFlags} loading={aiLoading && !duoFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        <Bar value={s.toxicityScores[0]} max={toxicMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.toxicityScores[1]} max={toxicMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Tension snapshot", 5)}>
      <T>{t("Tension snapshot")}</T>
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <AICard label={t(relationshipReadTitle)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={6} total={TOTAL} feedback={feedback("What keeps repeating", 6)}>
      <T>{t("What keeps repeating")}</T>
      <AICard label={t("Main topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Pattern note")} value={duoFlags[0]?.detail || t("The strongest pattern is shown above.")} loading={aiLoading && !duoFlags[0]?.detail} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={7} total={TOTAL} feedback={feedback("Toxicity report", 7)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// GROUP SCREENS
// ─────────────────────────────────────────────────────────────────
function GroupScreen({ s, ai, aiLoading, step, back, next, mode, resultId }) {
  const t = useT();
  const mMax   = Math.max(...s.msgCounts,1);
  const COLORS = ["#E06030","#4A90D4","#3ABDA0","#C4809A","#8A70D4","#D4A840"];
  const TOTAL  = mode === "redflags" ? GROUP_REDFLAG_SCREENS : GROUP_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || s.names[0];
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const groupFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("The Main Character", 1)}>
      <T>{t("The Main Character")}</T>
      <Big>{s.mainChar}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,6).map((n,i)=><Bar key={n} value={s.msgCounts[i]} max={mMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      {(() => {
      const q = pick(t("quips.group.mainCharacter", { name: s.mainChar }), `group-main-character|${s.names.join("|")}|${s.totalMessages}|${s.mainChar}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost", 2)}>
      <T>{t("The Ghost")}</T>
      <Big>{s.ghost}</Big>
      <Sub>{t("{count} messages total. Why are they even here?", { count: s.msgCounts[s.msgCounts.length-1].toLocaleString() })}</Sub>
      {(() => {
      const q = pick(t("quips.group.ghost", { name: s.ghost }), `group-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghost}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("The Last Word", 3)}>
      <T>{t("The Last Word")}</T>
      <Big>{s.convKiller}</Big>
      <Sub>{t("Sends the last message that nobody replies to.")}</Sub>
      {(() => {
      const q = pick(t("quips.group.lastWord", { name: s.convKiller }), `group-last-word|${s.names.join("|")}|${s.totalMessages}|${s.convKiller}|${s.convKillerCount}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("Top 3 most active months", 4)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("The group was most alive in {month}.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("Longest active streak", 5)}>
      <T>{t("Longest active streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("The group kept the chat alive for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.group.streak100", { streak: s.streak }), `group-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.group.streak30", { streak: s.streak }), `group-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.group.streak10", { streak: s.streak }), `group-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.group.streakShort", { streak: s.streak }), `group-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("The Hype Person", 6)}>
      <T>{t("The Hype Person")}</T>
      <Big>{s.hype}</Big>
      <Sub>{t("Started {pct} of all conversations. The engine of this group.", { pct: s.convStarterPct })}</Sub>
      <AICard label={t("Why {name} is the hype", { name: s.hype })} value={ai?.hypePersonReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL} feedback={feedback("The Kindest One", 7)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("The Funny One", 8)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Group spirit emoji", 9)}>
      <T>{t("Group spirit emoji")}</T>
      <div style={{fontSize:90,textAlign:"center",marginTop:16,lineHeight:1,width:"100%"}}>{s.spiritEmoji[0]}</div>
      <Sub>{t("This one emoji basically summarises the entire group energy.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL} feedback={feedback("Top 10 most used words", 10)}>
      <T>{t("Top 10 most used words")}</T>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL} feedback={feedback("The Novelist", 11)}>
      <T>{t("The Novelist")}</T>
      <Big>{s.novelist}</Big>
      <div style={{display:"flex",gap:0,marginTop:12,width:"100%",justifyContent:"space-around"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[[...s.names].sort((a,b)=>s.msgCounts[s.names.indexOf(b)]-s.msgCounts[s.names.indexOf(a)]).indexOf(s.novelist)]||s.avgMsgLen[0]}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("avg chars")}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.novelistMaxLen.toLocaleString()}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("longest message")}</div>
        </div>
      </div>
      {s.novelistLongestTopic && <Sub mt={8}>{t("Their longest message was mostly about \"{topic}\".", { topic: s.novelistLongestTopic })}</Sub>}
      <Quip>{pick(t("quips.group.novelist", { name: s.novelist }), `group-novelist|${s.names.join("|")}|${s.totalMessages}|${s.novelist}|${s.novelistMaxLen}`)}</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Group roles", 12)}>
      <T>Group roles</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        <Cell label={s.photographerIsVoice ? "Voice Note Addict" : "Photographer"} value={s.photographer} />
        <Cell label="The Therapist" value={s.therapist} />
        <Cell label="Night owl" value={s.nightOwl} />
        <Cell label="Early bird" value={s.earlyBird} />
        <Cell label="Voice memo king" value={s.voiceChampion} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={13} total={TOTAL} feedback={feedback("What you actually talk about", 13)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("The inside joke")} value={ai?.insideJoke} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("The Drama Report", 14)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("Most missed member", 15)}>
      <T>{t("Most missed member")}</T>
      <Big>{aiLoading?"...":(ai?.mostMissed||s.names[0])}</Big>
      <Sub>{t("When they go quiet, the group feels it.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL} feedback={feedback("The group read", 16)}>
      <T>{t("The group read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL} feedback={feedback("Group vibe", 17)}>
      <T>{t("Group vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("Chaotic. Wholesome. Somehow still going."))}
      </div>
      <MomentsRow moments={ai?.memorableMoments} loading={aiLoading} />
      <Sub mt={14}>{t("Powered by AI — your messages never left your device.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Group pattern read", 1)}>
      <T>{t("Group pattern read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={groupFlags} loading={aiLoading && !groupFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{aiLoading && !toxicName ? "..." : toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,4).map((n,i)=><Bar key={n} value={s.toxicityScores[i]} max={toxicMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Support and strain", 5)}>
      <T>{t("Support and strain")}</T>
      <AICard label={t("Who keeps it going")} value={s.hype ? t("{name} started {pct} of conversations.", { name: s.hype, pct: s.convStarterPct }) : t("The group shares the conversation starts.")} loading={false} />
      <AICard label={t("Who goes quiet")} value={s.ghost ? t("{name} is the least active member in the sampled history.", { name: s.ghost }) : t("No clear ghost in this sample.")} loading={false} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={6} total={TOTAL} feedback={feedback("Toxicity report", 6)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// SCORE RING — animated circular score display
// ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, max=10, size=110, color="#fff" }) {
  const [pct, setPct] = useState(0);
  useEffect(() => { const t = setTimeout(() => setPct(score / max), 150); return () => clearTimeout(t); }, [score, max]);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:size > 90 ? 28 : 20, fontWeight:800, color:"#fff", lineHeight:1 }}>{score}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginTop:2 }}>/{max}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TRIAL REPORT SCREENS
// ─────────────────────────────────────────────────────────────────
const TRIAL_SCREENS = 7;

function TrialReportScreen({ s, ai, aiLoading, step, back, next }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const [openPack, setOpenPack] = useState("vibe");
  const names = s.names || [];
  const msgCounts = s.msgCounts || [];
  const colors = ["#E06030", "#4A90D4", "#3ABDA0", "#C4809A", "#8A70D4", "#D4A840"];
  const topMembers = names.slice(0, Math.min(s.isGroup ? 5 : 2, names.length));
  const maxMessages = Math.max(...msgCounts, 1);
  const mediaTotal = (s.mediaCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const voiceTotal = (s.voiceCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const linkTotal = (s.linkCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const topMonth = s.topMonths?.[0];
  const ghostValue = s.isGroup
    ? (s.ghost || "—")
    : (s.ghostEqual ? t("Balanced") : (s.ghostName || "—"));
  const firstCardTitle = s.isGroup ? "Group snapshot" : "Chat snapshot";
  const screens = [
    <Shell sec="trial" prog={1} total={TRIAL_SCREENS + 2}>
      <T>{t(firstCardTitle)}</T>
      <Sub mt={4}>{names.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}</Sub>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:8 }}>
        <Cell label={t("Messages")} value={s.totalMessages?.toLocaleString() || "—"} />
        <Cell label={t(s.isGroup ? "People" : "Chatters")} value={names.length || "—"} />
        <Cell label={t("Best streak")} value={t("{count} days", { count: s.streak || 0 })} />
        <Cell label={t("Top month")} value={topMonth ? `${topMonth[0]} · ${topMonth[1].toLocaleString()}` : "—"} />
      </div>
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="trial" prog={2} total={TRIAL_SCREENS + 2}>
      <T>{t(s.isGroup ? "Who carries the chat?" : "Message balance")}</T>
      <div style={{ width:"100%", marginTop:12 }}>
        {topMembers.map((name, i) => (
          <Bar key={name} value={msgCounts[i] || 0} max={maxMessages} color={colors[i % colors.length]} label={name} delay={i * 90} />
        ))}
      </div>
      <Sub mt={12}>
        {s.isGroup
          ? t("{name} is the main character in this sample.", { name: s.mainChar || names[0] || "—" })
          : t("{pct}% of all messages came from {name}.", {
              pct: Math.round(((msgCounts[0] || 0) / Math.max(s.totalMessages || 1, 1)) * 100),
              name: names[0] || "—",
            })}
      </Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={3} total={TRIAL_SCREENS + 2}>
      <T>{t("Conversation rhythm")}</T>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:8 }}>
        <Cell label={t(s.isGroup ? "Main character" : "Ghost award")} value={s.isGroup ? (s.mainChar || "—") : ghostValue} />
        <Cell label={t(s.isGroup ? "The ghost" : "Reply times")} value={s.isGroup ? (s.ghost || "—") : (s.ghostAvg?.join(" / ") || "—")} />
        <Cell label={t("Starts most")} value={s.convStarter || "—"} />
        <Cell label={t("Last word")} value={s.convKiller || "—"} />
      </div>
      <Sub mt={12}>{t("Started {pct} of all conversations.", { pct: s.convStarterPct || "—" })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={4} total={TRIAL_SCREENS + 2}>
      <T>{t("Chat texture")}</T>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:6, marginTop:4 }}>{t("Most used words")}</div>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:6, marginTop:10 }}>{t("Stats")}</div>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        <Cell label={t("Media")} value={mediaTotal.toLocaleString()} />
        <Cell label={t("Voice")} value={voiceTotal.toLocaleString()} />
        <Cell label={t("Links")} value={linkTotal.toLocaleString()} />
      </div>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:4, marginTop:10 }}>{t("Most used emojis")}</div>
      <div style={{ width:"100%", background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"12px 16px", fontSize:22, letterSpacing:4 }}>
        {(Array.isArray(s.spiritEmoji) ? s.spiritEmoji.join(" ") : s.spiritEmoji) || "💬"}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={5} total={TRIAL_SCREENS + 2}>
      <T>{t("How you connect")}</T>
      <Sub mt={4}>{t("Two reads from the AI.")}</Sub>
      <AICard label={t("How you communicate")}    value={ai?.pattern}  loading={loading} />
      <AICard label={t("Most interesting thing")} value={ai?.takeaway} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={6} total={TRIAL_SCREENS + 2}>
      <T>{t("The vibe")}</T>
      <AICard label={t("Chat vibe")} value={ai?.vibe} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={7} total={TRIAL_SCREENS + 2}>
      <T>{t("Your summary")}</T>
      <Sub mt={4}>{t("A short version of what stood out in this chat.")}</Sub>
      <AICard label={t("Chat vibe")} value={ai?.vibe} loading={loading} />
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Cell label={t("Messages")} value={s.totalMessages?.toLocaleString() || "—"} />
        <Cell label={t("Best streak")} value={t("{count} days", { count: s.streak || 0 })} />
        <Cell label={t("Top month")} value={topMonth ? `${topMonth[0]} · ${topMonth[1].toLocaleString()}` : "—"} />
        <Cell label={t(s.isGroup ? "People" : "Chatters")} value={names.length || "—"} />
      </div>
      <div style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:18, padding:"13px 16px", color:"rgba(255,255,255,0.70)", fontSize:13, lineHeight:1.55, textAlign:"center" }}>
        {t("There is a lot more to read in this chat. See the packs to unlock the deeper reports.")}
      </div>
      <Nav back={back} next={next} nextLabel="See packs" showArrow={false} />
    </Shell>,

    <Shell sec="upload" prog={TRIAL_SCREENS + 1} total={TRIAL_SCREENS + 2} contentAlign="start" hidePill hideChromeButtons>
          <div style={{ alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))", padding:"16px 20px 0", minHeight:0, overflow:"hidden" }}>
            <div style={{ marginBottom:18, flexShrink:0 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, fontWeight:900, color:"#fff", letterSpacing:"-0.02em", lineHeight:1.1, textAlign:"left" }}>
                Here's what you can unlock.
              </div>
            </div>
            <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, paddingBottom:16 }}>
              {PACK_ORDER.map(id => {
                const pack = PACK_DEFS[id];
                const open = openPack === id;
                const reportCount = pack.reports.length;
                return (
                  <div key={id} onClick={() => setOpenPack(cur => cur === id ? null : id)} className="wc-btn"
                    style={{ borderRadius:22, overflow:"hidden", cursor:"pointer", background:pack.bg, border:`1.5px solid ${pack.accent}55`, flexShrink:0 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:open ? "16px 18px 12px" : "16px 18px", transition:"padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                        <PackSwatch pack={pack} />
                        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:"#fff", letterSpacing:"-0.015em", textAlign:"left" }}>{pack.name}</div>
                          <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", color:pack.accent, textAlign:"left" }}>{reportCount} {reportCount === 1 ? t("report") : t("reports")}</div>
                        </div>
                      </div>
                      <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(255,255,255,0.10)", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.50)", fontSize:13, transform:open ? "rotate(180deg)" : "none", transition:"transform 0.28s cubic-bezier(0.2,0,0.1,1)", flexShrink:0 }}>▾</div>
                    </div>
                    <div style={{ maxHeight:open ? 200 : 0, overflow:"hidden", opacity:open ? 1 : 0, padding:open ? "0 18px 16px" : "0 18px", transition:"max-height 0.35s cubic-bezier(0.2,0,0.1,1), opacity 0.22s ease, padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                      <div style={{ fontSize:13, color:"rgba(255,255,255,0.60)", lineHeight:1.55, marginBottom:12, textAlign:"left" }}>{PACK_EXPLAINER_DESCS[id]}</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {pack.reports.map(r => {
                          const rc = REPORT_PILL_STYLE[r] || {};
                          return <span key={r} style={{ background:rc.bg, border:`1px solid ${rc.border}`, borderRadius:999, padding:"4px 11px", fontSize:11, fontWeight:700, color:rc.text }}>{REPORT_LABELS_EXP[r] || r}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ flexShrink:0, paddingBottom:"calc(16px + env(safe-area-inset-bottom, 0px))", paddingTop:10 }}>
              <Nav back={back} next={next} nextLabel="See pricing" showArrow={false} />
            </div>
          </div>
        </Shell>,
  ];
  return screens[step] ?? null;
}

function CreditPackGrid({ accent = DA.teal, disabled = true }) {
  const t = useT();
  return (
    <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
      {CREDIT_PACKS.map(pack => (
        <button
          key={pack.id}
          type="button"
          disabled={disabled}
          className="wc-btn"
          style={{
            background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.14)",
            borderRadius:18,
            padding:"14px 10px",
            textAlign:"center",
            cursor:disabled ? "not-allowed" : "pointer",
            opacity:disabled ? 0.86 : 1,
            color:"#fff",
          }}
          title={disabled ? "Payments coming soon" : pack.label}
        >
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", color:accent, marginBottom:4, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
            <span>{pack.label}</span>
            {pack.recommended && <SolidStarIcon size={10} color={accent} />}
          </div>
          <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>{pack.credits}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginBottom:4 }}>{t("credits")}</div>
          <div style={{ fontSize:13, fontWeight:800, color:accent }}>{pack.priceLabel}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.36)", lineHeight:1.35, marginTop:6 }}>
            {pack.recommended ? "Recommended" : "One-time credits"}
          </div>
        </button>
      ))}
    </div>
  );
}

function PricingCostOverview({ accent = DA.teal, compact = false }) {
  const t = useT();
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"12px 14px" }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.09em", textTransform:"uppercase", color:accent, marginBottom:8 }}>{t("Bundles")}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:7 }}>
          {PACK_ORDER.map(id => {
            const pack = PACK_DEFS[id];
            return (
            <div key={pack.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"8px 0", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{t(pack.name)}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.42)", lineHeight:1.4 }}>{pack.tags.map(label => t(label)).join(" + ")}</div>
              </div>
              <div style={{ fontSize:12, fontWeight:900, color:accent, whiteSpace:"nowrap" }}>{pack.cost} {t("cr")}</div>
            </div>
          );})}
        </div>
      </div>

      {!compact && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"12px 14px" }}>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.09em", textTransform:"uppercase", color:accent, marginBottom:8 }}>{t("Credit rules")}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:6 }}>
            {["Credits never expire.", "One-time purchases only.", "No subscriptions."].map(line => (
              <div key={line} style={{ fontSize:12, color:"rgba(255,255,255,0.62)" }}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PACK_EXPLAINER_DESCS = {
  vibe:   "Who talks more, how love and care show up in the text, and the emotional energy you two actually bring to each other.",
  rf:     "The uncomfortable read. Toxic language patterns, passive aggression, who apologizes — and who deflects.",
  full:   "Every report in one run. Connection, love language, energy, tension, accountability, and how the relationship has evolved.",
  growth: "Tracks this chat across time — early messages vs. recent ones. Is this relationship deepening, or slowly fading?",
};

const REPORT_PILL_STYLE = {
  general:  { text:"rgba(155,114,255,1)",  bg:"rgba(155,114,255,0.14)", border:"rgba(155,114,255,0.32)" },
  lovelang: { text:"rgba(255,130,184,1)",  bg:"rgba(255,130,184,0.14)", border:"rgba(255,130,184,0.30)" },
  energy:   { text:"rgba(255,160,48,1)",   bg:"rgba(255,160,48,0.14)",  border:"rgba(255,160,48,0.28)"  },
  toxicity: { text:"rgba(255,60,64,1)",    bg:"rgba(255,60,64,0.14)",   border:"rgba(255,60,64,0.30)"   },
  accounta: { text:"rgba(90,173,255,1)",   bg:"rgba(90,173,255,0.14)",  border:"rgba(90,173,255,0.28)"  },
  growth:   { text:"rgba(40,234,168,1)",   bg:"rgba(40,234,168,0.14)",  border:"rgba(40,234,168,0.28)"  },
};

const REPORT_LABELS_EXP = {
  general:  "General Wrapped",
  lovelang: "Love Language",
  energy:   "Energy",
  toxicity: "Toxicity",
  accounta: "Accountability",
  growth:   "Growth",
};


function TrialFinale({ back, credits = null, userId = null, onPaymentComingSoon }) {
  return (
    <ShareResultsContext.Provider value={null}>
      <PaymentScreen preselect="vibe" credits={credits} userId={userId} onBack={back} onPaymentComingSoon={onPaymentComingSoon} />
    </ShareResultsContext.Provider>
  );
}

const TOXICITY_SCREENS = 7;
function ToxicityReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "toxicity", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="toxicity" prog={1} total={TOXICITY_SCREENS} feedback={feedback("Chat Health Score", 1)}>
      <T>{t("Chat Health Score")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore || 5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={12}>{t("Out of 10 — based on conflict patterns, communication style, and overall dynamic.")}</Sub>
      <AICard label={t("Verdict")} value={ai?.verdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="toxicity" prog={2} total={TOXICITY_SCREENS} feedback={feedback("Individual health scores", 2)}>
      <T>{t("Individual health scores")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:16 }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,score:5,detail:"Analysing…"})) : (ai?.healthScores||[])).map((p, i) => (
          <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", display:"flex", alignItems:"center", gap:14 }}>
            <ScoreRing score={loading ? 0 : (p.score||5)} max={10} size={80} color={i===0?"#E06030":"#4A90D4"} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff", marginBottom:4 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{loading ? "…" : (p.detail||"—")}</div>
            </div>
          </div>
        ))}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={3} total={TOXICITY_SCREENS} feedback={feedback("Who apologises more", 3)}>
      <T>{t("Who apologises more")}</T>
      <Big>{loading ? "…" : (ai?.apologiesLeader?.name || s.names[0])}</Big>
      <AICard label={`${(loading?"…":ai?.apologiesLeader?.name) || s.names[0]} — context`} value={ai?.apologiesLeader?.context} loading={loading} />
      <AICard label={`${(loading?"…":ai?.apologiesOther?.name) || s.names[1]||s.names[0]} — context`} value={ai?.apologiesOther?.context} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={4} total={TOXICITY_SCREENS} feedback={feedback("Red flag moments", 4)}>
      <T>{t("Red flag moments")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
            {(ai?.redFlagMoments||[]).map((m, i) => (
              <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{m.date} • {m.person}</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#fff", marginBottom:4 }}>{m.description}</div>
                {m.quote && <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", fontStyle:"italic" }}>"{m.quote}"</div>}
              </div>
            ))}
          </div>
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={5} total={TOXICITY_SCREENS} feedback={feedback("Conflict pattern", 5)}>
      <T>{t("Conflict pattern")}</T>
      <AICard label={t("How arguments unfold")} value={ai?.conflictPattern} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={6} total={TOXICITY_SCREENS} feedback={feedback("Power balance", 6)}>
      <T>{t("Power balance")}</T>
      <Big>{loading ? "…" : reportControl(ai?.powerHolder || t("Balanced"))}</Big>
      <AICard label={t("Power dynamic")} value={ai?.powerBalance} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={7} total={TOXICITY_SCREENS} feedback={feedback("The verdict", 7)}>
      <T>{t("The verdict")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore||5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={8}>{t("Overall chat health score.")}</Sub>
      <AICard label={t("Final read")} value={ai?.verdict} loading={loading} />
      <Sub mt={8}>{t("Reflects patterns in this sample — not a final judgment.")}</Sub>
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// LOVE LANGUAGE REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const LOVELANG_SCREENS = 5;
function LoveLangReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personATitle = `${ai?.personA?.name || s.names[0]}'s love language`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s love language`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "lovelang", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="lovelang" prog={1} total={LOVELANG_SCREENS} feedback={feedback(personATitle, 1)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: ai?.personA?.name || s.names[0] })}</T>
      <Big>{loading ? "…" : reportControl(ai?.personA?.language || "—")}</Big>
      <AICard label={t("How they show it")} value={ai?.personA?.examples} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="lovelang" prog={2} total={LOVELANG_SCREENS} feedback={feedback(personBTitle, 2)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <Big>{loading ? "…" : reportControl(ai?.personB?.language || "—")}</Big>
      <AICard label={t("How they show it")} value={ai?.personB?.examples} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={3} total={LOVELANG_SCREENS} feedback={feedback("The language gap", 3)}>
      <T>{t("The language gap")}</T>
      <AICard label={t("Do they speak the same language?")} value={ai?.mismatch} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={4} total={LOVELANG_SCREENS} feedback={feedback("Most loving moment", 4)}>
      <T>{t("Most loving moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostLovingMoment} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={5} total={LOVELANG_SCREENS} feedback={feedback("Love language compatibility", 5)}>
      <T>{t("Love language compatibility")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.compatibilityScore||5)} max={10} size={130} color="#F08EBF" />
      </div>
      <AICard label={t("Compatibility read")} value={ai?.compatibilityRead} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// GROWTH REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const GROWTH_SCREENS = 5;
function GrowthReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const arrowMap = { deeper:"↑", shallower:"↓", "about the same":"→" };
  const trajMap  = { closer:"Getting closer", drifting:"Drifting apart", stable:"Holding steady" };
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "growth", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="growth" prog={1} total={GROWTH_SCREENS} feedback={feedback("Then vs Now", 1)}>
      <T>{t("Then vs Now")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
        <AICard label={t("Early messages")} value={ai?.thenDepth} loading={loading} />
        <AICard label={t("Recent messages")} value={ai?.nowDepth} loading={loading} />
      </div>
      {!loading && ai?.depthChange && (
        <Sub mt={8}>Conversations got <strong style={{color:"#3AF0C0"}}>{reportControl(ai.depthChange)}</strong> {arrowMap[ai.depthChange]||""} over time.</Sub>
      )}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="growth" prog={2} total={GROWTH_SCREENS} feedback={feedback("Who changed more", 2)}>
      <T>{t("Who changed more")}</T>
      <Big>{loading ? "…" : (ai?.whoChangedMore||"—")}</Big>
      <AICard label={t("How they changed")} value={ai?.whoChangedHow} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={3} total={GROWTH_SCREENS} feedback={feedback("What changed in the chat", 3)}>
      <T>{t("What changed in the chat")}</T>
      <AICard label={t("Topics that appeared")} value={ai?.topicsAppeared} loading={loading} />
      <AICard label={t("Topics that faded")} value={ai?.topicsDisappeared} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={4} total={GROWTH_SCREENS} feedback={feedback("Relationship trajectory", 4)}>
      <T>{t("Relationship trajectory")}</T>
      <Big>{loading ? "…" : (resultLang === "en" ? (trajMap[ai?.trajectory] || ai?.trajectory || "—") : reportControl(ai?.trajectory || "—"))}</Big>
      <AICard label={t("What the data shows")} value={ai?.trajectoryDetail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={5} total={GROWTH_SCREENS} feedback={feedback("The arc", 5)}>
      <T>{t("The arc")}</T>
      <AICard label={t("Overall read")} value={ai?.arcSummary} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ACCOUNTABILITY REPORT SCREENS  (7 cards)
// ─────────────────────────────────────────────────────────────────
const ACCOUNTA_SCREENS = 7;

function hasPromiseMoment(moment) {
  const person = String(moment?.person || "").toLowerCase();
  return Boolean(moment?.promise || moment?.outcome) && person !== "none clearly identified";
}

function PromiseMomentCard({ moment, emptyText }) {
  return (
    <div style={{ width:"100%", marginTop:16 }}>
      <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
        {hasPromiseMoment(moment) ? (
          <>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{moment?.date||""}{moment?.date&&moment?.person?" • ":""}{moment?.person||""}</div>
            <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{moment?.promise||"—"}"</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{moment?.outcome||""}</div>
          </>
        ) : (
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.72)", lineHeight:1.6 }}>{moment?.outcome || emptyText}</div>
        )}
      </div>
    </div>
  );
}

function AccountaReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const personATitle = `${ai?.personA?.name || s.names[0]}'s accountability`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s accountability`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "accounta", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="accounta" prog={1} total={ACCOUNTA_SCREENS} feedback={feedback("Promises made", 1)}>
      <T>{t("Promises made")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {[ai?.personA, ai?.personB].filter(Boolean).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center" }}>
            <div style={{ fontSize:34, fontWeight:800, color:"#fff" }}>{loading ? "—" : (p.total||0)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:4 }}>{t("promises")}</div>
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)", marginTop:6 }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall verdict")} value={ai?.overallVerdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="accounta" prog={2} total={ACCOUNTA_SCREENS} feedback={feedback(personATitle, 2)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: ai?.personA?.name || s.names[0] })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personA?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personA?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personA?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personA?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={3} total={ACCOUNTA_SCREENS} feedback={feedback(personBTitle, 3)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personB?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personB?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personB?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personB?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={4} total={ACCOUNTA_SCREENS} feedback={feedback("Fair comparison", 4)}>
      <T>{t("Fair comparison")}</T>
      <AICard label={t("Both sides")} value={ai?.comparison} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={5} total={ACCOUNTA_SCREENS} feedback={feedback("Follow-through pattern", 5)}>
      <T>{t("Follow-through pattern")}</T>
      <AICard label={t("Pattern")} value={ai?.followThroughPattern} loading={loading} />
      <AICard label={t("Evidence strength")} value={ai?.evidenceQuality} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={6} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable broken promise", 6)}>
      <T>{t("Most notable broken promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <PromiseMomentCard moment={ai?.notableBroken} emptyText={t("No clear meaningful broken promise showed up strongly enough in this chat.")} />
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={7} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable kept promise", 7)}>
      <T>{t("Most notable kept promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <PromiseMomentCard moment={ai?.notableKept} emptyText={t("No clear meaningful kept promise showed up strongly enough in this chat.")} />
      }
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ENERGY REPORT SCREENS  (6 cards)
// ─────────────────────────────────────────────────────────────────
const ENERGY_SCREENS = 6;
function EnergyReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personATitle = `${ai?.personA?.name || s.names[0]}'s energy`;
  const personBTitle = `${ai?.personB?.name || s.names[1] || s.names[0]}'s energy`;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "energy", cardIndex, cardTitle } : null
  );
  const screens = [
    <Shell sec="energy" prog={1} total={ENERGY_SCREENS} feedback={feedback("Net energy scores", 1)}>
      <T>{t("Net energy scores")}</T>
      <div style={{ width:"100%", display:"flex", gap:16, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5,type:""})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={90} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>{loading ? "…" : reportControl(p.type || "")}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Energy compatibility")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="energy" prog={2} total={ENERGY_SCREENS} feedback={feedback(personATitle, 2)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: ai?.personA?.name || s.names[0] })}</T>
      <AICard label={t("Positive energy")} value={ai?.personA?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personA?.venting} loading={loading} />
      {!loading && ai?.personA?.hypeQuote && <Quip>"{ai.personA.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={3} total={ENERGY_SCREENS} feedback={feedback(personBTitle, 3)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: ai?.personB?.name || s.names[1]||s.names[0] })}</T>
      <AICard label={t("Positive energy")} value={ai?.personB?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personB?.venting} loading={loading} />
      {!loading && ai?.personB?.hypeQuote && <Quip>"{ai.personB.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={4} total={ENERGY_SCREENS} feedback={feedback("Most energising moment", 4)}>
      <T>{t("Most energising moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostEnergising} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={5} total={ENERGY_SCREENS} feedback={feedback("Most draining moment", 5)}>
      <T>{t("Most draining moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostDraining} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={6} total={ENERGY_SCREENS} feedback={feedback("Energy compatibility", 6)}>
      <T>{t("Energy compatibility")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 12px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={72} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall read")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// PREMIUM FINALE — wrap-up for non-general reports
// ─────────────────────────────────────────────────────────────────
function PremiumFinale({ s, restart, back, reportType, fromHistory = false }) {
  const t = useT();
  const closeResults = useContext(CloseResultsContext);
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const sec = rtype?.palette || "upload";
  const p = PAL[sec] || PAL.upload;
  const primaryAction = fromHistory ? closeResults : restart;
  const primaryLabel  = fromHistory ? t("My Results") : t("Start over");
  return (
    <Shell sec={sec} prog={1} total={1} shareType="summary">
      <T s={22}>{t(rtype?.label || "Report complete")}</T>
      <Sub mt={4}>{s.names?.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}</Sub>
      <div data-share-hide style={{ display:"flex", gap:10, marginTop:24, width:"100%" }}>
        <GhostButton onClick={back} style={{ flex:1, width:"auto" }}>← {t("Back")}</GhostButton>
        <PrimaryButton onClick={primaryAction} color={p.accent} textColor={p.bg} style={{ flex:1, width:"auto" }}>{primaryLabel}</PrimaryButton>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// FINALE
// ─────────────────────────────────────────────────────────────────
function Finale({ s, ai, aiLoading, restart, back, prog, total, mode, resultId, fromHistory = false }) {
  const t = useT();
  const closeResults = useContext(CloseResultsContext);
  const feedback = resultId && (mode === "redflags" || ai?.vibeOneLiner)
    ? { resultId, reportType: mode === "redflags" ? "toxicity" : "general", cardIndex: prog, cardTitle: mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup ? "Your group, unwrapped." : "Your chat, unwrapped.") }
    : null;
  const cells = mode === "redflags"
    ? (s.isGroup
      ? [
          {label:"Most toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Ghost",value:s.ghost},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ]
      : [
          {label:"Status guess",value:ai?.relationshipStatus || s.relationshipStatus || "—"},
          {label:"More toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ])
    : (s.isGroup
      ? [
          {label:"Main character",value:s.mainChar},
          {label:"The ghost",value:s.ghost},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Top month",value:s.topMonths[0]?.[0]},
        ]
      : [
          {label:"Most texts",value:s.names[0]},
          {label:"Ghost award",value:s.ghostName},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Spirit emojis",value:s.spiritEmoji.join(" ")},
          {label:"Best streak",value:t("{count} days", { count: s.streak })},
        ]);
  return (
    <Shell sec="finale" prog={prog} total={total} feedback={feedback} shareType="summary">
      <T s={24}>{t(mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup?"Your group, unwrapped.":"Your chat, unwrapped."))}</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        {cells.map((c,i)=><Cell key={i} label={t(c.label)} value={c.value} />)}
      </div>
      {!aiLoading&&ai?.vibeOneLiner&&(
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:20,padding:"14px 18px",width:"100%",fontSize:14,fontStyle:"italic",color:"rgba(255,255,255,0.75)",textAlign:"center",lineHeight:1.6,fontWeight:500}}>"{ai.vibeOneLiner}"</div>
      )}
      <div data-share-hide style={{display:"flex",gap:10,marginTop:20,width:"100%"}}>
        <GhostButton onClick={back} style={{ flex:1, width:"auto" }}>← {t("Back")}</GhostButton>
        {fromHistory
          ? <PrimaryButton onClick={closeResults} color={PAL.finale.accent} textColor={PAL.finale.bg} style={{ flex:1, width:"auto" }}>{t("My Results")}</PrimaryButton>
          : <PrimaryButton onClick={restart} color={PAL.finale.accent} textColor={PAL.finale.bg} style={{ flex:1, width:"auto" }}>{t("Start over")}</PrimaryButton>
        }
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP CONTEXT HELPERS
// ─────────────────────────────────────────────────────────────────
function relContextStr(relType) {
  const map = {
    partner:   "committed romantic partner or spouse",
    dating:    "early stage or casual romantic relationship",
    ex:        "former romantic partner — the relationship has ended",
    family:    "This is a chat between the user and a family member (parent, sibling, or relative).",
    friend:    "This is a chat between the user and a close friend.",
    colleague: "This is a chat between the user and a work colleague.",
    other:     "This is a chat between the user and someone they know.",
  };
  return relType ? (map[relType] || "") : "";
}

function relReadLabel(relType) {
  return {
    partner:   "Partnership read",
    family:    "Family dynamic",
    friend:    "Friendship read",
    colleague: "Work dynamic",
  }[relType] || "Relationship read";
}

function relReadTitle(relType, specificRelationship = null) {
  const specific = String(specificRelationship || "").trim().toLowerCase();
  if (/spouse/.test(specific)) return "Marriage dynamic";
  if (/partner/.test(specific)) return "Partnership read";
  if (/dating/.test(specific)) return "Dating dynamic";
  if (/ex/.test(specific)) return "Ex dynamic";
  if (/father and child/.test(specific)) return "Father-child dynamic";
  if (/mother and child/.test(specific)) return "Mother-child dynamic";
  if (/siblings/.test(specific)) return "Sibling dynamic";
  if (/cousins/.test(specific)) return "Cousin dynamic";
  if (/grandparent and grandchild/.test(specific)) return "Grandparent dynamic";
  if (/aunt\/uncle and niece\/nephew/.test(specific)) return "Extended family dynamic";
  if (/best friends/.test(specific)) return "Best-friend dynamic";
  if (/close friends/.test(specific)) return "Friendship read";
  if (/boss and employee/.test(specific)) return "Boss-work dynamic";
  if (/colleagues/.test(specific)) return "Work dynamic";
  if (/family members/.test(specific)) return "Family dynamic";
  return relReadLabel(relType);
}

function hasAcceptedCurrentTerms(user) {
  const meta = user?.user_metadata || {};
  return meta.terms_accepted === true && meta.terms_version === LEGAL_VERSION;
}

function postAuthPhaseForUser(user) {
  const meta = user?.user_metadata || {};
  if (hasAcceptedCurrentTerms(user)) return hasUserProvidedDisplayName(user) ? "upload" : "profileName";
  if (meta.has_onboarded === true) return "terms";
  return "onboarding";
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP SELECT SCREEN
// ─────────────────────────────────────────────────────────────────
function RelationshipSelect({
  onSelect,
  onBack,
  error = "",
  showDebugPanel = false,
  debugJson = "",
  debugRawText = "",
  debugRawLabel = "",
  debugRawBusy = false,
  debugRelationshipType = null,
  onDebugRelationshipTypeChange = () => {},
  onDebugExport = () => {},
  onDebugCopy = () => {},
  onDebugDownload = () => {},
  onDebugRunRawCoreA = () => {},
  onDebugRunRawCoreB = () => {},
  onDebugCopyRaw = () => {},
  onDebugDownloadRaw = () => {},
}) {
  const t = useT();
  const [sel, setSel] = useState(null);
  const [extraChats, setExtraChats] = useState([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraError, setExtraError] = useState("");
  const extraInputId = "wrapchat-extra-chat-input";

  const handleExtraFile = async (file) => {
    if (!file || extraBusy) return;
    setExtraBusy(true);
    setExtraError("");
    try {
      const result = await processImportedChatFile(file);
      setExtraChats(prev => [...prev, {
        payload: result.payload,
        summary: result.summary,
        fileName: file.name || null,
      }]);
      setExtraOpen(true);
    } catch (err) {
      setExtraError(String(err?.message || "Couldn't open that file. Try exporting again."));
    } finally {
      setExtraBusy(false);
    }
  };

  const romanticOptions = [
    { id:"partner", label:"Partner",   icon:partnerIcon,   accent:DA.purple },
    { id:"dating",  label:"Dating",    icon:datingIcon,    accent:DA.amber  },
    { id:"ex",      label:"Ex",        icon:exIcon,        accent:DA.orange },
  ];
  const otherOptions = [
    { id:"family",    label:"Related",   icon:familyIcon,    accent:DA.teal  },
    { id:"friend",    label:"Friend",    icon:friendIcon,    accent:DA.blue  },
    { id:"colleague", label:"Colleague", icon:colleagueIcon, accent:DA.lime  },
    { id:"other",     label:"Other",     icon:otherIcon,     accent:DA.faint },
  ];

  const RelCard = ({ opt, flex }) => {
    const active = sel === opt.id;
    return (
      <button
        key={opt.id}
        type="button"
        onClick={() => setSel(opt.id)}
        className="wc-btn"
        style={{
          flex: flex || undefined,
          position:"relative",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          padding:"20px 10px 16px",
          borderRadius:20,
          background: "rgba(255,255,255,0.05)",
          border: active ? `1.5px solid ${opt.accent}` : "1px solid rgba(255,255,255,0.10)",
          color:"#fff", cursor:"pointer", transition:"all 0.18s",
          minHeight:100,
        }}
      >
        {active && (
          <div style={{
            position:"absolute", top:10, left:"50%", transform:"translateX(-50%)",
            width:7, height:7, borderRadius:"50%", background:opt.accent,
          }} />
        )}
        <img
          src={opt.icon} alt="" aria-hidden="true"
          style={{ width:32, height:32, objectFit:"contain", marginBottom:9,
            filter:"brightness(0) invert(1)", opacity: active ? 1 : 0.65 }}
        />
        <div style={{
          fontSize:14, fontWeight:800, letterSpacing:-0.2, textAlign:"center",
          color: active ? opt.accent : "rgba(255,255,255,0.85)",
        }}>
          {t(opt.label)}
        </div>
      </button>
    );
  };

  return (
    <Shell sec="upload" prog={1} total={3} contentAlign="start">
      <ScreenHeader back={onBack} title="Set up this chat" />

      {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{error}</div>}

      {/* ── Section A: relationship ── */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)" }}>
          Who is this with?
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, width:"100%" }}>
          {romanticOptions.map(opt => <RelCard key={opt.id} opt={opt} />)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, width:"100%" }}>
          {otherOptions.map(opt => <RelCard key={opt.id} opt={opt} />)}
        </div>
      </div>

      {/* ── Section B: extra chats — collapsible ── */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)" }}>
          Have more chats with this person?
        </div>
      <div style={{
        width:"100%",
        borderRadius:20,
        border: extraOpen ? "1px solid rgba(160,138,240,0.25)" : "1px solid rgba(255,255,255,0.08)",
        background: extraOpen ? "rgba(160,138,240,0.06)" : "rgba(255,255,255,0.02)",
        overflow:"hidden",
        transition:"border-color 0.2s, background 0.2s",
      }}>
        {/* Toggle header */}
        <button
          type="button"
          onClick={() => setExtraOpen(o => !o)}
          className="wc-btn"
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"14px 16px", background:"none", border:"none", cursor:"pointer",
            gap:10,
          }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {extraChats.length > 0 ? (
              <div style={{
                fontSize:11, fontWeight:800, background:"rgba(160,138,240,0.25)",
                color:"#A08AF0", borderRadius:999, padding:"2px 8px", flexShrink:0,
              }}>
                {extraChats.length + 1} chats added
              </div>
            ) : (
              <span style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.45)", letterSpacing:-0.1 }}>
                Add older exports or number changes
              </span>
            )}
          </div>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ flexShrink:0, transition:"transform 0.2s", transform: extraOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <path d="M2 4l4 4 4-4" stroke="rgba(255,255,255,0.4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Expanded body */}
        {extraOpen && (
          <div style={{ padding:"0 16px 16px" }}>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", lineHeight:1.7, marginBottom:14 }}>
              If they changed numbers or you have older exports, add them here and we&apos;ll read them together.
            </div>

            {extraChats.length > 0 && (
              <div style={{ marginBottom:14, display:"flex", flexDirection:"column", gap:6 }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", fontWeight:700 }}>
                  We&apos;ll combine them before analysis.
                </div>
                {extraChats.map((chat, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"7px 11px" }}>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {chat.fileName || `Chat ${i + 2}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExtraChats(prev => prev.filter((_, j) => j !== i))}
                      className="wc-btn"
                      style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:11, fontWeight:700, cursor:"pointer", padding:0, flexShrink:0 }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {extraError && (
              <div style={{ fontSize:12, color:"#FFB090", marginBottom:12, lineHeight:1.5 }}>{extraError}</div>
            )}

            <label
              htmlFor={extraInputId}
              className="wc-btn"
              style={{
                display:"block", textAlign:"center",
                fontSize:13, fontWeight:800,
                color: extraBusy ? "rgba(160,138,240,0.4)" : "#A08AF0",
                background: extraBusy ? "rgba(160,138,240,0.06)" : "rgba(160,138,240,0.12)",
                border:"1.5px solid rgba(160,138,240,0.35)",
                borderRadius:14, padding:"12px 18px",
                cursor: extraBusy ? "default" : "pointer",
                letterSpacing:-0.1,
              }}
            >
              {extraBusy ? "Opening…" : extraChats.length > 0 ? "+ Add another chat" : "+ Add another chat"}
            </label>
            <input
              id={extraInputId}
              type="file"
              accept=".txt,.zip,text/plain,application/zip"
              style={{ display:"none" }}
              onClick={e => { e.target.value = ""; }}
              onChange={e => handleExtraFile(e.target.files?.[0] || null)}
            />
          </div>
        )}
      </div>
      </div>

      <AiDebugPanel
        enabled={showDebugPanel}
        title="Admin AI debug"
        description="Pick a relationship type, inspect the exact request bundle, or fetch the untouched model reply for the compact connection and risk families."
        relationshipOptions={DEBUG_RELATIONSHIP_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
        selectedRelationshipType={debugRelationshipType}
        onRelationshipTypeChange={onDebugRelationshipTypeChange}
        exportDisabled={!debugRelationshipType}
        disabledReason={!debugRelationshipType ? "Choose a relationship type here to prepare the local debug bundle." : ""}
        jsonText={debugJson}
        onExport={onDebugExport}
        onCopy={onDebugCopy}
        onDownload={onDebugDownload}
        rawText={debugRawText}
        rawLabel={debugRawLabel}
        rawBusy={debugRawBusy}
        rawPrimaryLabel="Run Connection Raw"
        rawSecondaryLabel="Run Risk Raw"
        onRunRawCoreA={onDebugRunRawCoreA}
        onRunRawCoreB={onDebugRunRawCoreB}
        onCopyRaw={onDebugCopyRaw}
        onDownloadRaw={onDebugDownloadRaw}
      />

      <PrimaryButton
        onClick={() => sel && onSelect(sel, extraChats)}
        disabled={!sel}
        color={sel ? PAL.upload.accent : "rgba(255,255,255,0.12)"}
        textColor={sel ? DA.bg : "rgba(255,255,255,0.35)"}
      >
        <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>
      </PrimaryButton>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
function normalizeAuthError(error, mode) {
  const msg = (error?.message || "").toLowerCase();
  if (mode === "login") {
    if (msg.includes("email not confirmed"))
      return "Please confirm your email before logging in. Check your inbox.";
    if (msg.includes("invalid login") || msg.includes("invalid credentials") || msg.includes("user not found"))
      return "Email or password is incorrect.";
    return "Something went wrong. Please try again.";
  }
  // signup
  if (msg.includes("already registered") || msg.includes("already exists"))
    return "This email is already registered. Log in instead.";
  return "Something went wrong. Please try again.";
}

function Auth() {
  const [tab,      setTab]      = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);

  const switchTab = (t) => { setTab(t); setErr(""); setInfo(""); };

  const submit = async () => {
    if (!email || !password) { setErr("Please fill in both fields."); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(normalizeAuthError(error, "login"));
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` },
        });
        if (error) {
          setErr(normalizeAuthError(error, "signup"));
        } else if (data?.user?.identities?.length === 0) {
          // Supabase returns success with an empty identities array when the email
          // already exists and email confirmation is enabled (avoids enumeration
          // server-side). This is the only reliable client-side signal.
          setErr("This email is already registered. Log in instead.");
        } else {
          setInfo("Check your email to confirm your account, then log in.");
        }
      }
    } catch { setErr("Something went wrong. Please try again."); }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(0,0,0,0.25)",
    border: "1.5px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: "13px 16px",
    fontSize: 15,
    color: "#fff",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <BrandLockup
        logoSrc={wrapchatLogoTransparent}
        logoSize={72}
        subtitle="Your chats, unwrapped."
        subtitleMarginBottom={8}
      />

      {/* Tab toggle */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:999, padding:4, width:"100%", gap:4 }}>
        {[["login","Log in"],["signup","Sign up"]].map(([t,label]) => (
          <button key={t} onClick={() => switchTab(t)}
            style={{
              flex:1, border:"none", borderRadius:999, padding:"10px 0",
              fontSize:14, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
              background: tab === t ? "rgba(255,255,255,0.18)" : "transparent",
              color: tab === t ? "#fff" : "rgba(255,255,255,0.38)",
              letterSpacing: 0.2,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <input
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
      </div>

      {err  && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      {info && <div style={{ fontSize:13, color:"#B0F4C8", background:"rgba(20,160,80,0.15)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{info}</div>}

      <PrimaryButton onClick={submit} disabled={busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "…" : tab === "login" ? "Log in" : "Create account"}
      </PrimaryButton>

      <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center" }}>Your chat is analysed by AI and never stored. Only results are saved.</div>
      <div style={{ position:"absolute", left:20, right:20, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.28)", fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", pointerEvents:"none" }}>
        {HOMEPAGE_VERSION_LABEL}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING (3 screens, first-login only)
// ─────────────────────────────────────────────────────────────────
const ONBOARD_PILLS = [
  { label: "Toxicity",       palette: "toxicity" },
  { label: "Love Languages", palette: "lovelang" },
  { label: "Accountability", palette: "accounta" },
  { label: "Energy",         palette: "energy"   },
  { label: "Growth",         palette: "growth"   },
  { label: "Chat Wrapped",   palette: "upload"   },
];

const EXPORT_STEPS = [
  "Open your messaging app",
  "Tap the chat you want to analyse",
  "Tap ··· menu → More → Export Chat",
  "Choose Without Media",
  "Save the .txt file to your device",
];

function OnboardingFlow({ step, next, onOnboarded }) {
  const { uiLangPref } = useUILanguage();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err]           = useState("");
  const [selectedUiLang, setSelectedUiLang] = useState(uiLangPref);

  useEffect(() => {
    setSelectedUiLang(uiLangPref);
  }, [uiLangPref]);

  const markOnboarded = async (pref, thenCb) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.updateUser({ data: { has_onboarded: true, ui_language: normalizeUiLangPref(pref) } });
    } catch { /* silent — non-critical */ }
    thenCb?.();
  };

  const handleSkip   = () => markOnboarded("en", () => onOnboarded?.("en"));
  const handleFinish = () => markOnboarded(selectedUiLang, () => onOnboarded?.(selectedUiLang));

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={step + 1} total={4} scrollable={false}>

      {/* ── Screen 1: hook ── */}
      {step === 0 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Your relationship, in data.")}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.")}
        </div>
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Next")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
        <button onClick={handleSkip} className="wc-btn" style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, padding:"4px 8px", fontWeight:600 }}>{t("Skip")}</button>
      </>)}

      {/* ── Screen 2: export instructions ── */}
      {step === 1 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Start with your chat.")}
        </div>
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:9 }}>
          {EXPORT_STEPS.map((label, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:14, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"13px 16px" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:PAL.upload.inner, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>
                {i + 1}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:"#fff", lineHeight:1.4 }}>{t(label)}</div>
            </div>
          ))}
        </div>
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Next")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
      </>)}

      {/* ── Screen 3: launch ── */}
      {step === 2 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Upload. Analyse. See it clearly.")}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.")}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", width:"100%" }}>
          {ONBOARD_PILLS.map(pill => {
            const p = PAL[pill.palette] || PAL.upload;
            return (
              <div key={pill.label} style={{ background:p.inner, color:"#fff", borderRadius:50, padding:"7px 16px", fontSize:13, fontWeight:700, letterSpacing:0.1 }}>
                {t(pill.label)}
              </div>
            );
          })}
        </div>
        {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
      </>)}

      {step === 3 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Choose your language")}
        </div>
        <div style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:22, padding:"18px 16px", display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.58)", lineHeight:1.6 }}>
            {t("Auto selection will recognize the language from your chats.")}
          </div>
          <select
            value={selectedUiLang}
            onChange={e => setSelectedUiLang(e.target.value)}
            aria-label="App language"
            style={{
              width:"100%",
              height:44,
              background:"rgba(0,0,0,0.22)",
              border:"1px solid rgba(255,255,255,0.18)",
              borderRadius:14,
              color:"#fff",
              fontSize:14,
              fontWeight:800,
              padding:"0 12px",
              outline:"none",
              fontFamily:"inherit",
            }}
          >
            <option value="auto">{t("Auto-detect")}</option>
            {LANG_OPTIONS.map(option => (
              <option key={option.code} value={option.code}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </div>
        <PrimaryButton onClick={handleFinish} disabled={busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          {busy ? "…" : <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>}
        </PrimaryButton>
      </>)}

    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// TERMS & PRIVACY ACCEPTANCE (separate step, after onboarding)
// ─────────────────────────────────────────────────────────────────
function TermsFlow({ onAccepted, onLogout }) {
  const [activeTab,    setActiveTab]    = useState("tos");
  const [tosRead,      setTosRead]      = useState(false);
  const [privacyRead,  setPrivacyRead]  = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState("");
  const tosRef     = useRef(null);
  const privacyRef = useRef(null);

  const bothRead = tosRead && privacyRead;

  const checkRead = (tab) => {
    const el = tab === "tos" ? tosRef.current : privacyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      if (tab === "tos")     setTosRead(true);
      else                   setPrivacyRead(true);
    }
  };

  // check on mount in case content is shorter than container
  useEffect(() => { checkRead("tos"); checkRead("privacy"); }, []); // eslint-disable-line

  const acceptTerms = async () => {
    if (!bothRead || busy) return;
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          terms_accepted: true,
          terms_version: LEGAL_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      });
      if (error) { setErr(error.message || "Could not save. Please try again."); setBusy(false); return; }
      onAccepted?.();
    } catch {
      setErr("Could not save. Please try again.");
      setBusy(false);
    }
  };

  const tabBtn = (tab, isRead) => ({
    flex:1, border:"none", borderRadius:999, padding:"10px 6px",
    fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
    background: activeTab === tab ? "rgba(255,255,255,0.18)" : "transparent",
    color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.38)",
    letterSpacing:0.1,
    display:"flex", alignItems:"center", justifyContent:"center", gap:5,
    opacity: isRead && activeTab !== tab ? 0.7 : 1,
  });

  const scrollBox = {
    height:"40vh", overflowY:"auto",
    background:"rgba(0,0,0,0.22)", borderRadius:20,
    padding:"18px 20px", width:"100%",
    fontSize:12.5, color:"rgba(255,255,255,0.62)", lineHeight:1.8,
    fontFamily:"inherit", whiteSpace:"pre-wrap",
  };

  const checkMark = (read) => read
    ? <span style={{ color:PAL.growth.accent, fontWeight:800 }}>✓</span>
    : null;

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={0} total={1} scrollable={false}>
      <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>
        One thing before you start.
      </div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", textAlign:"center", lineHeight:1.6, width:"100%" }}>
        Read both documents below before continuing.
      </div>

      {/* Tab switcher */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:999, padding:4, width:"100%", gap:4 }}>
        <button onClick={() => setActiveTab("tos")} style={tabBtn("tos", tosRead)}>
          Terms of Service {checkMark(tosRead)}
        </button>
        <button onClick={() => setActiveTab("privacy")} style={tabBtn("privacy", privacyRead)}>
          Privacy Policy {checkMark(privacyRead)}
        </button>
      </div>

      {/* Scrollable document bodies — both mounted so scroll position is preserved */}
      <div
        ref={tosRef}
        onScroll={() => checkRead("tos")}
        style={{ ...scrollBox, display: activeTab === "tos" ? "block" : "none" }}
      >
        {TERMS_OF_SERVICE_TEXT}
      </div>
      <div
        ref={privacyRef}
        onScroll={() => checkRead("privacy")}
        style={{ ...scrollBox, display: activeTab === "privacy" ? "block" : "none" }}
      >
        {PRIVACY_POLICY_TEXT}
      </div>

      {!bothRead && (
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)", textAlign:"center" }}>
          {!tosRead && !privacyRead
            ? "Scroll through both documents to continue."
            : !tosRead
              ? "Scroll to the bottom of Terms of Service."
              : "Scroll to the bottom of Privacy Policy."}
        </div>
      )}

      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}

      <PrimaryButton onClick={acceptTerms} disabled={!bothRead || busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "Saving…" : "I have read and accept both documents."}
      </PrimaryButton>

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:999, color:"rgba(255,255,255,0.42)", fontSize:12, padding:"8px 14px", fontWeight:700 }}>Log out</button>}
      </div>
    </Shell>
  );
}

function ProfileNameSetup({ user, onSaved, onLogout }) {
  const initialName = userProvidedDisplayName(user);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  const canSave = cleanName.length >= 2 && !busy;

  const save = async () => {
    if (!canSave) {
      setErr("Enter the name that appears as you in your chats.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: cleanName,
          display_name: cleanName,
          profile_name_completed: true,
          profile_name_completed_at: new Date().toISOString(),
        },
      });
      if (error) {
        setErr(error.message || "Could not save your name. Please try again.");
        setBusy(false);
        return;
      }
      onSaved?.(data?.user || null);
    } catch {
      setErr("Could not save your name. Please try again.");
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(0,0,0,0.25)",
    border: "1.5px solid rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: "14px 16px",
    fontSize: 16,
    color: "#fff",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <BrandLockup
        logoSrc={wrapchatLogoTransparent}
        logoSize={62}
        subtitle="Your chats, unwrapped."
        subtitleMarginBottom={8}
      />
      <div style={{ fontSize:27, fontWeight:850, color:"#fff", letterSpacing:-1, lineHeight:1.12, textAlign:"center", width:"100%" }}>
        What name should we look for?
      </div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.58)", textAlign:"center", lineHeight:1.7, width:"100%" }}>
        Use the name that appears for you inside your exported chats. This helps WrapChat tell you apart from the other person and keeps My Results cleaner.
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
        <input
          type="text"
          placeholder="Your name in chats"
          value={name}
          autoFocus
          autoComplete="name"
          onChange={event => { setName(event.target.value); setErr(""); }}
          onKeyDown={event => event.key === "Enter" && save()}
          style={inputStyle}
        />
      </div>
      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      <PrimaryButton onClick={save} disabled={!canSave} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "Saving…" : "Continue"}
      </PrimaryButton>
      {onLogout && (
        <button onClick={onLogout} className="wc-btn" style={{ background:"none", border:"none", color:"rgba(255,255,255,0.32)", fontSize:12, padding:"4px 8px", fontWeight:700 }}>
          Log out
        </button>
      )}
    </Shell>
  );
}

function TooShort({ onBack }) {
  return (
    <Shell sec="upload" prog={0} total={1} scrollable={false}>
      <BrandLockup />
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"32px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-0.5, lineHeight:1.2 }}>
          Not enough messages to wrap
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:10, lineHeight:1.75 }}>
          This chat has fewer than {MIN_MESSAGES} messages after filtering system messages. WrapChat needs more to work with.
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", textAlign:"center", lineHeight:1.8 }}>
        Try exporting a longer chat history.
      </div>
      <GhostButton onClick={onBack}><BackIcon size={11} /> Upload a different file</GhostButton>
    </Shell>
  );
}

function DuplicateParticipantReview({ dataset, onContinue, onBack }) {
  const suggestions = getReviewableMergeSuggestions(dataset);
  const existingApprovedIds = (dataset?.mergeState?.approved || []).map(suggestion => suggestion.id);
  const [approvedIds, setApprovedIds] = useState([]);
  const markApproved = (id) => setApprovedIds(prev => prev.includes(id) ? prev : [...prev, id]);
  const markSeparate = (id) => setApprovedIds(prev => prev.filter(item => item !== id));

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      <ScreenHeader back={onBack} title="Review contacts" />
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"22px 20px", width:"100%" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-0.5, lineHeight:1.2 }}>
            We found possible duplicate contacts.
          </div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.58)", marginTop:10, lineHeight:1.65 }}>
            Choose which pairs should be treated as the same person before analysis.
          </div>
        </div>
        {suggestions.map(suggestion => {
          const active = approvedIds.includes(suggestion.id);
          return (
            <div key={suggestion.id} style={{
              background:"rgba(255,255,255,0.06)",
              border:`1px solid ${active ? PAL.upload.accent : "rgba(255,255,255,0.10)"}`,
              borderRadius:20,
              padding:16,
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[suggestion.participantA, suggestion.participantB].map((participant, index) => (
                  <div key={`${suggestion.id}-${index}`} style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                      Participant {index === 0 ? "A" : "B"}
                    </div>
                    <div style={{ marginTop:5, fontSize:15, color:"#fff", fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {participant.displayName || "Unknown"}
                    </div>
                    {participant.phone && (
                      <div style={{ marginTop:3, fontSize:12, color:"rgba(255,255,255,0.45)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {participant.phone}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button type="button" onClick={() => markApproved(suggestion.id)} className="wc-btn"
                  style={{ flex:1, borderRadius:999, padding:"10px 12px", border:`1px solid ${active ? PAL.upload.accent : "rgba(255,255,255,0.16)"}`, background:active ? PAL.upload.accent : "rgba(255,255,255,0.08)", color:active ? PAL.upload.bg : "#fff", fontSize:13, fontWeight:800 }}>
                  Approve
                </button>
                <button type="button" onClick={() => markSeparate(suggestion.id)} className="wc-btn"
                  style={{ flex:1, borderRadius:999, padding:"10px 12px", border:"1px solid rgba(255,255,255,0.16)", background:!active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)", color:"#fff", fontSize:13, fontWeight:700 }}>
                  Keep separate
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <PrimaryButton onClick={() => onContinue([...existingApprovedIds, ...approvedIds])}>Continue</PrimaryButton>
    </Shell>
  );
}

function ParticipantMismatchReview({ mismatch, onContinue, onBack }) {
  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      <ScreenHeader back={onBack} title="Review chats" />
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"22px 20px", width:"100%" }}>
        <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-0.5, lineHeight:1.2 }}>
          These chats may be from different people.
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.58)", marginTop:10, lineHeight:1.65 }}>
          Confirm before combining them into one analysis.
        </div>
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        {(mismatch?.rows || []).map(row => (
          <div key={row.chatId} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:PAL.upload.accent, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em" }}>
              {row.label}
            </div>
            <div style={{ marginTop:5, fontSize:16, color:"#fff", fontWeight:800 }}>{row.otherName}</div>
            {row.fileName && <div style={{ marginTop:4, fontSize:12, color:"rgba(255,255,255,0.42)" }}>{row.fileName}</div>}
          </div>
        ))}
      </div>
      <PrimaryButton onClick={onContinue}>Continue combined analysis</PrimaryButton>
      <GhostButton onClick={onBack}><BackIcon size={11} /> Go back and review files</GhostButton>
    </Shell>
  );
}

function AdminLocked({ onBack }) {
  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} contentAlign="start">
      <ScreenHeader back={onBack} title="Admin access only" />
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.58)", lineHeight:1.7 }}>
          This panel is only visible to the configured admin email.
        </div>
      </div>
    </Shell>
  );
}

function Upload({
  onParsed,
  onLogout,
  onHistory,
  onAdmin,
  onSettings,
  canAdmin,
  uploadError = "",
  uploadInfo = "",
  credits = null,
  quickReadAvailable = false,
  hideCredits = false,
  unlockedPackIds = {},
  accessMode = DEFAULT_ACCESS_MODE,
  onClearError,
  onUpgrade,
  onPayment,
}) {
  const t = useT();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const showAdminEntry = Boolean(onAdmin) && canAdmin;
  const uploadInputId = "wrapchat-upload-input";
  const displayErr = err || uploadError;

  const isPaymentsMode = !hideCredits && accessMode === "payments";
  const isTrialPending  = isPaymentsMode && quickReadAvailable;
  const isTrialUsed     = isPaymentsMode && !quickReadAvailable && credits === 0;

  const displayInfo = uploadInfo
    || (isTrialUsed ? t("No reads left. Unlock more insights.") : "")
    || (!hideCredits && !isPaymentsMode && credits === 0 ? OUT_OF_CREDITS_MESSAGE : "");

  const showCreditPill = !hideCredits && !isOpenMode(accessMode) && !isTrialPending && Number.isInteger(credits);

  const handle = async fileList => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    onClearError?.();
    setBusy(true); setErr("");
    try {
      const file = files[0];
      const result = await processImportedChatFile(file);
      onParsed({
        payload: result.payload,
        summary: result.summary,
        fileName: file.name || null,
      });
    } catch (error) {
      setErr(String(error?.message || "Couldn't open this file. Please export the chat again and retry."));
      setBusy(false);
    }
  };
  const showOpenPill = isOpenMode(accessMode) && !hideCredits;

  return (
    <Shell sec="upload" prog={0} total={1} scrollable={false}>
      {/* ── Absolute overlays (never participate in flex layout) ── */}
      {onHistory && (
        <div style={{ position:"absolute", top:16, left:16, zIndex:5 }}>
          <button type="button" onClick={onHistory} className="wc-btn" aria-label="My Results"
            style={{ width:40, height:40, borderRadius:"50%", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.14)", color:"rgba(255,255,255,0.7)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0, flexShrink:0 }}>
            <svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="1" y1="1.5" x2="15" y2="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="12.5" x2="15" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
      {showCreditPill && (
        <div style={{ position:"absolute", top:16, right:20, minHeight:40, zIndex:5, display:"flex", alignItems:"center" }}>
          <AnalysisDotsCounter credits={credits} activePackIds={unlockedPackIds} onAdd={onUpgrade || onPayment} hide={hideCredits} />
        </div>
      )}
      <div style={{ position:"absolute", left:20, right:20, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.28)", fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", pointerEvents:"none", zIndex:1 }}>
        {HOMEPAGE_VERSION_LABEL}
      </div>

      {/* ── Logo — pinned to 42% from top, never displaced by other elements ── */}
      <div style={{ position:"absolute", top:"32%", left:0, right:0, transform:"translateY(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"0 24px", zIndex:1 }}>
        <BrandLockup
          logoSrc={wrapchatLogoTransparent}
          logoSize={72}
          subtitle={t("Your chats, unwrapped.")}
          subtitleMarginBottom={showOpenPill ? 4 : 8}
        />
        {showOpenPill && (
          <div style={{
            fontSize:12, fontWeight:700,
            color:"rgba(176,244,200,0.9)",
            background:"rgba(20,160,80,0.12)",
            border:"1px solid rgba(20,160,80,0.28)",
            borderRadius:999,
            padding:"7px 18px",
            textAlign:"center",
          }}>
            Open testing · free reports
          </div>
        )}
      </div>

      {/* ── Action zone — snapped just below tagline, independent of logo ── */}
      <div style={{ position:"absolute", top:"calc(32% + 105px)", left:24, right:24, display:"flex", flexDirection:"column", gap:12 }}>
        <label
          htmlFor={uploadInputId}
          onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
          style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", cursor:"pointer", width:"100%", transition:"background 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.35)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.25)"}
        >
          <div style={{ fontSize:17, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>{busy ? t("Reading your chat…") : t("Upload your chat")}</div>
        </label>
        <input id={uploadInputId} type="file" accept=".txt,.zip,text/plain,application/zip" style={{ display:"none" }} onChange={e => handle(e.target.files)} />
        {isTrialPending && (
          <div style={{
            fontSize:13, fontWeight:700, color:"rgba(160,120,240,0.95)",
            background:"rgba(160,120,240,0.10)", border:"1px solid rgba(160,120,240,0.25)",
            borderRadius:14, padding:"11px 16px", width:"100%", textAlign:"center", lineHeight:1.6,
          }}>
            {t("You have 1 free Quick Read included. Upload a chat to get started.")}
          </div>
        )}
        {displayErr && <div style={{ fontSize:13, color:"#FFB090", textAlign:"center", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%" }}>{displayErr}</div>}
        {displayInfo && (
          <div style={{
            fontSize:13, color:"rgba(255,255,255,0.82)", textAlign:"center",
            background:"rgba(74,30,160,0.22)", border:"1px solid rgba(160,138,240,0.22)",
            padding:"11px 16px", borderRadius:16, width:"100%", lineHeight:1.6,
          }}>
            {displayInfo}
          </div>
        )}
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center" }}>{t("Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.")}</div>
        {showAdminEntry && (
          <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", flexWrap:"wrap", width:"100%" }}>
            <button onClick={onAdmin} className="wc-btn" style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.14)", borderRadius:999, color:"rgba(255,255,255,0.75)", fontSize:12, padding:"8px 14px", fontWeight:700, letterSpacing:0.1 }}>
              Admin
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────
function Loading({ math, reportType, reportTypes = [], loadingIndex = 0 }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => Math.min(x+1, LOADING_STEPS.length-1)), 1800); return () => clearInterval(t); }, []);
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const label = rtype?.label || "Analysis";
  const sec   = rtype?.palette || "upload";
  const pal   = PAL[sec] || PAL.upload;
  const queue = normalizeSelectedReportTypes(reportTypes);
  const queuePrefix = queue.length > 1 ? `${Math.min(loadingIndex + 1, queue.length)}/${queue.length} · ` : "";
  return (
    <Shell sec={sec} prog={tick+1} total={LOADING_STEPS.length} scrollable={false} hidePill>
      <BrandLockup accentColor={reportType ? pal.accent : null} />
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", textAlign:"center", fontWeight:500 }}>
        {queuePrefix}{t(label)} · {math.totalMessages.toLocaleString()} {t("messages")}
      </div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"24px 20px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#fff", minHeight:52, letterSpacing:-0.3 }}>{t(LOADING_STEPS[tick])}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:16 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"rgba(255,255,255,0.4)", animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)", textAlign:"center", lineHeight:1.8 }}>
        Your chat is analysed by AI and never stored. Only results are saved.
      </div>
    </Shell>
  );
}

function SettingsScreen({ onBack, onAccountDeleted, onLogout, onUserUpdated, reportLang = "en", onReportLangChange = () => {} }) {
  const t = useT();
  const { uiLangPref, updateUiLangPref } = useUILanguage();
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileInfo, setProfileInfo] = useState("");
  const [profileError, setProfileError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const autoLanguage = uiLangPref === "auto";
  const cleanProfileName = String(profileName || "").replace(/\s+/g, " ").trim();
  const canSaveProfileName = cleanProfileName.length >= 2 && !profileBusy;

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!alive) return;
      setProfileName(userProvidedDisplayName(user));
    });
    return () => { alive = false; };
  }, []);

  const saveProfileName = async () => {
    if (!canSaveProfileName) {
      setProfileError("Enter the name that appears as you in your chats.");
      setProfileInfo("");
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    setProfileInfo("");
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: cleanProfileName,
          display_name: cleanProfileName,
          profile_name_completed: true,
          profile_name_completed_at: new Date().toISOString(),
        },
      });
      if (error) {
        setProfileError(error.message || "Could not update your name. Please try again.");
        setProfileBusy(false);
        return;
      }
      if (data?.user) onUserUpdated?.(data.user);
      setProfileName(cleanProfileName);
      setProfileInfo("Name updated.");
    } catch {
      setProfileError("Could not update your name. Please try again.");
    }
    setProfileBusy(false);
  };

  const closeConfirm = () => {
    if (deleteBusy) return;
    setConfirmOpen(false);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCurrentAccount();
      onAccountDeleted?.();
    } catch (error) {
      console.error("Account deletion failed", error);
      setDeleteError("Couldn't delete your account. Please try again.");
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
        <div style={{
          alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", minHeight:0,
          margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        }}>
          <div style={{ padding:"19px 20px 12px", flexShrink:0 }}>
            <ScreenHeader back={onBack} title="Settings" />
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", gap:14, padding:"12px 20px calc(24px + env(safe-area-inset-bottom, 0px))" }}>
            <div style={{
              width:"100%",
              background:"rgba(255,255,255,0.06)",
              border:"1px solid rgba(255,255,255,0.10)",
              borderRadius:18,
              padding:"15px 16px",
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"#fff" }}>Your name</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  This is how WrapChat recognizes you in uploaded chats and keeps duo result cards focused on the other person.
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) auto", gap:8, alignItems:"center" }}>
                <input
                  type="text"
                  value={profileName}
                  placeholder="Your name in chats"
                  autoComplete="name"
                  onChange={event => {
                    setProfileName(event.target.value);
                    setProfileInfo("");
                    setProfileError("");
                  }}
                  onKeyDown={event => event.key === "Enter" && saveProfileName()}
                  aria-label="Your name in chats"
                  style={{
                    minWidth:0,
                    height:42,
                    background:"rgba(0,0,0,0.22)",
                    border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:14,
                    color:"#fff",
                    fontSize:14,
                    fontWeight:700,
                    padding:"0 12px",
                    outline:"none",
                    fontFamily:"inherit",
                  }}
                />
                <button
                  type="button"
                  onClick={saveProfileName}
                  disabled={!canSaveProfileName}
                  className="wc-btn"
                  style={{
                    height:42,
                    border:"1px solid rgba(255,255,255,0.14)",
                    background:canSaveProfileName ? PAL.upload.accent : "rgba(255,255,255,0.08)",
                    borderRadius:999,
                    color:canSaveProfileName ? PAL.upload.bg : "rgba(255,255,255,0.34)",
                    fontSize:13,
                    fontWeight:850,
                    padding:"0 16px",
                    cursor:canSaveProfileName ? "pointer" : "default",
                    whiteSpace:"nowrap",
                  }}
                >
                  {profileBusy ? "Saving…" : "Save"}
                </button>
              </div>
              {(profileInfo || profileError) && (
                <div style={{ fontSize:12, color:profileError ? "#FFB090" : "#B0F4C8", lineHeight:1.5 }}>
                  {profileError || profileInfo}
                </div>
              )}
            </div>
            <div style={{
              width:"100%",
              background:"rgba(255,255,255,0.06)",
              border:"1px solid rgba(255,255,255,0.10)",
              borderRadius:18,
              padding:"15px 16px",
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"#fff" }}>App language</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  {t("Auto selection will recognize the language from your chats.")}
                </div>
              </div>
              <div>
                <select
                  value={uiLangPref}
                  onChange={e => updateUiLangPref(e.target.value)}
                  aria-label="App language"
                  style={{
                    width:"100%",
                    height:42,
                    background:"rgba(0,0,0,0.22)",
                    border:`1px solid ${autoLanguage ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.28)"}`,
                    borderRadius:14,
                    color:"#fff",
                    fontSize:14,
                    fontWeight:700,
                    padding:"0 12px",
                    outline:"none",
                    fontFamily:"inherit",
                  }}
                >
                  <option value="auto">{t("Auto-detect")}</option>
                  {LANG_OPTIONS.map(option => (
                    <option key={option.code} value={option.code}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ height:1, background:"rgba(255,255,255,0.08)" }} />
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"#fff" }}>{t("Report language")}</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  The language used for generated reads.
                </div>
              </div>
              <select
                value={reportLang}
                onChange={e => onReportLangChange(e.target.value)}
                aria-label={t("Report language")}
                style={{
                  minWidth:0,
                  height:42,
                  background:"rgba(0,0,0,0.22)",
                  border:"1px solid rgba(255,255,255,0.18)",
                  borderRadius:14,
                  color:"#fff",
                  fontSize:14,
                  fontWeight:700,
                  padding:"0 12px",
                  outline:"none",
                  fontFamily:"inherit",
                }}
              >
                <option value="auto">{t("Auto-detect")}</option>
                {LANG_OPTIONS.map(option => (
                  <option key={option.code} value={option.code}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="wc-btn"
                style={{
                  width:"100%",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"space-between",
                  gap:14,
                  textAlign:"left",
                  background:"rgba(255,255,255,0.05)",
                  border:"1px solid rgba(255,255,255,0.10)",
                  borderRadius:18,
                  padding:"15px 16px",
                  color:"#fff",
                }}
              >
                <span style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"rgba(255,255,255,0.75)" }}>{t("Log out")}</span>
                <span style={{ fontSize:18, lineHeight:1, color:"rgba(255,255,255,0.28)" }}>›</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="wc-btn"
              style={{
                width:"100%",
                display:"flex",
                alignItems:"center",
                justifyContent:"space-between",
                gap:14,
                textAlign:"left",
                background:"rgba(224,64,64,0.12)",
                border:"1px solid rgba(224,64,64,0.35)",
                borderRadius:18,
                padding:"15px 16px",
                color:"#fff",
              }}
            >
              <span style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"#FF8E8E" }}>{t("Delete my account")}</span>
              <span style={{ fontSize:18, lineHeight:1, color:"rgba(255,142,142,0.55)" }}>›</span>
            </button>
          </div>
        </div>
      </Shell>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          style={{
            position:"fixed",
            inset:0,
            zIndex:220,
            background:"rgba(0,0,0,0.62)",
            backdropFilter:"blur(6px)",
            WebkitBackdropFilter:"blur(6px)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:"20px",
          }}
          onClick={closeConfirm}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width:"min(380px, calc(100vw - 32px))",
              background:"linear-gradient(180deg, #211426 0%, #161018 100%)",
              border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:24,
              padding:"22px 20px 18px",
              color:"#fff",
              boxShadow:"0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            <div id="delete-account-title" style={{ fontSize:20, fontWeight:900, letterSpacing:-0.5, lineHeight:1.15 }}>
              {t("Are you sure you want to delete your account?")}
            </div>
            <div style={{ marginTop:10, fontSize:14, lineHeight:1.6, color:"rgba(255,255,255,0.66)" }}>
              {t("All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.")}
            </div>
            {deleteError && (
              <div style={{ marginTop:14, fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.18)", border:"1px solid rgba(200,60,20,0.28)", padding:"10px 12px", borderRadius:14, lineHeight:1.45 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1.25fr", gap:10, marginTop:20 }}>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={deleteBusy}
                className="wc-btn"
                style={{
                  border:"1px solid rgba(255,255,255,0.12)",
                  background:"rgba(255,255,255,0.06)",
                  color:"rgba(255,255,255,0.72)",
                  borderRadius:16,
                  padding:"12px 10px",
                  fontSize:14,
                  fontWeight:800,
                  cursor:deleteBusy ? "default" : "pointer",
                  opacity:deleteBusy ? 0.55 : 1,
                }}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="wc-btn"
                style={{
                  border:"1px solid rgba(255,100,100,0.35)",
                  background:"rgba(224,64,64,0.82)",
                  color:"#fff",
                  borderRadius:16,
                  padding:"12px 10px",
                  fontSize:14,
                  fontWeight:900,
                  cursor:deleteBusy ? "wait" : "pointer",
                  opacity:deleteBusy ? 0.7 : 1,
                }}
              >
                {deleteBusy ? t("Deleting...") : t("Delete account")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// REPORT SELECT
// ─────────────────────────────────────────────────────────────────
const LANG_OPTIONS = [
  { code: "en", label: "English"    },
  { code: "tr", label: "Turkish"    },
  { code: "es", label: "Spanish"    },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic"     },
  { code: "fr", label: "French"     },
  { code: "de", label: "German"     },
  { code: "it", label: "Italian"    },
];

const DEBUG_RELATIONSHIP_OPTIONS = [
  { id: "partner", label: "Partner" },
  { id: "dating", label: "Dating" },
  { id: "ex", label: "Ex" },
  { id: "family", label: "Related" },
  { id: "friend", label: "Friend" },
  { id: "colleague", label: "Colleague" },
  { id: "other", label: "Other" },
];

function PackSelect({
  math,
  onRunPack,
  onBack,
  error = "",
  unlockedPackIds = {},
  credits = null,
  accessMode = DEFAULT_ACCESS_MODE,
  hideCredits = false,
  onOpenUnlock = () => {},
}) {
  const [openPack, setOpenPack] = useState("vibe");
  const stepProg  = math?.isGroup ? 1 : 2;
  const stepTotal = math?.isGroup ? 2 : 3;
  const showOpenNotice = !hideCredits && isOpenMode(accessMode);
  const showCreditsCounter = !hideCredits && !isOpenMode(accessMode) && Number.isInteger(credits);
  const isPackActive = (id) => Boolean(hideCredits || isOpenMode(accessMode) || unlockedPackIds?.[id]);

  return (
    <Shell sec="upload" prog={stepProg} total={stepTotal} contentAlign="start" hidePill>
      {showCreditsCounter && (
        <div style={{ position:"absolute", top:16, right:20, minHeight:40, zIndex:12, display:"flex", alignItems:"center" }}>
          <div style={{
            height:34,
            boxSizing:"border-box",
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:999,
            padding:"5px 10px",
          }}>
            <span style={{ fontSize:10, lineHeight:1, fontWeight:900, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)" }}>Credits</span>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, lineHeight:1, fontWeight:900, color:"#fff" }}>{credits}</span>
          </div>
        </div>
      )}
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column",
        margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        padding:"16px 20px 56px",
        minHeight:0,
      }}>
        <div style={{ marginBottom:14 }}>
          <ScreenHeader back={onBack} title="Pick your read" />
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.42)", lineHeight:1.5, textAlign:"center", margin:"-4px 8px 16px" }}>
          Choose the angle you want on this chat and uncover what is actually going on.
        </div>

	        {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", marginBottom:10 }}>{error}</div>}
        {showOpenNotice && (
          <div style={{ fontSize:12, color:"rgba(176,244,200,0.9)", background:"rgba(20,160,80,0.12)", border:"1px solid rgba(20,160,80,0.24)", borderRadius:14, padding:"8px 14px", width:"100%", textAlign:"center", lineHeight:1.6, marginBottom:10 }}>
            Open testing is active — analyses will not use credits.
          </div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {PACK_ORDER.map(id => {
            const pack = PACK_DEFS[id];
            const open = openPack === id;
            const active = isPackActive(id);
            const locked = !active;
            return (
              <div
                key={id}
                onClick={() => locked ? onOpenUnlock(id) : setOpenPack(current => current === id ? null : id)}
                className="wc-btn"
                style={{
                  borderRadius:22,
                  overflow:"hidden",
                  cursor:"pointer",
                  transition:"transform 0.18s cubic-bezier(0.2,0,0.1,1)",
                  background:active ? pack.bg : `${pack.accent}0C`,
                  border:`1.5px solid ${active ? `${pack.accent}55` : `${pack.accent}32`}`,
                  opacity:active ? 1 : 0.86,
                }}
              >
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:open ? "16px 18px 12px" : "16px 18px", transition:"padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <PackSwatch pack={pack} />
                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:"#fff", letterSpacing:"-0.015em" }}>{pack.name}</div>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.02em", color:locked ? "rgba(255,255,255,0.52)" : pack.accent, textAlign:"left" }}>{pack.cost} credits</div>
                    </div>
                  </div>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(255,255,255,0.10)", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.50)", fontSize:13, transform:open ? "rotate(180deg)" : "none", transition:"transform 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                    ▾
                  </div>
                </div>
                <div style={{ maxHeight:open ? 300 : 0, overflow:"hidden", opacity:open ? 1 : 0, padding:open ? "0 18px 18px" : "0 18px", transition:"max-height 0.35s cubic-bezier(0.2,0,0.1,1), opacity 0.22s ease, padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.52)", lineHeight:1.55, marginBottom:14, textAlign:"left" }}>
                    {pack.desc}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                    {pack.tags.map(tag => (
                      <span key={tag} style={{ background:"rgba(255,255,255,0.08)", borderRadius:999, padding:"4px 11px", fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.55)" }}>{tag}</span>
                    ))}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.38)" }}>
                      <strong style={{ fontSize:18, fontWeight:900, color:locked ? "rgba(255,255,255,0.45)" : "#fff", marginRight:4 }}>{active ? 1 : 0}</strong> left
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (locked) onOpenUnlock(id);
                        else onRunPack(pack);
                      }}
                      className="wc-btn"
                      style={{
                        borderRadius:999,
                        padding:"10px 22px",
                        fontSize:14,
                        fontWeight:700,
                        fontFamily:"'Nunito Sans',sans-serif",
                        cursor:"pointer",
                        border:"none",
                        background:locked ? pack.accent : pack.accent,
                        color:locked ? pack.fg : pack.fg,
                      }}
                    >
                      {locked ? "Unlock" : "Run"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ height:1, background:"rgba(255,255,255,0.07)", margin:"18px 0" }} />
        <button
          type="button"
          onClick={() => onOpenUnlock(null)}
          className="wc-btn"
          style={{ width:"100%", padding:14, borderRadius:999, background:"transparent", border:"1.5px solid rgba(255,255,255,0.14)", color:"rgba(255,255,255,0.48)", fontSize:14, fontWeight:600, fontFamily:"'Nunito Sans',sans-serif", cursor:"pointer", textAlign:"center" }}
        >
          Get more credits
        </button>
      </div>
    </Shell>
  );
}

function PaymentScreen({ preselect = null, credits = null, userId = null, onBack, onPaymentComingSoon }) {
  const getSuggestedBundleId = () => {
    const packCost = getPackCreditCost(preselect);
    const balance = Number.isInteger(credits) ? credits : 0;
    const needed = packCost != null ? Math.max(packCost - balance, 0) : 0;
    if (needed > 0) {
      return CREDIT_BUNDLES.find(bundle => bundle.credits >= needed)?.id || "plus";
    }
    return "plus";
  };
  const [selectedBundleId, setSelectedBundleId] = useState(getSuggestedBundleId);

  useEffect(() => {
    setSelectedBundleId(getSuggestedBundleId());
  }, [preselect, credits]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedBundle = getCreditBundleById(selectedBundleId) || CREDIT_BUNDLES[1];
  const analysesLeft = estimateAnalysesLeft(credits);

  const pay = (bundle = selectedBundle) => {
    if (!bundle) return;
    console.log("Payment coming soon", {
      creditBundleId: bundle.id,
      credits: bundle.credits,
      price: bundle.price,
      priceLabel: bundle.priceLabel,
      userId: userId || null,
    });
    onPaymentComingSoon?.();
  };

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hidePill>
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column",
        margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        padding:"16px 20px 56px",
        minHeight:0,
      }}>
        <div style={{ marginBottom:10 }}>
          <ScreenHeader back={onBack} title="Add Credits" />
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.42)", lineHeight:1.5, marginBottom:18 }}>Add credits once. Use them whenever you want.</div>

        <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:9, minWidth:0 }}>
              <span style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)", whiteSpace:"nowrap" }}>Your balance</span>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, lineHeight:1, fontWeight:900, color:"#fff", letterSpacing:"-0.02em" }}>{Number.isInteger(credits) ? credits : "—"}</span>
              <span style={{ fontSize:12, fontWeight:800, color:"rgba(255,255,255,0.34)" }}>credits</span>
            </div>
            <div style={{ fontSize:12, fontWeight:800, color:"rgba(255,255,255,0.44)", whiteSpace:"nowrap" }}>≈ up to {analysesLeft} reads</div>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)", margin:"0 2px 2px" }}>Add Credits</div>
          {CREDIT_BUNDLES.map(bundle => {
            const active = selectedBundleId === bundle.id;
            return (
              <button
                key={bundle.id}
                type="button"
                onClick={() => setSelectedBundleId(bundle.id)}
                className="wc-btn"
                style={{
                  borderRadius:20,
                  padding:"14px 16px",
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                  cursor:"pointer",
                  border:`1.5px solid ${active ? "rgba(196,170,255,0.62)" : "rgba(255,255,255,0.07)"}`,
                  background:active ? "rgba(74,30,160,0.26)" : "rgba(255,255,255,0.04)",
                  color:"#fff",
                  textAlign:"left",
                }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                  <div style={{ width:42, height:42, borderRadius:14, background:bundle.recommended ? "rgba(196,170,255,0.24)" : "rgba(255,255,255,0.08)", border:`1px solid ${bundle.recommended ? "rgba(196,170,255,0.42)" : "rgba(255,255,255,0.12)"}`, display:"flex", alignItems:"center", justifyContent:"center", color:bundle.recommended ? "#C4AAFF" : "rgba(255,255,255,0.66)", fontWeight:900 }}>
                    {bundle.credits}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:0 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:16, fontWeight:900, color:"#fff", letterSpacing:"-0.01em", display:"flex", alignItems:"center", gap:5 }}>
                      <span>{bundle.label}</span>
                      {bundle.recommended && <SolidStarIcon size={12} color="#C4AAFF" />}
                      {bundle.recommended && (
                        <span style={{ border:"1px solid rgba(196,170,255,0.38)", background:"rgba(196,170,255,0.13)", color:"#C4AAFF", borderRadius:999, padding:"2px 7px", fontSize:9, lineHeight:1.1, fontWeight:900, letterSpacing:"0.08em", textTransform:"uppercase" }}>
                          Popular
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:active ? "rgba(196,170,255,0.78)" : "rgba(255,255,255,0.38)", lineHeight:1.35, whiteSpace:"normal" }}>
                      {bundle.credits} credits
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:bundle.recommended ? "#C4AAFF" : "rgba(255,255,255,0.74)", flexShrink:0 }}>{bundle.priceLabel}</div>
              </button>
            );
          })}
        </div>

        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"16px 18px", marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)", marginBottom:10 }}>What can I do with credits?</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {PACK_ORDER.map(id => {
              const pack = PACK_DEFS[id];
              return (
                <div key={id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.68)", fontWeight:700 }}>{pack.name}</div>
                  <div style={{ fontSize:13, color:pack.accent, fontWeight:900 }}>{pack.cost} credits</div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => pay(selectedBundle)}
          className="wc-btn"
          style={{ width:"100%", padding:17, borderRadius:999, border:"none", fontSize:16, fontWeight:700, fontFamily:"'Nunito Sans',sans-serif", cursor:"pointer", marginBottom:12, background:"#C4AAFF", color:"#100630" }}
        >
          Add {selectedBundle?.credits || 0} credits
        </button>

        <div style={{ textAlign:"center", fontSize:12, color:"rgba(255,255,255,0.20)", lineHeight:1.6 }}>
          <strong style={{ color:"rgba(255,255,255,0.38)", fontWeight:600 }}>Credits never expire.</strong> One-time purchases only.<br/>No subscriptions. Leftover credits stay in your account.
        </div>
      </div>
    </Shell>
  );
}

function resultPreviewFields(row) {
  const displayLang = getStoredResultDisplayLanguage(row?.result_data);
  const ai = getDisplayResultData(row?.result_data, displayLang);
  const math = row?.math_data || {};
  const control = (value) => translateControlValue(displayLang, value) || value;
  switch (row?.report_type) {
    case "general": {
      const score = math.bondScore ?? math.connectionScore ?? math.chatScore ?? null;
      return {
        stat: score != null ? String(score) : `${Math.min(10, Math.max(1, Math.round(((math.streak || 0) / 30) + 6)))}`,
        label: "bond score",
        insight: ai?.vibeOneLiner || ai?.relationshipSummary || ai?.groupDynamic || ai?.takeaway || "Your full chat read is ready.",
        title: "Your Chat, Unwrapped",
      };
    }
    case "lovelang": {
      const lang = control(ai?.personA?.language || ai?.personB?.language || "");
      return {
        stat: lang ? String(lang).split(/\s+/)[0] : "—",
        label: "primary",
        insight: ai?.compatibilityRead || ai?.personA?.examples || ai?.mismatch || "Your love language read is ready.",
        title: "How You Show Up",
      };
    }
    case "energy": {
      const scores = [ai?.personA?.netScore, ai?.personB?.netScore].map(Number).filter(Number.isFinite);
      const avg = scores.length ? Math.round((scores.reduce((sum, n) => sum + n, 0) / scores.length) * 10) : null;
      return {
        stat: avg != null ? `${avg}%` : "—",
        label: "positive",
        insight: ai?.compatibility || ai?.personA?.goodNews || ai?.mostEnergising || "Your energy read is ready.",
        title: "The Energy Between You",
      };
    }
    case "toxicity":
      return {
        stat: ai?.chatHealthScore != null ? `${ai.chatHealthScore}/10` : (chatHealthLabel(ai?.chatHealthScore) || math.toxicityLevel || "—"),
        label: "health",
        insight: ai?.verdict || ai?.conflictPattern || "Your red flags read is ready.",
        title: "What Feels Off",
      };
    case "accounta": {
      const a = ai?.personA;
      const b = ai?.personB;
      const lead = [a, b].filter(Boolean).sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))[0];
      return {
        stat: lead?.name ? shortDisplayName(lead.name) : `${a?.kept || 0}/${b?.kept || 0}`,
        label: "steady",
        insight: ai?.overallVerdict || lead?.detail || ai?.followThroughPattern || "Your accountability read is ready.",
        title: "Promises & Follow-Through",
      };
    }
    case "growth":
      return {
        stat: control(ai?.trajectory) || "—",
        label: "trajectory",
        insight: ai?.arcSummary || ai?.trajectoryDetail || "Your growth read is ready.",
        title: "The Arc",
      };
    default:
      return { stat:"—", label:"read", insight:"Your report is ready.", title:reportTypeMeta(row?.report_type).label };
  }
}

function shortDisplayName(name) {
  return String(name || "—").trim().split(/\s+/)[0] || "—";
}

function PackResultsBuffer({ rows, pack, onClose, onOpenReport }) {
  const orderedRows = [...(rows || [])].sort((a, b) => {
    const ai = pack.reports.indexOf(a.report_type);
    const bi = pack.reports.indexOf(b.report_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const runDate = orderedRows[0]?.created_at;
  const firstRow = orderedRows[0] || {};
  const participantLabel = (() => {
    const names = Array.isArray(firstRow?.names) ? firstRow.names.filter(Boolean) : [];
    const namesTitle = compactNamesLabel(names);
    if (namesTitle) return namesTitle;
    const displayTitle = firstRow?.result_data?.runMetadata?.displayTitle || firstRow?.math_data?.display_title || firstRow?.math_data?.displayTitle || "";
    return String(displayTitle || "").replace(/,\s*combined\b/i, "").trim();
  })();
  const titleNode = (
    <div style={{ display:"flex", flexDirection:"column", gap:5, minWidth:0 }}>
      <span style={{ display:"block", fontSize:participantLabel.length > 24 ? 23 : 27, lineHeight:1.04, fontWeight:900, letterSpacing:-1, overflowWrap:"anywhere" }}>
        {participantLabel || pack.name}
      </span>
      {participantLabel && (
        <span style={{ display:"block", width:"fit-content", maxWidth:"100%", borderRadius:999, padding:"3px 9px", background:`${pack.accent}20`, border:`1px solid ${pack.accent}55`, color:pack.accent, fontSize:10, lineHeight:1.1, fontWeight:900, letterSpacing:"0.08em", textTransform:"uppercase" }}>
          {pack.name}
        </span>
      )}
    </div>
  );
  const daysAgo = (() => {
    const diff = Math.floor((new Date() - new Date(runDate)) / 864e5);
    if (!Number.isFinite(diff) || diff <= 0) return "today";
    if (diff === 1) return "1 day ago";
    return `${diff} days ago`;
  })();

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hidePill palette={{ ...PAL.upload, bg:pack.bg, inner:pack.cardBg || pack.inner, accent:pack.accent }}>
      <div style={{ alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))", padding:"16px 20px calc(96px + env(safe-area-inset-bottom, 0px))", minHeight:0, overflowY:"auto", overscrollBehavior:"contain" }}>
        <div style={{ marginBottom:18 }}>
          <ScreenHeader back={onClose} titleNode={titleNode} />
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {orderedRows.map(row => {
            const rt = reportTypeMeta(row.report_type);
            const pal = PAL[rt.palette] || PAL.upload;
            const style = REPORT_BUFFER_STYLE[row.report_type] || REPORT_BUFFER_STYLE.general;
            const preview = resultPreviewFields(row);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenReport(row)}
                className="wc-btn"
                style={{ borderRadius:24, padding:20, cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", flexDirection:"column", background:style.bg, border:`1.5px solid ${style.border}`, color:"#fff", textAlign:"left" }}
              >
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                    <SwatchIcon inner={pal.inner} accent={pal.accent} />
                    <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                      <div style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", width:"fit-content", background:style.pillBg, color:pal.accent, border:`1px solid ${style.pillBorder}` }}>
                        {rt.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.40)", fontSize:14, marginTop:2 }}>›</div>
                </div>
                <div style={{ height:1, background:"rgba(255,255,255,0.08)", marginBottom:14 }} />
                <div style={{ display:"flex", alignItems:"stretch", gap:12 }}>
                  <div style={{ display:"flex", flexDirection:"column", flexShrink:0, minWidth:52 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1, color:pal.accent }}>{preview.stat}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.32)", letterSpacing:"0.06em", textTransform:"uppercase", marginTop:3 }}>{preview.label}</div>
                  </div>
                  <div style={{ width:1, background:"rgba(255,255,255,0.08)", alignSelf:"stretch" }} />
                  <div style={{ fontSize:13, fontWeight:500, fontStyle:"italic", color:"rgba(255,255,255,0.65)", lineHeight:1.55, flex:1 }}>
                    "{cleanQuote(preview.insight, 120)}"
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop:24, textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.20)", lineHeight:1.6, letterSpacing:"0.02em" }}>
          {orderedRows.length} reports · {pack.name} · run {daysAgo}
        </div>
      </div>
    </Shell>
  );
}

function UpgradePlaceholder({ info, onBack, credits = null, userRole = "user", accessMode = "credits", onOpenPayment = () => {}, onUnlockPack = null }) {
  const t = useT();
  const mode      = info?.accessMode || accessMode;

  const isPayments = mode === "payments";
  const isTester   = userRole === "tester";
  const canUnlockWithCredits = (isPayments || mode === "credits") && !isTester;
  const balance = Number.isInteger(credits) ? credits : null;
  const initialPackId = PACK_ORDER.find(id => PACK_DEFS[id].cost === info?.requiredCredits) || "vibe";
  const [selected, setSelected] = useState(() => (
    Object.fromEntries(PACK_ORDER.map(id => [id, id === initialPackId ? 1 : 0]))
  ));

  const selectedIds = PACK_ORDER.filter(id => (selected[id] || 0) > 0);
  const selectedItemCount = selectedIds.reduce((sum, id) => sum + (selected[id] || 0), 0);
  const selectedCreditTotal = selectedIds.reduce((sum, id) => sum + (PACK_DEFS[id].cost * (selected[id] || 0)), 0);
  const selectedSingleId = selectedItemCount === 1 ? selectedIds[0] : null;
  const selectedPack = selectedSingleId ? PACK_DEFS[selectedSingleId] : null;
  const hasEnoughCredits = balance != null && selectedCreditTotal > 0 && balance >= selectedCreditTotal;
  const remainingAfterSelection = balance != null ? balance - selectedCreditTotal : null;
  const canUnlockSelection = hasEnoughCredits && selectedSingleId && selectedPack && onUnlockPack;
  const packDescriptionText = (id) => (
    id === "vibe" ? "See the connection style, affection, and energy underneath the chat." :
    id === "rf" ? "Spot tension, accountability gaps, and moments worth noticing." :
    id === "full" ? "Get the complete relationship read in one full pass." :
    "Track how the chat has changed from early days to now."
  );

  const changeQty = (id, delta) => {
    setSelected(prev => {
      const current = prev[id] || 0;
      return { ...prev, [id]: Math.max(0, Math.min(9, current + delta)) };
    });
  };

  const handlePrimary = () => {
    if (!canUnlockSelection) return;
    if (selectedPack && onUnlockPack) {
      onUnlockPack(selectedPack);
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      {canUnlockWithCredits && (
        <div style={{ position:"absolute", top:16, right:20, minHeight:40, zIndex:12, display:"flex", alignItems:"center" }}>
          <div style={{
            height:34,
            boxSizing:"border-box",
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:999,
            padding:"5px 7px 5px 10px",
          }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
              <span style={{ fontSize:10, lineHeight:1, fontWeight:900, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)" }}>Credits</span>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, lineHeight:1, fontWeight:900, color:"#fff" }}>{balance != null ? balance : "—"}</span>
            </div>
            {isPayments && (
              <>
                <div style={{ width:1, height:14, background:"rgba(255,255,255,0.12)", margin:"0 1px" }} />
                <button
                  type="button"
                  onClick={() => onOpenPayment(null)}
                  className="wc-btn"
                  aria-label="Add Credits"
                  style={{
                    width:22, height:22, borderRadius:"50%",
                    background:"rgba(255,255,255,0.10)",
                    border:"1px solid rgba(255,255,255,0.16)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"rgba(255,255,255,0.65)",
                    fontSize:14, fontWeight:400, lineHeight:1,
                    padding:0, flexShrink:0, cursor:"pointer",
                  }}
                >
                  +
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <ScreenHeader back={onBack} backLabel="Back to reports" title={canUnlockWithCredits ? "Unlock reads" : "More credits needed"} />

      {canUnlockWithCredits ? (
        <>
          <Sub mt={2}>{isPayments ? t("Choose the reads you want to unlock. Leftover credits stay in your account.") : t("Choose the reads you want to unlock with your available credits.")}</Sub>

          <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
            {PACK_ORDER.map(id => {
              const pack = PACK_DEFS[id];
              const qty = selected[id] || 0;
              const active = qty > 0;
              return (
                <div
                  key={id}
                  className="wc-btn"
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                    background:active ? pack.paymentSelectedBg : `${pack.accent}0C`,
                    border:`1.5px solid ${active ? pack.paymentSelectedBorder : `${pack.accent}45`}`,
                    borderRadius:18,
                    padding:"12px 14px",
                    color:"#fff",
                    textAlign:"left",
                    cursor:"pointer",
                  }}
                  onClick={() => !active && changeQty(id, 1)}
                >
                  <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                    <PackSwatch pack={pack} />
                    <div style={{ minWidth:0, flex:"1 1 auto" }}>
                      <div style={{ fontSize:14, fontWeight:900, color:"#fff" }}>{pack.name}</div>
                      <div style={{
                        fontSize:11,
                        color:active ? `${pack.accent}B3` : "rgba(255,255,255,0.46)",
                        lineHeight:1.35,
                        display:"-webkit-box",
                        WebkitLineClamp:2,
                        WebkitBoxOrient:"vertical",
                        overflow:"hidden",
                      }}>
                        {packDescriptionText(id)}
                      </div>
                      <div style={{ fontSize:10, fontWeight:900, letterSpacing:"0.07em", textTransform:"uppercase", color:active ? pack.accent : "rgba(255,255,255,0.32)", marginTop:6 }}>
                        {pack.reports.length === 6 ? "All 6 reports" : `${pack.reports.length} ${pack.reports.length === 1 ? "report" : "reports"}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8, flexShrink:0, minWidth:active ? 106 : 78 }}>
                    {!active ? (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); changeQty(id, 1); }}
                        className="wc-btn"
                        style={{ border:"none", background:"transparent", padding:"8px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:900, color:pack.accent, cursor:"pointer" }}
                      >
                        {pack.cost} cr
                      </button>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:5, border:`1px solid ${pack.accent}66`, background:"rgba(0,0,0,0.14)", borderRadius:999, padding:3 }}>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); changeQty(id, -1); }}
                          className="wc-btn"
                          aria-label={`Remove ${pack.name}`}
                          style={{ width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.10)", color:"rgba(255,255,255,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:0, fontSize:15, fontWeight:800, cursor:"pointer" }}
                        >
                          -
                        </button>
                        <div style={{ width:20, textAlign:"center", fontSize:13, fontWeight:900, color:pack.accent }}>{qty}</div>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); changeQty(id, 1); }}
                          className="wc-btn"
                          aria-label={`Add ${pack.name}`}
                          style={{ width:22, height:22, borderRadius:"50%", border:"none", background:pack.accent, color:pack.fg, display:"flex", alignItems:"center", justifyContent:"center", padding:0, fontSize:15, fontWeight:900, cursor:"pointer" }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ width:"100%", background:"rgba(255,255,255,0.045)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
            {selectedIds.length ? selectedIds.map(id => {
              const pack = PACK_DEFS[id];
              const qty = selected[id] || 0;
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div style={{ fontSize:13, color:`${pack.accent}CC`, fontWeight:800 }}>{pack.name}{qty > 1 ? ` x${qty}` : ""}</div>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.66)", fontWeight:800 }}>{pack.cost * qty} credits</div>
                </div>
              );
            }) : (
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.24)" }}>Nothing selected yet</div>
            )}
            <div style={{ height:1, background:"rgba(255,255,255,0.07)", margin:"2px 0" }} />
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
              <div style={{ fontSize:14, fontWeight:900, color:"#fff" }}>Total</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:24, fontWeight:900, color:selectedPack?.accent || "#fff" }}>{selectedCreditTotal} credits</div>
            </div>
            {remainingAfterSelection != null && (
              <div style={{ fontSize:12, color:remainingAfterSelection >= 0 ? "rgba(255,255,255,0.44)" : "rgba(255,176,144,0.86)", textAlign:"right", fontWeight:800 }}>
                {remainingAfterSelection >= 0 ? `${remainingAfterSelection} credits left after unlock` : `${Math.abs(remainingAfterSelection)} more credits needed`}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handlePrimary}
            disabled={!canUnlockSelection}
            className="wc-btn"
            style={{ width:"100%", padding:16, borderRadius:999, border:"none", fontSize:16, fontWeight:800, fontFamily:"'Nunito Sans',sans-serif", cursor:canUnlockSelection ? "pointer" : "default", background:canUnlockSelection ? (selectedPack?.accent || "#C4AAFF") : "rgba(255,255,255,0.10)", color:canUnlockSelection ? (selectedPack?.fg || "#100630") : "rgba(255,255,255,0.30)", opacity:canUnlockSelection ? 1 : 0.72 }}
          >
            Unlock
          </button>
          {selectedItemCount > 1 && hasEnoughCredits && (
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.34)", textAlign:"center", lineHeight:1.5 }}>Pick one read to unlock on this chat.</div>
          )}
          {!hasEnoughCredits && selectedCreditTotal > 0 && (
            <button
              type="button"
              onClick={() => isPayments ? onOpenPayment(selectedSingleId) : null}
              disabled={!isPayments}
              className="wc-btn"
              style={{ width:"100%", padding:14, borderRadius:999, background:isPayments ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", border:"1.5px solid rgba(255,255,255,0.12)", color:isPayments ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.34)", fontSize:14, fontWeight:700, fontFamily:"'Nunito Sans',sans-serif", cursor:isPayments ? "pointer" : "default", textAlign:"center" }}
            >
              {isPayments ? "Add Credits" : "Ask admin for more credits"}
            </button>
          )}
        </>
      ) : isTester ? (
        <Sub mt={2}>{t("You're in beta testing mode — credits are managed by the admin. Reach out to get more.")}</Sub>
      ) : (
        <Sub mt={2}>{info?.message || t("You need credits to run these reports. Ask an admin to add credits to your account.")}</Sub>
      )}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SLIDE
// ─────────────────────────────────────────────────────────────────
// SLIDE_MS and SLIDE_EASE are defined above Shell, which consumes them.

// Slide is now a thin context provider only.
// Shell consumes SlideContext and animates its content area internally,
// keeping the chrome (background, progress bar, pill, close button) perfectly still.
function Slide({ children, dir, id }) {
  return (
    <SlideContext.Provider value={{ dir, id }}>
      {children}
    </SlideContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// CREDITS
// ─────────────────────────────────────────────────────────────────
const OUT_OF_CREDITS_MESSAGE = "You've used all your credits. More coming soon — stay tuned.";

function parseCreditBalance(value) {
  const candidate = (
    value && typeof value === "object" && !Array.isArray(value)
      ? (value.balance ?? value.new_balance ?? value.credit_balance ?? value.credits ?? null)
      : value
  );

  if (candidate == null) return null;

  const parsed = Number.parseInt(String(candidate), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function getUserCredits() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return null;

  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return parseCreditBalance(data);
}

async function getUserProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return { balance: null, role: "user", quickReadAvailable: false };

  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  const balance = parseCreditBalance(data);
  const role = String(data?.role || "user").trim().toLowerCase();
  const quickReadAvailable = data?.quick_read_available !== false && !data?.quick_read_used_at;
  return { balance, role, quickReadAvailable };
}

async function initialiseUserCredits(userEmail = null) {
  const existingBalance = await getUserCredits();
  if (existingBalance !== null) return existingBalance;

  const { error } = await supabase.functions.invoke("initialise-credits", {
    body: { email: userEmail ?? null },
  });
  if (error) throw error;

  return await getUserCredits();
}

async function consumeQuickReadTrial(userId) {
  if (!userId) return false;
  const { data, error } = await supabase.rpc("consume_quick_read_trial", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data === true;
}

async function deleteCurrentAccount() {
  const { error } = await supabase.functions.invoke("delete-account");
  if (error) throw error;
  try {
    await supabase.auth.signOut();
  } catch {
    // The Edge Function already deleted the auth user; local cleanup continues below.
  }
}

// ─────────────────────────────────────────────────────────────────
// SAVE RESULT
// ─────────────────────────────────────────────────────────────────
async function saveResult(type, result, mathData, bundleId = null, creditMeta = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const generatedAt = new Date().toISOString();
    const visibleNames = namesWithoutCurrentUser(mathData.names, user);
    const displayTitle = compactNamesLabel(visibleNames) || mathData.displayTitle || "WrapChat result";
    const datasetKind = mathData.datasetKind || "single";
    const sourceChatCount = mathData.sourceChatCount || 1;
    const registeredName = normalizeDisplayName(userProvidedDisplayName(user));
    const savedNames = !mathData.isGroup && Array.isArray(mathData.names) && mathData.names.length === 2 && registeredName
      ? (mathData.names.filter(name => normalizeDisplayName(name) !== registeredName).length
          ? mathData.names.filter(name => normalizeDisplayName(name) !== registeredName)
          : mathData.names)
      : (visibleNames.length ? visibleNames : mathData.names);
    const safeMathData = {
      ...mathData,
      ...(bundleId ? { bundle_id: bundleId } : {}),
      display_title: displayTitle,
      dataset_kind: datasetKind,
      source_chat_count: sourceChatCount,
      ...(creditMeta ? {
        credit_cost: creditMeta.creditCost,
        report_types: creditMeta.reportTypes,
        generated_at: generatedAt,
        ...(creditMeta.bundleName ? { bundle_name: creditMeta.bundleName } : {}),
      } : {}),
      evidenceTimeline: mathData.evidenceTimeline?.map(({ date, title }) => ({ date, title })) ?? [],
      redFlags: mathData.redFlags?.map(({ title }) => ({ title })) ?? [],
    };
    const { data, error } = await supabase.from("results").insert({
      user_id:     user.id,
      report_type: type,
      chat_type:   mathData.isGroup ? "group" : "duo",
      names:       savedNames,
      result_data: {
        ...result,
        runMetadata: {
          reportType: type,
          reportTypes: creditMeta?.reportTypes || [type],
          creditCost: creditMeta?.creditCost ?? getReportCreditCost(type),
          totalRunCreditCost: creditMeta?.totalRunCreditCost ?? (creditMeta?.creditCost ?? getReportCreditCost(type)),
          generatedAt,
          displayTitle,
          datasetKind,
          sourceChatCount,
          approvedMerges: mathData.combinedMeta?.approvedMerges || 0,
          participantAliases: mathData.participantAliases || {},
          ...(creditMeta?.bundleName ? { bundleName: creditMeta.bundleName } : {}),
        },
      },
      math_data:   safeMathData,
    }).select("id").single();
    if (error) return null;
    return data;
  } catch { return null; /* silent — never interrupt the user flow */ }
}

async function submitFeedback({ resultId, reportType, cardIndex, cardTitle, errorType, errorNote }) {
  try {
    if (!resultId || !reportType || !cardTitle || !errorType) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const sentiment = getFeedbackSentiment(errorType);
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      result_id: resultId,
      report_type: reportType,
      card_index: cardIndex,
      card_title: cardTitle,
      sentiment,
      error_type: errorType,
      error_note: String(errorNote || "").trim() || null,
    });
    return !error;
  } catch { /* silent — never interrupt the user flow */ }
  return false;
}

function pushSummaryRow(rows, label, value, max = null) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === "—" || text === "..." || text === "…") return;
  rows.push({ label, value: Number.isFinite(max) ? cleanQuote(text, max) : text });
}

function buildFeedbackSummary(feedbackRow, resultRow, viewLang = "en") {
  if (!feedbackRow || !resultRow) return [];
  const math = resultRow.math_data || {};
  const ai = resultRow.result_data || {};
  const rows = [];
  const card = Number(feedbackRow.card_index || 0);
  const isGroup = !!math.isGroup;
  const control = (value) => translateControlValue(viewLang, value);

  if (feedbackRow.report_type === "general") {
    if (!isGroup) {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghostName);
        pushSummaryRow(rows, "Reply times", `${math.names?.[0] || "A"} ${math.ghostAvg?.[0] || "—"} • ${math.names?.[1] || "B"} ${math.ghostAvg?.[1] || "—"}`, 90);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 5) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson || math.names?.[0]);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 14) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 15) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 16) {
        pushSummaryRow(rows, relReadTitle(ai.relationshipType, ai.relationshipSpecific), ai.relationshipSummary);
        pushSummaryRow(rows, "Detected relationship", ai.relationshipSpecific ? `${ai.relationshipSpecific}${ai.relationshipConfidence ? ` (${ai.relationshipConfidence} confidence)` : ""}` : "");
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= DUO_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    } else {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghost);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 6) {
        pushSummaryRow(rows, "Hype person", math.hype);
        pushSummaryRow(rows, "Reason", ai.hypePersonReason);
      } else if (card === 7) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 13) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Inside joke", ai.insideJoke);
      } else if (card === 14) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 15) {
        pushSummaryRow(rows, "Most missed", ai.mostMissed);
      } else if (card === 16) {
        pushSummaryRow(rows, "Group dynamic", ai.groupDynamic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= GROUP_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    }
  } else if (feedbackRow.report_type === "toxicity") {
    if (card === 1 || card === 7) {
      pushSummaryRow(rows, "Health score", ai.chatHealthScore != null ? `${ai.chatHealthScore}/10` : "");
      pushSummaryRow(rows, "Verdict", ai.verdict);
    } else if (card === 2) {
      (ai.healthScores || []).slice(0, 3).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Scores" : " ", `${item.name}: ${item.score}/10 — ${item.detail}`, 120);
      });
    } else if (card === 3) {
      pushSummaryRow(rows, "Apologises more", ai.apologiesLeader?.name);
      pushSummaryRow(rows, "Their context", ai.apologiesLeader?.context);
      pushSummaryRow(rows, "Other context", ai.apologiesOther?.context);
    } else if (card === 4) {
      (ai.redFlagMoments || []).slice(0, 2).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Flagged moment" : "Another", `${item.person || ""} ${item.date ? `• ${item.date}` : ""} ${item.description || ""} ${item.quote ? `— "${item.quote}"` : ""}`, 130);
      });
    } else if (card === 5) {
      pushSummaryRow(rows, "Conflict pattern", ai.conflictPattern);
    } else if (card === 6) {
      pushSummaryRow(rows, "Power holder", control(ai.powerHolder));
      pushSummaryRow(rows, "Dynamic", ai.powerBalance);
    }
  } else if (feedbackRow.report_type === "lovelang") {
    if (card === 1) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Language", control(ai.personA?.language));
      pushSummaryRow(rows, "Examples", ai.personA?.examples);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Language", control(ai.personB?.language));
      pushSummaryRow(rows, "Examples", ai.personB?.examples);
    } else if (card === 3) {
      pushSummaryRow(rows, "Mismatch", ai.mismatch);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most loving moment", ai.mostLovingMoment);
    } else if (card === 5) {
      pushSummaryRow(rows, "Compatibility", ai.compatibilityScore != null ? `${ai.compatibilityScore}/10` : "");
      pushSummaryRow(rows, "Read", ai.compatibilityRead);
    }
  } else if (feedbackRow.report_type === "growth") {
    if (card === 1) {
      pushSummaryRow(rows, "Early", ai.thenDepth);
      pushSummaryRow(rows, "Recent", ai.nowDepth);
      pushSummaryRow(rows, "Change", control(ai.depthChange));
    } else if (card === 2) {
      pushSummaryRow(rows, "Changed more", ai.whoChangedMore);
      pushSummaryRow(rows, "How", ai.whoChangedHow);
    } else if (card === 3) {
      pushSummaryRow(rows, "Appeared", ai.topicsAppeared);
      pushSummaryRow(rows, "Faded", ai.topicsDisappeared);
    } else if (card === 4) {
      pushSummaryRow(rows, "Trajectory", control(ai.trajectory));
      pushSummaryRow(rows, "Detail", ai.trajectoryDetail);
    } else if (card === 5) {
      pushSummaryRow(rows, "Arc", ai.arcSummary);
    }
  } else if (feedbackRow.report_type === "accounta") {
    if (card === 1) {
      pushSummaryRow(rows, "Promises", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.total || 0} • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.total || 0}`, 100);
      pushSummaryRow(rows, "Verdict", ai.overallVerdict);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Score", ai.personA?.score != null ? `${ai.personA.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personA?.detail);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Score", ai.personB?.score != null ? `${ai.personB.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personB?.detail);
    } else if (card === 4) {
      pushSummaryRow(rows, "Comparison", ai.comparison);
    } else if (card === 5) {
      pushSummaryRow(rows, "Pattern", ai.followThroughPattern);
      pushSummaryRow(rows, "Evidence", ai.evidenceQuality);
    } else if (card === 6) {
      pushSummaryRow(rows, "Broken promise", ai.notableBroken?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableBroken?.outcome);
    } else if (card === 7) {
      pushSummaryRow(rows, "Kept promise", ai.notableKept?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableKept?.outcome);
    }
  } else if (feedbackRow.report_type === "energy") {
    if (card === 1 || card === 6) {
      pushSummaryRow(rows, "Scores", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.netScore ?? "—"}/10 • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.netScore ?? "—"}/10`, 100);
      pushSummaryRow(rows, "Compatibility", ai.compatibility);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Positive", ai.personA?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personA?.venting);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Positive", ai.personB?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personB?.venting);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most energising", ai.mostEnergising);
    } else if (card === 5) {
      pushSummaryRow(rows, "Most draining", ai.mostDraining);
    }
  }

  if (!rows.length) {
    pushSummaryRow(rows, "Reported card", feedbackRow.card_title);
    pushSummaryRow(rows, "Report type", feedbackRow.report_type);
  }

  return rows;
}

function adminControlPillStyle() {
  return {
    background:"rgba(255,255,255,0.08)",
    border:"1px solid rgba(255,255,255,0.18)",
    borderRadius:999,
    padding:"7px 16px",
    fontSize:13,
    fontWeight:700,
    color:"#fff",
    letterSpacing:0.1,
    whiteSpace:"nowrap",
  };
}

function AdminFeedbackTab() {
  const [rows, setRows] = useState(null);
  const [resultsById, setResultsById] = useState({});
  const [err, setErr] = useState("");
  const [viewLangById, setViewLangById] = useState({});
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setErr("");
      const { data: feedbackRows, error: feedbackError } = await supabase
        .rpc("admin_list_feedback", { p_limit: 100 });

      if (!alive) return;
      if (feedbackError) {
        setErr("Couldn't load feedback right now.");
        setRows([]);
        return;
      }

      const list = feedbackRows || [];
      setRows(list);
      const resultIds = Array.from(new Set(list.map(item => item.result_id).filter(Boolean)));
      if (!resultIds.length) {
        setResultsById({});
        setViewLangById({});
        return;
      }

      const { data: results, error: resultsError } = await supabase
        .from("results")
        .select("*")
        .in("id", resultIds);

      if (!alive) return;
      if (resultsError) {
        setErr("Couldn't load the related result cards.");
        setResultsById({});
        return;
      }
      setResultsById(Object.fromEntries((results || []).map(row => [row.id, row])));
    };

    load();
    return () => { alive = false; };
  }, []);

  const exitEditing = () => {
    setEditing(false);
    setConfirmId(null);
  };

  const deleteFeedbackRow = async (id) => {
    if (!id) return;
    setDeletingId(id);
    setConfirmTarget(null);
    try {
      const { data, error } = await supabase.rpc("admin_delete_feedback", {
        p_feedback_id: String(id),
      });
      if (error || data !== true) {
        console.error("Admin feedback delete failed", error || data);
        setErr("Couldn't delete feedback right now.");
        setDeletingId(null);
        return;
      }
      setRows(prev => (prev || []).filter(row => row.id !== id));
      setViewLangById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error("Admin feedback delete threw", error);
      setErr("Couldn't delete feedback right now.");
    }
    setDeletingId(null);
  };

  const errorTypeColor = (type) => {
    switch (type) {
      case POSITIVE_FEEDBACK_OPTION:
        return { bg:"rgba(80,190,120,0.16)",  border:"rgba(80,190,120,0.32)",  text:"#7BE39A" };
      case "Events are mixing":  return { bg:"rgba(240,160,40,0.15)",  border:"rgba(240,160,40,0.3)",  text:"#F0A040" };
      case "Wrong person":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Didn't happen":      return { bg:"rgba(180,60,200,0.15)",  border:"rgba(180,60,200,0.3)",  text:"#C070E0" };
      case "Tone misread":       return { bg:"rgba(60,140,240,0.15)",  border:"rgba(60,140,240,0.3)",  text:"#60A0F0" };
      case "Overclaiming":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Missing context":    return { bg:"rgba(80,160,100,0.15)",  border:"rgba(80,160,100,0.3)",  text:"#60C080" };
      default:                   return { bg:"rgba(255,255,255,0.07)", border:"rgba(255,255,255,0.14)",text:"rgba(255,255,255,0.7)" };
    }
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Feedback
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <div
            style={adminControlPillStyle()}
          >
            {rows === null ? "Loading…" : `${rows.length} report${rows.length !== 1 ? "s" : ""}`}
          </div>
          {!!rows?.length && (
            <button
              type="button"
              onClick={() => editing ? exitEditing() : setEditing(true)}
              className="wc-btn"
              style={{
                background: editing ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 999,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
                transition: "all 0.15s",
                letterSpacing: 0.1,
              }}
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {rows?.length > 0 && (
        !editing
          ? <div style={{ fontSize:12, color:"rgba(255,255,255,0.42)", lineHeight:1.6 }}>Latest feedback reports and the exact card content they referred to.</div>
          : <div style={{ fontSize:12, color:"rgba(255,255,255,0.42)", lineHeight:1.6 }}>Tap the × to delete a feedback report.</div>
      )}

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"32px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {rows?.length === 0 && !err && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"32px 20px", textAlign:"center" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>No feedback yet.</div>
        </div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, maxHeight:"58vh", overflowY:"auto", paddingRight:2, paddingBottom:4, alignSelf:"stretch" }}>
        {rows?.map(row => {
          const baseResultRow = resultsById[row.result_id];
          const resultData = baseResultRow?.result_data;
          const translatedLang = getStoredResultDisplayLanguage(resultData);
          const hasTranslation = translatedLang !== "en" && !!getStoredResultTranslations(resultData)?.[translatedLang];
          const selectedLang = hasTranslation ? (viewLangById[row.id] || translatedLang) : "en";
          const englishResultRow = baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, "en") }
            : baseResultRow;
          const translatedResultRow = hasTranslation && baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, translatedLang) }
            : null;
          const englishSummaryRows = buildFeedbackSummary(row, englishResultRow, "en");
          const translatedSummaryRows = translatedResultRow ? buildFeedbackSummary(row, translatedResultRow, translatedLang) : [];
          const summaryRows = selectedLang === "en" || !translatedResultRow ? englishSummaryRows : translatedSummaryRows;
          const namesLabel = Array.isArray(baseResultRow?.names) && baseResultRow.names.length
            ? `${baseResultRow.names.slice(0, 3).join(", ")}${baseResultRow.names.length > 3 ? ` +${baseResultRow.names.length - 3}` : ""}`
            : "";
          const messageLabel = baseResultRow?.math_data?.totalMessages != null
            ? `${baseResultRow.math_data.totalMessages.toLocaleString()} msgs`
            : "";
          const submittedAt = row.created_at
            ? new Date(row.created_at).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })
            : "Unknown";
          const tagStyle = errorTypeColor(row.error_type);
          const sentiment = row.sentiment === "positive" || row.error_type === POSITIVE_FEEDBACK_OPTION ? "positive" : "negative";
          const sentimentStyle = sentiment === "positive"
            ? { bg:"rgba(80,190,120,0.14)", border:"rgba(80,190,120,0.30)", text:"#7BE39A", label:"Positive" }
            : { bg:"rgba(224,90,80,0.13)", border:"rgba(224,90,80,0.28)", text:"#FF9A8F", label:"Negative" };
          const isDeleting = deletingId === row.id;
          const isConfirming = confirmId === row.id;

          return (
            <div
              key={row.id}
              style={{
                background:"rgba(255,255,255,0.04)",
                border:`1px solid ${isConfirming ? "rgba(220,50,50,0.42)" : "rgba(255,255,255,0.08)"}`,
                borderRadius:22,
                overflow:"hidden",
                flexShrink:0,
                position:"relative",
                transition:"border-color 0.15s",
              }}
            >
              {editing && !isConfirming && !isDeleting && (
                <button
                  type="button"
                  onClick={() => setConfirmId(row.id)}
                  className="wc-btn"
                  style={{
                    position:"absolute",
                    top:10,
                    right:10,
                    width:28,
                    height:28,
                    borderRadius:"50%",
                    background:"rgba(200,40,40,0.85)",
                    border:"1.5px solid rgba(255,100,100,0.5)",
                    color:"#fff",
                    fontSize:14,
                    fontWeight:800,
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    cursor:"pointer",
                    lineHeight:1,
                    padding:0,
                    transition:"all 0.15s",
                    zIndex:2,
                  }}
                  aria-label="Delete feedback"
                >
                  ×
                </button>
              )}

              {isDeleting && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(12,12,18,0.42)", zIndex:3 }}>
                  <Dots />
                </div>
              )}

              {isConfirming && !isDeleting && (
                <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"18px 20px", background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", zIndex:3, borderRadius:22 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center", lineHeight:1.45 }}>Delete this feedback report?</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
                    <button
                      type="button"
                      onClick={() => deleteFeedbackRow(row.id)}
                      className="wc-btn"
                      style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="wc-btn"
                      style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* top strip */}
              <div style={{ padding:"14px 16px 12px", borderBottom:"1px solid rgba(255,255,255,0.06)", opacity: editing ? 0.68 : 1, transition:"opacity 0.15s" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>
                      {row.report_type} · card {row.card_index} · {submittedAt}
                    </div>
                    <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, lineHeight:1.2, marginBottom: namesLabel || messageLabel ? 5 : 0 }}>
                      {row.card_title || "Untitled card"}
                    </div>
                    {(namesLabel || messageLabel) && (
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>
                        {[namesLabel, messageLabel].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, flexShrink:0 }}>
                    {hasTranslation && (
                      <div style={{ position:"relative", display:"inline-flex", alignItems:"center", padding:3, borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)" }}>
                        <div
                          style={{
                            position:"absolute",
                            top:3,
                            bottom:3,
                            left: selectedLang === "en" ? 3 : "calc(50% + 1.5px)",
                            width:"calc(50% - 3px)",
                            borderRadius:999,
                            background:"rgba(255,255,255,0.14)",
                            transition:"left 0.18s ease",
                          }}
                        />
                        {[
                          { code: "en", label: "English" },
                          { code: translatedLang, label: LANG_META[translatedLang] || translatedLang.toUpperCase() },
                        ].map(opt => (
                          <button
                            key={`${row.id}-${opt.code}`}
                            type="button"
                            onClick={() => setViewLangById(prev => ({ ...prev, [row.id]: opt.code }))}
                            className="wc-btn"
                            style={{
                              position:"relative",
                              zIndex:1,
                              minWidth:74,
                              border:"none",
                              background:"transparent",
                              color: selectedLang === opt.code ? "#fff" : "rgba(255,255,255,0.52)",
                              fontSize:11,
                              fontWeight:800,
                              letterSpacing:"0.04em",
                              padding:"7px 12px",
                              cursor:"pointer",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                      <div style={{ background:sentimentStyle.bg, border:`1px solid ${sentimentStyle.border}`, borderRadius:999, padding:"4px 10px", fontSize:11, fontWeight:800, color:sentimentStyle.text, whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                        {sentimentStyle.label}
                      </div>
                      <div style={{ background:tagStyle.bg, border:`1px solid ${tagStyle.border}`, borderRadius:999, padding:"5px 11px", fontSize:12, fontWeight:700, color:tagStyle.text, whiteSpace:"nowrap" }}>
                        {row.error_type || "Other"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* body */}
              <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:10, opacity: editing ? 0.68 : 1, transition:"opacity 0.15s" }}>
                {/* user's note */}
                {row.error_note && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>Note</div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.82)", lineHeight:1.6 }}>{row.error_note}</div>
                  </div>
                )}

                {/* model output */}
                {summaryRows.length > 0 && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:8 }}>What was shown</div>
                    {translatedResultRow ? (
                      <div style={{ display:"grid" }}>
                        {[
                          { code: "en", rows: englishSummaryRows },
                          { code: translatedLang, rows: translatedSummaryRows },
                        ].map(group => (
                          <div
                            key={`${row.id}-${group.code}`}
                            style={{
                              gridArea:"1 / 1",
                              display:"flex",
                              flexDirection:"column",
                              gap:7,
                              opacity: selectedLang === group.code ? 1 : 0,
                              visibility: selectedLang === group.code ? "visible" : "hidden",
                              pointerEvents: selectedLang === group.code ? "auto" : "none",
                            }}
                          >
                            {group.rows.map((item, index) => (
                              <div key={`${group.code}-${item.label}-${index}`}>
                                <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                                <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                        {summaryRows.map((item, index) => (
                          <div key={`${item.label}-${index}`}>
                            <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                            <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!row.error_note && !summaryRows.length && (
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", fontStyle:"italic" }}>No note or saved output for this card.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function AdminUsersTab({ accessMode = DEFAULT_ACCESS_MODE }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busyById, setBusyById] = useState({});
  const [amountById, setAmountById] = useState({});
  const [noticeById, setNoticeById] = useState({});
  const canAdjustCredits = accessMode === ACCESS_MODES.CREDITS;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setErr("");
      const { data, error } = await supabase.rpc("admin_list_user_credits");
      if (!alive) return;
      if (error) {
        console.error("Admin users load failed", error);
        setErr(error.message || "Couldn't load users right now.");
        setRows([]);
        return;
      }
      setRows((data || []).map(row => ({
        user_id: row.user_id,
        email: row.email || "No email",
        balance: Number.parseInt(String(row.balance ?? 0), 10) || 0,
      })));
    };

    load();
    return () => { alive = false; };
  }, []);

  const setAmount = (userId, value) => {
    setAmountById(prev => ({ ...prev, [userId]: value }));
  };

  const adjustCredits = async (userId, delta) => {
    if (!canAdjustCredits) {
      setNoticeById(prev => ({ ...prev, [userId]: "Switch to Credit Beta to adjust user credits." }));
      return;
    }

    const rawValue = amountById[userId] ?? "1";
    const amount = Number.parseInt(String(rawValue), 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      setNoticeById(prev => ({ ...prev, [userId]: "Enter a positive amount." }));
      return;
    }

    setBusyById(prev => ({ ...prev, [userId]: true }));
    setNoticeById(prev => ({ ...prev, [userId]: "" }));

    const { data, error } = await supabase.rpc("admin_add_credits", {
      p_user_id: userId,
      p_amount: delta < 0 ? -amount : amount,
    });

    if (error) {
      console.error("Admin credit update failed", error);
      setNoticeById(prev => ({ ...prev, [userId]: error.message || "Couldn't update credits right now." }));
      setBusyById(prev => ({ ...prev, [userId]: false }));
      return;
    }

    const updatedBalance = Number.parseInt(String(data ?? 0), 10) || 0;
    setRows(prev => (prev || []).map(row => (
      row.user_id === userId
        ? { ...row, balance: updatedBalance }
        : row
    )));
    setAmountById(prev => ({ ...prev, [userId]: "1" }));
    setNoticeById(prev => ({ ...prev, [userId]: delta < 0 ? "Removed." : "Added." }));
    setBusyById(prev => ({ ...prev, [userId]: false }));
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Users
        </div>
        <div style={adminControlPillStyle()}>
          {rows === null ? "Loading…" : `${rows.length} user${rows.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"32px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {!canAdjustCredits && (
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.72)", background:"rgba(160,138,240,0.12)", border:"1px solid rgba(160,138,240,0.24)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>
          Switch to Credit Beta to adjust user credits.
        </div>
      )}
      {rows?.length === 0 && !err && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"32px 20px", textAlign:"center" }}>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>No users yet.</div>
        </div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, maxHeight:"58vh", overflowY:"auto", paddingRight:2, paddingBottom:4, alignSelf:"stretch" }}>
        {rows?.map(row => {
          const inputValue = amountById[row.user_id] ?? "1";
          const notice = noticeById[row.user_id] || "";
          const busy = !!busyById[row.user_id];

          return (
            <div key={row.user_id} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.2, lineHeight:1.35, wordBreak:"break-word" }}>{row.email}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginTop:5 }}>Current credits: {row.balance}</div>
                </div>
                <div style={adminControlPillStyle()}>
                  {row.balance} credit{row.balance === 1 ? "" : "s"}
                </div>
              </div>

              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={inputValue}
                  disabled={!canAdjustCredits || busy}
                  onChange={e => setAmount(row.user_id, e.target.value)}
                  style={{
                    width:88,
                    background:"rgba(0,0,0,0.22)",
                    border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:12,
                    padding:"10px 12px",
                    fontSize:14,
                    color:"#fff",
                    outline:"none",
                    fontFamily:"inherit",
                    opacity:!canAdjustCredits ? 0.45 : 1,
                  }}
                />
                <button
                  type="button"
                  onClick={() => adjustCredits(row.user_id, 1)}
                  disabled={busy || !canAdjustCredits}
                  className="wc-btn"
                  style={{
                    background:"rgba(255,255,255,0.10)",
                    border:"1px solid rgba(255,255,255,0.16)",
                    borderRadius:999,
                    color:"#fff",
                    fontSize:12,
                    cursor:busy || !canAdjustCredits ? "default" : "pointer",
                    padding:"10px 14px",
                    fontWeight:700,
                    letterSpacing:0.1,
                    opacity:busy || !canAdjustCredits ? 0.6 : 1,
                  }}
                >
                  {busy ? "Adding…" : "Add credits"}
                </button>
                <button
                  type="button"
                  onClick={() => adjustCredits(row.user_id, -1)}
                  disabled={busy || !canAdjustCredits}
                  className="wc-btn"
                  style={{
                    background:"rgba(255,255,255,0.06)",
                    border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:999,
                    color:"#fff",
                    fontSize:12,
                    cursor:busy || !canAdjustCredits ? "default" : "pointer",
                    padding:"10px 14px",
                    fontWeight:700,
                    letterSpacing:0.1,
                    opacity:busy || !canAdjustCredits ? 0.6 : 1,
                  }}
                >
                  {busy ? "Removing…" : "Remove credits"}
                </button>
                {notice && (
                  <div style={{ fontSize:12, color:notice === "Added." || notice === "Removed." ? "rgba(176,244,200,0.9)" : "#FFB090" }}>
                    {notice}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const ACCESS_MODE_OPTIONS = [
  {
    id: ACCESS_MODES.OPEN,
    label: "Open Testing",
    description: "Everyone can run reports without using credits. Best for internal QA only.",
  },
  {
    id: ACCESS_MODES.CREDITS,
    label: "Credit Beta",
    description: "Users need manually assigned credits. Best for controlled beta access.",
  },
  {
    id: ACCESS_MODES.PAYMENTS,
    label: "Payment Launch",
    description: "Users can use Quick Read or purchased credits. Payment integration can plug in later.",
  },
];

function AdminAccessModeTab({ accessMode, onAccessModeChange }) {
  const [mode, setMode] = useState(accessMode || DEFAULT_ACCESS_MODE);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setErr("");
      try {
        const current = await getAccessMode({ throwOnError: true });
        if (!alive) return;
        setMode(current);
        onAccessModeChange?.(current);
      } catch (error) {
        if (!alive) return;
        console.error("Admin access mode load failed", error);
        setErr("Couldn't load access mode. The app falls back to Credit Beta.");
        setMode(DEFAULT_ACCESS_MODE);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [onAccessModeChange]);

  const updateMode = async (nextMode) => {
    if (busy || nextMode === mode) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const savedMode = await setAccessMode(nextMode);
      setMode(savedMode);
      onAccessModeChange?.(savedMode);
      setNotice(`Access mode set to ${getAccessModeLabel(savedMode)}.`);
    } catch (error) {
      console.error("Admin access mode update failed", error);
      setErr(error.message || "Couldn't update access mode.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Access Mode
        </div>
        <div style={adminControlPillStyle()}>
          {loading ? "Loading…" : getAccessModeLabel(mode)}
        </div>
      </div>

      <div style={{ fontSize:13, color:"rgba(255,255,255,0.55)", lineHeight:1.6, width:"100%" }}>
        This global setting controls who can run reports without redeploying the app.
      </div>

      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>
      )}
      {notice && (
        <div style={{ fontSize:13, color:"rgba(176,244,200,0.9)", background:"rgba(20,160,80,0.12)", border:"1px solid rgba(20,160,80,0.26)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>{notice}</div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        {ACCESS_MODE_OPTIONS.map(option => {
          const active = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => updateMode(option.id)}
              disabled={busy || loading}
              className="wc-btn"
              style={{
                width:"100%",
                display:"flex",
                flexDirection:"column",
                gap:6,
                textAlign:"left",
                borderRadius:18,
                padding:"14px 16px",
                background: active ? "rgba(160,138,240,0.16)" : "rgba(255,255,255,0.04)",
                border: active ? `1.5px solid ${PAL.upload.accent}` : "1px solid rgba(255,255,255,0.10)",
                color:"#fff",
                cursor:busy || loading ? "wait" : "pointer",
                opacity:busy || loading ? 0.7 : 1,
                transition:"all 0.18s",
              }}
            >
              <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <span style={{ fontSize:15, fontWeight:850, letterSpacing:-0.2 }}>{option.label}</span>
                <span style={{
                  width:20,
                  height:20,
                  borderRadius:"50%",
                  border:active ? "none" : "1.5px solid rgba(255,255,255,0.22)",
                  background:active ? PAL.upload.accent : "transparent",
                  color:active ? PAL.upload.bg : "transparent",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:11,
                  fontWeight:900,
                  flexShrink:0,
                }}>
                  ✓
                </span>
              </div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.52)", lineHeight:1.55 }}>
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function AdminPanel({ onBack, accessMode, onAccessModeChange }) {
  const [tab, setTab] = useState("feedback");
  const tabs = [
    { id: "feedback", label: "Feedback" },
    { id: "users", label: "Users" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} contentAlign="start">
      <ScreenHeader back={onBack} title="Admin" />

      {!ADMIN_EMAILS.length && (
        <div style={{ fontSize:12, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", lineHeight:1.6 }}>
          Set <code>VITE_ADMIN_EMAIL</code> in <code>.env</code> to unlock admin access.
        </div>
      )}

      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:999, padding:4, width:"100%", gap:4 }}>
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className="wc-btn"
            style={{
              flex:1,
              border:"none",
              borderRadius:999,
              padding:"10px 0",
              fontSize:14,
              fontWeight:700,
              cursor:"pointer",
              transition:"all 0.2s",
              background: tab === item.id ? "rgba(255,255,255,0.18)" : "transparent",
              color: tab === item.id ? "#fff" : "rgba(255,255,255,0.38)",
              letterSpacing:0.1,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "feedback" && <AdminFeedbackTab />}
      {tab === "users" && <AdminUsersTab accessMode={accessMode} />}
      {tab === "settings" && <AdminAccessModeTab accessMode={accessMode} onAccessModeChange={onAccessModeChange} />}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// MY RESULTS
// ─────────────────────────────────────────────────────────────────
function MyResults({ onBack, onRestoreResult, initialBundleId = null, onSettings = null, drawerMode = false }) {
  const [rows,           setRows]           = useState(null);
  const [err,            setErr]            = useState("");
  const [currentUserName, setCurrentUserName] = useState("");
  const [editing,        setEditing]        = useState(false);
  const [confirmId,      setConfirmId]      = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [bundleView,     setBundleView]     = useState(initialBundleId); // null | string (bundle_id)
  const [confirmBundle,  setConfirmBundle]  = useState(null);
  const [deletingBundle, setDeletingBundle] = useState(null);
  const [nameView,       setNameView]       = useState(null); // null | string (participant name)
  const [confirmNameId,  setConfirmNameId]  = useState(null); // null | string
  const [deletingName,   setDeletingName]   = useState(null); // null | string
  const [viewMode,       setViewMode]       = useState(() => {
    try { return localStorage.getItem("wrapchat_results_view") || "reports"; } catch { return "reports"; }
  });

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRows([]); return; }
      setCurrentUserName(userProvidedDisplayName(user));
      const { data, error } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) setErr("Couldn't load results. Try again.");
      else setRows(data || []);
    });
  }, []);

  useEffect(() => {
    if (bundleView && rows && !rows.some(r => r.math_data?.bundle_id === bundleView)) {
      queueMicrotask(() => setBundleView(null));
    }
  }, [rows, bundleView]);

  const exitEditing = () => { setEditing(false); setConfirmId(null); setConfirmBundle(null); setConfirmNameId(null); };

  const handleDelete = async (id) => {
    setDeletingId(id);
    setConfirmId(null);
    try {
      const { error } = await supabase.from("results").delete().eq("id", id);
      if (!error) {
        setRows(prev => prev.filter(r => r.id !== id));
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingId(null);
  };

  const handleDeleteBundle = async (bid, bundleRows) => {
    setDeletingBundle(bid);
    setConfirmBundle(null);
    const ids = bundleRows.map(r => r.id);
    try {
      const { error } = await supabase.from("results").delete().in("id", ids);
      if (!error) {
        setRows(prev => prev.filter(r => !ids.includes(r.id)));
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingBundle(null);
  };

  const handleDeleteName = async (name, group) => {
    setDeletingName(name);
    setConfirmNameId(null);
    const ids = [];
    group.items.forEach(item => {
      if (item.type === 'single') ids.push(item.row.id);
      else item.rows.forEach(r => ids.push(r.id));
    });
    const uniqueIds = [...new Set(ids)];
    try {
      const { error } = await supabase.from("results").delete().in("id", uniqueIds);
      if (!error) {
        setRows(prev => prev.filter(r => !uniqueIds.includes(r.id)));
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingName(null);
  };

  const shortName = (name, fallback = "—") => String(name || fallback).trim().split(/\s+/)[0] || fallback;

  const rankedPeople = (people, scoreKey) => people
    .filter(Boolean)
    .map(person => ({
      ...person,
      previewScore: Number(person?.[scoreKey]),
    }))
    .filter(person => Number.isFinite(person.previewScore))
    .sort((a, b) => b.previewScore - a.previewScore);

  const energyKeyword = (person, lang) => {
    const type = String(person?.type || "").toLowerCase();
    if (type === "net positive") return translateControlValue(lang, "net positive") || "positive";
    if (type === "net draining") return translateControlValue(lang, "net draining") || "draining";
    if (type === "mixed") return translateControlValue(lang, "mixed") || "mixed";
    if (person?.previewScore >= 7) return "positive";
    if (person?.previewScore <= 4) return "draining";
    return "mixed";
  };

  const accountabilityKeyword = (person) => {
    const kept = Number(person?.kept) || 0;
    const broken = Number(person?.broken) || 0;
    if (person?.previewScore >= 8 && kept >= broken) return "reliable";
    if (broken > kept) return "follow-through";
    if (person?.previewScore >= 6) return "steady";
    return "mixed";
  };

  const participantPreview = (people, scoreKey, keywordFor) => {
    const ranked = rankedPeople(people, scoreKey).slice(0, 2);
    if (!ranked.length) return "—";
    return ranked
      .map(person => `${shortName(person.name)} ${person.previewScore}/10 ${keywordFor(person)}`)
      .join(" • ");
  };

  const headline = (row) => {
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const ai   = getDisplayResultData(row.result_data, displayLang);
    const math = row.math_data   || {};
    switch (row.report_type) {
      case "general":  return `${(math.totalMessages || 0).toLocaleString()} messages`;
      case "toxicity": return chatHealthLabel(ai.chatHealthScore) || math.toxicityLevel || "—";
      case "lovelang": return ai.compatibilityScore != null ? `${ai.compatibilityScore}/10 compatibility` : "—";
      case "growth":   return translateControlValue(displayLang, ai.trajectory) || "—";
      case "accounta": return participantPreview([ai.personA, ai.personB], "score", accountabilityKeyword);
      case "energy":   return participantPreview([ai.personA, ai.personB], "netScore", person => energyKeyword(person, displayLang));
      default:         return "—";
    }
  };

  const formatDate = (dateStr) => {
    const d    = new Date(dateStr);
    const now  = new Date();
    const diff = Math.floor((now - d) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7)  return d.toLocaleDateString("en-US", { weekday:"short" });
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  };

  const resultDisplayTitle = (row) =>
    String(
      row?.result_data?.runMetadata?.displayTitle ||
      row?.math_data?.display_title ||
      row?.math_data?.displayTitle ||
      ""
    ).replace(/,\s*combined\b/i, "").trim();

  const duoNamesForCurrentUser = (row) => {
    if (row?.chat_type !== "duo" || !Array.isArray(row.names)) return null;
    const normalizedUser = normalizeDisplayName(currentUserName);
    const names = row.names.map(name => String(name || "").trim()).filter(Boolean);
    if (!names.length) return [];
    if (!normalizedUser) return names;
    const otherNames = names.filter(name => normalizeDisplayName(name) !== normalizedUser);
    return otherNames.length ? otherNames : names;
  };

  const namesLabel = (names) => {
    if (!Array.isArray(names) || !names.length) return "—";
    return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  };

  const rowNames = (row) => {
    const duoNames = duoNamesForCurrentUser(row);
    if (duoNames) return namesLabel(duoNames);
    const savedNames = Array.isArray(row?.names)
      ? namesWithoutCurrentUser(row.names, { user_metadata: { full_name: currentUserName } })
      : [];
    return namesLabel(savedNames) || resultDisplayTitle(row) || "—";
  };

  const datasetBadge = (row) => {
    const count = row?.result_data?.runMetadata?.sourceChatCount || row?.math_data?.source_chat_count || row?.math_data?.sourceChatCount || 1;
    const kind = row?.result_data?.runMetadata?.datasetKind || row?.math_data?.dataset_kind || row?.math_data?.datasetKind || "single";
    return kind === "combined" && count > 1 ? `Combined · ${count} chats` : "";
  };

  // Shared swatch for a single report card
  const makeSwatchEl = (pal) => <SwatchIcon inner={pal.inner} accent={pal.accent} />;

  // Shared text block for a single report card
  const makeTextEl = (pal, rt, row, dateLabel, stat) => (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:pal.accent, marginBottom:5 }}>
        {rt?.label || row.report_type} · {dateLabel}
      </div>
      <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, color:"#fff", lineHeight:1.2 }}>
        {rowNames(row)}
      </div>
      {datasetBadge(row) && (
        <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.38)", marginTop:4 }}>{datasetBadge(row)}</div>
      )}
      {stat !== "—" && (
        <div style={{ fontSize:12, fontWeight:600, color:pal.accent, marginTop:4 }}>{stat}</div>
      )}
    </div>
  );

  // Bundle palette — visually distinct from per-report-type colors
  const BUNDLE_PAL = { bg:"#160F38", inner:"#2E1F70", accent:"#C4B0FF" };
  // Name palette — for participant name cards in Names view
  const NAME_PAL = { bg:"#160F38", inner:"#2E1F70", accent:"#C4B0FF" };

  // ── Compute display items (singles + bundles) ──
  const displayItems = (() => {
    if (!rows) return [];
    const bundleMap = new Map();
    const items = [];
    rows.forEach(row => {
      const bid = row.math_data?.bundle_id;
      if (bid) {
        if (!bundleMap.has(bid)) bundleMap.set(bid, []);
        bundleMap.get(bid).push(row);
      } else {
        items.push({ type:"single", row, created_at: row.created_at });
      }
    });
    bundleMap.forEach((bundleRows, bid) => {
      if (bundleRows.length <= 1) {
        items.push({ type:"single", row: bundleRows[0], created_at: bundleRows[0].created_at });
      } else {
        items.push({ type:"bundle", bundleId: bid, rows: bundleRows, created_at: bundleRows[0].created_at });
      }
    });
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items;
  })();

  const changeViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("wrapchat_results_view", mode);
    } catch {
      // Ignore storage failures; the in-memory view switch still works.
    }
  };

  // ── Compute names-grouped items (for Names mode) ──
  const nameItems = (() => {
    if (!rows) return [];
    const nameMap = new Map();
    displayItems.forEach(item => {
      const itemNames = item.type === "single"
        ? (duoNamesForCurrentUser(item.row) || (Array.isArray(item.row.names) ? item.row.names : []))
        : (duoNamesForCurrentUser(item.rows[0]) || (Array.isArray(item.rows[0]?.names) ? item.rows[0].names : []));
      itemNames.forEach(rawName => {
        const name = String(rawName || "").trim();
        if (!name) return;
        if (!nameMap.has(name)) nameMap.set(name, { name, items: [], latestDate: new Date(0) });
        const entry = nameMap.get(name);
        entry.items.push(item);
        const d = new Date(item.created_at);
        if (d > entry.latestDate) entry.latestDate = d;
      });
    });
    return Array.from(nameMap.values()).sort((a, b) => b.latestDate - a.latestDate);
  })();

  const reportLabelFor = (type) => REPORT_TYPES.find(rt => rt.id === type)?.label || type;

  const packReportLabels = (pack, itemRows) => {
    const types = pack?.reports?.length ? pack.reports : itemRows.map(row => row.report_type);
    return [...new Set(types)].map(reportLabelFor).join(" · ");
  };

  const BundleMiniSwatch = ({ pack }) => {
    const gridByPack = {
      vibe: ["general", "lovelang", "energy", "general"],
      rf: ["toxicity", "accounta", null, null],
      full: ["general", "lovelang", "toxicity", "growth"],
    };
    if (pack?.id === "growth") return <PackSwatch pack={pack} />;
    const grid = gridByPack[pack?.id] || (pack?.reports || []).slice(0, 4);
    return (
      <div style={{ width:48, height:48, flexShrink:0, display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, padding:9, boxSizing:"border-box", borderRadius:13, background:`${pack.accent}20`, border:`1.5px solid ${pack.accent}55` }}>
        {[0, 1, 2, 3].map(i => {
          const type = grid[i];
          if (!type) return <div key={i} style={{ borderRadius:4, background:`${pack.accent}18`, border:`1px solid ${pack.accent}30` }} />;
          const meta = reportTypeMeta(type);
          const rpal = PAL[meta.palette] || PAL.upload;
          return <div key={i} style={{ borderRadius:4, background:rpal.inner || rpal.bg, border:`1px solid ${rpal.accent}99` }} />;
        })}
      </div>
    );
  };

  const renderPackResultCard = (item) => {
    const itemRows = item.type === "bundle" ? item.rows : [item.row];
    const firstRow = itemRows[0];
    const pack = item.type === "bundle"
      ? (packForSavedRows(itemRows) || PACK_DEFS.full)
      : (firstRow?.report_type === "growth" ? PACK_DEFS.growth : null);
    const rt = firstRow ? REPORT_TYPES.find(r => r.id === firstRow.report_type) : null;
    const fallbackPal = PAL[rt?.palette] || PAL.upload;
    const cardBg = pack?.listBg || pack?.cardBg || fallbackPal.bg;
    const cardAccent = pack?.listAccent || pack?.accent || fallbackPal.accent;
    const key = item.type === "bundle" ? item.bundleId : firstRow.id;
    const packOrReportName = pack?.name || rt?.label || firstRow.report_type;
    const participantName = rowNames(firstRow);
    const subline = pack ? packReportLabels(pack, itemRows) : (rt?.label || firstRow.report_type);
    const dateLabel = formatDate(item.created_at);
    const isDeleting = item.type === "bundle" ? deletingBundle === item.bundleId : deletingId === firstRow.id;
    const isConfirming = item.type === "bundle" ? confirmBundle === item.bundleId : confirmId === firstRow.id;
    const onOpen = () => {
      if (editing || isDeleting || isConfirming) return;
      if (pack?.id === "growth" || item.type === "single") onRestoreResult(firstRow);
      else setBundleView(item.bundleId);
    };

    return (
      <div key={key}
        onClick={onOpen}
        style={{
          display:"flex", alignItems:"center", gap:16, boxSizing:"border-box",
          background:cardBg, border:`1.5px solid ${isConfirming ? "rgba(220,50,50,0.55)" : `${cardAccent}55`}`,
          borderRadius:20, padding:"16px 18px",
          color:"#fff", width:"100%", position:"relative",
          textAlign:"left", transition:"border-color 0.18s",
          cursor: editing || isDeleting || isConfirming ? "default" : "pointer",
        }}
      >
        <div style={{
          display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0,
          opacity: isDeleting || isConfirming ? 0.3 : 1,
          transform:"translateX(0)",
          transition:"opacity 0.22s",
          pointerEvents:"none",
        }}>
          {pack ? (
            <BundleMiniSwatch pack={pack} />
          ) : (
            <SwatchIcon inner={fallbackPal.inner} accent={fallbackPal.accent} />
          )}
          <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:4 }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:12, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:900, letterSpacing:-0.25, color:"#fff", lineHeight:1.15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>
                {packOrReportName}
              </div>
              <div style={{ fontSize:11, fontWeight:800, color:"rgba(255,255,255,0.50)", flexShrink:0 }}>
                {dateLabel}
              </div>
            </div>
            <div style={{ fontSize:13, fontWeight:800, letterSpacing:-0.15, color:"rgba(255,255,255,0.86)", lineHeight:1.18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {participantName}
            </div>
            <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.40)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {subline}
            </div>
          </div>
        </div>
        <div style={{
          fontSize:20, color:"rgba(255,255,255,0.28)", flexShrink:0, lineHeight:1,
          overflow:"hidden", maxWidth: editing || isDeleting || isConfirming ? "0px" : "24px",
          opacity: editing || isDeleting || isConfirming ? 0 : 1,
          transition:"max-width 0.24s cubic-bezier(.2,0,.1,1), opacity 0.2s",
          pointerEvents:"none",
        }}>›</div>
        <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? setConfirmBundle(item.bundleId) : setConfirmId(firstRow.id); }} className="wc-btn"
          style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
            background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
            color:"#fff", fontSize:14, fontWeight:800,
            display:"flex", alignItems:"center", justifyContent:"center", padding:0,
            opacity: editing && !isDeleting && !isConfirming ? 1 : 0,
            transition:"opacity 0.2s",
            pointerEvents: editing && !isDeleting && !isConfirming ? "auto" : "none",
            cursor:"pointer" }}
          aria-label={item.type === "bundle" ? "Delete pack" : "Delete result"}>×</button>
        {isDeleting && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots /></div>}
        {isConfirming && !isDeleting && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
            background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>
              {item.type === "bundle" ? `Delete all ${itemRows.length} reports?` : "Delete this result?"}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? handleDeleteBundle(item.bundleId, itemRows) : handleDelete(firstRow.id); }} className="wc-btn"
                style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>
                {item.type === "bundle" ? "Delete all" : "Delete"}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? setConfirmBundle(null) : setConfirmId(null); }} className="wc-btn"
                style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Bundle detail view ──
  if (bundleView) {
    if (rows === null) {
      return drawerMode ? (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
      ) : (
        <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
          <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
        </Shell>
      );
    }
    const bRows = rows.filter(r => r.math_data?.bundle_id === bundleView);
    const pack = packForSavedRows(bRows) || PACK_DEFS.full;
    return (
      <PackResultsBuffer
        rows={bRows}
        pack={pack}
        onClose={() => { exitEditing(); setBundleView(null); }}
        onOpenReport={(row) => {
          if (!editing && deletingId !== row.id && confirmId !== row.id) {
            onRestoreResult(row, { origin: "bundle", bundleId: bundleView });
          }
        }}
      />
    );
  }

  // ── Name detail view ──
  if (nameView) {
    const nameGroup = nameItems.find(g => g.name === nameView);
    if (!nameGroup || rows === null) {
      const loadEl = <div style={{ flex:1, display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>;
      return drawerMode ? loadEl : <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>{loadEl}</Shell>;
    }
    const allNameRows = [];
    nameGroup.items.forEach(item => {
      if (item.type === 'single') allNameRows.push(item.row);
      else item.rows.forEach(r => allNameRows.push(r));
    });
    allNameRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const totalReports = allNameRows.length;
    const nameDetailContent = (
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", minHeight:0,
        ...(drawerMode ? {} : { margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))" }),
        position:"relative",
      }}>
        <div style={{ padding:"19px 20px 12px", flexShrink:0 }}>
          <ScreenHeader back={() => { exitEditing(); setNameView(null); }} titleNode={nameView} />
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:6, fontWeight:600, textAlign:"center" }}>
            {totalReports} report{totalReports !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain", minHeight:0,
          padding:"4px 20px calc(24px + env(safe-area-inset-bottom, 0px))",
          display:"flex", flexDirection:"column", gap:10 }}>
          {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
          {allNameRows.map(row => {
              const rt  = REPORT_TYPES.find(r => r.id === row.report_type);
              const pal = PAL[rt?.palette] || PAL.upload;
              const stat = headline(row);
              const isDeleting   = deletingId === row.id;
              const isConfirming = confirmId   === row.id;
              const swatchEl = makeSwatchEl(pal);
              const textEl = (
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:pal.accent, marginBottom:5 }}>
                    {rt?.label || row.report_type} · {formatDate(row.created_at)}
                  </div>
                  {stat !== "—" && <div style={{ fontSize:12, fontWeight:600, color:pal.accent, marginTop:2 }}>{stat}</div>}
                </div>
              );
              return (
                <div key={row.id}
                  onClick={() => { if (!editing && !isDeleting && !isConfirming) onRestoreResult(row); }}
                  style={{
                    display:"flex", alignItems:"center", gap:16, boxSizing:"border-box",
                    background:pal.bg, border:`1.5px solid ${isConfirming ? "rgba(220,50,50,0.55)" : `${pal.accent}55`}`,
                    borderRadius:20, padding:"16px 18px",
                    color:"#fff", width:"100%", position:"relative",
                    textAlign:"left", transition:"border-color 0.18s",
                    cursor: editing || isDeleting || isConfirming ? "default" : "pointer",
                  }}
                >
                  <div style={{
                    display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0,
                    opacity: isDeleting || isConfirming ? 0.3 : 1,
                    transform:"translateX(0)",
                    transition:"opacity 0.22s",
                    pointerEvents:"none",
                  }}>
                    {swatchEl}{textEl}
                  </div>
                  <div style={{
                    fontSize:20, color:"rgba(255,255,255,0.28)", flexShrink:0, lineHeight:1,
                    overflow:"hidden", maxWidth: editing || isDeleting || isConfirming ? "0px" : "24px",
                    opacity: editing || isDeleting || isConfirming ? 0 : 1,
                    transition:"max-width 0.24s cubic-bezier(.2,0,.1,1), opacity 0.2s",
                    pointerEvents:"none",
                  }}>›</div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmId(row.id); }} className="wc-btn"
                    style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
                      background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
                      color:"#fff", fontSize:14, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                      opacity: editing && !isDeleting && !isConfirming ? 1 : 0,
                      transition:"opacity 0.2s",
                      pointerEvents: editing && !isDeleting && !isConfirming ? "auto" : "none",
                      cursor:"pointer" }}
                    aria-label="Delete result">×</button>
                  {isDeleting && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots /></div>}
                  {isConfirming && !isDeleting && (
                    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                      alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
                      background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>Delete this result?</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }} className="wc-btn"
                          style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>Delete</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmId(null); }} className="wc-btn"
                          style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
          })}
        </div>
        {allNameRows.length > 0 && (
          <button type="button" onClick={() => editing ? exitEditing() : setEditing(true)} className="wc-btn"
            aria-label={editing ? "Done editing" : "Edit results"}
            style={{ position:"absolute", bottom:"calc(20px + env(safe-area-inset-bottom, 0px))", right:20,
              width:48, height:48, borderRadius:"50%",
              background: editing ? PAL.upload.accent : "rgba(255,255,255,0.12)",
              border:"1px solid rgba(255,255,255,0.20)",
              color: editing ? PAL.upload.bg : "#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,0.35)", cursor:"pointer", zIndex:10 }}>
            {editing
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            }
          </button>
        )}
      </div>
    );
    return drawerMode ? nameDetailContent : (
      <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
        {nameDetailContent}
      </Shell>
    );
  }

  const mainInnerContent = (
    <div style={{
      alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", minHeight:0,
      ...(drawerMode ? {} : { margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))" }),
      position:"relative",
    }}>
      {/* Fixed header */}
      <div style={{ padding:"19px 20px 12px", flexShrink:0 }}>
        <ScreenHeader
          back={() => { exitEditing(); onBack(); }}
          title="My Results"
          action={onSettings ? (
            <button type="button" onClick={onSettings} className="wc-btn" aria-label="Settings"
              style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.14)", borderRadius:999, color:"rgba(255,255,255,0.75)", width:34, height:34, padding:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
              <GearIcon />
            </button>
          ) : null}
        />
        {rows?.length > 0 && (
          <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", flexShrink:0 }}>Sort as</div>
            <div style={{ flex:1, display:"flex", background:"rgba(255,255,255,0.07)", borderRadius:999, padding:3, gap:2 }}>
              {[["reports", "Results"], ["names", "Names"]].map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => { exitEditing(); changeViewMode(mode); }} className="wc-btn"
                  style={{ flex:1, borderRadius:999, padding:"6px 0", fontSize:12, fontWeight:700, border:"none",
                    background: viewMode === mode ? "rgba(255,255,255,0.18)" : "transparent",
                    color: viewMode === mode ? "#fff" : "rgba(255,255,255,0.45)",
                    cursor:"pointer", transition:"all 0.18s" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
        {/* Floating edit FAB */}
        {rows?.length > 0 && (
          <button
            type="button"
            onClick={() => editing ? exitEditing() : setEditing(true)}
            className="wc-btn"
            aria-label={editing ? "Done editing" : "Edit results"}
            style={{
              position:"absolute",
              bottom:"calc(20px + env(safe-area-inset-bottom, 0px))",
              right:20,
              width:48, height:48,
              borderRadius:"50%",
              background: editing ? PAL.upload.accent : "rgba(255,255,255,0.12)",
              border:"1px solid rgba(255,255,255,0.20)",
              color: editing ? PAL.upload.bg : "#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,0.35)",
              cursor:"pointer",
              zIndex:10,
            }}
          >
            {editing
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            }
          </button>
        )}

        {viewMode === "reports" && (
        <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain", minHeight:0,
          padding:"4px 20px calc(24px + env(safe-area-inset-bottom, 0px))",
          display:"flex", flexDirection:"column", gap:10 }}>
          {rows === null && !err && (
            <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
          )}
          {err && (
            <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
          )}
          {rows?.length === 0 && (
            <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", textAlign:"center", padding:"32px 0", lineHeight:1.7 }}>
              No saved results yet.<br/>Run an analysis to see it here.
            </div>
          )}
          {displayItems.map(item => renderPackResultCard(item))}
        </div>
        )}
        {viewMode === "names" && (
          <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain", minHeight:0,
            padding:"4px 20px calc(24px + env(safe-area-inset-bottom, 0px))",
            display:"flex", flexDirection:"column", gap:10 }}>
            {rows === null && !err && (
              <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
            )}
            {err && (
              <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
            )}
            {rows?.length === 0 && (
              <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", textAlign:"center", padding:"32px 0", lineHeight:1.7 }}>
                No saved results yet.<br/>Run an analysis to see it here.
              </div>
            )}
            {nameItems.map(group => {
              const allGroupRows = [];
              group.items.forEach(item => {
                if (item.type === 'single') allGroupRows.push(item.row);
                else item.rows.forEach(r => allGroupRows.push(r));
              });
              const totalReports = allGroupRows.length;
              const uniqueTypes = [...new Set(allGroupRows.map(r => r.report_type))];
              const swatchPals = uniqueTypes.slice(0, 4).map(rt =>
                PAL[REPORT_TYPES.find(r => r.id === rt)?.palette] || PAL.upload
              );
              const isConfirmingName = confirmNameId === group.name;
              const isDeletingName   = deletingName   === group.name;
              const nameSwatchEl = (
                <div style={{ width:48, height:48, flexShrink:0, display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, padding:9, boxSizing:"border-box" }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{ borderRadius:4, background:"#2E1A70", border:"1px solid rgba(160,138,240,0.6)" }} />
                  ))}
                </div>
              );
              const nameTextEl = (
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:NAME_PAL.accent, marginBottom:5 }}>
                    {totalReports} report{totalReports !== 1 ? "s" : ""}
                  </div>
                  <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, color:"#fff", lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {group.name}
                  </div>
                </div>
              );
              return (
                <div key={group.name}
                  onClick={() => { if (!editing && !isDeletingName && !isConfirmingName) setNameView(group.name); }}
                  style={{
                    display:"flex", alignItems:"center", gap:16, boxSizing:"border-box",
                    background:NAME_PAL.bg, border:`1.5px solid ${isConfirmingName ? "rgba(220,50,50,0.55)" : `${NAME_PAL.accent}55`}`,
                    borderRadius:20, padding:"16px 18px",
                    color:"#fff", width:"100%", position:"relative",
                    textAlign:"left", transition:"border-color 0.18s",
                    cursor: editing || isDeletingName || isConfirmingName ? "default" : "pointer",
                  }}
                >
                  <div style={{
                    display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0,
                    opacity: isDeletingName || isConfirmingName ? 0.3 : 1,
                    transform:"translateX(0)",
                    transition:"opacity 0.22s",
                    pointerEvents:"none",
                  }}>
                    {nameSwatchEl}{nameTextEl}
                  </div>
                  <div style={{
                    fontSize:20, color:"rgba(255,255,255,0.28)", flexShrink:0, lineHeight:1,
                    overflow:"hidden", maxWidth: editing || isDeletingName || isConfirmingName ? "0px" : "24px",
                    opacity: editing || isDeletingName || isConfirmingName ? 0 : 1,
                    transition:"max-width 0.24s cubic-bezier(.2,0,.1,1), opacity 0.2s",
                    pointerEvents:"none",
                  }}>›</div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmNameId(group.name); }} className="wc-btn"
                    style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
                      background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
                      color:"#fff", fontSize:14, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                      opacity: editing && !isDeletingName && !isConfirmingName ? 1 : 0,
                      transition:"opacity 0.2s",
                      pointerEvents: editing && !isDeletingName && !isConfirmingName ? "auto" : "none",
                      cursor:"pointer" }}
                    aria-label="Delete all for name">×</button>
                  {isDeletingName && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots /></div>}
                  {isConfirmingName && !isDeletingName && (
                    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                      alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
                      background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>Delete all {totalReports} reports for {group.name}?</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteName(group.name, group); }} className="wc-btn"
                          style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>Delete all</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmNameId(null); }} className="wc-btn"
                          style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
  );
  return drawerMode ? (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
      {mainInnerContent}
    </div>
  ) : (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
      {mainInnerContent}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────
export default function App({ pendingImportedChat = null, onPendingImportedChatConsumed = () => {} }) {
  const [phase,            setPhase]            = useState("auth");
  const [authedUser,       setAuthedUser]       = useState(null);
  const [credits,          setCredits]          = useState(null);
  const [quickReadAvailable, setQuickReadAvailable] = useState(false);
  const [userRole,         setUserRole]         = useState("user");
  const [accessMode,       setAccessModeState]  = useState(DEFAULT_ACCESS_MODE);
  const [messages,         setMessages]         = useState(null);
  const [math,             setMath]             = useState(null);
  const [ai,               setAi]               = useState(null);
  const [connectionDigest, setConnectionDigest] = useState(null);
  const [connectionDigestKey, setConnectionDigestKey] = useState("");
  const [coreAnalysisA,    setCoreAnalysisA]    = useState(null);
  const [coreAnalysisAKey, setCoreAnalysisAKey] = useState("");
  const [coreAnalysisB,    setCoreAnalysisB]    = useState(null);
  const [coreAnalysisBKey, setCoreAnalysisBKey] = useState("");
  const [aiLoading,        setAiLoading]        = useState(false);
  const [reportType,       setReportType]       = useState(null);
  const [selectedReportTypes, setSelectedReportTypes] = useState([]);
  const [loadingReportIndex, setLoadingReportIndex] = useState(0);
  const [relationshipType, setRelationshipType] = useState(null);
  const [reportLang,       setReportLang]       = useState("auto");  // explicit report/output language, or auto from chat
  const [detectedLang,     setDetectedLang]     = useState(null);  // { code, label, confidence }
  const [uiLangPref,       setUiLangPref]       = useState("en");
  const [step,             setStep]             = useState(0);
  const [dir,              setDir]              = useState("fwd");
  const [sid,              setSid]              = useState(0);
  const [resultsOrigin,    setResultsOrigin]    = useState("upload"); // "upload" | "history"
  const [reportRouteState, setReportRouteState] = useState(null);
  const [historyBundleView, setHistoryBundleView] = useState(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [settingsReturnTarget, setSettingsReturnTarget] = useState("upload");
  const [sessionCompletedBundles, setSessionCompletedBundles] = useState({});
  const [unlockedPackIds, setUnlockedPackIds] = useState({});
  const [paymentPreselect, setPaymentPreselect] = useState(null);
  const [paymentBackPhase, setPaymentBackPhase] = useState("select");
  const [paymentToast, setPaymentToast] = useState("");
  const [shareBusy,        setShareBusy]        = useState(false);
  const [sharePicker,      setSharePicker]      = useState(false);
  const [currentResultId,  setCurrentResultId]  = useState(null);
  const [feedbackTarget,   setFeedbackTarget]   = useState(null);
  const [feedbackChoice,   setFeedbackChoice]   = useState("");
  const [feedbackNote,     setFeedbackNote]     = useState("");
  const [feedbackBusy,     setFeedbackBusy]     = useState(false);
  const [feedbackThanks,   setFeedbackThanks]   = useState(false);
  const [uploadError,      setUploadError]      = useState("");
  const [uploadInfo,       setUploadInfo]       = useState("");
  const [pendingParsedInput,  setPendingParsedInput]  = useState(null);
  const [pendingSkipRelationship, setPendingSkipRelationship] = useState(false);
  const [upgradeInfo,      setUpgradeInfo]      = useState(null);
  const [analysisError,    setAnalysisError]    = useState("");
  const [importMeta,       setImportMeta]       = useState({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
  const [,                 setActiveDataset]    = useState(null);
  const [pendingDataset,   setPendingDataset]   = useState(null);
  const [participantMismatch, setParticipantMismatch] = useState(null);
  const [debugExportJson,  setDebugExportJson]  = useState("");
  const [debugRelType,     setDebugRelType]     = useState(null);
  const [debugRawText,     setDebugRawText]     = useState("");
  const [debugRawLabel,    setDebugRawLabel]    = useState("");
  const [debugRawBusy,     setDebugRawBusy]     = useState(false);
  const consumedImportRef   = useRef(null);
  const trialAutoRunDoneRef = useRef(false);
  const resolvedUiLang = resolveUiLang(uiLangPref, detectedLang?.code);
  const reportContentLang = reportLang === "auto"
    ? (isReliableDetectedLanguage(detectedLang) ? normalizeUiLangCode(detectedLang?.code) : "en")
    : normalizeUiLangCode(reportLang);
  const authedIsAdmin = isAdminUser(authedUser);

  useEffect(() => {
    setUiLangPref(normalizeUiLangPref(authedUser?.user_metadata?.ui_language));
  }, [authedUser]);

  useEffect(() => {
    let cancelled = false;

    if (!authedUser) {
      setCredits(null);
      setQuickReadAvailable(false);
      setUserRole("user");
      setUploadInfo("");
      return undefined;
    }

    if (authedIsAdmin) {
      setCredits(null);
      setQuickReadAvailable(false);
      setUserRole("user");
      setUploadInfo("");
      return undefined;
    }

    (async () => {
      try {
        const { balance, role, quickReadAvailable: hasQuickRead } = await getUserProfile();
        if (cancelled) return;
        setCredits(balance);
        setQuickReadAvailable(hasQuickRead);
        setUserRole(role);
        if (typeof balance === "number" && balance > 0) setUploadInfo("");
      } catch (error) {
        if (cancelled) return;
        console.error("Credits load failed", error);
        setCredits(null);
        setQuickReadAvailable(false);
        setUserRole("user");
      }
    })();

    return () => { cancelled = true; };
  }, [authedIsAdmin, authedUser]);

  const updateUiLangPref = async (pref) => {
    const nextPref = normalizeUiLangPref(pref);
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), ui_language: nextPref } }
        : prev
    ));
    try {
      const { data } = await supabase.auth.updateUser({ data: { ui_language: nextPref } });
      if (data?.user) setAuthedUser(data.user);
    } catch {
      // Silent: preference changes should never interrupt the user flow.
    }
  };

  // Keep a ref so the visibilitychange handler always sees the current phase
  // without being re-registered on every render.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (!feedbackThanks) return undefined;
    const t = setTimeout(() => setFeedbackThanks(false), 2000);
    return () => clearTimeout(t);
  }, [feedbackThanks]);

  useEffect(() => {
    if (!messages?.length) return;
    if (math?.analysisVersion === LOCAL_STATS_VERSION) return;

    try {
      const refreshed = localStats(messages);
      if (!refreshed) return;
      refreshed.cappedGroup = math?.cappedGroup ?? refreshed.cappedGroup;
      refreshed.originalParticipantCount = math?.originalParticipantCount ?? refreshed.originalParticipantCount;
      setMath(refreshed);
      setCurrentResultId(null);
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } catch (error) {
      console.error("Local stats refresh failed", error);
    }
  }, [math, messages]);

  // When the tab becomes visible again while stuck on the loading screen,
  // check if a result was already saved (e.g. the fetch completed in the
  // background) and restore it without asking the user to re-upload.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current !== "loading") return;
      if (selectedReportTypes.length > 1) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setAuthedUser(user);

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;

      const displayLang = getStoredResultDisplayLanguage(data.result_data);
      const sourceLang = normalizeUiLangCode(data.result_data?.sourceLanguage || displayLang);
      const displayResult = getDisplayResultData(data.result_data, displayLang);
      const canReuseCore = data.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;

      setAi(displayResult || {});
      if (canReuseCore && data.result_data?.coreAnalysis?.part === "connection") {
        const cacheFamily = data.report_type === "energy" ? "connection:energy" : "connection";
        setConnectionDigest(data.result_data.coreAnalysis);
        setConnectionDigestKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      } else if (canReuseCore && (data.result_data?.coreAnalysis?.part === "growth" || data.result_data?.coreAnalysis?.part === "a")) {
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(data.result_data.coreAnalysis);
        setCoreAnalysisAKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, "growth", sourceLang));
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      } else if (canReuseCore && (data.result_data?.coreAnalysis?.part === "risk" || data.result_data?.coreAnalysis?.part === "b")) {
        const cacheFamily = data.report_type === "accounta" ? "risk:accountability" : "risk";
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(data.result_data.coreAnalysis);
        setCoreAnalysisBKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
      } else {
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      }
      setMath(data.math_data || null);
      setReportType(data.report_type || null);
      setSelectedReportTypes(data.report_type ? [data.report_type] : []);
      setLoadingReportIndex(0);
      setCurrentResultId(data.id || null);
      setRelationshipType(displayResult?.relationshipType ?? null);
      setReportLang(displayLang);
      setAiLoading(false);
      setStep(0);
      setDir("fwd");
      setResultsOrigin("upload");
      setReportRouteState(null);
      setHistoryBundleView(null);
      setPhase("results");
      setSid(s => s + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [selectedReportTypes.length]); // registered once per batch-mode shape — reads phase via phaseRef

  // Check for an existing session on mount and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthedUser(session?.user || null);
      if (session?.user) {
        setStep(0);
        setDir("fade");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthedUser(session?.user || null);
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      if (session?.user) {
        if (event === "SIGNED_IN" && phaseRef.current === "auth") {
          setStep(0);
          setDir("fwd");
          setPhase(postAuthPhaseForUser(session.user));
          setSid(s => s + 1);
        }
      } else if (event === "SIGNED_OUT") {
        setStep(0);
        setDir("fwd");
        setPhase("auth");
        setSid(s => s + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authedUser) {
      setAccessModeState(DEFAULT_ACCESS_MODE);
      return;
    }

    let alive = true;
    getAccessMode()
      .then(mode => {
        if (alive) setAccessModeState(mode);
      })
      .catch(error => {
        console.error("Access mode refresh failed", error);
        if (alive) setAccessModeState(DEFAULT_ACCESS_MODE);
      });

    return () => { alive = false; };
  }, [authedUser]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const handleAccountDeleted = () => {
    setAuthedUser(null);
    setCredits(null);
    setQuickReadAvailable(false);
    setUserRole("user");
    setMessages(null);
    setMath(null);
    setAi(null);
    setConnectionDigest(null);
    setConnectionDigestKey("");
    setCoreAnalysisA(null);
    setCoreAnalysisAKey("");
    setCoreAnalysisB(null);
    setCoreAnalysisBKey("");
    setAiLoading(false);
    setReportType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setRelationshipType(null);
    setReportLang("auto");
    setDetectedLang(null);
    setStep(0);
    setDir("fade");
    setResultsOrigin("upload");
    setReportRouteState(null);
    setHistoryBundleView(null);
    setHistoryDrawerOpen(false);
    setSettingsReturnTarget("upload");
    setSessionCompletedBundles({});
    setUnlockedPackIds({});
    setPaymentPreselect(null);
    setPaymentBackPhase("select");
    setPaymentToast("");
    setShareBusy(false);
    setSharePicker(false);
    setCurrentResultId(null);
    setFeedbackTarget(null);
    setFeedbackChoice("");
    setFeedbackNote("");
    setFeedbackBusy(false);
    setFeedbackThanks(false);
    setUploadError("");
    setUploadInfo("");
    setUpgradeInfo(null);
    setAnalysisError("");
    setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
    setActiveDataset(null);
    setPendingDataset(null);
    setParticipantMismatch(null);
    setDebugExportJson("");
    setDebugRelType(null);
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRawBusy(false);
    setPhase("auth");
    setSid(s => s + 1);
  };

  // Called when onboarding completes → proceed to terms acceptance
  const onOnboarded = (pref = "en") => {
    const nextPref = normalizeUiLangPref(pref);
    const userEmail = authedUser?.email || null;
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), has_onboarded: true, ui_language: nextPref } }
        : prev
    ));
    setStep(0);
    setDir("fwd");
    setPhase("terms");
    setSid(s => s + 1);

    void (async () => {
      try {
        const balance = await initialiseUserCredits(userEmail);
        setCredits(balance);
        const profile = await getUserProfile();
        setQuickReadAvailable(profile.quickReadAvailable);
        setUserRole(profile.role);
      } catch (error) {
        console.error("Initial credits setup failed", error);
      }
    })();
  };

  // Called when terms are accepted → proceed to upload
  const onAcceptedTerms = () => {
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setReportRouteState(null);
    setHistoryBundleView(null);
    setStep(0);
    setDir("fade");
    setPhase(hasUserProvidedDisplayName(authedUser) ? "upload" : "profileName");
    setSid(s => s + 1);
  };

  const onProfileNameSaved = (updatedUser) => {
    if (updatedUser) setAuthedUser(updatedUser);
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setStep(0);
    setDir("fade");
    setPhase("upload");
    setSid(s => s + 1);
  };

  const go      = d => { setDir(d); setSid(s => s+1); setStep(s => d==="fwd" ? s+1 : s-1); };
  const back    = () => go("bk");
  const next    = () => go("fwd");
  const restart = () => {
    setPhase("upload"); setMessages(null); setMath(null); setAi(null);
    setConnectionDigest(null); setConnectionDigestKey("");
    setCoreAnalysisA(null); setCoreAnalysisAKey("");
    setCoreAnalysisB(null); setCoreAnalysisBKey("");
    setAiLoading(false); setReportType(null); setRelationshipType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setCurrentResultId(null);
    setReportRouteState(null);
    setHistoryBundleView(null);
    setSessionCompletedBundles({});
    setUnlockedPackIds({});
    setPaymentPreselect(null);
    setPaymentBackPhase("select");
    setPaymentToast("");
    setFeedbackTarget(null); setFeedbackChoice(""); setFeedbackNote(""); setFeedbackBusy(false); setFeedbackThanks(false);
    setReportLang("auto"); setDetectedLang(null);
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
    setActiveDataset(null);
    setPendingDataset(null);
    setParticipantMismatch(null);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRelType(null);
    setStep(0); setDir("fade"); setSid(s => s+1);
  };

  const resetImportDerivedState = () => {
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRelType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setSessionCompletedBundles({});
    setUnlockedPackIds({});
  };

  const openPayment = (packId = null, backPhase = "select") => {
    setPaymentPreselect(packId);
    setPaymentBackPhase(backPhase || "select");
    setPaymentToast("");
    setDir("fwd");
    setPhase("payment");
    setSid(s => s + 1);
  };

  const openUnlockReads = (packId = null, backPhase = "select") => {
    const pack = packId ? PACK_DEFS[packId] : null;
    setUpgradeInfo({
      requiredCredits: pack?.cost ?? null,
      availableCredits: credits,
      accessMode,
      backPhase: backPhase || "select",
    });
    setAnalysisError("");
    setDir("fwd");
    setPhase("upgrade");
    setSid(s => s + 1);
  };

  const unlockPackForCurrentChat = (pack) => {
    if (!pack?.id) return;
    setUnlockedPackIds({ [pack.id]: true });
    setAnalysisError("");
    setUploadInfo("");
    setUpgradeInfo(null);
    setDir("bk");
    setPhase("select");
    setSid(s => s + 1);
  };

  const closePayment = () => {
    const target = paymentBackPhase || upgradeInfo?.backPhase || "select";
    setPaymentPreselect(null);
    setPaymentToast("");
    setAnalysisError("");
    setDir("bk");
    setPhase(target);
    setSid(s => s + 1);
  };

  const showPaymentComingSoon = () => {
    setPaymentToast("Payment coming soon");
    window.setTimeout(() => setPaymentToast(""), 1800);
  };

  const continueWithDataset = (dataset, { skipMismatch = false, skipRelationship = false } = {}) => {
    const mismatch = skipMismatch ? null : detectParticipantConsistencyMismatch(dataset, authedUser);
    if (mismatch) {
      setPendingDataset(dataset);
      setParticipantMismatch(mismatch);
      setDir("fwd");
      setPhase("participantMismatch");
      setSid(s => s + 1);
      return;
    }

    const msgs = toAnalysisMessagesFromDataset(dataset);
    const tooShort = msgs.length < MIN_MESSAGES;
    const summary = {
      participants: dataset.participants.map(participant => participant.displayName),
      participantLabel: getParticipantDisplayTitle(dataset, null, authedUser),
      messageCount: msgs.length,
      dateRange: dataset.sourceChats?.[0]?.dateRange || [msgs[0]?.date || null, msgs.at(-1)?.date || null],
      dateRangeLabel: dataset.sourceChats?.length > 1 ? `${dataset.sourceChats.length} chats combined` : undefined,
    };
    const fileName = dataset.sourceChats?.[0]?.fileName || null;

    setImportMeta({
      fileName,
      summary,
      rawProcessedPayload: { messages: msgs, tooShort },
      tooShort,
      dataset: {
        datasetId: dataset.datasetId,
        datasetKind: dataset.datasetKind,
        sourceChatCount: dataset.combinedMeta?.sourceChatCount || 1,
        displayTitle: getParticipantDisplayTitle(dataset, null, authedUser),
      },
    });
    if (tooShort) {
      setDir("fwd");
      setPhase("tooshort");
      setSid(s => s + 1);
      return;
    }
    // Yield to the browser's render cycle so "Reading your chat…" appears
    // before the heavy synchronous computation blocks the main thread.
    setTimeout(() => {
      try {
        const { messages: cappedMsgs, cappedGroup, originalParticipantCount } = capLargeGroup(msgs);
        const m = localStats(cappedMsgs);
        if (m) {
          m.cappedGroup = cappedGroup;
          m.originalParticipantCount = originalParticipantCount;
          m.datasetId = dataset.datasetId;
          m.datasetKind = dataset.datasetKind;
          m.sourceChatCount = dataset.combinedMeta?.sourceChatCount || 1;
          m.displayTitle = getParticipantDisplayTitle(dataset, m, authedUser);
          m.participantAliases = dataset.participantAliases;
          m.mergeState = dataset.mergeState;
          m.sourceChats = dataset.sourceChats;
          m.combinedMeta = dataset.combinedMeta;
        }
        const detected = detectLanguage(cappedMsgs);
        setDetectedLang(detected);
        setMessages(cappedMsgs);
        setMath(m);
        setActiveDataset(dataset);
        setPendingDataset(null);
        setParticipantMismatch(null);
        setAi(null);
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
        setRelationshipType(null);
        setSelectedReportTypes([]);
        setLoadingReportIndex(0);
        setCurrentResultId(null);
        setReportRouteState(null);
        setHistoryBundleView(null);
        setDebugRelType(null);
        setDir("fwd");
        setPhase(m?.isGroup ? "select" : (skipRelationship ? "select" : "relationship"));
        setSid(s => s+1);
      } catch (error) {
        console.error("Post-parse analysis failed", error);
        setMessages(null);
        setMath(null);
        setDetectedLang(null);
        setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
        setActiveDataset(null);
        setPendingDataset(null);
        setParticipantMismatch(null);
        setUploadError("Couldn't finish reading this chat. Try exporting again or using a shorter date range.");
        setDir("fade");
        setPhase("upload");
        setSid(s => s + 1);
      }
    }, 0);
  };

  // Step 1: file parsed → normalize identity, review merges, then compute stats
  const onParsed = (parsedInput) => {
    trialAutoRunDoneRef.current = false;
    resetImportDerivedState();
    setPendingSkipRelationship(false);
    try {
      const isMultiUpload = Array.isArray(parsedInput?.parsedChats);
      const rawDataset = isMultiUpload
        ? buildCombinedDataset(parsedInput.parsedChats)
        : buildDatasetFromParsedChat(parsedInput);
      const dataset = applyAutomaticParticipantMerges(rawDataset);
      if (!isMultiUpload) setPendingParsedInput(parsedInput);
      else setPendingParsedInput(null);
      if (getReviewableMergeSuggestions(dataset).length) {
        setPendingDataset(dataset);
        setParticipantMismatch(null);
        setDir("fwd");
        setPhase("mergeReview");
        setSid(s => s + 1);
        return;
      }
      continueWithDataset(dataset);
    } catch (error) {
      console.error("Dataset preparation failed", error);
      setUploadError(String(error?.message || "Couldn't finish reading this chat. Try exporting again or using a shorter date range."));
      setDir("fade");
      setPhase("upload");
      setSid(s => s + 1);
    }
  };

  const onMergeReviewContinue = (approvedIds) => {
    const dataset = pendingDataset;
    if (!dataset) {
      setPhase("upload");
      return;
    }
    const mergedDataset = applyApprovedMerges(dataset, approvedIds, dataset.mergeState?.suggestions || []);
    const skip = pendingSkipRelationship;
    setPendingSkipRelationship(false);
    continueWithDataset(mergedDataset, { skipRelationship: skip });
  };

  const onParticipantMismatchContinue = () => {
    if (!pendingDataset) {
      setPhase("upload");
      return;
    }
    const skip = pendingSkipRelationship;
    setPendingSkipRelationship(false);
    continueWithDataset(pendingDataset, { skipMismatch: true, skipRelationship: skip });
  };

  useEffect(() => {
    if (!pendingImportedChat?.id || !pendingImportedChat.payload) return;
    if (consumedImportRef.current === pendingImportedChat.id) return;
    if (!authedUser || phase !== "upload") return;

    consumedImportRef.current = pendingImportedChat.id;
    onParsed(pendingImportedChat.payload);
    onPendingImportedChatConsumed(pendingImportedChat.id);
  }, [authedUser, onPendingImportedChatConsumed, pendingImportedChat, phase]);

  // Auto-trigger the onboarding Quick Read entitlement before paid packs.
  useLayoutEffect(() => {
    if (phase !== "select") return;
    if (!messages?.length || !math) return;
    if (authedIsAdmin || isOpenMode(accessMode)) return;
    if (accessMode !== "payments" || !quickReadAvailable) return;
    if (trialAutoRunDoneRef.current) return;
    trialAutoRunDoneRef.current = true;
    setAnalysisError("");
    setUploadInfo("");
    setUpgradeInfo(null);
    setStep(0);
    setDir("fwd");
    setSelectedReportTypes(["trial_report"]);
    setReportType("trial_report");
    setLoadingReportIndex(0);
    setCurrentResultId(null);
    setAiLoading(true);
    setAi(null);
    setPhase("loading");
    setSid(s => s + 1);
    runAnalysis(["trial_report"], math.isGroup ? null : relationshipType);
  }, [phase, messages, math, quickReadAvailable, accessMode, authedIsAdmin, relationshipType]); // eslint-disable-line react-hooks/exhaustive-deps

  const generatePipelineResult = async (type, relType, contentLang = reportContentLang) => {
    const pipeline = REPORT_PIPELINES[type];
    const lang = normalizeUiLangCode(contentLang);

    if (pipeline?.strategy === "trial") {
      return await generateTrialDigest(messages, math, relType, lang);
    }

    if (pipeline?.strategy !== "family") return {};

    const family = pipeline.family || "connection";
    const cacheFamily =
      type === "energy" && family === "connection" ? "connection:energy" :
      type === "accounta" && family === "risk" ? "risk:accountability" :
      family;
    const cacheKey = getAnalysisFamilyCacheKey(math, relType, cacheFamily, lang);
    let core = null;

    if (family === "connection") {
      core = connectionDigestKey === cacheKey ? connectionDigest : null;
      if (!core) {
        core = await generateConnectionDigest(messages, math, relType, lang, { energyFocus: type === "energy" });
        setConnectionDigest(core);
        setConnectionDigestKey(cacheKey);
      }
    } else if (family === "growth") {
      core = coreAnalysisAKey === cacheKey ? coreAnalysisA : null;
      if (!core) {
        core = await generateGrowthDigest(messages, math, relType, lang);
        setCoreAnalysisA(core);
        setCoreAnalysisAKey(cacheKey);
      }
    } else if (family === "risk") {
      core = coreAnalysisBKey === cacheKey ? coreAnalysisB : null;
      if (!core) {
        core = await generateRiskDigest(messages, math, relType, lang, { accountabilityFocus: type === "accounta" });
        setCoreAnalysisB(core);
        setCoreAnalysisBKey(cacheKey);
      }
    }

    const derived = pipeline.derive(core, math, relType);
    if (!hasMeaningfulAnalysisResult(type, derived)) {
      // Log quality warning but return the partial result so the frontend can still render.
      // Cards with empty AI fields will show placeholder "—" values rather than aborting entirely.
      console.warn(`[generatePipelineResult] low-quality result for "${type}" — rendering partial`);
    }
    return derived;
  };

  const restoreGeneratedResult = (type, result, savedId = null) => {
    const displayLang = result ? getStoredResultDisplayLanguage(result) : "en";
    if (!result) return false;
    setReportType(type);
    setSelectedReportTypes([type]);
    setLoadingReportIndex(0);
    setAi(getDisplayResultData(result, displayLang));
    setCurrentResultId(savedId || null);
    setAiLoading(false);
    setResultsOrigin("upload");
    setReportRouteState(null);
    setHistoryBundleView(null);
    if (typeof window !== "undefined") {
      window.history.pushState({ wrapchatPhase: "results" }, "", window.location.href);
    }
    setDir("fwd");
    setPhase("results");
    setStep(0);
    setSid(s => s + 1);
    return true;
  };

  const deductCreditsBatch = async (types, mode = accessMode) => {
    const selectedTypes = normalizeSelectedReportTypes(Array.isArray(types) ? types : [types]).filter(type => type && type !== QUICK_READ_TRIAL_CONFIG.reportId);
    if (authedIsAdmin || isOpenMode(mode) || !selectedTypes.length) return;
    try {
      const amount = getTotalCreditCostBundled(selectedTypes);
      const nextBalance = await deductCreditsAmount(authedUser?.id, amount);
      setCredits(nextBalance);
    } catch (error) {
      console.error("Credit deduction failed", error);
    }
  };

  const failBackToSelection = (message) => {
    const fallbackPhase = math?.isGroup ? "select" : "relationship";
    setAnalysisError(message);
    setAiLoading(false);
    setDir("bk");
    setPhase(fallbackPhase);
    setStep(0);
    setSid(s => s + 1);
  };

  // Run AI analysis with the selected report type(s) and relationship type
  const runAnalysis = async (types, relType) => {
    const selectedTypes = normalizeSelectedReportTypes(Array.isArray(types) ? types : [types]).filter(Boolean);
    const isQuickReadRun = selectedTypes.length === 1 && selectedTypes[0] === QUICK_READ_TRIAL_CONFIG.reportId;
    const contentLang = reportContentLang;
    setAnalysisError("");
    if (!selectedTypes.length) {
      setAnalysisError("Choose at least one report.");
      return;
    }

    let activeAccessMode = accessMode;
    try {
      activeAccessMode = await getAccessMode({ throwOnError: true });
      setAccessModeState(activeAccessMode);
    } catch (error) {
      console.error("Access mode check failed", error);
      activeAccessMode = DEFAULT_ACCESS_MODE;
      setAccessModeState(DEFAULT_ACCESS_MODE);
    }

    if (isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode) && !quickReadAvailable) {
      const message = "Your Quick Read has already been used. Credits are required for everything else.";
      setUpgradeInfo({
        message,
        requiredCredits: PACK_DEFS.growth.cost,
        availableCredits: credits,
        accessMode: activeAccessMode,
        backPhase: "select",
      });
      setAnalysisError(message);
      setStep(0);
      setDir("bk");
      setPhase("upgrade");
      setSid(s => s + 1);
      return;
    }

    if (!isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode)) {
      let availableCredits = credits;
      try {
        availableCredits = await getUserCredits();
        setCredits(availableCredits);
      } catch (error) {
        console.error("Credit check failed", error);
        availableCredits = null;
        setCredits(null);
      }

      const access = canUserRunReports({
        ...authedUser,
        role: authedIsAdmin ? "admin" : authedUser?.role,
        credits: availableCredits,
      }, selectedTypes, activeAccessMode);

      if (!access.allowed) {
        setUpgradeInfo({
          message: access.message,
          requiredCredits: access.requiredCredits,
          availableCredits,
          accessMode: activeAccessMode,
          backPhase: "select",
        });
        setAnalysisError(access.message);
        setStep(0);
        setDir("bk");
        setPhase("upgrade");
        setSid(s => s + 1);
        return;
      }
    }

    const runCreditCost = getTotalCreditCostBundled(selectedTypes);
    const matchedBundle = getBundleMatch(selectedTypes);
    const bundleName = matchedBundle?.label
      ?? (selectedTypes.length > 1
        ? selectedTypes.map(type => REPORT_TYPES.find(r => r.id === type)?.label || type).join(" + ")
        : null);

    setUploadInfo("");
    setUpgradeInfo(null);
    setStep(0);
    setDir("fwd");
    setPhase("loading");
    setSid(s => s+1);
    setAiLoading(true);
    setAi(null);
    setSelectedReportTypes(selectedTypes);
    setLoadingReportIndex(0);
    setCurrentResultId(null);
    setReportRouteState(null);
    setHistoryBundleView(null);
    const bundleId = selectedTypes.length > 1 ? crypto.randomUUID() : null;
    const successfulRuns = [];
    const failedTypes = [];

    for (let index = 0; index < selectedTypes.length; index += 1) {
      const type = selectedTypes[index];
      setReportType(type);
      setLoadingReportIndex(index);

      try {
        // eslint-disable-next-line no-await-in-loop
        const canonicalResult = await generatePipelineResult(type, relType, contentLang);
        let translationOverlay = null;
        if (type === "trial_report" && contentLang !== "en") {
          try {
            // eslint-disable-next-line no-await-in-loop
            translationOverlay = await translateResultOverlay(type, canonicalResult, contentLang);
          } catch (translationError) {
            console.error(`Translation failed for report "${type}" [lang=${contentLang}]`, translationError);
          }
        }
        const sourceLang = type === "trial_report" ? "en" : contentLang;
        const resultLang = translationOverlay ? contentLang : sourceLang;
        const result = buildStoredResultData(canonicalResult, resultLang, translationOverlay, sourceLang);
        if (!result) {
          failedTypes.push(type);
          continue;
        }
        const creditMeta = {
          reportTypes: selectedTypes,
          creditCost: getReportCreditCost(type),
          totalRunCreditCost: runCreditCost,
          bundleName,
        };
        // eslint-disable-next-line no-await-in-loop
        const saved = await saveResult(type, result, math, bundleId, creditMeta);
        successfulRuns.push({ type, result, savedId: saved?.id || null });
      } catch (error) {
        console.error(`Analysis failed for report "${type}" [lang=${contentLang}]`, error);
        failedTypes.push(type);
      }
    }

    if (!successfulRuns.length) {
      failBackToSelection(failedTypes.length ? userFacingAnalysisError(new Error("Batch analysis failed.")) : "The AI analysis didn't return a usable result. Please try again.");
      return;
    }

    await deductCreditsBatch(successfulRuns.map(run => run.type), activeAccessMode);
    if (isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode)) {
      try {
        await consumeQuickReadTrial(authedUser?.id);
        setQuickReadAvailable(false);
      } catch (error) {
        console.error("Quick Read entitlement update failed", error);
      }
    }

    const completedPack = packForReports(successfulRuns.map(run => run.type));
    if (completedPack) {
      setSessionCompletedBundles(prev => ({
        ...prev,
        [completedPack.id]: completedPack.id === "growth"
          ? { savedId: successfulRuns[0]?.savedId || null }
          : { savedIds: successfulRuns.map(run => run.savedId).filter(Boolean) },
      }));
    }

    if (successfulRuns.length === 1) {
      const only = successfulRuns[0];
      restoreGeneratedResult(only.type, only.result, only.savedId);
      return;
    }

    setAiLoading(false);
    setResultsOrigin("history");
    setReportRouteState(null);
    setHistoryBundleView(bundleId);
    setDir("fwd");
    setPhase("history");
    setStep(0);
    setSid(s => s + 1);
  };

  // Step 2: user toggles one or more reports, then runs them together
  const onToggleReport = (type) => {
    setAnalysisError("");
    setSelectedReportTypes(prev => {
      const next = prev.includes(type)
        ? prev.filter(item => item !== type)
        : [...prev, type];
      return normalizeSelectedReportTypes(next);
    });
  };

  const onSelectBundle = (reportTypes) => {
    setAnalysisError("");
    setSelectedReportTypes(normalizeSelectedReportTypes(reportTypes));
  };

  const onRunSelectedReports = () => {
    setAnalysisError("");
    runAnalysis(selectedReportTypes, math?.isGroup ? null : relationshipType);
  };

  const onRunPack = (pack) => {
    if (!pack?.reports?.length) return;
    setAnalysisError("");
    setSelectedReportTypes(pack.reports);
    runAnalysis(pack.reports, math?.isGroup ? null : relationshipType);
  };

  // Step 3 (duo only): user picks relationship type → then choose report type
  const buildCombinedAndContinue = (relType, extraParsedChats) => {
    setRelationshipType(relType);
    setDebugRelType(relType);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setAnalysisError("");
    const allParsedChats = [pendingParsedInput, ...extraParsedChats].filter(Boolean);
    setPendingParsedInput(null);
    try {
      const dataset = applyAutomaticParticipantMerges(buildCombinedDataset(allParsedChats));
      if (getReviewableMergeSuggestions(dataset).length) {
        setPendingDataset(dataset);
        setParticipantMismatch(null);
        setPendingSkipRelationship(true);
        setDir("fwd");
        setPhase("mergeReview");
        setSid(s => s + 1);
        return;
      }
      continueWithDataset(dataset, { skipRelationship: true });
    } catch (error) {
      console.error("Combined dataset preparation failed", error);
      setUploadError(String(error?.message || "Couldn't combine the chats. Try exporting again."));
      setDir("fade");
      setPhase("relationship");
      setSid(s => s + 1);
    }
  };

  const onSelectRelationship = (relType, extraParsedChats = []) => {
    setAnalysisError("");
    setDebugRelType(relType);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    if (extraParsedChats.length > 0 && pendingParsedInput) {
      buildCombinedAndContinue(relType, extraParsedChats);
      return;
    }
    setRelationshipType(relType);
    setDir("fwd");
    setPhase("select");
    setSid(s => s+1);
  };

  const buildAdminAiDebugRequests = () => {
    if (!messages?.length || !math) return null;

    const contentLang = reportContentLang;
    const selectedRelationshipType = math.isGroup ? null : (relationshipType || debugRelType || null);
    if (!math.isGroup && !selectedRelationshipType) return null;

    const relationshipContext = !math.isGroup
      ? peekResolvedRelationshipContext(messages, math.names || [], selectedRelationshipType)
      : null;

    const connectionRequest = prepareConnectionDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt: buildCoreASystemPrompt,
      buildRelationshipLine,
      buildSampleText,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_A_MAX_TOKENS,
    });

    const growthRequest = prepareGrowthDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt: buildCoreASystemPrompt,
      buildRelationshipLine,
      formatForAI,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_A_MAX_TOKENS,
    });

    const riskRequest = prepareRiskDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt,
      buildRelationshipLine,
      buildSampleText,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_B_MAX_TOKENS,
    });

    return {
      selectedRelationshipType,
      relationshipContext,
      connectionRequest,
      growthRequest,
      riskRequest,
    };
  };

  const buildLocalAiDebugExport = () => {
    const debugRequests = buildAdminAiDebugRequests();
    if (!debugRequests) return "";
    const {
      selectedRelationshipType,
      relationshipContext,
      connectionRequest,
      growthRequest,
      riskRequest,
    } = debugRequests;

    const exportPayload = buildDebugAnalysisExport({
      fileName: importMeta.fileName,
      rawProcessedPayload: importMeta.rawProcessedPayload,
      messages,
      math,
      detectedLanguage: detectedLang,
      relationshipType: selectedRelationshipType,
      relationshipContext,
      relationshipLine: connectionRequest.relationshipLine || growthRequest.relationshipLine || riskRequest.relationshipLine || "",
      tooShort: importMeta.tooShort,
      summary: importMeta.summary,
      analysisVersions: {
        localStats: LOCAL_STATS_VERSION,
        coreAnalysis: CORE_ANALYSIS_VERSION,
        analysisCacheVersion: CORE_ANALYSIS_CACHE_VERSION,
        homepageVersion: HOMEPAGE_VERSION,
      },
      requests: {
        connection: connectionRequest,
        growth: growthRequest,
        risk: riskRequest,
      },
    });

    const jsonText = serializeDebugAnalysisExport(exportPayload);
    setDebugExportJson(jsonText);
    return jsonText;
  };

  const copyLocalAiDebugExport = async () => {
    const jsonText = debugExportJson || buildLocalAiDebugExport();
    if (!jsonText) return;
    try {
      await navigator.clipboard.writeText(jsonText);
    } catch (error) {
      console.error("Debug JSON copy failed", error);
    }
  };

  const downloadLocalAiDebugExport = () => {
    const jsonText = debugExportJson || buildLocalAiDebugExport();
    if (!jsonText) return;
    downloadJsonFile(jsonText, createAiDebugFileName(importMeta.fileName));
  };

  const runRawAiDebugExport = async (pipeline = "coreA") => {
    const debugRequests = buildAdminAiDebugRequests();
    if (!debugRequests) return;

    const normalizedPipeline = pipeline === "coreB" ? "risk" : (pipeline === "growth" ? "growth" : "connection");
    const request = normalizedPipeline === "risk"
      ? debugRequests.riskRequest
      : normalizedPipeline === "growth"
        ? debugRequests.growthRequest
        : debugRequests.connectionRequest;
    const label = normalizedPipeline === "risk"
      ? "Risk Raw Output"
      : normalizedPipeline === "growth"
        ? "Growth Raw Output"
        : "Connection Raw Output";

    setDebugRawBusy(true);
    setDebugRawLabel(label);
    try {
      const rawText = await callClaudeRawText(request.systemPrompt, request.userContent, request.maxTokens);
      setDebugRawText(rawText);
    } catch (error) {
      console.error(`[${label}] export failed`, error);
      setDebugRawText(String(error?.message || "Raw debug export failed."));
    } finally {
      setDebugRawBusy(false);
    }
  };

  const copyRawAiDebugExport = async () => {
    if (!debugRawText) return;
    try {
      await navigator.clipboard.writeText(debugRawText);
    } catch (error) {
      console.error("Raw debug text copy failed", error);
    }
  };

  const downloadRawAiDebugExport = () => {
    if (!debugRawText) return;
    const pipeline = /risk/i.test(debugRawLabel)
      ? "risk"
      : /growth/i.test(debugRawLabel)
        ? "growth"
        : "connection";
    downloadTextFile(debugRawText, createAiRawDebugFileName(importMeta.fileName, pipeline));
  };

  const closeResults = () => {
    const fromHist = resultsOrigin === "history";
    setReportRouteState(null);
    setDir("fade");
    setPhase("upload");
    setSid(s => s + 1);
    if (fromHist) {
      setHistoryBundleView(reportRouteState?.origin === "bundle" ? reportRouteState.bundleId : null);
      setHistoryDrawerOpen(true);
    } else {
      setHistoryBundleView(null);
    }
  };

  const navigateBack = () => {
    if (sharePicker || feedbackTarget || phase === "auth" || phase === "loading") return;
    if (phase === "results") {
      if (step > 0) back();
      else closeResults();
      return;
    }
    if (phase === "select") {
      setAnalysisError("");
      setDir(math?.isGroup ? "fade" : "bk");
      setPhase(math?.isGroup ? "upload" : "relationship");
      setSid(s => s + 1);
      return;
    }
    if (phase === "relationship") {
      setAnalysisError("");
      setDir("fade");
      setPhase("upload");
      setSid(s => s + 1);
      return;
    }
    if (phase === "upgrade") {
      setAnalysisError("");
      setDir("bk");
      setPhase(upgradeInfo?.backPhase || "select");
      setSid(s => s + 1);
      return;
    }
    if (phase === "payment") {
      closePayment();
      return;
    }
    if (phase === "settings") {
      setDir("fade");
      setHistoryBundleView(null);
      if (settingsReturnTarget === "history") {
        setPhase("history");
        setHistoryDrawerOpen(false);
      } else if (settingsReturnTarget === "historyDrawer") {
        setPhase("upload");
        setHistoryDrawerOpen(true);
      } else {
        setPhase("upload");
        setHistoryDrawerOpen(false);
      }
      setSettingsReturnTarget("upload");
      setSid(s => s + 1);
      return;
    }
    if (["history", "admin", "settings", "tooshort"].includes(phase)) {
      setDir("fade");
      if (phase === "history") setHistoryBundleView(null);
      setPhase("upload");
      setSid(s => s + 1);
    }
  };

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const edgeWidth = 28;

    const onTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (!touch || touch.clientX > edgeWidth) return;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchEnd = (event) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx > 72 && Math.abs(dx) > Math.abs(dy) * 1.6) navigateBack();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [phase, step, math, sharePicker, feedbackTarget, resultsOrigin, reportRouteState, upgradeInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== "results") return undefined;
    window.addEventListener("popstate", navigateBack);
    return () => window.removeEventListener("popstate", navigateBack);
  }, [phase, step, resultsOrigin, reportRouteState]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFeedback = (target) => {
    setFeedbackTarget(target);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const closeFeedback = (force = false) => {
    if (feedbackBusy && !force) return;
    setFeedbackTarget(null);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackTarget || !feedbackChoice || feedbackBusy) return;
    setFeedbackBusy(true);
    const ok = await submitFeedback({
      resultId: feedbackTarget.resultId,
      reportType: feedbackTarget.reportType,
      cardIndex: feedbackTarget.cardIndex,
      cardTitle: feedbackTarget.cardTitle,
      errorType: feedbackChoice,
      errorNote: feedbackNote,
    });
    setFeedbackBusy(false);
    closeFeedback(true);
    if (ok) setFeedbackThanks(true);
  };

  const getSummaryShareScreen = () => {
    if (!math) return null;
    const noop = () => {};
    if (reportType === "toxicity")
      return <ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={TOXICITY_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "lovelang")
      return <LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={LOVELANG_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "growth")
      return <GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={GROWTH_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "accounta")
      return <AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={ACCOUNTA_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "energy")
      return <EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={ENERGY_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
    const total = contentCount + 1;
    return (
      <Finale
        s={math}
        ai={ai}
        aiLoading={aiLoading}
        restart={noop}
        back={noop}
        prog={total}
        total={total}
        mode="casual"
        resultId={currentResultId}
      />
    );
  };

  const captureScreen = async (type, filename) => {
    if (shareBusy) return;
    setShareBusy(true);
    setSharePicker(false);
    let blob = null;
    try {
      const canvas = await buildShareCanvas(type, wrapchatLogoTransparent);
      if (!canvas) return;
      blob = await canvasToBlob(canvas);
      const file = typeof File === "function"
        ? new File([blob], filename, { type: "image/png" })
        : null;
      if (file && canShareFiles([file])) {
        await navigator.share({ files: [file], title: "WrapChat" });
      } else {
        downloadBlob(blob, filename);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (blob) downloadBlob(blob, filename);
        console.error("Screen capture failed", error);
      }
    } finally {
      setShareBusy(false);
    }
  };

  const wrap = child => (
    <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
      <ShareResultsContext.Provider value={{ onShare: () => setSharePicker(true), busy: shareBusy }}>
        <FeedbackContext.Provider value={{ openFeedback }}>
          <>
            <div style={{ width:"min(420px, 100vw)", margin:"0 auto", overflow:"hidden" }}>
              <Slide dir={dir} id={sid}>
                <CloseResultsContext.Provider value={closeResults}>
                  {child}
                </CloseResultsContext.Provider>
              </Slide>
            </div>
            <div
              aria-hidden="true"
              data-share-capture="summary"
              style={{
                position:"fixed",
                top:0,
                left:-10000,
                width:"min(420px, 100vw)",
                pointerEvents:"none",
                zIndex:-1,
              }}
            >
              <CloseResultsContext.Provider value={null}>
                {getSummaryShareScreen()}
              </CloseResultsContext.Provider>
            </div>
            <SharePicker
              open={sharePicker}
              busy={shareBusy}
              onCard={() => captureScreen("card", `wrapchat-${reportType || "general"}-card.png`)}
              onSummary={() => captureScreen("summary", `wrapchat-${reportType || "general"}-summary.png`)}
              onClose={() => setSharePicker(false)}
            />
            <FeedbackSheet
              open={!!feedbackTarget}
              target={feedbackTarget}
              selected={feedbackChoice}
              note={feedbackNote}
              submitting={feedbackBusy}
              onSelect={setFeedbackChoice}
              onNoteChange={setFeedbackNote}
              onSubmit={handleSubmitFeedback}
              onClose={closeFeedback}
            />
            {feedbackThanks && (
              <div style={{ position:"fixed", left:"50%", bottom:32, transform:"translateX(-50%)", zIndex:210, background:"rgba(20,20,28,0.96)", border:"1px solid rgba(255,255,255,0.14)", color:"#fff", padding:"11px 20px", borderRadius:999, fontSize:13, fontWeight:700, letterSpacing:"0.02em", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:15 }}>✓</span> {translateUI(resolvedUiLang, "Got it, thank you.")}
              </div>
            )}
          </>
        </FeedbackContext.Provider>
      </ShareResultsContext.Provider>
    </UILanguageContext.Provider>
  );

  const withUiLanguage = (node) => (
    <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
      {node}
    </UILanguageContext.Provider>
  );

  const pushReportHistoryEntry = () => {
    if (typeof window === "undefined") return;
    window.history.pushState({ wrapchatPhase: "results" }, "", window.location.href);
  };

  const onRestoreResult = (row, routeState = null) => {
    const nextRouteState = routeState?.origin === "bundle" && routeState.bundleId
      ? { origin: "bundle", bundleId: routeState.bundleId }
      : null;
    setMath(row.math_data);
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const sourceLang = normalizeUiLangCode(row.result_data?.sourceLanguage || displayLang);
    const canReuseCore = row.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;
    setAi(getDisplayResultData(row.result_data, displayLang));
    if (canReuseCore && row.result_data?.coreAnalysis?.part === "connection") {
      const cacheFamily = row.report_type === "energy" ? "connection:energy" : "connection";
      setConnectionDigest(row.result_data.coreAnalysis);
      setConnectionDigestKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } else if (canReuseCore && (row.result_data?.coreAnalysis?.part === "growth" || row.result_data?.coreAnalysis?.part === "a")) {
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(row.result_data.coreAnalysis);
      setCoreAnalysisAKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, "growth", sourceLang));
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } else if (canReuseCore && (row.result_data?.coreAnalysis?.part === "risk" || row.result_data?.coreAnalysis?.part === "b")) {
      const cacheFamily = row.report_type === "accounta" ? "risk:accountability" : "risk";
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(row.result_data.coreAnalysis);
      setCoreAnalysisBKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
    } else {
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    }
    setReportType(row.report_type);
    setSelectedReportTypes(row.report_type ? [row.report_type] : []);
    setLoadingReportIndex(0);
    setCurrentResultId(row.id || null);
    setReportRouteState(nextRouteState);
    setHistoryBundleView(null);
    setHistoryDrawerOpen(false);
    setRelationshipType(row.result_data?.relationshipType ?? null);
    setReportLang(displayLang);
    setAiLoading(false);
    setStep(0);
    setDir("fwd");
    setResultsOrigin("history");
    setPhase("results");
    pushReportHistoryEntry();
    setSid(s => s + 1);
  };

  if (phase === "auth")     return withUiLanguage(<Slide dir={dir} id={sid}><Auth /></Slide>);
  if (phase === "onboarding") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <OnboardingFlow step={step} next={next} onOnboarded={onOnboarded} />
    </Slide>)
  );
  if (phase === "terms") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <TermsFlow onAccepted={onAcceptedTerms} onLogout={logout} />
    </Slide>)
  );
  if (phase === "profileName") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <ProfileNameSetup user={authedUser} onSaved={onProfileNameSaved} onLogout={logout} />
    </Slide>)
  );
  if (phase === "admin") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      {isAdminUser(authedUser)
        ? <AdminPanel
            onBack={navigateBack}
            onLogout={logout}
            accessMode={accessMode}
            onAccessModeChange={setAccessModeState}
          />
        : <AdminLocked onBack={navigateBack} />}
    </Slide>)
  );
  if (phase === "settings") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <SettingsScreen
        onBack={navigateBack}
        onAccountDeleted={handleAccountDeleted}
        onLogout={logout}
        onUserUpdated={setAuthedUser}
        reportLang={reportLang}
        onReportLangChange={code => {
          setAnalysisError("");
          setReportLang(code);
          setCoreAnalysisA(null);
          setCoreAnalysisAKey("");
          setCoreAnalysisB(null);
          setCoreAnalysisBKey("");
        }}
      />
    </Slide>
  );
  if (phase === "history")  return withUiLanguage(<Slide dir={dir} id={sid}><MyResults initialBundleId={historyBundleView} onBack={navigateBack} onRestoreResult={onRestoreResult} onSettings={() => { setSettingsReturnTarget("history"); setDir("fwd"); setPhase("settings"); setSid(s => s+1); }} /></Slide>);
  if (phase === "upload") return withUiLanguage(
    <>
      <Slide dir={dir} id={sid}>
        <Upload
          onParsed={onParsed}
          onLogout={logout}
          onHistory={() => { setHistoryBundleView(null); setHistoryDrawerOpen(true); }}
          onAdmin={() => { setDir("fwd"); setPhase("admin"); setSid(s => s+1); }}
          onSettings={() => { setSettingsReturnTarget("upload"); setDir("fwd"); setPhase("settings"); setSid(s => s+1); }}
          canAdmin={authedIsAdmin}
          uploadError={uploadError}
          uploadInfo={uploadInfo}
          credits={credits}
          unlockedPackIds={unlockedPackIds}
          quickReadAvailable={quickReadAvailable}
          hideCredits={authedIsAdmin}
	          accessMode={accessMode}
	          onClearError={() => setUploadError("")}
	          onUpgrade={() => { setUpgradeInfo({ availableCredits: credits, accessMode, backPhase: "upload" }); setDir("fwd"); setPhase("upgrade"); setSid(s => s+1); }}
	          onPayment={() => openPayment(null, "upload")}
	        />
      </Slide>
      {/* My Results slide-in drawer */}
      <div style={{ position:"fixed", inset:0, zIndex:120, pointerEvents: historyDrawerOpen ? "all" : "none" }}>
        {/* Backdrop */}
        <div
          onClick={() => { setHistoryBundleView(null); setHistoryDrawerOpen(false); }}
          style={{
            position:"absolute", inset:0,
            background:"rgba(0,0,0,0.52)",
            backdropFilter:"blur(3px)", WebkitBackdropFilter:"blur(3px)",
            opacity: historyDrawerOpen ? 1 : 0,
            transition:"opacity 0.28s ease",
            pointerEvents: historyDrawerOpen ? "all" : "none",
          }}
        />
        {/* Drawer panel */}
        <div style={{
          position:"absolute", top:0, left:0, bottom:0,
          width:"100%",
          paddingTop:"max(20px, env(safe-area-inset-top, 0px))",
          transform: historyDrawerOpen ? "translateX(0)" : "translateX(-100%)",
          transition:"transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
          background:DA.bg,
          display:"flex", flexDirection:"column",
          overflow:"hidden",
          boxShadow:"4px 0 32px rgba(0,0,0,0.45)",
          boxSizing:"border-box",
        }}>
          <MyResults
            drawerMode={true}
            initialBundleId={historyBundleView}
            onBack={() => { setHistoryBundleView(null); setHistoryDrawerOpen(false); }}
            onRestoreResult={(row, routeState) => { setHistoryDrawerOpen(false); onRestoreResult(row, routeState); }}
            onSettings={() => { setSettingsReturnTarget("historyDrawer"); setHistoryDrawerOpen(false); setDir("fwd"); setPhase("settings"); setSid(s => s+1); }}
          />
        </div>
      </div>
    </>
  );
  if (phase === "tooshort") return withUiLanguage(<Slide dir={dir} id={sid}><TooShort onBack={navigateBack} /></Slide>);
  if (phase === "mergeReview") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <DuplicateParticipantReview
        dataset={pendingDataset}
        onContinue={onMergeReviewContinue}
        onBack={() => { setPendingDataset(null); setDir("bk"); setPhase("upload"); setSid(s => s + 1); }}
      />
    </Slide>
  );
  if (phase === "participantMismatch") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <ParticipantMismatchReview
        mismatch={participantMismatch}
        onContinue={onParticipantMismatchContinue}
        onBack={() => { setParticipantMismatch(null); setPendingDataset(null); setDir("bk"); setPhase("upload"); setSid(s => s + 1); }}
      />
    </Slide>
  );
	  if (phase === "upgrade") return withUiLanguage(<Slide dir={dir} id={sid}><UpgradePlaceholder info={upgradeInfo} credits={credits} userRole={userRole} accessMode={accessMode} onBack={navigateBack} onOpenPayment={(packId) => openPayment(packId, "upgrade")} onUnlockPack={messages?.length && math ? unlockPackForCurrentChat : null} /></Slide>);
	  if (phase === "payment") return withUiLanguage(
	    <Slide dir={dir} id={sid}>
	      <div style={{ position:"relative" }}>
	        <PaymentScreen
	          preselect={paymentPreselect}
	          credits={credits}
	          userId={authedUser?.id || null}
	          onBack={closePayment}
	          onPaymentComingSoon={showPaymentComingSoon}
	        />
	        {paymentToast && (
	          <div style={{ position:"fixed", left:"50%", bottom:32, transform:"translateX(-50%)", zIndex:220, background:"rgba(20,20,28,0.96)", border:"1px solid rgba(255,255,255,0.14)", color:"#fff", padding:"11px 20px", borderRadius:999, fontSize:13, fontWeight:800, letterSpacing:"0.01em", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", whiteSpace:"nowrap" }}>
	            {paymentToast}
	          </div>
	        )}
	      </div>
	    </Slide>
	  );
	  if (phase === "select") return (
	    withUiLanguage(<Slide dir={dir} id={sid}>
	      <PackSelect
	        math={math}
	        onRunPack={onRunPack}
	        onBack={navigateBack}
	        error={analysisError}
	        unlockedPackIds={unlockedPackIds}
	        credits={credits}
	        accessMode={accessMode}
	        hideCredits={authedIsAdmin}
	        onOpenUnlock={(packId) => openUnlockReads(packId, "select")}
	      />
	    </Slide>)
	  );
  if (phase === "relationship") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <RelationshipSelect
        onSelect={onSelectRelationship}
        onBack={navigateBack}
        error={analysisError}
        showDebugPanel={authedIsAdmin && !math?.isGroup}
        debugJson={debugExportJson}
        debugRawText={debugRawText}
        debugRawLabel={debugRawLabel}
        debugRawBusy={debugRawBusy}
        debugRelationshipType={relationshipType || debugRelType}
        onDebugRelationshipTypeChange={value => { setDebugRelType(value); setDebugExportJson(""); setDebugRawText(""); setDebugRawLabel(""); }}
        onDebugExport={buildLocalAiDebugExport}
        onDebugCopy={copyLocalAiDebugExport}
        onDebugDownload={downloadLocalAiDebugExport}
        onDebugRunRawCoreA={() => runRawAiDebugExport("coreA")}
        onDebugRunRawCoreB={() => runRawAiDebugExport("coreB")}
        onDebugCopyRaw={copyRawAiDebugExport}
        onDebugDownloadRaw={downloadRawAiDebugExport}
      />
    </Slide>)
  );
  if (phase === "loading") return withUiLanguage(<Loading math={math} reportType={reportType} reportTypes={selectedReportTypes} loadingIndex={loadingReportIndex} />);

  // ── Trial report routing ──
  if (reportType === "trial_report") {
    if (step <= TRIAL_SCREENS) return wrap(<TrialReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} />);
    return wrap(
      <TrialFinale
        s={math}
        restart={restart}
        back={navigateBack}
        credits={credits}
        userId={authedUser?.id || null}
        onPaymentComingSoon={showPaymentComingSoon}
      />
    );
  }

  // ── Premium report routing ──
  const fromHistory = resultsOrigin === "history";
  if (reportType === "toxicity") {
    if (step < TOXICITY_SCREENS) return wrap(<ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "lovelang") {
    if (step < LOVELANG_SCREENS) return wrap(<LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "growth") {
    if (step < GROWTH_SCREENS) return wrap(<GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "accounta") {
    if (step < ACCOUNTA_SCREENS) return wrap(<AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "energy") {
    if (step < ENERGY_SCREENS) return wrap(<EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }

  // ── General Wrapped (existing casual analysis) ──
  const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
  const total = contentCount + 1;
  let screen;
  if (step < contentCount) {
    screen = math.isGroup
      ? <GroupScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} mode="casual" resultId={currentResultId} />
      : <DuoScreen   s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} mode="casual" relationshipType={relationshipType} resultId={currentResultId} />;
  } else {
    screen = <Finale s={math} ai={ai} aiLoading={aiLoading} restart={restart} back={navigateBack} prog={total} total={total} mode="casual" resultId={currentResultId} fromHistory={fromHistory} />;
  }
  return wrap(screen);
}
