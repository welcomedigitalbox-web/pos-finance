// Code 128, drawn as bars.
//
// Written out rather than installed, because the people who run this
// system work on machines where adding a package is its own small
// project, and a barcode is a hundred lines of lookup table.
//
// Code 128 encodes any ASCII character. Set B covers letters and digits;
// set C packs two digits into one symbol, which is what keeps a long
// article number narrow enough to fit on a 40mm label. The encoder below
// starts in whichever set suits the code and switches when it pays to.

// The 107 symbols, each as six bar/space widths.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "233111",
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

const isDigits = (s: string, from: number, count: number) =>
  from + count <= s.length && /^\d+$/.test(s.slice(from, from + count));

// How many digits run from here. Four or more are worth packing in pairs;
// below that the switch costs more than it saves.
function digitRun(s: string, from: number): number {
  let n = 0;
  while (from + n < s.length && s[from + n] >= "0" && s[from + n] <= "9") n++;
  return n;
}

function encode(value: string): number[] {
  const s = value.replace(/[^\x20-\x7e]/g, "");
  if (!s) return [];

  const out: number[] = [];
  let i = 0;
  // An all-digit code of even length is cheapest in set C from the start.
  let inC = digitRun(s, 0) >= (s.length % 2 === 0 ? 4 : 6);
  out.push(inC ? START_C : START_B);

  while (i < s.length) {
    if (inC) {
      if (isDigits(s, i, 2)) {
        out.push(Number(s.slice(i, i + 2)));
        i += 2;
        continue;
      }
      out.push(CODE_B);
      inC = false;
      continue;
    }
    // Worth switching to C when a long enough run of digits is ahead.
    const run = digitRun(s, i);
    if (run >= 4 && run % 2 === 0) {
      out.push(CODE_C);
      inC = true;
      continue;
    }
    out.push(s.charCodeAt(i) - 32);
    i++;
  }

  // The check symbol: the start value plus each value times its position.
  let sum = out[0];
  for (let k = 1; k < out.length; k++) sum += out[k] * k;
  out.push(sum % 103);
  out.push(STOP);
  return out;
}

/**
 * An SVG of the code, sized in millimetres so it prints at the size asked
 * for rather than at whatever the screen happens to be.
 *
 * widthMm is the space available; the bars are scaled to fill it. A module
 * narrower than about 0.25mm will not read on a thermal printer, so the
 * caller should keep the label wide enough or the code short enough.
 */
export function code128Svg(
  value: string,
  opts: { widthMm: number; heightMm: number; showText?: boolean } = {
    widthMm: 36, heightMm: 10,
  }
): string {
  const symbols = encode(value);
  if (!symbols.length) return "";

  const widths: number[] = [];
  for (const sym of symbols) {
    for (const ch of PATTERNS[sym]) widths.push(Number(ch));
  }
  // Code 128 ends with two extra bar modules after the stop pattern.
  widths.push(2);

  const modules = widths.reduce((a, b) => a + b, 0);
  const unit = opts.widthMm / modules;

  let x = 0;
  let bars = "";
  widths.forEach((w, n) => {
    // Even positions are bars, odd are spaces.
    if (n % 2 === 0) {
      bars += `<rect x="${(x).toFixed(3)}" y="0" width="${(w * unit).toFixed(3)}" height="${opts.heightMm}" fill="#000"/>`;
    }
    x += w * unit;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${opts.widthMm}mm" height="${opts.heightMm}mm" ` +
    `viewBox="0 0 ${opts.widthMm} ${opts.heightMm}" preserveAspectRatio="none">` +
    bars +
    `</svg>`
  );
}

// Whether a code will still read once it is squeezed onto the label.
export function moduleWidthMm(value: string, widthMm: number): number {
  const symbols = encode(value);
  if (!symbols.length) return 0;
  let modules = 2;
  for (const sym of symbols) {
    for (const ch of PATTERNS[sym]) modules += Number(ch);
  }
  return widthMm / modules;
}
