const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const animeService = require("./src/services/anime.service");
const downloadService = require("./src/services/download.service");

// ─── Paleta ANSI Sobria / TUI Profesional ───────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  steel: "\x1b[38;5;75m",     // Azul acero suave
  cyan: "\x1b[38;5;110m",     // Slate pastel
  sage: "\x1b[38;5;108m",     // Verde salvia (éxito / completado)
  amber: "\x1b[38;5;215m",    // Ámbar suave (advertencia / preparando)
  coral: "\x1b[38;5;174m",    // Coral muted (error / fallo)
  lavender: "\x1b[38;5;146m", // Lavanda (metadatos / tags)
  slate: "\x1b[38;5;245m",    // Gris pizarra (secundario)
  darkSlate: "\x1b[38;5;240m",// Bordes
  white: "\x1b[38;5;255m",    // Texto principal claro
};

const PROVIDERS = [
  { title: "AnimeAV1     (Recomendado · HD Directo)", value: "animeav1.com" },
  { title: "AnimeFLV     (Catálogo clásico)", value: "animeflv.net" },
  { title: "JKAnime      (Alternativo)", value: "jkanime.net" },
  { title: "TioAnime     (YourUpload / Directo)", value: "tioanime.com" },
  { title: "MonosChinos  (Mirrors alternativos)", value: "monoschinos2.com" },
  { title: "HentaiLA     (+18)", value: "hentaila.com" },
];

const PROVIDER_DOMAINS = {
  "animeav1.com": "AnimeAV1",
  "animeflv.net": "AnimeFLV",
  "www4.animeflv.net": "AnimeFLV",
  "jkanime.net": "JKAnime",
  "hentaila.com": "HentaiLA",
  "tioanime.com": "TioAnime",
  "monoschinos2.com": "MonosChinos",
};

// ─── Utilidades de Medición y Formato de Terminal ───────────────────────────
function stripAnsi(str) {
  return String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function getTermWidth() {
  return Math.max(50, (process.stdout.columns || 80) - 2);
}

function padEndVisible(str, targetLen) {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen >= targetLen) return str;
  return str + " ".repeat(targetLen - visibleLen);
}

function truncateVisible(str, maxLen) {
  const clean = stripAnsi(str);
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "0.0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0.0 MB/s";
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps < 0.1) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${mbps.toFixed(1)} MB/s`;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM.toString().padStart(2, "0")}m`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function renderBar(percent, width = 24, activeColor = C.steel) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const fillStr = "━".repeat(filled);
  const emptyStr = "─".repeat(empty);
  return `${activeColor}${fillStr}${C.darkSlate}${emptyStr}${C.reset}`;
}

function formatEpisodeRanges(nums) {
  if (!nums || nums.length === 0) return "ninguno";
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(", ");
}

function drawBox(title, lines, customWidth = null) {
  const width = customWidth || Math.min(74, getTermWidth());
  const innerWidth = width - 4;
  const topTitle = title ? ` ${C.bold}${C.cyan}${title}${C.reset} ` : "";
  const titleVisLen = stripAnsi(topTitle).length;
  const topBorder =
    `${C.darkSlate}╭──${topTitle}` +
    `${C.darkSlate}${"─".repeat(Math.max(0, width - 3 - titleVisLen))}╮${C.reset}`;
  const bottomBorder = `${C.darkSlate}╰${"─".repeat(width - 2)}╯${C.reset}`;

  const body = lines.map((line) => {
    if (line === "---") {
      return `${C.darkSlate}├${"─".repeat(width - 2)}┤${C.reset}`;
    }
    return `${C.darkSlate}│${C.reset} ${padEndVisible(truncateVisible(line, innerWidth), innerWidth)} ${C.darkSlate}│${C.reset}`;
  });

  return [topBorder, ...body, bottomBorder].join("\n");
}

