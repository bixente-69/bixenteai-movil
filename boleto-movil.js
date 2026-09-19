"use strict";

const SIGNS = ["1", "X", "2"];
// SELAE solo ofrece 4 casillas reales en el Pleno al 15: 0, 1, 2 o M (3 o más goles).
const GOAL_SIGNS = ["0", "1", "2", "M"];
const LIVE_SCORE_LEAGUES = ["esp.1", "esp.2", "esp.w.1", "uefa.champions"];
const LIVE_SCORE_REFRESH_MS = 60_000;

let liveScoreRefreshTimer = null;
let liveScoreRefreshInFlight = false;
let activeLiveScoreDate = null;

const elements = {
  title: document.querySelector("#boletoTitle"),
  closing: document.querySelector("#boletoClosing"),
  status: document.querySelector("#boletoStatus"),
  content: document.querySelector("#boletoContent"),
  legend: document.querySelector("#boletoLegend"),
  matches: document.querySelector("#boletoMatches"),
  printButton: document.querySelector("#boletoPrintButton"),
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatLiveScoreDate(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeLiveScoreTeamName(value) {
  return String(value || "")
    .replace(/\s*\([mf]\)\s*$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function liveScoreTeamNamesIncludeEachOther(left, right) {
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function liveScoreFromCompetitor(competitor) {
  const score = String(competitor?.score ?? "").trim();
  return /^\d+$/.test(score) ? Number(score) : null;
}

function liveScoreTeamName(competitor) {
  const name = competitor?.team?.displayName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function extractLiveScoreMatches(payload, league) {
  const matches = [];
  const events = Array.isArray(payload?.events) ? payload.events : [];

  for (const event of events) {
    const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const statusType = competition?.status?.type;
    const state = statusType?.state;
    if (state !== "in" && state !== "post") {
      continue;
    }

    const competitors = Array.isArray(competition?.competitors)
      ? competition.competitors
      : [];
    const home = competitors.find((competitor) => competitor?.homeAway === "home");
    const away = competitors.find((competitor) => competitor?.homeAway === "away");
    const homeName = liveScoreTeamName(home);
    const awayName = liveScoreTeamName(away);
    const homeScore = liveScoreFromCompetitor(home);
    const awayScore = liveScoreFromCompetitor(away);
    if (!homeName || !awayName || homeScore === null || awayScore === null) {
      continue;
    }

    matches.push({
      homeName,
      awayName,
      homeScore,
      awayScore,
      state,
      completed: Boolean(statusType?.completed),
      league,
    });
  }
  return matches;
}

async function requestLiveScoreLeague(league, dateKey) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dateKey}`;
  const response = await globalThis["fetch"](
    url,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`ESPN respondió con código ${response.status}`);
  }
  return extractLiveScoreMatches(await response.json(), league);
}

async function requestLiveScores(dateKey) {
  const results = await Promise.allSettled(
    LIVE_SCORE_LEAGUES.map((league) => requestLiveScoreLeague(league, dateKey)),
  );
  const matches = [];
  const successfulLeagues = new Set();
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      return;
    }
    successfulLeagues.add(LIVE_SCORE_LEAGUES[index]);
    matches.push(...result.value);
  });
  return { matches, successfulLeagues };
}

function findLiveScoreMatch(homeName, awayName, scoreboardMatches) {
  const normalizedHome = normalizeLiveScoreTeamName(homeName);
  const normalizedAway = normalizeLiveScoreTeamName(awayName);
  if (!normalizedHome || !normalizedAway) {
    return null;
  }

  const normalizedMatches = scoreboardMatches.map((match) => ({
    match,
    home: normalizeLiveScoreTeamName(match.homeName),
    away: normalizeLiveScoreTeamName(match.awayName),
  }));
  const exactMatches = normalizedMatches.filter(
    (candidate) => candidate.home === normalizedHome && candidate.away === normalizedAway,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0].match;
  }

  const includedMatches = normalizedMatches.filter(
    (candidate) => liveScoreTeamNamesIncludeEachOther(candidate.home, normalizedHome)
      && liveScoreTeamNamesIncludeEachOther(candidate.away, normalizedAway),
  );
  return includedMatches.length === 1 ? includedMatches[0].match : null;
}

function createLiveScoreBadge(match) {
  const badge = createElement("span", "boleto-live-score");
  badge.hidden = true;
  badge.dataset.homeTeam = match.local;
  badge.dataset.awayTeam = match.visitante;
  badge.setAttribute("aria-live", "polite");
  return badge;
}

function clearLiveScoreBadge(badge) {
  badge.hidden = true;
  badge.textContent = "";
  badge.removeAttribute("aria-label");
  delete badge.dataset.liveLeague;
}

function clearLiveScoreBadges() {
  elements.matches.querySelectorAll(".boleto-live-score").forEach(clearLiveScoreBadge);
}

function renderLiveScoreBadges(scoreboardMatches, successfulLeagues) {
  const badges = elements.matches.querySelectorAll(".boleto-live-score");
  for (const badge of badges) {
    const match = findLiveScoreMatch(
      badge.dataset.homeTeam,
      badge.dataset.awayTeam,
      scoreboardMatches,
    );
    if (!match) {
      if (!badge.dataset.liveLeague || successfulLeagues.has(badge.dataset.liveLeague)) {
        clearLiveScoreBadge(badge);
      }
      continue;
    }

    const phase = match.state === "in" && !match.completed ? "en juego" : "final";
    const label = `${match.homeScore}-${match.awayScore} · ${phase}`;
    badge.textContent = label;
    badge.dataset.liveLeague = match.league;
    badge.setAttribute(
      "aria-label",
      `Marcador: ${match.homeName} ${match.homeScore}, ${match.awayName} ${match.awayScore}; ${phase}`,
    );
    badge.hidden = false;
  }
}

async function refreshLiveScores() {
  if (document.visibilityState !== "visible" || liveScoreRefreshInFlight) {
    return;
  }
  liveScoreRefreshInFlight = true;
  try {
    const dateKey = formatLiveScoreDate();
    if (activeLiveScoreDate !== dateKey) {
      clearLiveScoreBadges();
      activeLiveScoreDate = dateKey;
    }
    const { matches, successfulLeagues } = await requestLiveScores(dateKey);
    renderLiveScoreBadges(matches, successfulLeagues);
  } catch {
    // Los marcadores son opcionales: cualquier fallo debe dejar intacto el boleto.
  } finally {
    liveScoreRefreshInFlight = false;
  }
}

function stopLiveScoreRefresh() {
  if (liveScoreRefreshTimer !== null) {
    window.clearInterval(liveScoreRefreshTimer);
    liveScoreRefreshTimer = null;
  }
}

function startLiveScoreRefresh() {
  stopLiveScoreRefresh();
  if (document.visibilityState !== "visible") {
    return;
  }
  void refreshLiveScores();
  liveScoreRefreshTimer = window.setInterval(
    () => void refreshLiveScores(),
    LIVE_SCORE_REFRESH_MS,
  );
}

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseApiDateTime(value) {
  const text = String(value || "").trim().replace(/\\\//g, "/");
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:([+-])(\d{2}):(\d{2}))?$/.exec(text);
  if (!match) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, year, month, day, hour = "0", minute = "0", second = "0", sign, offsetHour, offsetMinute] = match;
  if (sign && offsetHour && offsetMinute) {
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHour}:${offsetMinute}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function formatDate(value, includeTime = false) {
  const parsed = parseDateOnly(value) || parseApiDateTime(value);
  if (!parsed) {
    return value ? String(value) : "Fecha no disponible";
  }
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(parsed);
}

async function readResponse(response) {
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? payload.detail : payload;
    const error = new Error(
      typeof detail === "string"
        ? detail
        : `No se pudo completar la consulta (código ${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showEmpty(message) {
  stopLiveScoreRefresh();
  elements.content.hidden = true;
  elements.status.replaceChildren(
    createElement("strong", "", message),
    createElement(
      "p",
      "",
      "Vuelve al pronóstico principal para elegir una jornada que ya esté guardada.",
    ),
  );
  const backLink = createElement("a", "boleto-empty-link", "← Volver al pronóstico");
  backLink.href = "/";
  elements.status.append(backLink);
  elements.status.className = "boleto-status boleto-empty";
}

function recommendedSigns(match) {
  if (Array.isArray(match.signos_recomendados)) {
    return new Set(match.signos_recomendados.map(String));
  }
  return new Set(String(match.signos_recomendados || "").split(""));
}

function renderSignGroup(match) {
  const group = createElement("div", "sign-group boleto-sign-group");
  group.setAttribute("aria-label", `Pronóstico para ${match.local} contra ${match.visitante}`);
  const recommended = recommendedSigns(match);

  for (const sign of SIGNS) {
    const selected = recommended.has(sign);
    const cell = createElement("div", "sign-cell boleto-sign-cell");
    if (selected) {
      cell.classList.add("is-selected");
    }
    if (selected && match.es_doble) {
      cell.classList.add("is-double");
    }
    cell.setAttribute("aria-label", `${sign}${selected ? ", recomendado" : ""}`);
    cell.append(createElement("strong", "sign-label", sign));
    group.append(cell);
  }
  return group;
}

function renderTeams(match) {
  const teams = createElement("div", "boleto-teams");
  teams.append(
    createElement("span", "boleto-team boleto-team-home", match.local),
    createElement("span", "boleto-team boleto-team-away", match.visitante),
  );
  teams.append(createLiveScoreBadge(match));
  return teams;
}

function renderMineSignGroup(signos) {
  const group = createElement("div", "sign-group boleto-sign-group boleto-mine-group");
  group.setAttribute("aria-label", "Mi apuesta");
  const mine = new Set(signos);

  for (const sign of SIGNS) {
    const selected = mine.has(sign);
    const cell = createElement("div", "sign-cell boleto-sign-cell boleto-mine-cell");
    if (selected) {
      cell.classList.add("is-mine");
    }
    cell.setAttribute("aria-label", `${sign}${selected ? ", mi apuesta" : ""}`);
    cell.append(createElement("strong", "sign-label", sign));
    group.append(cell);
  }
  return group;
}

function renderStandardMatch(match, mineSignos) {
  const hasMine = Array.isArray(mineSignos) && mineSignos.length > 0;
  const row = createElement(
    "article",
    `match-row boleto-match-row${hasMine ? " has-mine" : ""}`,
  );
  row.append(
    createElement("span", "position-badge", String(match.posicion)),
    renderTeams(match),
    renderSignGroup(match),
  );
  if (hasMine) {
    row.append(renderMineSignGroup(mineSignos));
  }
  return row;
}

function mineSignsForPosition(manualBet, posicion) {
  const entry = manualBet?.partidos?.find(
    (candidate) => Number(candidate.posicion) === Number(posicion),
  );
  return Array.isArray(entry?.signos) ? entry.signos.map(String) : [];
}

function hasAnyManualBet(manualBet) {
  if (!manualBet) {
    return false;
  }
  const anySign = Array.isArray(manualBet.partidos)
    && manualBet.partidos.some(
      (entry) => Array.isArray(entry.signos) && entry.signos.length > 0,
    );
  return anySign || Boolean(manualBet.pleno15_marcador);
}

function goalSign(value) {
  const goals = Number(value);
  if (!Number.isInteger(goals) || goals < 0) {
    return null;
  }
  return goals >= 3 ? "M" : String(goals);
}

function plenoGoals(marcador) {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(marcador || ""));
  return match ? [goalSign(match[1]), goalSign(match[2])] : [null, null];
}

function renderGoalGroup(team, selectedSign, mine = false) {
  const group = createElement(
    "div",
    `sign-group boleto-goal-group${mine ? " boleto-mine-group" : ""}`,
  );
  group.setAttribute(
    "aria-label",
    mine ? `Mi apuesta de goles para ${team}` : `Goles pronosticados para ${team}`,
  );
  for (const sign of GOAL_SIGNS) {
    const selected = sign === selectedSign;
    const cell = createElement(
      "div",
      `sign-cell boleto-goal-cell${mine ? " boleto-mine-cell" : ""}`,
    );
    if (selected) {
      cell.classList.add(mine ? "is-mine" : "is-selected");
    }
    const goalsLabel = sign === "M" ? "tres o más" : sign;
    cell.setAttribute(
      "aria-label",
      `${goalsLabel} goles${selected ? (mine ? ", mi apuesta" : ", recomendado") : ""}`,
    );
    cell.append(createElement("strong", "sign-label", sign));
    group.append(cell);
  }
  return group;
}

function renderPlenoTeam(team, selectedSign, mineSign) {
  const row = createElement("div", "boleto-pleno-team-row");
  row.append(
    createElement("span", "boleto-pleno-team", team),
    renderGoalGroup(team, selectedSign),
  );
  if (mineSign) {
    row.append(renderGoalGroup(team, mineSign, true));
  }
  return row;
}

function mineGoalsFromCategory(marcador) {
  const match = /^\s*([012M])\s*-\s*([012M])\s*$/.exec(String(marcador || ""));
  return match ? [match[1], match[2]] : [null, null];
}

function renderPleno(match, pleno, mineMarcador) {
  const row = createElement("article", "match-row pleno-row boleto-match-row boleto-pleno-row");
  const badge = createElement("span", "position-badge", "15");
  const block = createElement("div", "boleto-pleno-content");
  block.append(createElement("span", "pleno-label", "Pleno al 15"));

  if (!pleno || pleno.disponible === false) {
    block.append(
      createElement(
        "p",
        "pleno-unavailable",
        pleno?.nota || "Pronóstico de marcador no disponible",
      ),
    );
  } else {
    const [homeGoals, awayGoals] = plenoGoals(pleno.marcador);
    const [mineHome, mineAway] = mineGoalsFromCategory(mineMarcador);
    block.append(
      renderPlenoTeam(match.local, homeGoals, mineHome),
      renderPlenoTeam(match.visitante, awayGoals, mineAway),
    );
  }

  row.append(badge, block);
  return row;
}

function renderJornada(jornada, manualBet) {
  const matches = Array.isArray(jornada.partidos)
    ? [...jornada.partidos].sort((left, right) => Number(left.posicion) - Number(right.posicion))
    : [];
  if (!matches.length) {
    showEmpty("La predicción guardada no contiene partidos.");
    return;
  }

  document.title = `Jornada ${jornada.jornada} · Boleto · BixenteAI 2026`;
  elements.title.textContent = `Jornada ${jornada.jornada} — ${formatDate(jornada.fecha_sorteo)}`;
  if (jornada.cierre_apuestas) {
    elements.closing.textContent = `Cierre de apuestas: ${formatDate(jornada.cierre_apuestas, true)}`;
    elements.closing.hidden = false;
  } else {
    elements.closing.hidden = true;
  }

  const showMine = hasAnyManualBet(manualBet);
  elements.legend.hidden = !showMine;

  elements.matches.replaceChildren();
  for (const match of matches) {
    const posicion = Number(match.posicion);
    if (posicion === 15) {
      elements.matches.append(
        renderPleno(match, jornada.pleno_al_15, showMine ? manualBet.pleno15_marcador : null),
      );
      continue;
    }
    const mineSigns = showMine ? mineSignsForPosition(manualBet, posicion) : [];
    elements.matches.append(renderStandardMatch(match, mineSigns));
  }
  elements.matches.setAttribute("aria-busy", "false");
  elements.status.remove();
  elements.content.hidden = false;
  startLiveScoreRefresh();
}

async function fetchManualBet(drawDate) {
  try {
    void drawDate;
    return window.__MI_APUESTA__ ?? null;
  } catch {
    return null;
  }
}

async function loadBoleto() {
  const drawDate = window.__JORNADA_DATA__?.prediccion_json?.fecha_sorteo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(drawDate || ""))) {
    showEmpty("No se ha indicado una fecha de sorteo válida.");
    return;
  }

  try {
    const payload = window.__JORNADA_DATA__;
    if (!payload?.prediccion_json || typeof payload.prediccion_json !== "object") {
      throw new Error("La predicción guardada no tiene un boleto válido.");
    }
    const manualBet = await fetchManualBet(drawDate);
    renderJornada(payload.prediccion_json, manualBet);
  } catch (error) {
    if (error?.status === 404) {
      showEmpty(`No hay ninguna predicción guardada para el sorteo del ${formatDate(drawDate)}.`);
      return;
    }
    showEmpty(error instanceof Error ? error.message : String(error));
  }
}

elements.printButton.addEventListener("click", () => window.print());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startLiveScoreRefresh();
  } else {
    stopLiveScoreRefresh();
  }
});
loadBoleto();
