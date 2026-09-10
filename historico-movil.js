"use strict";

const SIGNS = ["1", "X", "2"];
const FACTOR_COLOR_CLASSES = Object.freeze({
  gris: "factor-color-gris",
  verde: "factor-color-verde",
  verde_amarillo: "factor-color-verde-amarillo",
  amarillo: "factor-color-amarillo",
  naranja: "factor-color-naranja",
  rojo: "factor-color-rojo",
  rojo_intenso: "factor-color-rojo-intenso",
});

const elements = {
  status: document.querySelector("#historyStatus"),
  pageContent: document.querySelector("#historyPageContent"),
  summary: document.querySelector("#seasonSummary"),
  journeys: document.querySelector("#jornadasContent"),
  factorCallout: document.querySelector("#factorCallout"),
  factorsGrid: document.querySelector("#factorsGrid"),
  failureStatus: document.querySelector("#failureAnalysisStatus"),
  failureCategorySummary: document.querySelector("#failureCategorySummary"),
  failureTrendSummary: document.querySelector("#failureTrendSummary"),
  failureMatchesList: document.querySelector("#failureMatchesList"),
};

const FAILURE_CATEGORY_LABELS = Object.freeze({
  poisson_base_desencaminado: "Base Poisson desencaminada",
  senales_cualitativas_alejaron: "Señales cualitativas alejaron el signo",
  mercado_alejo: "El mercado alejó el signo",
  estaba_cerca: "Estaba cerca, pero no entró",
});

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