// ─── Selector Interactivo Nativo (Sin Duplicaciones ni Fallos de Cursor) ────
function selectMenu(message, choices, initial = 0) {
  return new Promise((resolve) => {
    let cursor = Math.max(0, Math.min(choices.length - 1, initial));
    let lastRenderCount = 0;
    const termWidth = getTermWidth();

    function render() {
      const lines = [];
      lines.push(`${C.bold}${C.cyan}? ${message}${C.reset} ${C.slate}(Usa ↑/↓ o 1-${choices.length})${C.reset}`);

      choices.forEach((c, idx) => {
        const isSel = idx === cursor;
        const numStr = `[${idx + 1}]`;
        const prefix = isSel ? `${C.cyan}${C.bold}❯ ${numStr}${C.reset} ` : `${C.darkSlate}  ${numStr}${C.reset} `;
        const titleText = isSel ? `${C.cyan}${C.bold}${c.title}${C.reset}` : `${C.white}${c.title}${C.reset}`;
        lines.push(prefix + titleText);
      });

      let out = "";
      if (lastRenderCount > 0) {
        out += `\x1b[${lastRenderCount}A`;
      }
      for (const line of lines) {
        // Aseguramos que la línea NUNCA sobrepase el ancho del terminal para prevenir wrap/duplicación
        out += `\r\x1b[2K${line}\n`;
      }
      process.stdout.write(out);
      lastRenderCount = lines.length;
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    readline.emitKeypressEvents(process.stdin);

    render();

    function onKeypress(str, key) {
      if (!key) return;

      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        process.stdout.write(`\n${C.amber}Operación cancelada.${C.reset}\n`);
        process.exit(130);
      }

      if (key.name === "up") {
        cursor = (cursor - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === "down") {
        cursor = (cursor + 1) % choices.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        // Borrar el menú y dejar una línea limpia de confirmación
        let clearStr = `\x1b[${lastRenderCount}A`;
        for (let i = 0; i < lastRenderCount; i++) clearStr += `\r\x1b[2K\n`;
        clearStr += `\x1b[${lastRenderCount}A`;
        process.stdout.write(clearStr);
        process.stdout.write(
          `${C.sage}✔${C.reset} ${C.slate}${message}:${C.reset} ${C.bold}${C.white}${choices[cursor].title}${C.reset}\n`
        );
        resolve(choices[cursor].value);
      } else if (/^[1-9]$/.test(str)) {
        const num = parseInt(str, 10) - 1;
        if (num >= 0 && num < choices.length) {
          cursor = num;
          render();
        }
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

function askText(message, initial = "", validate = null) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const promptMsg = `${C.bold}${C.cyan}? ${message}${C.reset} ${initial ? `${C.slate}[${initial}]${C.reset} ` : ""}`;
    rl.question(promptMsg, (answer) => {
      rl.close();
      const val = answer.trim() || initial;
      if (validate) {
        const check = validate(val);
        if (check !== true) {
          console.log(`${C.coral}✖ ${typeof check === "string" ? check : "Valor inválido"}${C.reset}`);
          return askText(message, initial, validate).then(resolve);
        }
      }
      resolve(val);
    });
  });
}

function askConfirm(message, defaultVal = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const opts = defaultVal ? "S/n" : "s/N";
    rl.question(`${C.bold}${C.cyan}? ${message}${C.reset} ${C.slate}[${opts}]${C.reset} `, (ans) => {
      rl.close();
      const clean = ans.trim().toLowerCase();
      if (!clean) return resolve(defaultVal);
      if (clean === "s" || clean === "si" || clean === "y" || clean === "yes") return resolve(true);
      return resolve(false);
    });
  });
}

// ─── Detección de Episodios ya Descargados en Disco ─────────────────────────
function extractSlugFromAnimeUrl(animeUrl) {
  try {
    const parts = new URL(animeUrl).pathname.split("/").filter(Boolean);
    return (parts[parts.length - 1] || "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function scanDownloadedEpisodes(animeUrl, downloadsDir) {
  const downloaded = new Set();
  try {
    if (!fs.existsSync(downloadsDir)) return downloaded;
    const slug = extractSlugFromAnimeUrl(animeUrl);
    const files = fs.readdirSync(downloadsDir);

    for (const file of files) {
      const lower = file.toLowerCase();
      if (slug && !lower.startsWith(slug)) continue;
      const match = lower.match(/-ep(\d+)-/);
      if (match && match[1]) {
        const epNum = parseInt(match[1], 10);
        const fullPath = path.join(downloadsDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 512 * 1024) {
            downloaded.add(epNum);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return downloaded;
}

// ─── Motor TUI Estático para Descargas en Cola ──────────────────────────────
async function runBatchTui({
  animeTitle,
  source,
  variant,
  episodes,
  concurrency,
  maxRetries,
  downloadsDir,
}) {
  const totalTasks = episodes.length;
  const startTime = Date.now();
  const recentLogs = [];

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const captureLog = (...args) => {
    const text = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .replace(/\r?\n/g, " ")
      .trim();
    if (!text) return;
    recentLogs.push({ time: new Date().toLocaleTimeString("es-CL", { hour12: false }), text });
    if (recentLogs.length > 4) recentLogs.shift();
  };

  console.log = captureLog;
  console.warn = captureLog;
  console.error = captureLog;

  const tasks = episodes.map((ep) => ({
    episode: ep.number,
    url: ep.url,
    status: "queued",
    progress: 0,
    attempts: 0,
    downloadId: null,
    server: "—",
    downloadedBytes: 0,
    totalBytes: null,
    speedBps: 0,
    lastBytes: 0,
    lastSpeedCheck: Date.now(),
    fileName: null,
    error: null,
  }));

  const activeSlots = new Array(concurrency).fill(null);
  let queueIndex = 0;
  let renderedLineCount = 0;
  let isFinished = false;

  process.stdout.write("\x1b[?25l");

  const cleanupTui = () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    process.stdout.write("\x1b[?25h");
  };

  const onSigInt = () => {
    cleanupTui();
    process.stdout.write("\n\n" + C.amber + "⚠ Descarga interrumpida por el usuario (Ctrl+C)." + C.reset + "\n");
    process.exit(130);
  };
  process.once("SIGINT", onSigInt);

  function startNextInSlot(slotIdx) {
    if (queueIndex >= tasks.length) {
      activeSlots[slotIdx] = null;
      return;
    }
    const task = tasks[queueIndex++];
    activeSlots[slotIdx] = task;
    launchTaskAttempt(task);
  }

  function launchTaskAttempt(task) {
    task.attempts += 1;
    task.status = "running";
    task.progress = 0;
    task.downloadedBytes = 0;
    task.totalBytes = null;
    task.speedBps = 0;
    task.lastBytes = 0;
    task.lastSpeedCheck = Date.now();
    task.error = null;

    try {
      const res = downloadService.createDownload(
        { url: task.url, quality: "1080p", variant },
        "http://localhost"
      );
      task.downloadId = res.downloadId;
    } catch (err) {
      task.status = "failed";
      task.error = err.message || "Error al iniciar";
    }
  }

  for (let i = 0; i < concurrency; i++) {
    startNextInSlot(i);
  }

  function buildDashboardFrame() {
    const width = Math.min(74, getTermWidth());
    const completedTasks = tasks.filter((t) => t.status === "completed");
    const failedTasks = tasks.filter((t) => t.status === "failed");
    const runningTasks = tasks.filter((t) => t.status === "running");
    const queuedCount = tasks.filter((t) => t.status === "queued").length;

    const sumProgress = tasks.reduce((acc, t) => {
      if (t.status === "completed") return acc + 100;
      if (t.status === "running") return acc + (t.progress || 0);
      return acc;
    }, 0);
    const globalPct = totalTasks > 0 ? Math.floor(sumProgress / totalTasks) : 0;

    const totalSpeed = runningTasks.reduce((acc, t) => acc + (t.speedBps || 0), 0);
    const elapsed = formatDuration(Date.now() - startTime);

    const lines = [];

    // 1. Encabezado
    lines.push(
      `${C.bold}${C.white}${truncateVisible(animeTitle, 38)}${C.reset}  ` +
      `${C.lavender}[${source} · ${variant}]${C.reset}`
    );
    lines.push(
      `${C.slate}Workers:${C.reset} ${concurrency}  ` +
      `${C.slate}Tiempo:${C.reset} ${elapsed}  ` +
      `${C.slate}Velocidad:${C.reset} ${C.steel}${C.bold}${formatSpeed(totalSpeed)}${C.reset}`
    );
    lines.push("---");

    // 2. Progreso Global
    const globalBar = renderBar(globalPct, Math.max(16, width - 42), C.sage);
    lines.push(
      `${C.bold}Total${C.reset}  ${globalBar} ${C.bold}${C.white}${globalPct.toString().padStart(3, " ")}%${C.reset}`
    );
    lines.push(
      `${C.sage}✔ ${completedTasks.length}/${totalTasks}${C.reset}  ` +
      `${C.steel}▶ ${runningTasks.length} activos${C.reset}  ` +
      `${C.slate}⏳ ${queuedCount} cola${C.reset}  ` +
      `${failedTasks.length > 0 ? C.coral : C.slate}✖ ${failedTasks.length} fallos${C.reset}`
    );
    lines.push("---");

    // 3. Workers Activos
    lines.push(`${C.bold}${C.cyan}Descargas en curso:${C.reset}`);
    for (let i = 0; i < concurrency; i++) {
      const t = activeSlots[i];
      if (!t) {
        lines.push(`${C.darkSlate}  [Worker #${i + 1}]  ─ Inactivo ─${C.reset}`);
        continue;
      }

      const epLabel = `${C.bold}${C.white}Ep ${t.episode.toString().padStart(3, "0")}${C.reset}`;
      const bar = renderBar(t.progress, 14, t.progress > 0 ? C.steel : C.amber);
      const pctStr = `${(t.progress || 0).toString().padStart(3, " ")}%`;
      const srvName = truncateVisible(t.server || "Prep", 6).padEnd(6, " ");

      let sizeInfo = "";
      if (t.downloadedBytes > 0) {
        sizeInfo = `${formatBytes(t.downloadedBytes)} · ${formatSpeed(t.speedBps)}`;
      } else {
        sizeInfo = `${C.amber}Conectando...${C.reset}`;
      }

      lines.push(`  ${epLabel} ${bar} ${pctStr} ${C.lavender}[${srvName}]${C.reset} ${sizeInfo}`);
    }

    lines.push("---");

    // 4. Historial y Logs
    const doneNums = completedTasks.map((t) => t.episode);
    lines.push(`${C.sage}✔ Listos:${C.reset} ${C.white}${truncateVisible(formatEpisodeRanges(doneNums), width - 14)}${C.reset}`);

    const lastLog = recentLogs[recentLogs.length - 1];
    const logLine = lastLog
      ? `${C.darkSlate}⚙ [${lastLog.time}] ${truncateVisible(lastLog.text, width - 16)}${C.reset}`
      : `${C.darkSlate}⚙ Motor en ejecución...${C.reset}`;
    lines.push(logLine);

    return drawBox("Anime1v Downloader TUI · Live", lines, width);
  }

  function renderFrame() {
    const frame = buildDashboardFrame();
    const frameLines = frame.split("\n");

    let out = "";
    if (renderedLineCount > 0) {
      out += `\x1b[${renderedLineCount}A`;
    }
    for (const line of frameLines) {
      out += `\r\x1b[2K${line}\n`;
    }
    process.stdout.write(out);
    renderedLineCount = frameLines.length;
  }

  renderFrame();

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = Date.now();

      for (let i = 0; i < concurrency; i++) {
        const task = activeSlots[i];
        if (!task) continue;

        if (task.status === "failed") {
          if (task.attempts <= maxRetries) {
            captureLog(`Reintentando Ep ${task.episode} (intento ${task.attempts + 1})...`);
            launchTaskAttempt(task);
          } else {
            startNextInSlot(i);
          }
          continue;
        }

        try {
          const stats = downloadService.getDownload(task.downloadId);
          task.progress = stats.progress || 0;
          task.server = stats.currentServer || (stats.status === "preparing" ? "Prep" : "Buscando");
          task.downloadedBytes = stats.downloadedBytes || 0;
          task.totalBytes = stats.totalBytes || null;

          const dt = (now - task.lastSpeedCheck) / 1000;
          if (dt >= 0.8 && task.downloadedBytes >= task.lastBytes) {
            const deltaBytes = task.downloadedBytes - task.lastBytes;
            const instantSpeed = deltaBytes / dt;
            task.speedBps = task.speedBps > 0 ? task.speedBps * 0.4 + instantSpeed * 0.6 : instantSpeed;
            task.lastBytes = task.downloadedBytes;
            task.lastSpeedCheck = now;
          }

          if (stats.status === "completed") {
            task.status = "completed";
            task.progress = 100;
            task.speedBps = 0;
            task.fileName = stats.downloadUrl ? stats.downloadUrl.split("/").pop() : null;
            captureLog(`Ep ${task.episode} completado`);
            startNextInSlot(i);
          } else if (stats.status === "failed") {
            if (task.attempts <= maxRetries) {
              captureLog(`Fallo Ep ${task.episode}, reintentando...`);
              launchTaskAttempt(task);
            } else {
              task.status = "failed";
              task.speedBps = 0;
              task.error = stats.error || "Error desconocido";
              captureLog(`Ep ${task.episode} falló: ${task.error}`);
              startNextInSlot(i);
            }
          }
        } catch (err) {
          task.status = "failed";
          task.error = err.message;
          startNextInSlot(i);
        }
      }

      renderFrame();

      const allFinished = tasks.every((t) => t.status === "completed" || t.status === "failed");
      if (allFinished && !isFinished) {
        isFinished = true;
        clearInterval(timer);
        process.removeListener("SIGINT", onSigInt);
        cleanupTui();
        resolve({
          tasks,
          elapsedMs: Date.now() - startTime,
          downloadsDir,
        });
      }
    }, 400);
  });
}

// ─── Flujo Principal ────────────────────────────────────────────────────────
async function main() {
  const _0xfxx = "\x1b[36m[Creado y Mantenido por FxxMorgan - https://github.com/FxxMorgan/]\x1b[0m";

  console.clear();
  console.log(
    drawBox(
      "ANIME1V DOWNLOADER ENGINE · TUI v3.1",
      [
        `${C.bold}${C.white}Motor Multi-Proveedor de Descarga Directa y Streaming HLS${C.reset}`,
        _0xfxx,
      ]
    )
  );
  console.log();

  const downloadsDir = downloadService.getDownloadsDir();

  // 1. Modo de búsqueda
  const mode = await selectMenu("¿Cómo deseas localizar el anime?", [
    { title: "Pegar enlace del anime (lista completa de episodios)", value: "anime" },
    { title: "Buscar anime por nombre en un proveedor", value: "search" },
    { title: "Descargar un único episodio por enlace directo", value: "direct" },
  ]);

  // Modo directo
  if (mode === "direct") {
    const url = await askText("Enlace del episodio (ej: https://animeav1.com/media/serie/1):", "", (v) =>
      v && v.length > 8 ? true : "Ingresa una URL válida"
    );

    console.log();
    const summary = await runBatchTui({
      animeTitle: "Descarga Directa Individual",
      source: "Directo",
      variant: "SUB",
      episodes: [{ number: 1, url }],
      concurrency: 1,
      maxRetries: 1,
      downloadsDir,
    });
    printFinalReport(summary);
    return;
  }

  let animeUrl = "";
  let query = "";
  let providerDomain = "animeav1.com";

  if (mode === "anime") {
    query = await askText(
      "Pega el enlace del anime (ej: https://animeav1.com/media/jojo-no-kimyou-na-bouken-tv):",
      "",
      (v) => (v && v.length > 8 ? true : "URL demasiado corta")
    );
  } else {
    providerDomain = await selectMenu("Selecciona el proveedor de búsqueda:", PROVIDERS);
    query = await askText("Nombre del anime a buscar:", "", (v) =>
      v && v.length >= 2 ? true : "Ingresa al menos 2 caracteres"
    );
  }

  const isLink =
    query.startsWith("http://") ||
    query.startsWith("https://") ||
    Object.keys(PROVIDER_DOMAINS).some((d) => query.includes(d));

  if (isLink) {
    animeUrl = query.startsWith("http") ? query : `https://${query}`;
  } else {
    process.stdout.write(`\n${C.steel}⏳ Buscando "${query}" en ${providerDomain}...${C.reset}\n`);
    const searchResult = await animeService.searchAnime(query, providerDomain);

    if (!searchResult.data.results || searchResult.data.results.length === 0) {
      console.log(`${C.coral}✖ No se encontraron resultados en este proveedor.${C.reset}`);
      return;
    }

    const choices = searchResult.data.results.slice(0, 15).map((anime) => ({
      title: `${anime.title} ${anime.type ? `(${anime.type})` : ""}`,
      value: anime.url,
    }));

    animeUrl = await selectMenu("Selecciona el anime deseado:", choices);
  }

  // 2. Info y escaneo en disco
  process.stdout.write(`\n${C.steel}⏳ Obteniendo información del anime y episodios...${C.reset}\n`);
  const info = await animeService.getAnimeInfo(animeUrl);

  if (!info.data.episodes || info.data.episodes.length === 0) {
    console.log(`${C.coral}✖ No se encontraron episodios disponibles para este anime.${C.reset}`);
    return;
  }

  const episodes = info.data.episodes.sort((a, b) => a.number - b.number);
  const source = PROVIDER_DOMAINS[new URL(animeUrl).hostname] || info.source || "AnimeAV1";
  const alreadyDownloaded = scanDownloadedEpisodes(animeUrl, downloadsDir);
  const missingEpisodes = episodes.filter((ep) => !alreadyDownloaded.has(ep.number));

  const cardLines = [
    `${C.bold}${C.white}${info.data.title || "Anime"}${C.reset}  ${C.lavender}[${source}]${C.reset}`,
    `${C.slate}URL:${C.reset}        ${truncateVisible(animeUrl, 56)}`,
    `${C.slate}Episodios:${C.reset}  ${C.white}${episodes.length} totales${C.reset} (Ep ${episodes[0]?.number} al ${episodes[episodes.length - 1]?.number})`,
  ];

  if (alreadyDownloaded.size > 0) {
    cardLines.push(
      `${C.slate}En disco:${C.reset}   ${C.sage}${alreadyDownloaded.size} descargados${C.reset} (${truncateVisible(formatEpisodeRanges([...alreadyDownloaded]), 40)})`
    );
    if (missingEpisodes.length > 0) {
      cardLines.push(
        `${C.slate}Faltantes:${C.reset}  ${C.amber}${C.bold}${missingEpisodes.length} pendientes${C.reset} (${C.amber}${truncateVisible(formatEpisodeRanges(missingEpisodes.map((e) => e.number)), 40)}${C.reset})`
      );
    } else {
      cardLines.push(`${C.slate}Estado:${C.reset}     ${C.sage}✔ Serie completa ya en tu carpeta local${C.reset}`);
    }
  }

  if (info.data.description) {
    cardLines.push("---");
    cardLines.push(`${C.dim}${truncateVisible(info.data.description.replace(/\s+/g, " "), 68)}${C.reset}`);
  }

  console.log("\n" + drawBox("Ficha del Anime", cardLines) + "\n");

  // 3. Selección de episodios
  let episodesToDownload = [];

  if (alreadyDownloaded.size > 0 && missingEpisodes.length > 0) {
    const missingRangeStr = formatEpisodeRanges(missingEpisodes.map((e) => e.number));
    const sel = await selectMenu("Episodios a descargar:", [
      {
        title: `Descargar solo los ${missingEpisodes.length} faltantes (${missingRangeStr})`,
        value: "missing",
      },
      {
        title: `Especificar rango o lista personalizada (ej: 2, 5, 9, 22-25)`,
        value: "custom",
      },
      {
        title: `Descargar todos los ${episodes.length} episodios de nuevo`,
        value: "all",
      },
    ]);

    if (sel === "missing") {
      episodesToDownload = missingEpisodes;
    } else if (sel === "all") {
      episodesToDownload = episodes;
    }
  } else {
    const sel = await selectMenu("Episodios a descargar:", [
      { title: `Todos los episodios (${episodes.length} episodios)`, value: "all" },
      { title: `Seleccionar rango o episodios específicos (ej: 1, 3, 5-8)`, value: "custom" },
    ]);
    if (sel === "all") {
      episodesToDownload = episodes;
    }
  }

  if (episodesToDownload.length === 0) {
    const defaultRange =
      missingEpisodes.length > 0 && missingEpisodes.length < episodes.length
        ? formatEpisodeRanges(missingEpisodes.map((e) => e.number))
        : "todos";

    const targetEpisodes = await askText(
      "Escribe los episodios (ej: 2, 5, 9, 22-25 o 'todos'):",
      defaultRange
    );

    const inputCmd = targetEpisodes.trim().toLowerCase();
    if (inputCmd === "todos" || inputCmd === "all") {
      episodesToDownload = episodes;
    } else {
      const nums = new Set();
      const parts = inputCmd.replace(/[{}[\]]/g, "").split(",");
      for (const part of parts) {
        const rangeMatch = part.match(/(\d+)[-:](\d+)/);
        if (rangeMatch) {
          const a = parseInt(rangeMatch[1], 10);
          const b = parseInt(rangeMatch[2], 10);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nums.add(i);
        } else {
          const num = Number(part.trim());
          if (!Number.isNaN(num)) nums.add(num);
        }
      }
      episodesToDownload = episodes.filter((ep) => nums.has(ep.number));
    }
  }

  if (episodesToDownload.length === 0) {
    console.log(`${C.coral}✖ Ningún episodio válido seleccionado.${C.reset}`);
    return;
  }

  // 4. Variante de idioma y workers
  const variant = await selectMenu("Variante de audio:", [
    { title: "SUB (Audio Japonés con Subtítulos en Español)", value: "SUB" },
    { title: "DUB (Audio en Español Latino)", value: "DUB" },
  ]);

  const concurrency = await selectMenu("Descargas simultáneas (Workers):", [
    { title: "3 workers (Recomendado · Descarga rápida y estable)", value: 3 },
    { title: "2 workers (Conservador · Para conexiones compartidas)", value: 2 },
    { title: "4 workers (Máxima velocidad en fibra óptica)", value: 4 },
    { title: "1 worker  (Descarga secuencial estricta)", value: 1 },
  ]);

  // 5. Confirmación final
  const selectedNums = episodesToDownload.map((e) => e.number);
  console.log(
    "\n" +
      drawBox("Resumen de Cola", [
        `${C.slate}Anime:${C.reset}         ${C.bold}${C.white}${truncateVisible(info.data.title || "Anime", 52)}${C.reset}`,
        `${C.slate}Episodios (${selectedNums.length}):${C.reset} ${C.cyan}${truncateVisible(formatEpisodeRanges(selectedNums), 52)}${C.reset}`,
        `${C.slate}Idioma:${C.reset}        ${variant} · 1080p HD`,
        `${C.slate}Workers:${C.reset}       ${concurrency} descargas en simultáneo`,
        `${C.slate}Destino:${C.reset}       ${truncateVisible(downloadsDir, 54)}`,
      ]) +
      "\n"
  );

  const confirm = await askConfirm("¿Iniciar cola de descargas ahora?", true);
  if (!confirm) return console.log(`\n${C.amber}Operación cancelada.${C.reset}\n`);

  console.log();

  // 6. Lanzar TUI
  const summary = await runBatchTui({
    animeTitle: info.data.title || "Anime",
    source,
    variant,
    episodes: episodesToDownload,
    concurrency: Math.min(concurrency, episodesToDownload.length),
    maxRetries: 1,
    downloadsDir,
  });

  printFinalReport(summary);
}

function printFinalReport({ tasks, elapsedMs, downloadsDir }) {
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const totalBytes = completed.reduce((acc, t) => acc + (t.downloadedBytes || 0), 0);

  const reportLines = [
    `${C.sage}✔ Completados:${C.reset} ${C.bold}${C.white}${completed.length} de ${tasks.length}${C.reset} episodios`,
    `${C.slate}⏱ Tiempo total:${C.reset} ${formatDuration(elapsedMs)}   ·   ${C.slate}Transferido:${C.reset} ${C.steel}${formatBytes(totalBytes)}${C.reset}`,
    `${C.slate}📂 Carpeta:${C.reset}      ${truncateVisible(downloadsDir, 56)}`,
  ];

  if (failed.length > 0) {
    const failedNums = failed.map((f) => f.episode);
    reportLines.push("---");
    reportLines.push(
      `${C.coral}${C.bold}✖ Fallidos (${failed.length}):${C.reset} ${C.amber}${formatEpisodeRanges(failedNums)}${C.reset}`
    );
    for (const f of failed.slice(0, 5)) {
      reportLines.push(
        `  ${C.coral}• Ep ${f.episode.toString().padStart(3, "0")}:${C.reset} ${C.slate}${truncateVisible(f.error || "Fallo de red", 54)}${C.reset}`
      );
    }
    reportLines.push("---");
    reportLines.push(
      `${C.cyan}💡 Tip:${C.reset} Al volver a ejecutar ${C.bold}node descargador.js${C.reset}, detectará los faltantes automáticamente.`
    );
  } else {
    reportLines.push("---");
    reportLines.push(`${C.sage}${C.bold}✨ ¡Todos los episodios se completaron exitosamente!${C.reset}`);
  }

  console.log("\n" + drawBox("Reporte Final de Descarga", reportLines) + "\n");
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h");
  console.error(`\n${C.coral}✖ Error inesperado:${C.reset}`, err.message);
  process.exit(1);
});
