/** Review hints only. Never treats an allegation as established fact or publishes it. */
export function reviewFlags(title: string, description: string) {
  const text = `${title}\n${description}`.replace(/[০-৯]/g, (digit) =>
    String("০১২৩৪৫৬৭৮৯".indexOf(digit)),
  );
  const flags: string[] = [];
  if (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) ||
    /(?:\+?88)?01[3-9][\s-]?\d{4}[\s-]?\d{4}/.test(text)
  )
    flags.push(
      "সম্ভাব্য ফোন নম্বর বা ইমেইল আছে—প্রকাশের আগে পরিচয় যাচাই করুন।",
    );
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
  const repeatedLine = lines.some(
    (line, index) =>
      lines.indexOf(line) !== index &&
      lines.filter((entry) => entry === line).length >= 3,
  );
  const words = text.toLowerCase().split(/\s+/u);
  if (
    repeatedLine ||
    (words.length > 30 && new Set(words).size < words.length * 0.15) ||
    /(.)\1{15}/u.test(text)
  )
    flags.push("অস্বাভাবিক পুনরাবৃত্তি আছে—স্প্যাম কি না পরীক্ষা করুন।");
  if ((text.match(/https?:\/\//gi) || []).length > 5)
    flags.push("বিবরণে অনেক লিংক আছে—প্রাসঙ্গিকতা পরীক্ষা করুন।");
  return flags;
}
