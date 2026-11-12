const axios = require("axios");
const cheerio = require("cheerio");
const vm = require("node:vm");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const DEFAULT_DOMAIN = "jkanime.net";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtmlWithCookies(url) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const rawCookies = response.headers["set-cookie"] || [];
    const cookies = rawCookies.map((c) => c.split(";")[0]).join("; ");
    return {
      html: response.data,
      cookies,
    };
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido desde JKAnime", error.message);
  }
}

async function fetchHtml(url) {
  const { html } = await fetchHtmlWithCookies(url);
  return html;
}

async function fetchJson(url, options = {}) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios({
      url,
      timeout,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        ...HTTP_HEADERS,
        ...(options.headers || {}),
      },
      method: options.method || "GET",
      data: options.data || undefined,
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

function resolveAbsoluteUrl(urlCandidate, domain = DEFAULT_DOMAIN) {
  if (!urlCandidate || typeof urlCandidate !== "string") {
    return null;
  }

  try {
    const base = `https://${domain}`;
    return new URL(urlCandidate, base).toString();
  } catch (_error) {
    return null;
  }
}

function normalizeInputUrl(urlCandidate, domain = DEFAULT_DOMAIN) {
  const normalized = resolveAbsoluteUrl(urlCandidate, domain);
  if (!normalized) {
    throw new ApiError(400, "URL invalida");
  }
  return normalized;
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function parseEpisodeNumberFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const number = Number(lastSegment);
    return Number.isFinite(number) ? number : null;
  } catch (_error) {
    return null;
  }
}

function normalizeToken(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeServerName(serverName, url) {
  if (serverName && typeof serverName === "string") {
    const token = normalizeToken(serverName);
    if (token) {
      return { name: serverName.trim(), token };
    }
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      name: host,
      token: normalizeToken(host),
    };
  } catch (_error) {
    return { name: "Unknown", token: "unknown" };
  }
}

function pushDeduped(target, link) {
  if (!link || !link.url) {
    return;
  }

  if (target.some((item) => item.url === link.url)) {
    return;
  }

  target.push(link);
}

function buildExcludedTokens(includeMega, excludeServersRaw) {
  const excluded = new Set();

  const raw = typeof excludeServersRaw === "string" ? excludeServersRaw : "";
  for (const part of raw.split(",")) {
    const token = normalizeToken(part);
    if (token) {
      excluded.add(token);
    }
  }

  if (!includeMega) {
    excluded.add("mega");
  }

  return excluded;
}

function filterLinksByServers(links, excludedTokens) {
  return links.filter((link) => {
    const token = normalizeToken(link.token || link.server);
    if (!token) {
      return true;
    }

    if (excludedTokens.has(token)) {
      return false;
    }

    if (token.includes("mega") && excludedTokens.has("mega")) {
      return false;
    }

    return true;
  });
}

function sanitizeLinksForResponse(links) {
  return links.map((link) => {
    const result = {
      server: link.server,
      url: link.url,
    };

    if (link.quality) {
      result.quality = link.quality;
    }

    return result;
  });
}

