const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const axios = require("axios");
const cheerio = require("cheerio");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const { ApiError } = require("../utils/api-error");
const animeService = require("./anime.service");
const { extractVoe } = require("../utils/resolvers/voe.resolver");
const { extractStreamwish } = require("../utils/resolvers/streamwish.resolver");
const { extractStreamtape } = require("../utils/resolvers/streamtape.resolver");

let puppeteerBrowser = null;

async function getPuppeteerBrowser() {
  if (!puppeteerBrowser) {
    const puppeteer = require("puppeteer");
    puppeteerBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return puppeteerBrowser;
}

async function resolveEmbedWithPuppeteer(url, referer) {
  debugLog("Puppeteer", "Resolving URL", url);
  try {
    const browser = await getPuppeteerBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    
    if (referer) {
      await page.setExtraHTTPHeaders({ Referer: referer });
    }

    let interceptedUrl = null;
    page.on("request", (req) => {
      const rUrl = req.url();
      const isDocument = req.resourceType() === "document";
      const isMedia = /\.(?:m3u8|mp4)(?:\?|#|$)/i.test(rUrl);
      if (!interceptedUrl && !isDocument && isMedia && !rUrl.startsWith("blob:") && !rUrl.includes("blank")) {
        interceptedUrl = rUrl;
      }
    });
    
    // Wait for page to fully load
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    
    // Attempt to click play buttons to trigger video load
    try {
      const playBtnSelectors = '.play-button, button, .vjs-big-play-button, [role="button"], .jw-icon-display, .plyr__control--overlaid';
      const playBtn = await page.$(playBtnSelectors);
      if (playBtn) await playBtn.click();
    } catch(e) {}

    // Wait for potential JS to execute and requests to fire
    await new Promise(r => setTimeout(r, 4000));

    // Try clicking inside iframes (common in SPAs like new Filemoon)
    if (!interceptedUrl) {
      for (const frame of page.frames()) {
        try {
          const playBtn = await frame.$('.play-button, button, .vjs-big-play-button, [role="button"], .jw-icon-display, .plyr__control--overlaid');
          if (playBtn) await playBtn.click();
        } catch(e) {}
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (interceptedUrl) {
      debugLog("Puppeteer", "Intercepted media URL", interceptedUrl);
      await page.close();
      return interceptedUrl;
    }
    
    const html = await page.content();
    await page.close();
    
    debugLog("Puppeteer", "Fetched HTML length", html.length);
    
    const $ = cheerio.load(html);
    
    // Try many patterns
    const patterns = [
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*['"]([^'"]+)['"]/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /"video"\s*:\s*"([^"]+)"/i,
      /(https?:\/\/[^\s"'>]+\.(?:mp4|m3u8)[^\s"'>]*)/i,
      /video\s*src\s*=\s*["']([^"']+)["']/i,
      /source\s+src\s*=\s*["']([^"']+)["']/i,
      /data-src\s*=\s*["']([^"']+)["']/i,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1] && isLikelyVideoUrl(match[1])) {
        debugLog("Puppeteer", "Found URL", match[1]);
        return match[1];
      }
    }
    
    // Try video element
    const videoSrc = $("video").attr("src");
    if (videoSrc && isLikelyVideoUrl(videoSrc)) {
      return videoSrc;
    }
    
    // Try data attributes
    const dataElements = $("[data-src], [data-source], [data-video], [data-file]");
    for (let i = 0; i < dataElements.length; i++) {
      const dataSrc = $(dataElements[i]).attr("data-src") || $(dataElements[i]).attr("data-source");
      if (dataSrc && isLikelyVideoUrl(dataSrc)) {
        return dataSrc;
      }
    }
    
    return null;
  } catch (err) {
    debugLog("Puppeteer", "Error", err.message);
    return null;
  }
}

const downloadStore = new Map();
const batchStore = new Map();

const DEBUG_MODE = process.env.DEBUG_DOWNLOAD === "true";

function debugLog(server, message, data) {
  if (!DEBUG_MODE) {
    return;
  }
  const timestamp = new Date().toISOString();
  const header = `[${timestamp}] [${server}] ${message}`;
  if (data) {
    console.log(header, typeof data === "string" ? data.slice(0, 500) : data);
  } else {
    console.log(header);
  }
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
};

const HTML_HEADERS = {
  "User-Agent": DEFAULT_HEADERS["User-Agent"],
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

const SERVER_PRIORITY = ["yourupload", "pdrain", "voe", "streamwish", "streamtape", "1fichier", "hls", "mp4upload", "upnshare", "mega"];

function getDownloadsDir() {
  const configuredPath = process.env.DOWNLOADS_DIR || "downloads";
  const targetPath = path.resolve(process.cwd(), configuredPath);
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function safeFilePart(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function extractEpisodeNumber(episodeUrl) {
  if (!episodeUrl) {
    return null;
  }

  const parts = episodeUrl.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";

  const numberMatch = lastPart.match(/(\d+)$/);
  if (numberMatch && numberMatch[1]) {
    return Number(numberMatch[1]);
  }

  return null;
}

function extractAnimeSlug(episodeUrl) {
  const parts = episodeUrl.split("/").filter(Boolean);
  const mediaIndex = parts.findIndex((part) => part === "media");
  if (mediaIndex === -1 || !parts[mediaIndex + 1]) {
    return "anime";
  }
  return safeFilePart(parts[mediaIndex + 1]) || "anime";
}

function getExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname || "";
    const ext = path.extname(pathname).toLowerCase();
    if ([".mp4", ".mkv", ".avi", ".mov", ".webm"].includes(ext)) {
      return ext;
    }
  } catch (_error) {
    // Ignore parse errors and fallback.
  }

  return ".mp4";
}

function getRefererForUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/`;
  } catch (_error) {
    return "https://animeav1.com/";
  }
}

function buildCookieHeader(setCookieHeaders) {
  if (!setCookieHeaders) {
    return "";
  }

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function normalizeExtractedUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%3D/gi, "=")
    .trim();
}

function decodeIfEncoded(url) {
  if (!url || typeof url !== "string") {
    return url;
  }

  try {
    if (url.includes("%") && url.match(/%[0-9A-Fa-f]{2}/)) {
      return decodeURIComponent(url);
    }
  } catch (_e) {
    // Ignore decode errors
  }
  return url;
}

function tryBase64Decode(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      return decoded;
    }
  } catch (_e) {
    // Ignore decode errors
  }
  return null;
}

function findFirstUrl(payload, patterns) {
  if (!payload || typeof payload !== "string") {
    return null;
  }

  for (const pattern of patterns) {
    try {
      const match = payload.match(pattern);
      if (match && match[1]) {
        const candidate = normalizeExtractedUrl(match[1]);
        if (candidate && isLikelyVideoUrl(candidate)) {
          return decodeIfEncoded(candidate);
        }
      }
    } catch (_e) {
      // Skip invalid patterns silently
    }
  }

  // Fallback: try to find any URL-like pattern with .m3u8 or .mp4
  const urlMatch = payload.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
  if (urlMatch && urlMatch[1]) {
    const candidate = normalizeExtractedUrl(urlMatch[1]);
    if (isLikelyVideoUrl(candidate)) {
      return decodeIfEncoded(candidate);
    }
  }

  return null;
}

function isLikelyVideoUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  const lower = url.toLowerCase();
  const excludePatterns = [
    "cloudflareinsights",
    "google-analytics",
    "googletagmanager",
    "facebook.net",
    "beacon.min.js",
    ".js?",
    "analytics",
    "pixel",
    "bigbuckbunny",
    "test-videos",
    "sample-video",
    "placeholder",
  ];

  for (const pattern of excludePatterns) {
    if (lower.includes(pattern)) {
      return false;
    }
  }

  // Accept .mp4, .m3u8 (HLS), or direct video URLs
  const hasVideoExtension = /\.(?:mp4|m3u8)(?:\?|#|$)/i.test(url);
  return hasVideoExtension || lower.includes("video") || lower.includes("stream");
}

async function fetchHtmlWithHeaders(url, referer) {
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
  const headers = { ...HTML_HEADERS };
  if (referer) {
    headers.Referer = referer;
  }

  const response = await axios.get(url, {
    timeout,
    headers,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  return { html: response.data, headers: response.headers };
}

async function resolveStreamwishUrl(url, referer) {
  debugLog("Streamwish", "Resolving URL with native decrypter", url);
  try {
    const resolved = await extractStreamwish(url);
    if (resolved) {
      debugLog("Streamwish", "Native decrypter succeeded", resolved);
      return resolved;
    }
  } catch (err) {
    debugLog("Streamwish", "Native decrypter failed, running fallback", err.message);
  }

  debugLog("Streamwish", "Resolving URL with fallback", url);
  const { html, headers } = await fetchHtmlWithHeaders(url, referer);
  debugLog("Streamwish", "Fetched HTML length", html.length);
  debugLog("Streamwish", "Content-Type", headers["content-type"]);

  // First try to find .m3u8 URL (HLS stream)
  const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m3u8Match && m3u8Match[1]) {
    const candidate = m3u8Match[1];
    if (isLikelyVideoUrl(candidate) && !candidate.startsWith("blob:")) {
      debugLog("Streamwish", "Found m3u8", candidate);
      return candidate;
    }
  }

  const extracted = findFirstUrl(html, [
    /(https?:[^\s"']+\.m3u8[^\s"']*)/i,
    /file\s*:\s*["'](https?:[^\s"']+)["']/i,
    /sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:[^\s"']+)["']/i,
    /"file"\s*:\s*"([^"]+)"/i,
    /sources\s*:\s*\[([^\]]+)\]/i,
    /player\.config\s*=\s*\{[^}]*file\s*:\s*["']([^"']+)["']/i,
    /player\.setup\(\{[^}]*file\s*:\s*["']([^"']+)["']/i,
    /player\.setup\([\s\S]*?sources\s*:\s*\[[\s\S]*?src\s*:\s*["']([^"']+)["']/i,
  ]);

  if (extracted && !extracted.startsWith("blob:")) {
    debugLog("Streamwish", "Found URL", extracted);
    return extracted;
  }

  // Try to find .m3u8 in any data attributes
  const dataMatch = html.match(/data-src=["']([^"']+\.m3u8[^"']*)["']/i);
  if (dataMatch && dataMatch[1] && !dataMatch[1].startsWith("blob:")) {
    return normalizeExtractedUrl(dataMatch[1]);
  }

  // Try eval-based extraction: look for sources in script tags
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?var\s+sources\s*=\s*\[[\s\S]*?\];[\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const sourcesLines = scriptMatch[1];
    const urlInScript = sourcesLines.match(/src\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (urlInScript && urlInScript[1] && !urlInScript[1].startsWith("blob:")) {
      debugLog("Streamwish", "Found in script", urlInScript[1]);
      return normalizeExtractedUrl(urlInScript[1]);
    }
  }

  debugLog("Streamwish", "No URL found in HTML");
  return null;
}

async function resolveStreamtapeUrl(url, referer) {
  debugLog("Streamtape", "Resolving URL with native decrypter", url);
  try {
    const resolved = await extractStreamtape(url);
    if (resolved) {
      debugLog("Streamtape", "Native decrypter succeeded", resolved);
      return resolved;
    }
  } catch (err) {
    debugLog("Streamtape", "Native decrypter failed, running fallback", err.message);
  }

  debugLog("Streamtape", "Resolving URL with fallback", url);
  const { html, headers } = await fetchHtmlWithHeaders(url, referer);
  debugLog("Streamtape", "Fetched HTML length", html.length);
  debugLog("Streamtape", "Content-Type", headers["content-type"]);

  const extracted = findFirstUrl(html, [
    /(https?:\/\/[^\s"']*streamtape\.com\/get_video[^\s"']*)/i,
    /(https?:\/\/[^\s"']*streamtape\.com\/ab-get-video[^\s"']*)/i,
    /videolink[^\n]+?href=["']([^"']+)["']/i,
    /(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i,
    /"file"\s*:\s*"([^"]+)"/i,
    /player\.config\s*=\s*\{[^}]*file\s*:\s*["']([^"']+)["']/i,
    /"video_link"\s*:\s*"([^"]+)"/i,
  ]);

  if (extracted) {
    debugLog("Streamtape", "Found URL", extracted);
    return extracted;
  }

  debugLog("Streamtape", "No URL found in HTML");
  return null;
}

async function resolveOneFichierUrl(url, referer) {
  debugLog("1Fichier", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("1Fichier", "Fetched HTML length", html.length);
    debugLog("1Fichier", "Content-Type", headers["content-type"]);

    const simpleMatch = html.match(/https?:\/\/[^\s'\"]+\.(?:mp4|mkv|avi|mov|webm|zip|rar)/i);
    if (simpleMatch && simpleMatch[0]) {
      debugLog("1Fichier", "Found direct URL in HTML", simpleMatch[0]);
      return normalizeExtractedUrl(simpleMatch[0]);
    }

    const cookieHeader = buildCookieHeader(headers["set-cookie"]);
    debugLog("1Fichier", "Cookie header", cookieHeader ? "present" : "missing");

    const formBody = new URLSearchParams({ dl: "1" }).toString();
    const response = await axios.post(url, formBody, {
      timeout: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
      maxRedirects: 0,
      headers: {
        ...HTML_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer || url,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      validateStatus: (status) => status >= 200 && status < 400,
    }).catch((err) => {
      debugLog("1Fichier", "POST error", err.message);
      return null;
    });

    if (response) {
      debugLog("1Fichier", "POST response status", response.status);

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        debugLog("1Fichier", "Redirect to", response.headers.location);
        return response.headers.location;
      }

      if (typeof response.data === "string") {
        const m = response.data.match(/https?:\/\/[^\s'\"]+\.(?:mp4|mkv|avi|mov|webm|zip|rar)/i);
        if (m && m[0]) {
          debugLog("1Fichier", "Found URL in POST response", m[0]);
          return normalizeExtractedUrl(m[0]);
        }
      }
    }

    debugLog("1Fichier", "No URL found");
    return null;
  } catch (err) {
    debugLog("1Fichier", "Error", err.message);
    return null;
  }
}

async function resolveYourUploadUrl(url, referer) {
  debugLog("YourUpload", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("YourUpload", "Fetched HTML length", html.length);
    debugLog("YourUpload", "Content-Type", headers["content-type"]);

    const extracted = findFirstUrl(html, [
      /file["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /video\[[^\]]+\]\s*=\s*["']([^"']+\.mp4[^"']*)["']/i,
    ]);

    if (extracted) {
      debugLog("YourUpload", "Found URL", extracted);
      return extracted;
    }

    debugLog("YourUpload", "No URL found");
    return null;
  } catch (err) {
    debugLog("YourUpload", "Error", err.message);
    return null;
  }
}

async function resolveOkruUrl(url, referer) {
  debugLog("Okru", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Okru", "Fetched HTML length", html.length);
    debugLog("Okru", "Content-Type", headers["content-type"]);

    const extracted = findFirstUrl(html, [
      /"metadata"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
      /flashvars\s*=\s*\{[^}]*src\s*:\s*"([^"]+)"/i,
      /videoUrl\s*=\s*"([^"]+)"/i,
    ]);

    if (extracted) {
      debugLog("Okru", "Found URL", extracted);
      return extracted;
    }

    debugLog("Okru", "No URL found");
    return null;
  } catch (err) {
    debugLog("Okru", "Error", err.message);
    return null;
  }
}

async function resolveFembedUrl(url, referer) {
  debugLog("Fembed", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Fembed", "Fetched HTML length", html.length);
    debugLog("Fembed", "Content-Type", headers["content-type"]);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /file["']?\s*:\s*["']([^"']+)["']/i,
      /video\s*=\s*["']([^"']+\.mp4[^"']*)["']/i,
    ]);

    if (extracted) {
      debugLog("Fembed", "Found URL", extracted);
      return extracted;
    }

    debugLog("Fembed", "No URL found");
    return null;
  } catch (err) {
    debugLog("Fembed", "Error", err.message);
    return null;
  }
}

async function resolveVoeUrl(url, referer) {
  debugLog("VOE", "Resolving URL with native decrypter", url);
  try {
    const resolved = await extractVoe(url);
    if (resolved) {
      debugLog("VOE", "Native decrypter succeeded", resolved);
      return resolved;
    }
  } catch (err) {
    debugLog("VOE", "Native decrypter failed, running fallback", err.message);
  }

  debugLog("VOE", "Resolving URL with fallback", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("VOE", "Fetched HTML length", html.length);

    // Check for redirect in page
    const redirectMatch = html.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
    if (redirectMatch && redirectMatch[1]) {
      debugLog("VOE", "Following redirect to", redirectMatch[1]);
      const redirectHtml = await fetchHtmlWithHeaders(redirectMatch[1], referer);
      const extracted = findFirstUrl(redirectHtml.html, [
        /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
        /"file"\s*:\s*"([^"]+)"/i,
        /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/i,
      ]);
      if (extracted) {
        debugLog("VOE", "Found URL via redirect", extracted);
        return extracted;
      }
    }

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/i,
    ]);

    if (extracted) {
      debugLog("VOE", "Found URL", extracted);
      return extracted;
    }

    debugLog("VOE", "No URL found");
    return null;
  } catch (err) {
    debugLog("VOE", "Error", err.message);
    return null;
  }
}

async function resolveVidhideUrl(url, referer) {
  debugLog("Vidhide", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Vidhide", "Fetched HTML length", html.length);

    // Try to find video data in player setup
    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /file\s*:\s*'([^']+)'/i,
      /setup\([^)]*file[^)]*\)/i,
    ]);

    if (extracted) {
      debugLog("Vidhide", "Found URL", extracted);
      return extracted;
    }

    // Try to find in eval or decrypted content
    // const evalMatch = html.match(/\$\.getJSON\(["'])([^"'"]+)\1/i);
    if (evalMatch) {
      debugLog("Vidhide", "Found JSON URL", evalMatch[2]);
    }

    debugLog("Vidhide", "No URL found");
    return null;
  } catch (err) {
    debugLog("Vidhide", "Error", err.message);
    return null;
  }
}

async function resolveFilemoonUrl(url, referer) {
  debugLog("Filemoon", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Filemoon", "Fetched HTML length", html.length);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*"([^"\)]+)"/i,
    ]);

    if (extracted) {
      debugLog("Filemoon", "Found URL", extracted);
      return extracted;
    }

    debugLog("Filemoon", "No URL found");
    return null;
  } catch (err) {
    debugLog("Filemoon", "Error", err.message);
    return null;
  }
}

async function resolveMixdropUrl(url, referer) {
  debugLog("Mixdrop", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Mixdrop", "Fetched HTML length", html.length);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*file\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*"([^"]+\.mp4[^"]*)"/i,
    ]);

    if (extracted) {
      debugLog("Mixdrop", "Found URL", extracted);
      return extracted;
    }

    debugLog("Mixdrop", "No URL found");
    return null;
  } catch (err) {
    debugLog("Mixdrop", "Error", err.message);
    return null;
  }
}

async function resolveDoodstreamUrl(url, referer) {
  debugLog("Doodstream", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Doodstream", "Fetched HTML length", html.length);

    const extracted = findFirstUrl(html, [
      /"file"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"video"\s*:\s*"([^"]+)"/i,
    ]);

    if (extracted) {
      debugLog("Doodstream", "Found URL", extracted);
      return extracted;
    }

    debugLog("Doodstream", "No URL found");
    return null;
  } catch (err) {
    debugLog("Doodstream", "Error", err.message);
    return null;
  }
}

async function resolveHqqUrl(url, referer) {
  debugLog("Hqq/Netu", "Resolving URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Hqq/Netu", "Fetched HTML length", html.length);
    debugLog("Hqq/Netu", "Content-Type", headers["content-type"]);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /file\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /video(?:\d+)?\s*=\s*["']([^"']+\.mp4[^"']+)["']/i,
    ]);

    if (extracted) {
      debugLog("Hqq/Netu", "Found URL", extracted);
      return extracted;
    }

    debugLog("Hqq/Netu", "No URL found");
    return null;
  } catch (err) {
    debugLog("Hqq/Netu", "Error", err.message);
    return null;
  }
}

function tryDecodeJKPlayerUrl(encodedUrl) {
  if (!encodedUrl) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedUrl, "base64").toString("utf8");
    const urlMatch = decoded.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1].split("&")[0];
    }

    if (decoded.includes("http")) {
      return decoded.split("&")[0];
    }
  } catch (_e) {
    // Ignore
  }
  return null;
}

async function resolveJKPlayerUrl(url, referer) {
  debugLog("JKPlayer", "Resolving URL", url);
  try {
    const parsedUrl = new URL(url);
    const eParam = parsedUrl.searchParams.get("e");

    if (eParam) {
      const decodedUrl = tryDecodeJKPlayerUrl(eParam);
      if (decodedUrl && decodedUrl.startsWith("http")) {
        debugLog("JKPlayer", "Decoded URL", decodedUrl);
        return decodedUrl;
      }
    }

    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("JKPlayer", "Fetched HTML length", html.length);

    const scriptMatch = html.match(/player\.setup\(\{[\s\S]*?sources\s*:\s*\[\s*\{[\s\S]*?file\s*:\s*"([^"]+)"[\s\S]*?\}[\s\S]*?\]\}/);
    if (scriptMatch && scriptMatch[1]) {
      return scriptMatch[1];
    }

    return null;
  } catch (err) {
    debugLog("JKPlayer", "Error", err.message);
    return null;
  }
}

async function resolveEmbedUrl(url, record, candidate) {
  if (!url) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return url;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const referer = getRefererForUrl(candidate?.url || record?.url || url);

  debugLog("resolveEmbed", `Host: ${host}, Path: ${pathname}`, url);

  // 1. SPECIFIC DOMAIN RESOLVERS FIRST
  if (/streamwish|sfastwish|flaswish/i.test(host)) {
    debugLog("resolveEmbed", "Using Streamwish resolver", null);
    const resolved = await resolveStreamwishUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Streamwish");
    return resolved;
  }

  if (/streamtape/i.test(host)) {
    debugLog("resolveEmbed", "Using Streamtape resolver", null);
    const resolved = await resolveStreamtapeUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Streamtape");
    return resolved;
  }

  if (/1fichier/i.test(host)) {
    debugLog("resolveEmbed", "Using 1Fichier resolver", null);
    const resolved = await resolveOneFichierUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en 1Fichier");
    return resolved;
  }

  if (/yourupload/i.test(host)) {
    debugLog("resolveEmbed", "Using YourUpload resolver", null);
    const resolved = await resolveYourUploadUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en YourUpload");
    return resolved;
  }

  if (/ok\.ru|okru/i.test(host)) {
    debugLog("resolveEmbed", "Using Okru resolver", null);
    const resolved = await resolveOkruUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Okru");
    return resolved;
  }

  if (/embedsito|fembed|mycloud/i.test(host)) {
    debugLog("resolveEmbed", "Using Fembed resolver", null);
    const resolved = await resolveFembedUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Fembed");
    return resolved;
  }

  if (/hqq\.tv|netu|waaw/i.test(host)) {
    debugLog("resolveEmbed", "Using Hqq/Netu resolver", null);
    const resolved = await resolveHqqUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Hqq/Netu");
    return resolved;
  }

  if (/jkplayers|jkanime/i.test(host) || /\/jkplayer\//.test(pathname)) {
    debugLog("resolveEmbed", "Using JKPlayer resolver", null);
    const resolved = await resolveJKPlayerUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en JKPlayer");
    return resolved;
  }

  if (/vidhidevip|vidhide/i.test(host)) {
    debugLog("resolveEmbed", "Using Vidhide resolver", null);
    const resolved = await resolveVidhideUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/bysekoze|filemoon/i.test(host)) {
    debugLog("resolveEmbed", "Using Filemoon resolver", null);
    const resolved = await resolveFilemoonUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/mixdrop/i.test(host)) {
    debugLog("resolveEmbed", "Using Mixdrop resolver", null);
    const resolved = await resolveMixdropUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/dsvplay|doodstream/i.test(host)) {
    debugLog("resolveEmbed", "Using Doodstream resolver", null);
    const resolved = await resolveDoodstreamUrl(url, referer);
    if (resolved) return resolved;
  }

  if (/mp4upload/i.test(host)) {
    debugLog("resolveEmbed", "Using MP4Upload resolver", null);
    if (!pathname.includes("embed") && !pathname.endsWith(".html")) {
      const slug = pathname.split("/").filter(Boolean).pop();
      if (slug) {
        url = `https://www.mp4upload.com/embed-${slug}.html`;
        debugLog("resolveEmbed", `Converted MP4Upload download URL to embed: ${url}`, null);
      }
    }
    const resolved = await resolveEmbedWithPuppeteer(url, referer);
    if (resolved) return resolved;
    throw new Error("No se pudo resolver enlace directo en MP4Upload");
  }

  // 2. VOE AND DYNAMIC DOMAINS
  if (/voe\.sx/i.test(host) || /\/e\//.test(pathname)) {
    debugLog("resolveEmbed", "Using VOE resolver", null);
    const resolved = await resolveVoeUrl(url, referer);
    if (resolved) return resolved;
    // Don't throw if it was a dynamic domain catch, let it fallback to Puppeteer
    if (/voe\.sx/i.test(host)) {
      throw new Error("No se pudo resolver enlace directo en VOE");
    }
  }

  // 3. PUPPETEER PROTECTED SITE FALLBACK
  const isProtectedSite = /animeflv|streamwish|vidhide|mixdrop/i.test(host);
  if (isProtectedSite) {
    debugLog("resolveEmbed", "Using puppeteer for protected site", null);
    const resolved = await resolveEmbedWithPuppeteer(url, referer);
    if (resolved) return resolved;
  }

  // Fallback: use puppeteer for any unresolved embed
  debugLog("resolveEmbed", "Trying puppeteer fallback", null);
  const puppeteerResolved = await resolveEmbedWithPuppeteer(url, referer);
  if (puppeteerResolved) {
    return puppeteerResolved;
  }

  return url;
}