function formatDate(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return value ? String(value) : "Fecha no disponible";
  }
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function formatRate(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(number)}%`
    : "—";
}

function formatProbability(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("es-ES", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(number)
    : "—";
}

function numericText(value, fallback = 0) {
  const number = Number(value);
  return String(Number.isFinite(number) ? number : fallback);
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
    throw new Error(
      typeof detail === "string"
        ? detail
        : `No se pudo completar la consulta (código ${response.status})`,
    );
  }
  return payload;
}

function renderSummary(payload) {
  const summary = payload?.resumen || {};
  const journeys = Number(summary.jornadas_reconciliadas) || 0;
  const heading = createElement("div", "season-summary-heading");
  const title = createElement(
    "h2",
    "",
    payload?.temporada ? `Temporada ${payload.temporada}` : "Temporada sin jornadas reconciliadas",
  );
  title.id = "seasonSummaryTitle";
  heading.append(
    createElement("p", "eyebrow", "Resumen de temporada"),
    title,
    createElement(
      "p",
      "season-summary-copy",
      journeys === 1
        ? "Una jornada comprobada con sus resultados oficiales."
        : `${journeys} jornadas comprobadas con sus resultados oficiales.`,
    ),
  );

  const metrics = createElement("dl", "season-summary-metrics");
  for (const [label, value, className] of [
    ["Jornadas reconciliadas", numericText(summary.jornadas_reconciliadas), ""],
    [
      "Aciertos totales",
      `${numericText(summary.aciertos_totales)}/${numericText(summary.partidos_totales)}`,
      "",
    ],
    ["Porcentaje global", formatRate(summary.porcentaje_aciertos), "is-primary"],
  ]) {
    const metric = createElement("div", `season-summary-metric ${className}`.trim());
    metric.append(createElement("dt", "", label), createElement("dd", "", value));
    metrics.append(metric);
  }

  if (summary.mi_apuesta_resumen) {
    const mine = summary.mi_apuesta_resumen;
    const metric = createElement("div", "season-summary-metric");
    metric.append(
      createElement("dt", "", "Mis aciertos"),
      createElement(
        "dd",
        "",
        `${numericText(mine.aciertos_totales)}/${numericText(mine.partidos_totales)} (${formatRate(mine.porcentaje_aciertos)})`
      ),
    );
    metrics.append(metric);
  }

  elements.summary.replaceChildren(heading, metrics);
}

function createPrediction(match) {
  const prediction = createElement("div", "season-prediction");
  const sign = createElement("div", "sign-cell is-selected season-predicted-sign");
  sign.setAttribute(
    "aria-label",
    `Signo predicho: ${match.signo_predicho_estricto || "no disponible"}`,
  );
  sign.append(createElement("strong", "sign-label", match.signo_predicho_estricto || "—"));

  const probabilities = createElement("div", "season-probabilities");
  for (const candidate of SIGNS) {
    const item = createElement("span", "");
    item.append(
      createElement("strong", "", candidate),
      document.createTextNode(` ${formatProbability(match.probabilidades?.[candidate])}`),
    );
    probabilities.append(item);
  }
  prediction.append(sign, probabilities);
  return prediction;
}

function createResult(match) {
  const result = createElement("div", "season-real-result");
  result.append(
    createElement("strong", "season-real-score", match.marcador_real || "—"),
    createElement("span", "season-real-sign", `Signo ${match.signo_real || "—"}`),
  );
  return result;
}

function createVerdict(value) {
  const isEvaluated = value === true || value === false;
  const verdict = createElement(
    "span",
    `season-verdict ${value === true ? "is-hit" : value === false ? "is-miss" : "is-neutral"}`,
    value === true ? "✅" : value === false ? "❌" : "—",
  );
  verdict.setAttribute("aria-hidden", "true");
  const wrapper = createElement("span", "season-verdict-wrap");
  wrapper.setAttribute(
    "aria-label",
    value === true ? "Acierto" : value === false ? "Fallo" : "Sin evaluar",
  );
  wrapper.title = isEvaluated ? (value ? "Acierto" : "Fallo") : "Sin evaluar";
  wrapper.append(verdict);
  return wrapper;
}

function createStandardMatchRow(match) {
  const row = createElement("tr", "season-match-row");
  const matchCell = createElement("th", "season-match-cell");
  matchCell.scope = "row";
  matchCell.append(
    createElement("span", "season-match-position", String(match.posicion ?? "—")),
    createElement("span", "season-match-teams", `${match.local || "—"} – ${match.visitante || "—"}`),
  );
  const predictionCell = document.createElement("td");
  predictionCell.append(createPrediction(match));
  const resultCell = document.createElement("td");
  resultCell.append(createResult(match));
  const verdictCell = createElement("td", "season-verdict-cell");
  verdictCell.append(createVerdict(match.acierto_estricto));
  row.append(matchCell, predictionCell, resultCell, verdictCell);
  return row;
}

function createPlenoRow(match) {
  const row = createElement("tr", "season-match-row season-pleno-row");
  const matchCell = createElement("th", "season-match-cell");
  matchCell.scope = "row";
  const copy = createElement("span", "season-pleno-copy");
  copy.append(
    createElement("strong", "pleno-label", "Pleno al 15"),
    createElement("span", "season-match-teams", `${match.local || "—"} – ${match.visitante || "—"}`),
  );
  matchCell.append(createElement("span", "season-match-position", "15"), copy);

  const predictionCell = document.createElement("td");
  const predicted = createElement("div", "season-pleno-result");
  predicted.append(
    createElement("span", "season-result-label", "Marcador predicho"),
    createElement("strong", "season-pleno-score", match.marcador_predicho || "—"),
  );
  predictionCell.append(predicted);

  const resultCell = document.createElement("td");
  const actual = createElement("div", "season-pleno-result");
  actual.append(
    createElement("span", "season-result-label", "Marcador real"),
    createElement("strong", "season-real-score", match.marcador_real || "—"),
  );
  resultCell.append(actual);

  const verdictCell = createElement("td", "season-verdict-cell");
  verdictCell.append(createVerdict(match.acierto_estricto));
  row.append(matchCell, predictionCell, resultCell, verdictCell);
  return row;
}

function createJourneyTable(journey) {
  const wrapper = createElement("div", "history-table-wrap season-history-table-wrap");
  const table = createElement("table", "history-table season-history-table");
  const caption = createElement(
    "caption",
    "sr-only",
    `Resultados de la jornada ${journey.jornada}`,
  );
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of ["Partido", "Predicción", "Resultado real", "Evaluación"]) {
    const cell = createElement("th", "", heading);
    cell.scope = "col";
    if (heading === "Evaluación") {
      cell.className = "season-verdict-heading";
    }
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  const matches = Array.isArray(journey.partidos)
    ? [...journey.partidos].sort((left, right) => Number(left.posicion) - Number(right.posicion))
    : [];
  for (const match of matches) {
    body.append(Number(match.posicion) === 15 ? createPlenoRow(match) : createStandardMatchRow(match));
  }
  table.append(caption, head, body);
  wrapper.append(table);
  return wrapper;
}

function renderJourneys(payload) {
  elements.journeys.replaceChildren();
  const reconciled = Number(payload?.resumen?.jornadas_reconciliadas) || 0;
  if (reconciled === 0) {
    const empty = createElement("div", "season-empty-state");
    empty.append(
      createElement("strong", "", "Todavía no hay ninguna jornada reconciliada esta temporada"),
      createElement(
        "p",
        "",
        "Cuando se comprueben los resultados oficiales, cada jornada aparecerá aquí con sus 15 filas.",
      ),
    );
    elements.journeys.append(empty);
    return;
  }

  const journeys = Array.isArray(payload?.jornadas)
    ? [...payload.jornadas].sort((left, right) => {
        const byDate = String(right.fecha_sorteo || "").localeCompare(String(left.fecha_sorteo || ""));
        return byDate || Number(right.jornada) - Number(left.jornada);
      })
    : [];
  for (const journey of journeys) {
    const card = createElement("article", "season-journey-card");
    const heading = createElement("header", "season-journey-heading");
    heading.append(
      createElement("p", "eyebrow", `Jornada ${journey.jornada}`),
      createElement(
        "h3",
        "",
        `Jornada ${journey.jornada} — ${formatDate(journey.fecha_sorteo)}, ${numericText(journey.aciertos_estricto)}/14 (${formatRate(journey.porcentaje_estricto)})`,
      ),
    );
    const mine = journey.mi_apuesta;
    heading.append(
      createElement(
        "p",
        "season-journey-mine",
        mine
          ? `Mi apuesta: ${numericText(mine.aciertos)}/14 (${formatRate(mine.porcentaje)})`
          : "No marcaste una apuesta esta jornada",
      ),
    );
    card.append(heading, createJourneyTable(journey));
    elements.journeys.append(card);
  }
}

function factorColorClass(color) {
  return FACTOR_COLOR_CLASSES[color] || FACTOR_COLOR_CLASSES.gris;
}

function sortedFactors(analysis) {
  const factors = Array.isArray(analysis?.factores) ? [...analysis.factores] : [];
  return factors.sort((left, right) => {
    const leftIsGrey = left.color === "gris";
    const rightIsGrey = right.color === "gris";
    if (leftIsGrey !== rightIsGrey) {
      return leftIsGrey ? 1 : -1;
    }
    if (leftIsGrey) {
      return Number(left.numero) - Number(right.numero);
    }
    return Number(right.tasa_fallo) - Number(left.tasa_fallo)
      || Number(left.numero) - Number(right.numero);
  });
}

function renderFactorCallout(analysis) {
  const factor = analysis?.factor_mas_problematico;
  if (!factor) {
    elements.factorCallout.replaceChildren(
      createElement(
        "p",
        "factor-callout is-neutral",
        "Todavía no hay un factor con muestra suficiente (mínimo 3 evaluaciones) para señalarlo con claridad.",
      ),
    );
    return;
  }
  const callout = createElement("p", "factor-callout is-warning");
  callout.append(
    createElement("strong", "", `Factor a vigilar: ${factor.nombre}`),
    document.createTextNode(` — falla en el ${formatRate(factor.tasa_fallo)} de los casos evaluados.`),
  );
  elements.factorCallout.replaceChildren(callout);
}

function createFactorCard(factor) {
  const card = createElement(
    "article",
    `factor-card ${factorColorClass(factor.color)}`,
  );
  card.dataset.factorColor = String(factor.color || "gris");
  const heading = createElement("div", "factor-card-heading");
  heading.append(
    createElement("span", "factor-number", `Factor ${factor.numero ?? "—"}`),
    createElement("h3", "", factor.nombre || "Factor sin nombre"),
  );

  const stats = createElement("dl", "factor-stats");
  for (const [label, value] of [
    ["Evaluado", factor.n_evaluado],
    ["Acierto", factor.n_acierto],
    ["Fallo", factor.n_fallo],
  ]) {
    const item = document.createElement("div");
    item.append(
      createElement("dt", "", label),
      createElement("dd", "", numericText(value)),
    );
    stats.append(item);
  }

  const evaluated = Number(factor.n_evaluado) || 0;
  const rate = createElement(
    "p",
    "factor-rate",
    evaluated > 0 ? `Tasa de fallo: ${formatRate(factor.tasa_fallo)}` : "Sin evaluaciones todavía",
  );
  card.append(
    heading,
    stats,
    rate,
    createElement("p", "factor-note", factor.nota_color || "Sin nota de color disponible."),
  );
  return card;
}

function renderFactors(payload) {
  const analysis = payload?.analisis_factores || {};
  renderFactorCallout(analysis);
  elements.factorsGrid.replaceChildren();
  for (const factor of sortedFactors(analysis)) {
    elements.factorsGrid.append(createFactorCard(factor));
  }
}

function renderFailureCategorySummary(diagnostics) {
  elements.failureCategorySummary.replaceChildren();
  if (diagnostics.length === 0) {
    return;
  }
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    const category = String(diagnostic?.categoria || "");
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  for (const [category, count] of sorted) {
    const tile = createElement("div", `failure-category-tile failure-category-${category}`);
    tile.append(
      createElement("strong", "failure-category-count", String(count)),
      createElement(
        "span",
        "failure-category-label",
        FAILURE_CATEGORY_LABELS[category] || category || "Sin categoría",
      ),
    );
    elements.failureCategorySummary.append(tile);
  }
}

function renderFailureTrendSummary(estado, trend, signalAnalysis) {
  const section = elements.failureTrendSummary;
  section.replaceChildren();
  const trendAvailable = trend?.disponible === true;
  const signalsAvailable = signalAnalysis?.disponible === true;
  if (!trendAvailable && !signalsAvailable) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  if (trendAvailable) {
    const metrics = trend.metricas_agregadas || {};
    const block = createElement("div", "failure-trend-block");
    block.append(
      createElement("h3", "", "Tendencia agregada"),
      createElement(
        "p",
        "",
        `${numericText(metrics.jornadas)} jornadas · ${formatRate((Number(metrics.aciertos_por_14) || 0) * 100)} de aciertos de media.`,
      ),
    );
    section.append(block);
  }

  if (signalsAvailable && Array.isArray(signalAnalysis.senales)) {
    const block = createElement("div", "failure-trend-block");
    block.append(createElement("h3", "", "Análisis por señal cualitativa"));
    for (const signal of signalAnalysis.senales) {
      block.append(
        createElement(
          "p",
          signal?.hallazgo_estadisticamente_defendible ? "is-warning" : "",
          `${signal?.senal ?? "señal"}: ${signal?.hallazgo_estadisticamente_defendible ? "hallazgo defendible" : "sin patrón confirmado"}.`,
        ),
      );
    }
    section.append(block);
  } else if (estado?.codigo === "solo_tendencia_agregada") {
    section.append(
      createElement(
        "p",
        "muted-message",
        signalAnalysis?.nota || "Todavía sin volumen para el análisis por señal.",
      ),
    );
  }
}

function renderFailureMatch(diagnostic) {
  const card = createElement("article", `failure-match-card failure-category-${diagnostic.categoria}`);
  const heading = createElement("div", "failure-match-heading");
  heading.append(
    createElement(
      "span",
      "failure-match-jornada",
      `J${diagnostic.jornada ?? "—"} · ${formatDate(diagnostic.fecha_sorteo)}`,
    ),
    createElement(
      "strong",
      "",
      `${diagnostic.local || "Local"} — ${diagnostic.visitante || "Visitante"}`,
    ),
  );
  const badge = createElement(
    "span",
    `failure-category-badge failure-category-${diagnostic.categoria}`,
    FAILURE_CATEGORY_LABELS[diagnostic.categoria] || diagnostic.categoria || "Sin categoría",
  );
  const signs = createElement(
    "p",
    "failure-match-signs",
    `Salió "${diagnostic.signo_real ?? "—"}" · recomendábamos ${
      Array.isArray(diagnostic.signos_recomendados) && diagnostic.signos_recomendados.length > 0
        ? diagnostic.signos_recomendados.join(", ")
        : "—"
    }.`,
  );
  const reason = createElement("p", "failure-match-reason", diagnostic.motivo || "");
  card.append(heading, badge, signs, reason);
  return card;
}

function renderFailureMatches(diagnostics) {
  elements.failureMatchesList.replaceChildren();
  if (diagnostics.length === 0) {
    return;
  }
  const sorted = [...diagnostics].sort(
    (left, right) => String(right.fecha_sorteo).localeCompare(String(left.fecha_sorteo))
      || Number(right.posicion) - Number(left.posicion),
  );
  for (const diagnostic of sorted) {
    elements.failureMatchesList.append(renderFailureMatch(diagnostic));
  }
}

function renderFailureAnalysis(payload) {
  const estado = payload?.estado || {};
  const diagnostics = Array.isArray(payload?.diagnosticos_partidos_fallados)
    ? payload.diagnosticos_partidos_fallados
    : [];

  elements.failureStatus.textContent =
    estado.mensaje
    || "Sin información de diagnóstico todavía.";
  elements.failureStatus.className = "factor-callout is-neutral";

  renderFailureCategorySummary(diagnostics);
  renderFailureTrendSummary(estado, payload?.tendencia_agregada, payload?.analisis_senales);
  renderFailureMatches(diagnostics);
}

function renderHistory(payload) {
  renderSummary(payload);
  renderJourneys(payload);
  renderFactors(payload);
  elements.status.className = "status-message";
  elements.status.textContent = "";
  elements.pageContent.hidden = false;
}

async function loadHistory() {
  try {
    const [historyResponse, failureResponse] = await Promise.all([
      window.__HISTORICO_DATA__,
      window.__ANALISIS_DATA__,
    ]);
    renderHistory(historyResponse);
    try {
      renderFailureAnalysis(failureResponse);
    } catch (error) {
      elements.failureStatus.textContent =
        error instanceof Error ? error.message : String(error);
      elements.failureStatus.className = "factor-callout is-warning";
    }
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error);
    elements.status.className = "status-message is-visible status-error";
    elements.pageContent.hidden = true;
  }
}

loadHistory();
