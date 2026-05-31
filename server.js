import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const ROOT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC_DIR = resolve(ROOT_DIR, "public");
const CACHE_DIR = resolve(ROOT_DIR, ".cache", "troparion");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function getMoscowToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateInput(dateInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    throw new Error("Дата должна быть в формате YYYY-MM-DD.");
  }

  const [yearText, monthText, dayText] = dateInput.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(candidate.valueOf()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("Указана несуществующая дата.");
  }

  return { year, month, day };
}

function buildTroparionUrl({ year, month, day }) {
  return new URL(`https://azbyka.ru/days/${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function getTroparionCacheFile(dateString) {
  return resolve(CACHE_DIR, `${dateString}.json`);
}

function sanitizeMarkup(markup) {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\r/g, "")
    .replace(/ href="\//g, ' href="https://azbyka.ru/')
    .replace(/ src="\//g, ' src="https://azbyka.ru/')
    .replace(/<p>\s*<p>/g, "<p>")
    .replace(/<\/p>\s*<\/p>/g, "</p>")
    .trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&ndash;/g, "–")
    .replace(/&minus;/g, "−")
    .replace(/&mdash;/g, "—")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(markup) {
  return decodeHtmlEntities(markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).replace(/\s+([,.:;!?])/g, "$1");
}

function isWeekdayTroparion(title) {
  return /^В\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)/i.test(title);
}

function extractSegment(markup, startMarker, endMarker) {
  const startIndex = markup.indexOf(startMarker);
  if (startIndex === -1) {
    return "";
  }

  const endIndex = markup.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    return markup.slice(startIndex);
  }

  return markup.slice(startIndex, endIndex);
}

function extractDayHeadline(markup) {
  const descriptionMatch = markup.match(/<meta name="description" content="([^"]+)"/i);
  if (!descriptionMatch) {
    return "";
  }

  const description = decodeHtmlEntities(descriptionMatch[1]);
  const [, afterDash = ""] = description.split(" - ");
  return afterDash.replace(/Список всех[\s\S]*$/i, "").trim();
}

function extractTroparia(markup) {
  const tropariBlock = extractSegment(markup, '<div id="tropari"', '<div id="pritcha"');
  const tropariItemsRegion = extractSegment(tropariBlock, '<div class="expandable">', '<div class="read-more">');
  const rawItems = tropariItemsRegion.split(/<div class="tropary-item"[^>]*>/).slice(1);
  const items = [];

  for (const rawItem of rawItems) {
    const titleMatch = rawItem.match(/<h2 class="block_title">([\s\S]*?)<\/h2>/);
    if (!titleMatch) {
      continue;
    }

    const title = stripTags(titleMatch[1]);
    if (isWeekdayTroparion(title)) {
      continue;
    }

    const rawFrames = rawItem.split('<div class="frame">').slice(1);
    const troparia = [];

    for (const rawFrame of rawFrames) {
      const headingMatch = rawFrame.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (!headingMatch) {
        continue;
      }

      const heading = stripTags(headingMatch[1]);
      if (!heading.startsWith("Тропарь")) {
        continue;
      }

      const afterHeading = rawFrame.split(/<\/h3>/)[1] ?? "";
      const [beforeTranslation] = afterHeading.split(/<p class="taks-explanation">/);
      const bodyHtml = sanitizeMarkup(
        beforeTranslation
          .replace(/^[\s\S]*?<div>\s*/, "")
          .replace(/\s*<\/div>\s*$/, "")
      );

      if (!bodyHtml) {
        continue;
      }

      const translationMatch = rawFrame.match(/<div class="taks-explanation-info"[^>]*>([\s\S]*?)<\/div>/);
      const translationHtml = translationMatch ? sanitizeMarkup(translationMatch[1]) : "";

      troparia.push({
        heading,
        textHtml: bodyHtml,
        translationHtml
      });
    }

    if (troparia.length > 0) {
      items.push({
        title,
        troparia
      });
    }
  }

  return items;
}

async function readTroparionCache(dateString) {
  try {
    const cacheFile = getTroparionCacheFile(dateString);
    const cachedJson = await readFile(cacheFile, "utf-8");
    return JSON.parse(cachedJson);
  } catch (error) {
    return null;
  }
}

async function writeTroparionCache(dateString, payload) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = getTroparionCacheFile(dateString);
  await writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf-8");
}

async function fetchTroparionData(dateString) {
  const dateParts = parseDateInput(dateString);
  const sourceUrl = buildTroparionUrl(dateParts);
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "PrayerForTwo/1.0 (+https://localhost)"
      }
    });

    if (!response.ok) {
      throw new Error(`Источник календаря вернул ошибку ${response.status}.`);
    }

    const markup = await response.text();
    const items = extractTroparia(markup);

    if (items.length === 0) {
      throw new Error("На странице дня не удалось найти тропари.");
    }

    const payload = {
      headline: extractDayHeadline(markup),
      items,
      sourcePage: sourceUrl.toString(),
      sourceName: "Азбука веры",
      warning: ""
    };

    await writeTroparionCache(dateString, payload);
    return payload;
  } catch (error) {
    const cachedPayload = await readTroparionCache(dateString);

    if (cachedPayload) {
      return {
        ...cachedPayload,
        warning: "Показываю сохранённую копию: страница Азбуки веры сейчас временно недоступна."
      };
    }

    throw error;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function serveStaticAsset(pathname, response) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${normalizedPath}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileContents = await readFile(filePath);
    const extension = extname(filePath);
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (requestUrl.pathname === "/api/troparion") {
    try {
      const dateString = requestUrl.searchParams.get("date") ?? getMoscowToday();
      const troparion = await fetchTroparionData(dateString);

      sendJson(response, 200, {
        date: dateString,
        headline: troparion.headline,
        items: troparion.items,
        sourcePage: troparion.sourcePage,
        sourceName: troparion.sourceName
      });
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : "Не удалось получить тропарь дня."
      });
    }

    return;
  }

  await serveStaticAsset(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Prayer for Two is running on http://${HOST}:${PORT}`);
});