function chooseCandidateLinks(episodeData, variant, preferredServer) {
  const normalizedVariant = String(variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const otherVariant = normalizedVariant === "SUB" ? "DUB" : "SUB";

  const downloadLinks = episodeData.downloadLinks || { SUB: [], DUB: [] };
  const streamLinks = episodeData.streamLinks || { SUB: [], DUB: [] };

  const candidates = [
    ...(downloadLinks[normalizedVariant] || []),
    ...(downloadLinks[otherVariant] || []),
    ...(streamLinks[normalizedVariant] || []),
    ...(streamLinks[otherVariant] || []),
  ];

  const seen = new Set();
  const deduped = [];

  for (const item of candidates) {
    if (!item || typeof item.url !== "string" || !item.url.trim()) {
      continue;
    }

    const key = item.url.trim();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      server: item.server || "Unknown",
      url: key,
      quality: item.quality || null,
    });
  }

  const preferredToken = safeFilePart(preferredServer);

  deduped.sort((a, b) => {
    const serverA = safeFilePart(a.server);
    const serverB = safeFilePart(b.server);

    const preferredBonusA = preferredToken && serverA.includes(preferredToken) ? -100 : 0;
    const preferredBonusB = preferredToken && serverB.includes(preferredToken) ? -100 : 0;

    const priorityA = SERVER_PRIORITY.findIndex((token) => serverA.includes(token));
    const priorityB = SERVER_PRIORITY.findIndex((token) => serverB.includes(token));
    const resolvedA = priorityA === -1 ? 999 : priorityA;
    const resolvedB = priorityB === -1 ? 999 : priorityB;

    return resolvedA + preferredBonusA - (resolvedB + preferredBonusB);
  });

  return deduped;
}