function extractBalancedSection(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let activeQuote = "";
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = "";
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      activeQuote = character;
      continue;
    }

    if (character === openChar) {
      depth += 1;
    }

    if (character === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function safeEvaluate(expression) {
  try {
    const context = Object.create(null);
    return vm.runInNewContext(expression, context, {
      timeout: 1000,
      displayErrors: false,
    });
  } catch (_error) {
    return null;
  }
}

function extractVarLiteral(html, varName) {
  const marker = `var ${varName}`;
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) {
    return null;
  }

  const equalsIndex = html.indexOf("=", startIndex);
  if (equalsIndex === -1) {
    return null;
  }

  const slice = html.slice(equalsIndex + 1);
  const firstBracketIndex = slice.search(/[\[{]/);
  if (firstBracketIndex === -1) {
    return null;
  }

  const openChar = slice[firstBracketIndex];
  const closeChar = openChar === "{" ? "}" : "]";
  return extractBalancedSection(slice, firstBracketIndex, openChar, closeChar);
}

function extractVideoIframeUrls(html) {
  const urls = [];
  const videoPattern = /video\[\d+\]\s*=\s*(['"])([\s\S]*?)\1/g;
  let match = null;

  while ((match = videoPattern.exec(html))) {
    const fragment = match[2];
    const srcMatch = fragment.match(/src=['"]([^'"]+)['"]/i);
    if (srcMatch && srcMatch[1]) {
      urls.push(srcMatch[1]);
    }
  }

  return urls;
}

function decodeBase64(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return Buffer.from(value, "base64").toString("utf8").trim();
  } catch (_error) {
    return null;
  }
}

function normalizeVariantKey(value) {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "SUB";
  }

  if (normalized.includes("sub") || normalized.includes("jp") || normalized.includes("jap")) {
    return "SUB";
  }

  return "DUB";
}

function parseSearchResultsFromHtml(html, domain) {
  const $ = cheerio.load(html);
  const results = [];

  $(".anime__item").each((_, element) => {
    const card = $(element);
    const title = card.find(".anime__item__text h5 a").first().text().trim();
    const link = card.find(".anime__item__text h5 a").attr("href") || card.find("a").first().attr("href");

    if (!title || !link) {
      return;
    }

    const image =
      card.find(".anime__item__pic").attr("data-setbg") ||
      card.find("img").attr("data-setbg") ||
      card.find("img").attr("src") ||
      null;

    const status = card.find(".anime__item__text ul li").first().text().trim() || null;
    const type = card.find(".anime__item__text ul li").last().text().trim() || null;

    let slug = null;
    try {
      const parsed = new URL(resolveAbsoluteUrl(link, domain));
      slug = parsed.pathname.split("/").filter(Boolean)[0] || null;
    } catch (_error) {
      slug = null;
    }

    results.push({
      id: null,
      title,
      slug,
      url: resolveAbsoluteUrl(link, domain),
      image: resolveAbsoluteUrl(image, domain),
      backdrop: null,
      type,
      score: null,
      status,
      year: null,
    });
  });

  return results;
}

function parseAnimeInfoFromHtml(html, domain) {
  const $ = cheerio.load(html);
  const info = $(".anime_info");

  const title = info.find("h3").first().text().trim() || null;
  const titleAlt = info.find("span").first().text().trim() || null;
  const description = info.find("p").first().text().trim() || null;
  const image =
    info.find("img").attr("src") || info.find("img").attr("data-setbg") || $(".movpic img").attr("src") || null;

  const infoValues = {};

  $("li").each((_, element) => {
    const labelSource =
      $(element).find("span").first().text().trim() || $(element).find("div").first().text().trim();
    const label = labelSource.replace(":", "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) {
      return;
    }

    const fullText = $(element).text().replace(/\s+/g, " ").trim();

    if (label === "tipo") {
      infoValues.type = fullText.replace(/Tipo:/i, "").trim();
    }

    if (label === "estado") {
      const status = $(element).find(".enemision").text().trim();
      infoValues.status = status || fullText.replace(/Estado:/i, "").trim();
    }

    if (label === "episodios") {
      const raw = fullText.replace(/Episodios:/i, "").trim();
      infoValues.totalEpisodes = parseNumber(raw) || null;
    }

    if (label === "emitido") {
      infoValues.emitido = fullText.replace(/Emitido:/i, "").trim();
    }

    if (label === "generos") {
      const genres = [];
      $(element)
        .find("a")
        .each((_, link) => {
          const name = $(link).text().trim();
          if (!name) {
            return;
          }
          genres.push({
            id: null,
            name,
            slug: name.toLowerCase().replace(/\s+/g, "-"),
            malId: null,
          });
        });
      if (genres.length) {
        infoValues.genres = genres;
      }
    }
  });

  const animeId =
    $("#guardar-anime").attr("data-anime") ||
    $(".guardar-anime").attr("data-anime") ||
    $("[data-anime]").attr("data-anime") ||
    (html.match(/data-anime=["']?(\d+)["']?/i) || [])[1] ||
    (html.match(/\/ajax\/episodes\/(\d+)\//i) || [])[1] ||
    (html.match(/\/ajax\/votado\/(\d+)/i) || [])[1] ||
    null;

  return {
    title,
    titleAlt,
    description,
    image,
    animeId,
    infoValues,
  };
}

function parseEpisodesFromHtml(html, domain, slug) {
  const $ = cheerio.load(html);
  const episodes = [];

  $("#episodes-content a, .episodes-content a, .list-group a").each((_, element) => {
    const link = $(element).attr("href");
    if (!link) {
      return;
    }

    const url = resolveAbsoluteUrl(link, domain);
    if (!url || !/\/\d+\/?$/.test(url)) {
      return;
    }

    const number = parseEpisodeNumberFromUrl(url);
    episodes.push({
      id: null,
      number: number || null,
      title: number ? `Episodio ${number}` : $(element).text().trim(),
      url,
    });
  });

  if (episodes.length > 0) {
    return episodes;
  }

  if (!slug) {
    return episodes;
  }

  const seen = new Set();
  const episodeLinks = [];
  $("a").each((_, element) => {
    const link = $(element).attr("href");
    if (!link) {
      return;
    }

    const url = resolveAbsoluteUrl(link, domain);
    if (!url || !url.includes(`/${slug}/`)) {
      return;
    }

    const number = parseEpisodeNumberFromUrl(url);
    if (!number || seen.has(number)) {
      return;
    }
    seen.add(number);

    episodeLinks.push({
      id: null,
      number,
      title: `Episodio ${number}`,
      url,
    });
  });

  episodeLinks.sort((a, b) => a.number - b.number);
  return episodeLinks;
}

function parseToken(html) {
  const $ = cheerio.load(html);
  const metaToken = $("meta[name='csrf-token']").attr("content");
  if (metaToken) {
    return metaToken.trim();
  }

  const match =
    html.match(/var\s+token\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/_token:\s*['"]([^'"]+)['"]/i) ||
    html.match(/['"]_token['"]\s*:\s*['"]([^'"]+)['"]/i);
  return match ? match[1] : null;
}

async function fetchEpisodesFromApi(animeId, slug, referer, token, cookies) {
  if (!animeId) {
    return [];
  }

  const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
  const headers = {
    ...HTTP_HEADERS,
    "X-Requested-With": "XMLHttpRequest",
    Referer: referer,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (cookies) {
    headers.Cookie = cookies;
  }
  if (token) {
    headers["X-CSRF-TOKEN"] = token;
  }

  const postData = token ? `_token=${encodeURIComponent(token)}` : "";

  async function requestPage(page) {
    try {
      const response = await axios({
        url: `https://${DEFAULT_DOMAIN}/ajax/episodes/${animeId}/${page}`,
        method: "POST",
        headers,
        data: postData,
        timeout,
        validateStatus: (status) => status >= 200 && status < 400,
      });
      return response.data;
    } catch (_error) {
      return null;
    }
  }

  const firstPageResponse = await requestPage(1);
  if (!firstPageResponse || !Array.isArray(firstPageResponse.data)) {
    return [];
  }

  let rawItems = [...firstPageResponse.data];
  const lastPage = parseNumber(firstPageResponse.last_page) || 1;

  if (lastPage > 1) {
    const pagesToFetch = [];
    for (let p = 2; p <= lastPage; p += 1) {
      pagesToFetch.push(p);
    }

    const BATCH_SIZE = 8;
    for (let i = 0; i < pagesToFetch.length; i += BATCH_SIZE) {
      const batch = pagesToFetch.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (pageNumber) => {
          const res = await requestPage(pageNumber);
          return Array.isArray(res?.data) ? res.data : [];
        })
      );

      for (const pageItems of batchResults) {
        rawItems.push(...pageItems);
      }
    }
  }

  const seenNumbers = new Set();
  const episodes = [];

  for (const item of rawItems) {
    const number = parseNumber(item.number || item.episode);
    if (!number || seenNumbers.has(number)) {
      continue;
    }
    seenNumbers.add(number);

    episodes.push({
      id: item.id ?? null,
      number,
      title: item.title || `Episodio ${number}`,
      url: `https://${DEFAULT_DOMAIN}/${slug}/${number}/`,
    });
  }

  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

function buildLinkRecord(serverName, url, quality) {
  if (!url) {
    return null;
  }

  const server = normalizeServerName(serverName, url);
  return {
    server: server.name,
    token: server.token,
    url,
    quality: quality || null,
  };
}

async function searchAnime(query, domainCandidate) {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw new ApiError(400, "Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN || "jkanime.net").toString().trim();

  const candidates = [
    `https://${domain}/buscar/${encodeURIComponent(cleanQuery)}`,
    `https://${domain}/buscar?q=${encodeURIComponent(cleanQuery)}`,
  ];

  let bestResults = [];

  for (const url of candidates) {
    const html = await fetchHtml(url);
    const results = parseSearchResultsFromHtml(html, domain);
    if (results.length > bestResults.length) {
      bestResults = results;
    }

    if (bestResults.length >= 5) {
      break;
    }
  }

  return {
    success: true,
    data: {
      query: cleanQuery,
      results: bestResults,
      count: bestResults.length,
    },
    source: "jkanime",
  };
}

async function getAnimeInfo(urlCandidate) {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const parsed = new URL(normalizedUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);

  const slug = segments[0] || "";
  if (!slug) {
    throw new ApiError(400, "URL invalida");
  }

  const baseUrl = `https://${DEFAULT_DOMAIN}/${slug}/`;
  const { html, cookies } = await fetchHtmlWithCookies(baseUrl);
  const info = parseAnimeInfoFromHtml(html, DEFAULT_DOMAIN);
  const token = parseToken(html);

  let episodes = [];
  if (info.animeId) {
    episodes = await fetchEpisodesFromApi(info.animeId, slug, baseUrl, token, cookies);
  }

  if (episodes.length === 0) {
    episodes = parseEpisodesFromHtml(html, DEFAULT_DOMAIN, slug);
  }

  const totalEpisodes = info.infoValues.totalEpisodes || episodes.length || null;

  return {
    success: true,
    data: {
      id: info.animeId ? Number(info.animeId) : null,
      title: info.title || null,
      titleJapanese: info.titleAlt || null,
      description: info.description || null,
      image: resolveAbsoluteUrl(info.image, DEFAULT_DOMAIN),
      backdrop: null,
      status: info.infoValues.status || null,
      type: info.infoValues.type || null,
      year: null,
      startDate: info.infoValues.emitido || null,
      endDate: null,
      score: null,
      votes: null,
      totalEpisodes,
      malId: null,
      trailer: null,
      genres: info.infoValues.genres || [],
      episodes,
    },
    source: "jkanime",
  };
}

async function getEpisodeLinks(urlCandidate, includeMegaRaw, excludeServersRaw) {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const includeMega = String(includeMegaRaw).toLowerCase() === "true";
  const excludedTokens = buildExcludedTokens(includeMega, excludeServersRaw);

  const html = await fetchHtml(normalizedUrl);
  const title = cheerio.load(html)("h1").first().text().trim() || null;

  const streamLinks = { SUB: [], DUB: [] };
  const downloadLinks = { SUB: [], DUB: [] };

  const serversLiteral = extractVarLiteral(html, "servers");
  if (serversLiteral) {
    const serversData = safeEvaluate(`(${serversLiteral})`);
    if (Array.isArray(serversData)) {
      const remoteMatch = html.match(/var\s+remote\s*=\s*['"]([^'"]+)['"]/i);
      const remoteBase = remoteMatch ? remoteMatch[1] : null;

      for (const entry of serversData) {
        if (!entry) {
          continue;
        }

        const decodedUrl = decodeBase64(entry.remote);
        const variant = normalizeVariantKey(entry.lang);
        const streamLink = buildLinkRecord(entry.server, decodedUrl, entry.size || null);
        if (streamLink) {
          pushDeduped(streamLinks[variant], streamLink);
        }

        if (remoteBase && entry.slug) {
          const downloadUrl = `${remoteBase.replace(/\/$/, "")}/d/${entry.slug}/`;
          const downloadLink = buildLinkRecord(entry.server, downloadUrl, entry.size || null);
          if (downloadLink) {
            pushDeduped(downloadLinks[variant], downloadLink);
          }
        }
      }
    }
  }

  const iframeUrls = extractVideoIframeUrls(html);
  for (const url of iframeUrls) {
    const link = buildLinkRecord("JKPlayer", url, null);
    if (link) {
      pushDeduped(streamLinks.SUB, link);
    }
  }

  const filteredStreamSub = filterLinksByServers(streamLinks.SUB, excludedTokens);
  const filteredStreamDub = filterLinksByServers(streamLinks.DUB, excludedTokens);
  const filteredDownloadSub = filterLinksByServers(downloadLinks.SUB, excludedTokens);
  const filteredDownloadDub = filterLinksByServers(downloadLinks.DUB, excludedTokens);

  return {
    success: true,
    data: {
      id: null,
      episode: parseEpisodeNumberFromUrl(normalizedUrl),
      title: title || `Episodio ${parseEpisodeNumberFromUrl(normalizedUrl) || "?"}`,
      season: null,
      variants: {
        SUB: filteredStreamSub.length > 0 || filteredDownloadSub.length > 0 ? 1 : 0,
        DUB: filteredStreamDub.length > 0 || filteredDownloadDub.length > 0 ? 1 : 0,
      },
      publishedAt: null,
      servers: {
        sub: sanitizeLinksForResponse(filteredStreamSub),
        dub: sanitizeLinksForResponse(filteredStreamDub),
      },
      streamLinks: {
        SUB: sanitizeLinksForResponse(filteredStreamSub),
        DUB: sanitizeLinksForResponse(filteredStreamDub),
      },
      downloadLinks: {
        SUB: sanitizeLinksForResponse(filteredDownloadSub),
        DUB: sanitizeLinksForResponse(filteredDownloadDub),
      },
    },
    source: "jkanime",
  };
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
};
