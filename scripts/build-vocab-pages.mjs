import { mkdir, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(root, "..", "fluentflow", "words", "corpus", "entries");
const publicRoot = path.join(root, "public");
const pageSize = Number.parseInt(process.env.PAGE_SIZE ?? "100", 10);
const levels = ["A1", "A2", "B1", "B2", "C1", "C2", "UNKNOWN"];

const meaningAliases = { am: "to be", are: "to be", is: "to be", was: "to be", were: "to be", has: "to have", had: "to have" };
const normalizeMeaning = (value) => meaningAliases[value.trim().toLowerCase()] ?? value.trim().toLowerCase();

async function loadNativeIndex(language) {
  const byMeaning = new Map();
  const stream = readline.createInterface({ input: createReadStream(path.join(sourceRoot, `${language}.jsonl`), { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line) continue;
    const entry = JSON.parse(line);
    const example = entry.meanings?.flatMap((meaning) => meaning.examples ?? [])[0];
    for (const meaning of entry.meanings ?? []) {
      for (const token of meaning.translation?.split(/[;,/|]/) ?? []) {
        const key = `${entry.pos ?? ""}:${normalizeMeaning(token)}`;
        const matches = byMeaning.get(key) ?? [];
        matches.push({ word: entry.word, example: example?.native ?? "", frequency: entry.frequency ?? Number.MAX_SAFE_INTEGER });
        byMeaning.set(key, matches);
      }
    }
  }
  return byMeaning;
}

function toWordEntry(entry, nativeIndexes) {
  const firstExample = entry.meanings?.flatMap((meaning) => meaning.examples ?? [])[0];
  const englishTranslation = (entry.meanings ?? []).map((meaning) => meaning.translation).filter(Boolean).join(";");
  const translations = {};
  for (const [language, nativeIndex] of Object.entries(nativeIndexes)) {
    const candidates = new Map();
    for (const meaning of entry.meanings ?? []) {
      for (const token of meaning.translation?.split(/[;,/|]/) ?? []) {
        for (const candidate of nativeIndex.get(`${entry.pos ?? ""}:${normalizeMeaning(token)}`) ?? []) {
          const current = candidates.get(candidate.word);
          candidates.set(candidate.word, { ...candidate, score: (current?.score ?? 0) + 1 });
        }
      }
    }
    const native = [...candidates.values()].sort((a, b) => b.score - a.score || a.frequency - b.frequency)[0];
    if (native) translations[language] = { translation: native.word, example: native.example };
  }
  return {
    word: entry.word,
    pos: entry.pos ?? "",
    cefr_level: entry.cefr_level ?? "UNKNOWN",
    english_translation: englishTranslation,
    translations,
    example_sentence_native: firstExample?.native ?? "",
    example_sentence_english: firstExample?.english ?? "",
    gender: entry.gender ?? "",
    romanization: entry.romanization ?? undefined,
    useful_for_flashcard: entry.useful_for_flashcard ?? true,
    word_frequency: entry.frequency ?? undefined,
    goethe_b1_wordlist: entry.goethe_b1_wordlist ?? undefined
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}

async function flushPage(language, level, page, total, words) {
  if (words.length === 0) return;
  const file = path.join(publicRoot, "entries", language, level, `page-${page}.json`);
  await writeJson(file, {
    language,
    level,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    words
  });
}

async function countByLevel(file) {
  const counts = Object.fromEntries(levels.map((level) => [level, 0]));
  const stream = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of stream) {
    if (!line) continue;
    const entry = JSON.parse(line);
    const level = entry.cefr_level || "UNKNOWN";
    counts[level] = (counts[level] ?? 0) + 1;
  }

  return counts;
}

async function buildLanguage(language, file, nativeIndexes) {
  const counts = await countByLevel(file);
  const pagesByLevel = Object.fromEntries(levels.map((level) => [level, 1]));
  const buckets = Object.fromEntries(levels.map((level) => [level, []]));
  const writtenByLevel = Object.fromEntries(levels.map((level) => [level, 0]));

  const stream = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of stream) {
    if (!line) continue;
    const word = toWordEntry(JSON.parse(line), nativeIndexes);
    const level = levels.includes(word.cefr_level) ? word.cefr_level : "UNKNOWN";
    const bucket = buckets[level];
    bucket.push(word);
    writtenByLevel[level] += 1;

    if (bucket.length >= pageSize) {
      await flushPage(language, level, pagesByLevel[level], counts[level], bucket.splice(0));
      pagesByLevel[level] += 1;
    }
  }

  for (const level of levels) {
    await flushPage(language, level, pagesByLevel[level], counts[level], buckets[level]);
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    total,
    levels: Object.fromEntries(
      levels.map((level) => [
        level,
        {
          total: counts[level] ?? 0,
          totalPages: Math.ceil((counts[level] ?? 0) / pageSize),
          path: `/entries/${language}/${level}/page-{page}.json`
        }
      ])
    )
  };
}

async function main() {
  await rm(publicRoot, { recursive: true, force: true });
  await mkdir(publicRoot, { recursive: true });

  const languages = {};
  const files = [
    "ar.jsonl",
    "de.jsonl",
    "en.jsonl",
    "es.jsonl",
    "fr.jsonl",
    "hi.jsonl",
    "it.jsonl",
    "ja.jsonl",
    "ko.jsonl",
    "pt.jsonl",
    "ru.jsonl",
    "zh.jsonl"
  ];
  const nativeIndexes = Object.fromEntries(await Promise.all(files.map(async (fileName) => [path.basename(fileName, ".jsonl"), await loadNativeIndex(path.basename(fileName, ".jsonl"))])));

  for (const fileName of files) {
    const language = path.basename(fileName, ".jsonl");
    console.log(`Building ${language}...`);
    languages[language] = await buildLanguage(language, path.join(sourceRoot, fileName), nativeIndexes);
  }

  await writeJson(path.join(publicRoot, "manifest.json"), {
    schema: "fluentflow-vocab-static-v1",
    generatedAt: new Date().toISOString(),
    pageSize,
    languages
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
