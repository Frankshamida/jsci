// Pesos, written out.
//
// A receipt says the amount twice on purpose: once in figures, where a stray
// pen stroke turns 100 into 1000, and once in words, where it cannot. The
// words are the ones that count if the two ever disagree, which is why the
// figures are never the only copy on a slip anybody signs.
//
// Philippine convention throughout: "Pesos" and "Centavos", the scale words
// stop at Billion (an amount past that on a church receipt is a typo, and is
// handled below rather than silently mis-spelled), and the line ends in
// "Only" so nothing can be added after it.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
// Indexed by how many groups of three we are from the units, so SCALES[1] is
// what a thousand is called and SCALES[0] is what nothing is called.
const SCALES = ['', 'Thousand', 'Million', 'Billion'];

// 0-999. Returns '' for 0 so an empty group ("one million and no thousands")
// contributes nothing rather than the word "Zero" in the middle of a line.
function underThousand(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = ONES[n % 10];
    // Hyphenated, as English writes them: "Twenty-One", not "Twenty One".
    return ones ? `${tens}-${ones}` : tens;
  }
  const rest = underThousand(n % 100);
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` ${rest}` : ''}`;
}

// A whole number in words. Exported on its own because a count of people reads
// the same way a count of pesos does.
export function numberToWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'Zero';

  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  // Past a billion there is no scale word left, and guessing one ("Trillion")
  // on a receipt nobody meant to write is worse than declining to. The figures
  // beside it still say what was paid.
  if (groups.length > SCALES.length) return String(n);

  return groups
    .map((group, i) => (group === 0 ? '' : `${underThousand(group)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`))
    .reverse()
    .filter(Boolean)
    .join(' ');
}

// The line that goes on the receipt: "One Thousand Two Hundred Pesos Only".
//
// Centavos are included only when there are any. A church collects round
// hundreds nearly every time, and "and Zero Centavos" on every slip is noise
// that makes the one receipt that DOES carry centavos harder to notice.
export function amountInWords(value) {
  const amount = Math.abs(Number(value) || 0);
  // Rounded to the centavo first: 0.1 + 0.2 is 0.30000000000000004, and
  // "Thirty Centavos" is the only reading of that anybody wants.
  const total = Math.round(amount * 100);
  const pesos = Math.floor(total / 100);
  const centavos = total % 100;

  const pesoWords = `${numberToWords(pesos)} ${pesos === 1 ? 'Peso' : 'Pesos'}`;
  if (centavos === 0) return `${pesoWords} Only`;
  return `${pesoWords} and ${numberToWords(centavos)} ${centavos === 1 ? 'Centavo' : 'Centavos'} Only`;
}

export default amountInWords;
