// ─────────────────────────────────────────────────────────────────
// LOCAL MATH — client-side analysis. Pure JS, no React, no AI.
// ─────────────────────────────────────────────────────────────────
import { normalizeDisplayName, applyApprovedMerges } from "../utils/identityMerge";
import { detectOtherParticipantMismatches } from "../import/datasetBuilder";
import { callClaude, tryParseJsonText } from "./claudeClient";

export const LOCAL_STATS_VERSION = 3;

// ─────────────────────────────────────────────────────────────────
// LARGE-GROUP CAP
// ─────────────────────────────────────────────────────────────────
export const GROUP_PARTICIPANT_THRESHOLD = 20; // above this, cap is applied
export const GROUP_PARTICIPANT_CAP       = 10; // keep this many top senders

export function capLargeGroup(messages) {
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

export function userProvidedDisplayName(user) {
  const meta = user?.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    meta.display_name ||
    ""
  ).trim();
}

export function hasUserProvidedDisplayName(user) {
  return Boolean(userProvidedDisplayName(user));
}

export function quickReadDaysLeft(expiresAt) {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt).getTime();
  if (!Number.isFinite(expires)) return null;
  return Math.max(0, Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function quickReadExpiryLabel(expiresAt) {
  const days = quickReadDaysLeft(expiresAt);
  if (days == null) return "Use it when you are ready.";
  if (days <= 0) return "Expires today.";
  if (days === 1) return "Expires tomorrow.";
  return `${days} days left.`;
}

export function getAuthConfirmationRedirectUrl() {
  const configured = String(import.meta.env.VITE_AUTH_CONFIRM_REDIRECT_URL || "").trim();
  if (configured) return configured;
  return `${window.location.origin}/auth/confirmed`;
}

export function namesWithoutCurrentUser(names = [], user = null) {
  const normalizedUser = normalizeDisplayName(userProvidedDisplayName(user));
  const cleanNames = (Array.isArray(names) ? names : [])
    .map(name => String(name || "").trim())
    .filter(Boolean);
  if (!normalizedUser) return cleanNames;
  const otherNames = cleanNames.filter(name => normalizeDisplayName(name) !== normalizedUser);
  return otherNames.length ? otherNames : cleanNames;
}

export function compactNamesLabel(names = [], maxVisible = 2) {
  const cleanNames = [...new Set((Array.isArray(names) ? names : [])
    .map(name => String(name || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))];
  if (!cleanNames.length) return "";
  if (cleanNames.length <= maxVisible) return cleanNames.join(", ");
  return `${cleanNames.slice(0, maxVisible).join(", ")} +${cleanNames.length - maxVisible}`;
}

export function getParticipantDisplayTitle(dataset, mathData = null, user = null) {
  const datasetNames = Array.isArray(dataset?.participants)
    ? dataset.participants.map(participant => participant.displayName)
    : [];
  const mathNames = Array.isArray(mathData?.names) ? mathData.names : [];
  const names = namesWithoutCurrentUser(datasetNames.length ? datasetNames : mathNames, user);
  return compactNamesLabel(names) || dataset?.combinedMeta?.displayTitle || "WrapChat result";
}

export function detectParticipantConsistencyMismatch(dataset, user) {
  return detectOtherParticipantMismatches(dataset, userProvidedDisplayName(user));
}

export function detectDuoProfileNameMismatch(math, user) {
  if (!math || math.isGroup) return null;
  const userName = userProvidedDisplayName(user);
  if (!userName) return null;
  const participants = (Array.isArray(math.names) ? math.names : [])
    .map(name => String(name || "").trim())
    .filter(Boolean);
  if (participants.length !== 2) return null;
  const normalizedUser = normalizeDisplayName(userName);
  if (!normalizedUser) return null;
  const matched = participants.some(name => normalizeDisplayName(name) === normalizedUser);
  return matched ? null : { userName, participants };
}

export function applyAutomaticParticipantMerges(dataset) {
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

export function getReviewableMergeSuggestions(dataset) {
  const approvedIds = new Set((dataset?.mergeState?.approved || []).map(suggestion => suggestion.id));
  return (dataset?.mergeState?.suggestions || []).filter(suggestion => !approvedIds.has(suggestion.id));
}
// ─────────────────────────────────────────────────────────────────
// LOCAL MATH
// ─────────────────────────────────────────────────────────────────
export const STOP_WORDS = new Set([

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

export const ROMANCE_RE = /\b(love you|luv you|miss you|my love|baby|babe|bb|darling|good night love|good morning love|kiss you|date night|come over|sleep well|xoxo|sevgilim|askim|aşkım|canim|canım|ozledim|özledim|tatlim|tatlım|bebegim|bebeğim)\b/i;
export const FRIEND_RE = /\b(bestie|bro|broski|dude|girl|sis|mate|homie|kanka|knk|abi|abla)\b/i;
export const WORK_RE = /\b(meeting|deadline|project|client|invoice|brief|office|shift|deck|review this|sunum|mesai|müşteri|musteri|patron|toplantı|toplanti)\b/i;
export const DATE_RE = /\b(date|dinner tonight|movie night|see you tonight|come over|valentine|anniversary)\b/i;
export const FLIRTY_EMOJI_RE = /(❤️|❤|💕|💖|💗|💘|😍|🥰|😘|💋)/;

export const CONTROL_RE = /\b(where are you|who are you with|why are you online|why were you online|why didn't you reply|why dont you reply|why didn't you answer|why didnt you answer|answer me|pick up|call me now|send me your location|share your location|send your location|reply now|reply to me|neredesin|nerde kaldın|kimlesin|kimleydin|neden cevap vermedin|niye cevap vermedin|cevap ver|cvp ver|aç telefonu|telefonu aç|konum at|konumunu at|konum paylaş|konumunu paylaş)\b/i;
export const AGGRO_RE = /\b(stupid|idiot|shut up|hate you|leave me alone|you're crazy|you are crazy|disgusting|pathetic|annoying|i'm sick of this|i am sick of this|salak|gerizekal[ıi]|aptal|mal|siktir|siktir git|defol|yeter|bıktım|biktim|nefret ediyorum|manyak|saçma|sacma)\b/i;
export const BREAKUP_RE = /\b(it'?s over|we'?re done|i'?m done|im done|done with you|break up|breakup|goodbye forever|don't text me|dont text me|blocked you|bitti|bitsin|ayrıl|ayrilelim|ayrılalım|beni arama|yazma bana|engelledim|sildim seni)\b/i;
export const APOLOGY_RE = /\b(sorry|i'm sorry|i am sorry|my fault|forgive me|özür dilerim|ozur dilerim|affet|hata bendeydi|haklısın|haklisin)\b/i;
export const SUPPORT_RE = /\b(i'm here|i am here|here for you|got you|proud of you|take care|rest up|go rest|get some rest|drink water|eat something|text me when you|get home safe|call me if|let me know if|i can help|i'll help|i will help|i'll come|i will come|feel better|hope you feel better|hope it gets better|sending love|yanındayım|yanindayim|buradayım|buradayim|iyi misin|iyi mısın|kendine iyi bak|dinlen|uyu biraz|su iç|su ic|bir şey yedin mi|bir sey yedin mi|haber ver|arayayım|arayim|gelirim|yardım ederim|yardim ederim|geçer|gecer|hallolur|hallederiz)\b/i;
export const GRATITUDE_RE = /\b(thank you|thanks|thank u|appreciate it|you’re the best|you're the best|sağ ol|sag ol|saol|teşekkür|tesekkur|iyi ki varsın|iyi ki varsin)\b/i;
export const DISTRESS_RE = /\b(sad|cry|crying|tired|stressed|anxious|scared|worried|hurt|hard|difficult|broken|lost|alone|upset|angry|panic|panicking|faint|fainted|feel sick|bad day|burnt out|hasta|üzgün|uzgun|stresli|yorgun|yalnız|yalniz|korktum|kötü|kotu|bayıl|bayil|ağla|agla|yardım|yardim)\b/i;
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
export const HEART_REPLY_RE = /(❤️|❤|💕|💖|💗|💘|🥰|😘|🤍|🫶|🥺)/;

function isKeyboardMashLaugh(body = "") {
  const b = String(body || "").trim();
  if (!b || /\s/.test(b)) return false;
  if (!/^[a-zçğıöşü]{8,}$/i.test(b)) return false;
  const vowelRatio = (b.match(/[aeiouöüıi]/gi) || []).length / b.length;
  return vowelRatio < 0.3;
}

export function isLaughReaction(body = "") {
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

export function coerceRelationshipCategory(value, userSelectedType, fallback = "other") {
  const selected = normalizeSelectedRelationshipType(userSelectedType);
  if (["partner", "dating", "ex", "family", "friend", "colleague", "other"].includes(selected)) {
    return selected;
  }
  return normalizeRelationshipCategory(value, fallback);
}

export function coerceRelationshipSpecificLabel(value, category) {
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

export function sanitizeRelationshipStatus(value, category, specificRelationship) {
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

export function buildRelationshipLine(relationshipContext, userSelectedType) {
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

export async function confirmRelationship(snippets, names, userSelectedType) {
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

export async function resolveRelationshipContext(messages, names, userSelectedType) {
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

export function peekResolvedRelationshipContext(messages, names, userSelectedType) {
  const cacheKey = getRelationshipContextCacheKey(messages, names, userSelectedType);
  if (!cacheKey) return null;
  return RELATIONSHIP_CONTEXT_CACHE.has(cacheKey) ? RELATIONSHIP_CONTEXT_CACHE.get(cacheKey) : null;
}

const DUO_CONTENT_SCREENS = 20;
const GROUP_CONTENT_SCREENS = 19;
export const LOADING_STEPS = ["Reading your messages...","Finding the patterns...","Figuring out who's funny...","Detecting the drama...","Reading between the lines...","Almost done..."];
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
export const DUO_CASUAL_SCREENS = 15;
export const DUO_REDFLAG_SCREENS = 7;
export const GROUP_CASUAL_SCREENS = 17;
export const GROUP_REDFLAG_SCREENS = 6;

export function isPassiveAggressive(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.length <= 20 && /^(fine|whatever|ok then|okay then|sure|k|kk|nvm|never mind|forget it|sen bilirsin|tamam ya|boşver|bosver|neyse|aynen|bravo|peki)$/.test(trimmed);
}

export function capsBurst(body) {
  const upper = body.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  return upper.length >= 5 && /[!?]{2,}/.test(body);
}

export function normalizeRedFlags(flags) {
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

export function normalizeTimeline(items) {
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

export const VALID_MOMENT_TYPES = new Set(["funny","sweet","awkward","chaotic","signature","tension","care","conflict"]);

export function normalizeMemorableMoments(raw) {
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

export function formatEvidenceDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function cleanQuote(body, max = 72) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

export function formatGap(gapMin) {
  if (gapMin < 60) return `${Math.round(gapMin)}m`;
  const hours = Math.floor(gapMin / 60);
  const mins = Math.round(gapMin % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function spotDynamics({ messages, namesAll, namesSorted, msgCounts, starterCount, isGroup }) {
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

export function localStats(messages) {
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
// QUIZ CHALLENGE — question builder
// ─────────────────────────────────────────────────────────────────

const QUIZ_EMOJI_POOL = ["🔥","💀","😭","🥹","💯","✨","😤","🤣","😮","🙈","🥲","💪","😩","🤯","😎","🙃","🥰","😬","🤦","🙏","👀","🫠","💅","🫶","🤌","🐸","💃","🎉","🫡","😏"];

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildQuizQuestions(quizData) {
  const {
    names = [], msgCounts = [], ghostName = "", spiritEmoji = [],
    signatureWord = [], signaturePhrase = [], streak = 0, topWords = [],
  } = quizData;

  const [nameA, nameB] = names;
  if (!nameA || !nameB) return [];

  const seed = nameA.charCodeAt(0) * 31 + nameB.charCodeAt(0);
  const questions = [];

  // Q1 — Who sent more messages?
  const moreIdx = (msgCounts[0] ?? 0) >= (msgCounts[1] ?? 0) ? 0 : 1;
  questions.push({
    id: "who_more",
    text: "Who sent more messages?",
    options: seededShuffle([nameA, nameB], seed + 1),
    correct: names[moreIdx],
    layout: "stack",
  });

  // Q2 — Who ghosts longer?
  if (ghostName) {
    questions.push({
      id: "who_ghosts",
      text: "Who takes longer to reply?",
      options: seededShuffle([nameA, nameB], seed + 2),
      correct: ghostName,
      layout: "stack",
    });
  }

  // Q3 — Spirit emoji for nameA
  if (spiritEmoji[0]) {
    const pool = QUIZ_EMOJI_POOL.filter(e => e !== spiritEmoji[0] && e !== spiritEmoji[1]);
    const distractors = seededShuffle(pool, seed + 3).slice(0, 3);
    questions.push({
      id: "spirit_emoji_a",
      text: `What's ${nameA}'s spirit emoji?`,
      options: seededShuffle([spiritEmoji[0], ...distractors], seed + 4),
      correct: spiritEmoji[0],
      layout: "grid",
    });
  }

  // Q4 — Signature phrase for nameB
  const phraseB = signaturePhrase[1] || signatureWord[1] || "";
  if (phraseB) {
    const distractors = [
      signaturePhrase[0] || signatureWord[0],
      topWords[1]?.[0],
      topWords[2]?.[0],
    ].filter(p => p && p !== phraseB).slice(0, 3);
    questions.push({
      id: "phrase_b",
      text: `What's ${nameB}'s signature phrase?`,
      options: seededShuffle([phraseB, ...distractors], seed + 5),
      correct: phraseB,
      layout: "stack",
    });
  }

  // Q5 — Most used word
  if (topWords.length >= 4) {
    questions.push({
      id: "top_word",
      text: "What was their most used word?",
      options: seededShuffle(topWords.slice(0, 4).map(w => w[0]), seed + 7),
      correct: topWords[0][0],
      layout: "grid",
    });
  }

  // Q6 — Longest streak (last — hardest to remember)
  if (streak > 0) {
    const gap = Math.max(4, Math.ceil(streak * 0.25));
    const opts = [
      streak,
      Math.max(1, streak - gap),
      streak + gap,
      Math.max(1, streak - gap * 2),
    ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
    questions.push({
      id: "streak",
      text: "What was their longest streak?",
      options: seededShuffle(opts, seed + 6).map(n => `${n} days`),
      correct: `${streak} days`,
      layout: "grid",
    });
  }

  return questions;
}

