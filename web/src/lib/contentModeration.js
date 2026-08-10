/**
 * Content Moderation Library
 * Detects and filters inappropriate content in English, Tagalog, Bisaya, and Gen Z slang
 */

// AI moderation runs server-side via /api/moderate so the Groq key is never shipped
// to the browser (an exposed key can be lifted and used to burn the free-tier quota).
const MODERATION_ENDPOINT = '/api/moderate';

// Minimum length before AI review is worth a request. Very short messages ("ok",
// "amen", "see you") carry almost no risk the word list would miss.
const AI_REVIEW_MIN_LENGTH = 12;

// Comprehensive word lists (English, Tagalog, Bisaya, Gen Z)
const INAPPROPRIATE_WORDS = {
  english: [
    'kill', 'suicide', 'die', 'death', 'hang', 'overdose', 'poison', 'cut myself',
    'hurt myself', 'no point living', 'end it', 'jump', 'slit',
    'f**k', 'sh*t', 'a**hole', 'b*tch', 'bastard', 'damn', 'hell', 'crap',
    'a-hole', 'asshole', 'bitch', 'dumbass', 'dumb ass', 'f***', 'f word',
  ],
  tagalog: [
    'k*mat', 'kamatayan', 'pagkakasakripisyo', 'magsabog', 'sampalin', 'pumuksa',
    'putangina', 'putang ina', 'gago', 'bobo', 'tarantado', 'tulad mo',
    'hayop', 'bastardo', 'basura', 'walang halaga', 'walang pag asa',
    'magsuffer', 'magdusa', 'maghirap nang malakas',
  ],
  bisaya: [
    'patay', 'hilabihan', 'patayan', 'sugat', 'bugnaw', 'humay',
    'talunan', 'yawa', 'buang', 'walanghusay', 'basura', 'walang bili',
    'hayop ka', 'basting', 'bugok', 'imbisil', 'gago',
  ],
  genZ: [
    'kys', 'kms', 'ctb', 'nrd', 'rope', 'toaster bath', 'bridge method',
    'toxic', 'literally dying', 'i hate everything', 'nobody likes me',
    'simp', 'delete this', 'cringe', 'no cap that hurt',
  ],
  harmful: [
    'suicide', 'self harm', 'self-harm', 'suicidal', 'suicidal thoughts',
    'kill myself', 'kill yourself', 'end my life', 'end your life',
    'i want to die', 'i deserve to die', 'why am i alive',
  ],
};

// Flatten all words for easy matching
const ALL_INAPPROPRIATE_WORDS = [
  ...INAPPROPRIATE_WORDS.english,
  ...INAPPROPRIATE_WORDS.tagalog,
  ...INAPPROPRIATE_WORDS.bisaya,
  ...INAPPROPRIATE_WORDS.genZ,
  ...INAPPROPRIATE_WORDS.harmful,
].map(w => w.toLowerCase());

/**
 * Check if content contains inappropriate words (basic pattern matching)
 * @param {string} content - Message content
 * @returns {object} { isInappropriate: boolean, matches: string[], type: string }
 */