function makeDownloadFilename(record, sourceUrl, serverName) {
  const slug = extractAnimeSlug(record.url);
  const episodeNumber = extractEpisodeNumber(record.url);
  const ext = getExtensionFromUrl(sourceUrl);
  const serverToken = safeFilePart(serverName || "server");
  const qualityToken = safeFilePart(record.quality || "auto");
  const suffix = record.downloadId.split("-")[0];
  const episodeLabel = Number.isFinite(episodeNumber) ? `ep${episodeNumber}` : "epx";

  return `${slug}-${episodeLabel}-${qualityToken}-${serverToken}-${suffix}${ext}`;
}

async function removeFileIfExists(targetPath) {
  try {
    await fs.promises.unlink(targetPath);
  } catch (_error) {
    // Ignore missing files.
  }
}

function ensureDirectLikeContent(contentType, url) {
  const lowered = (contentType || "").toLowerCase();
  if (/(text\/html|application\/json|application\/javascript|text\/plain)/i.test(lowered)) {
    throw new Error(`El servidor devolvio contenido no descargable (${lowered || "desconocido"}) para ${url}`);
  }
}

function resolveDirectDownloadUrl(rawUrl, serverName) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return rawUrl;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const serverToken = safeFilePart(serverName || "");

  if (host.includes("pixeldrain.com") || serverToken.includes("pdrain") || serverToken.includes("pixeldrain")) {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const isFileApi = pathParts[0] === "api" && pathParts[1] === "file" && pathParts[2];
    const isUserShare = pathParts[0] === "u" && pathParts[1];

    const fileId = isFileApi ? pathParts[2] : isUserShare ? pathParts[1] : null;
    if (fileId) {
      return `https://pixeldrain.com/api/file/${fileId}?download`;
    }
  }

  if (host.includes("zilla-networks.com") && parsed.pathname.startsWith("/play/")) {
    const videoId = parsed.pathname.split("/").pop();
    if (videoId) {
      return `https://player.zilla-networks.com/m3u8/${videoId}`;
    }
  }

  return rawUrl;
}

