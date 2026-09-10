"use strict";

const SIGNS = ["1", "X", "2"];
// SELAE solo ofrece 4 casillas reales en el Pleno al 15: 0, 1, 2 o M (3 o más goles).
const GOAL_SIGNS = ["0", "1", "2", "M"];

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
loadBoleto();