export function detectInappropriateWords(content) {
  if (!content || typeof content !== 'string') return { isInappropriate: false, matches: [], type: null };

  const lowerContent = content.toLowerCase();
  const matches = [];

  for (const word of ALL_INAPPROPRIATE_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/\*/g, '.?')}\\b`, 'gi');
    if (pattern.test(lowerContent)) {
      matches.push(word);
    }
  }

  let type = null;
  if (matches.some(m => INAPPROPRIATE_WORDS.harmful.some(h => m.includes(h.toLowerCase())))) {
    type = 'harmful';
  } else if (matches.some(m => INAPPROPRIATE_WORDS.english.some(e => m.includes(e.toLowerCase())))) {
    type = 'abusive';
  } else if (matches.some(m => INAPPROPRIATE_WORDS.genZ.some(g => m.includes(g.toLowerCase())))) {
    type = 'genZ-harmful';
  }

  return {
    isInappropriate: matches.length > 0,
    matches: [...new Set(matches)],
    type,
  };
}

/**
 * Use AI to analyze message sentiment and intent (Groq API)
 * @param {string} content - Message content
 * @returns {Promise<object>} { isSafe: boolean, reason: string, suggestion: string }
 */
export async function analyzeMessageSafety(content, { userId } = {}) {
  if (!content || typeof content !== 'string') return { isSafe: true, reason: null, suggestion: null };

  try {
    const response = await fetch(MODERATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, userId }),
    });

    if (!response.ok) return { isSafe: true, reason: null, suggestion: null };

    const json = await response.json();
    const result = json?.data;
    if (!result) return { isSafe: true, reason: null, suggestion: null };

    return {
      isSafe: result.isSafe !== false,
      reason: result.reason || null,
      suggestion: result.suggestion || null,
    };
  } catch (error) {
    // Fail open — never block a user because moderation was unreachable.
    console.warn('Error during AI safety analysis:', error);
    return { isSafe: true, reason: null, suggestion: null };
  }
}

/**
 * Combined moderation check: word list + AI
 * @param {string} content - Message content
 * @returns {Promise<object>} { isBlocked: boolean, isCorrected: boolean, correctedContent: string, reason: string }
 */
export async function moderateMessage(content, { userId } = {}) {
  if (!content || typeof content !== 'string') {
    return { isBlocked: false, isCorrected: false, correctedContent: content, reason: null };
  }

  // Step 1: Basic word list check — free, instant, and catches the clear cases.
  const wordCheck = detectInappropriateWords(content);

  if (wordCheck.isInappropriate) {
    // Harmful content: always block
    if (wordCheck.type === 'harmful') {
      return {
        isBlocked: true,
        isCorrected: false,
        correctedContent: null,
        reason: `This message contains concerning language about self-harm. If you're struggling, please reach out to a counselor or crisis hotline. ❤️`,
      };
    }

    // Abusive content: block
    if (wordCheck.type === 'abusive') {
      return {
        isBlocked: true,
        isCorrected: false,
        correctedContent: null,
        reason: `This message contains inappropriate language. Please keep our community respectful and kind.`,
      };
    }
  }

  // Step 2: AI review — the only metered step, so gate it tightly.
  //
  // Previously every message hit the AI even when the word list found nothing, which
  // meant one Groq call per chat message and posts burning the free tier fast. Now the
  // AI is only consulted when it can actually add something the word list cannot:
  //   - the word list flagged something it does not outright block (borderline), or
  //   - the text is long enough to hide intent that simple matching would miss.
  const isBorderline = wordCheck.isInappropriate; // flagged, but not harmful/abusive
  const isLongEnoughToHideIntent = content.trim().length >= AI_REVIEW_MIN_LENGTH;

  if (!isBorderline && !isLongEnoughToHideIntent) {
    return { isBlocked: false, isCorrected: false, correctedContent: content, reason: null };
  }

  const aiCheck = await analyzeMessageSafety(content, { userId });

  if (!aiCheck.isSafe) {
    return {
      isBlocked: true,
      isCorrected: false,
      correctedContent: null,
      reason: aiCheck.reason || 'This message may not be appropriate. Please review and try again.',
    };
  }

  // Step 3: Auto-correct suggestion (from AI if provided)
  if (aiCheck.suggestion && aiCheck.suggestion !== content) {
    return {
      isBlocked: false,
      isCorrected: true,
      correctedContent: aiCheck.suggestion,
      reason: `Suggested correction: "${aiCheck.suggestion}"`,
    };
  }

  // Message is safe
  return {
    isBlocked: false,
    isCorrected: false,
    correctedContent: content,
    reason: null,
  };
}

export default {
  detectInappropriateWords,
  analyzeMessageSafety,
  moderateMessage,
};