async function downloadHlsVideo(finalUrl, filePath, record, candidate) {
  record.status = "downloading";
  record.currentServer = candidate.server;
  record.sourceUrl = finalUrl;
  record.totalBytes = null;
  record.downloadedBytes = 0;
  record.progress = 1;
  record.updatedAt = Date.now();

  const referer = getRefererForUrl(candidate.url || record.url || finalUrl);

  return new Promise((resolve, reject) => {
    ffmpeg(finalUrl)
      .inputOptions([
        '-headers',
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\r\nReferer: ${referer}\r\n`
      ])
      .outputOptions([
        "-c copy",
        "-bsf:a aac_adtstoasc"
      ])
      .output(filePath)
      .on("start", () => {
        record.status = "downloading";
        record.progress = 1;
        record.updatedAt = Date.now();
      })
      .on("progress", (progress) => {
        if (progress.percent && progress.percent > 0) {
          record.progress = Math.max(1, Math.min(99, Math.floor(progress.percent)));
        } else {
          // Si ffmpeg no nos da un %, subimos el progreso visualmente poco a poco
          record.progress = Math.min(90, record.progress + 1);
        }
        record.updatedAt = Date.now();
      })
      .on("error", async (err) => {
        await removeFileIfExists(filePath);
        reject(new Error(`Transferencia fallida en ${candidate.server} (HLS): ${err.message}`));
      })
      .on("end", () => {
        resolve();
      })
      .run();
  });
}

async function downloadFromUrl(record, candidate) {
  let finalUrl = resolveDirectDownloadUrl(candidate.url, candidate.server);
  finalUrl = await resolveEmbedUrl(finalUrl, record, candidate);
  if (!finalUrl) {
    throw new Error(`No se pudo resolver enlace directo en ${candidate.server}`);
  }
  const downloadsDir = getDownloadsDir();
  const fileName = makeDownloadFilename(record, finalUrl, candidate.server);
  const filePath = path.join(downloadsDir, fileName);

  const referer = getRefererForUrl(candidate.url || record.url || finalUrl);

  const isHls = finalUrl.toLowerCase().includes(".m3u8") || /hls/i.test(candidate.server);

  if (isHls) {
    await downloadHlsVideo(finalUrl, filePath, record, candidate);
  } else {
    let response;
    try {
      const timeout = Number(process.env.DOWNLOAD_REQUEST_TIMEOUT_MS || 120000);
      response = await axios.get(finalUrl, {
        responseType: "stream",
        timeout,
        maxRedirects: 5,
        headers: {
          ...DEFAULT_HEADERS,
          Referer: referer,
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (error) {
      throw new Error(`No se pudo abrir enlace ${candidate.server}: ${error.message}`);
    }

    const contentType = response.headers["content-type"] || "";
    ensureDirectLikeContent(contentType, finalUrl);

    const totalBytesRaw = Number(response.headers["content-length"] || 0);
    const totalBytes = Number.isFinite(totalBytesRaw) && totalBytesRaw > 0 ? totalBytesRaw : null;

    record.status = "downloading";
    record.currentServer = candidate.server;
    record.sourceUrl = finalUrl;
    record.totalBytes = totalBytes;
    record.downloadedBytes = 0;
    record.progress = 1;
    record.updatedAt = Date.now();

    const writer = fs.createWriteStream(filePath, { flags: "w" });

    response.data.on("data", (chunk) => {
      if (!Buffer.isBuffer(chunk)) {
        return;
      }

      record.downloadedBytes += chunk.length;
      record.updatedAt = Date.now();

      if (record.totalBytes && record.totalBytes > 0) {
        const pct = Math.floor((record.downloadedBytes / record.totalBytes) * 100);
        record.progress = Math.max(1, Math.min(99, pct));
        return;
      }

      record.progress = Math.min(90, record.progress + 1);
    });

    try {
      await pipeline(response.data, writer);
    } catch (error) {
      await removeFileIfExists(filePath);
      throw new Error(`Transferencia fallida en ${candidate.server}: ${error.message}`);
    }
  }

  const stat = await fs.promises.stat(filePath);
  if (!stat.size || stat.size < 512 * 1024) {
    await removeFileIfExists(filePath);
    throw new Error(`Archivo invalido en ${candidate.server}: tamano demasiado pequeno`);
  }

  record.status = "completed";
  record.progress = 100;
  record.fileName = fileName;
  record.filePath = filePath;
  record.fileSize = String(stat.size);
  record.downloadUrl = `${record.baseUrl}/downloads/${fileName}`;
  record.completedAt = Date.now();
  record.error = null;
}

async function runDownload(record, payload) {
  record.status = "preparing";
  record.updatedAt = Date.now();

  const variant = String(record.variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const includeMega = String(payload?.includeMega).toLowerCase() === "true";
  const excludeServers = payload?.excludeServers;
  const preferredServer = payload?.preferredServer;

  try {
    const episodeResponse = await animeService.getEpisodeLinks(record.url, includeMega, excludeServers);
    const candidates = chooseCandidateLinks(episodeResponse.data, variant, preferredServer);

    if (candidates.length === 0) {
      throw new Error("No se encontraron enlaces para descarga real");
    }

    const errors = [];
    for (const candidate of candidates) {
      try {
        await downloadFromUrl(record, candidate);
        return;
      } catch (error) {
        errors.push(`${candidate.server}: ${error.message}`);
      }
    }

    throw new Error(`Todos los servidores fallaron. ${errors.join(" | ")}`);
  } catch (error) {
    record.status = "failed";
    record.progress = 0;
    record.error = error.message || "Error desconocido en descarga";
    record.updatedAt = Date.now();
  }
}

function createDownload(payload, baseUrl) {
  if (!payload || typeof payload.url !== "string" || !payload.url.trim()) {
    throw new ApiError(400, "Se requiere el parametro url en el body");
  }

  const downloadId = randomUUID();
  const record = {
    downloadId,
    status: "queued",
    progress: 0,
    url: payload.url.trim(),
    quality: payload.quality || "1080p",
    variant: payload.variant || "SUB",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    baseUrl,
    error: null,
    downloadUrl: null,
    fileSize: null,
    fileName: null,
    downloadedBytes: 0,
    totalBytes: null,
    sourceUrl: null,
    currentServer: null,
  };

  downloadStore.set(downloadId, record);

  void runDownload(record, payload);

  return {
    id: downloadId,
    downloadId,
    status: record.status,
    statusUrl: `/api/v1/anime/download/${downloadId}`,
    url: record.url,
    quality: record.quality,
    variant: record.variant,
  };
}

function getDownload(downloadId) {
  const record = downloadStore.get(downloadId);
  if (!record) {
    throw new ApiError(404, "Descarga no encontrada");
  }

  return {
    id: record.downloadId,
    downloadId: record.downloadId,
    status: record.status,
    progress: record.progress,
    url: record.url,
    quality: record.quality,
    variant: record.variant,
    downloadUrl: record.downloadUrl,
    fileSize: record.fileSize,
    sourceUrl: record.sourceUrl,
    currentServer: record.currentServer,
    downloadedBytes: record.downloadedBytes,
    totalBytes: record.totalBytes,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt || null,
  };
}

function createBatch(payload, baseUrl) {
  const animeUrl = (payload?.animeUrl || "").toString().trim();
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

  if (!animeUrl) {
    throw new ApiError(400, "Se requiere animeUrl en el body");
  }

  if (episodes.length === 0) {
    throw new ApiError(400, "Se requiere un arreglo de episodes con al menos un elemento");
  }

  const normalizedEpisodes = episodes
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);

  if (normalizedEpisodes.length === 0) {
    throw new ApiError(400, "episodes debe contener numeros de episodio validos");
  }

  const batchId = randomUUID();
  const entries = normalizedEpisodes.map((episodeNumber) => {
    const episodeUrl = `${animeUrl.replace(/\/$/, "")}/${episodeNumber}`;
    const created = createDownload(
      {
        url: episodeUrl,
        quality: payload.quality || "1080p",
        variant: payload.variant || "SUB",
        includeMega: payload.includeMega,
        excludeServers: payload.excludeServers,
        preferredServer: payload.preferredServer,
      },
      baseUrl
    );

    return {
      episode: episodeNumber,
      downloadId: created.downloadId,
      status: created.status,
    };
  });

  const batch = {
    batchId,
    animeUrl,
    quality: payload.quality || "1080p",
    variant: payload.variant || "SUB",
    createdAt: Date.now(),
    items: entries,
  };

  batchStore.set(batchId, batch);

  return {
    batchId,
    status: "queued",
    total: entries.length,
    statusUrl: `/api/v1/anime/batch/${batchId}`,
    items: entries,
  };
}

function getBatch(batchId) {
  const batch = batchStore.get(batchId);
  if (!batch) {
    throw new ApiError(404, "Batch no encontrado");
  }

  const items = batch.items.map((item) => {
    const snapshot = getDownload(item.downloadId);
    return {
      episode: item.episode,
      downloadId: item.downloadId,
      status: snapshot.status,
      progress: snapshot.progress,
      downloadUrl: snapshot.downloadUrl,
      error: snapshot.error,
    };
  });

  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    batchId,
    status: completed === total ? "completed" : failed === total ? "failed" : "downloading",
    progress,
    total,
    completed,
    failed,
    items,
  };
}

module.exports = {
  createDownload,
  getDownload,
  createBatch,
  getBatch,
  getDownloadsDir,
};
