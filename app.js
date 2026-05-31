const MOSCOW_TIMEZONE = "Europe/Moscow";
const TROPARION_STORAGE_PREFIX = "troparion:";
const SAINT_INVOCATIONS = [
  "Пресвятой Царицы нашей и Матери Твоей Девы Марии",
  "Святого Иоанна Крестителя Твоего",
  "Святых Иакима и Анны",
  "Преподобного отца нашего Алексея",
  "Святой царицы и страстотерпецы Александры Романовой",
  "Святителя и отца нашего Алексия, митрополита Московского",
  "Святой царицы и мученицы Александры Римской",
  "Святых апостолов Твоих",
  "Святых жен-мироносиц",
  "Преподобных отцов наших Сергия, Гавриила, Серафима и Паисия",
  "Святых блаженных Матроны и Ксении",
  "Святого мученика Философа",
  "Святых равноапостольных Нины и Томары, Владимира и Ольги, Мефодия и Кирилла, Николая Японского",
  "Святых новомучеников и исповедников Церкви нашей",
  "Святителей Николая Мирликийского и Спиридона Тримифунтского",
  "Святых равноапостольных Константина и Елены",
  "Святого мученика и победоносца Георгия",
  "Святых преподобного Василия, епископа Парийского, и святой великомученицы Варвары",
  "Святого Иосифа Обручника",
  "Святой преподобной матери нашей Марии Египетской",
  "Адама и Евы",
  "Святых патриархов Авраама, Исаака и Иакова, святых пророков Моисея, Исаии, Илии, Даниила, царя Давида и прочих ветхозаветных святых",
  "Святых Августина и Патрикия",
  "Всех святых земли Российской и Грузинской",
  "Святых благоверных князя Петра и княгини Февронии",
  "Святых небесных сил бесплотных: ангелов хранителей наших, архангелов Гавриила и Михаила и прочих ангелов",
  "Святителей Иоанна Златоустого, Василия Великого и Григория Двоеслова",
  "Святых преподобных жен Дивеевских и старцев Оптинских",
  "Святого царя и страстотерпца Николая и детей его",
  "Всех святых Твоих"
];

const currentDateElement = document.querySelector("#current-date");
const currentYearElement = document.querySelector("#current-year");
const timezoneElement = document.querySelector("#timezone-name");
const troparionStatusElement = document.querySelector("#troparion-status");
const troparionContentElement = document.querySelector("#troparion-content");
const sourceLinkElement = document.querySelector("#source-link");
const refreshButton = document.querySelector("#refresh-troparion");
const copyPrayerButton = document.querySelector("#copy-prayer");
const prayerElement = document.querySelector("#prayer-suite");
const jesusPrayersListElement = document.querySelector("#jesus-prayers-list");

timezoneElement.textContent = MOSCOW_TIMEZONE;
currentYearElement.textContent = String(new Date().getFullYear());

renderJesusPrayers();

copyPrayerButton.addEventListener("click", () => {
  void copyTextFromElement(copyPrayerButton, prayerElement, "Скопировано всё");
});

refreshButton.addEventListener("click", () => {
  void loadTroparion();
});

void loadTroparion();

function getDateStringForTimezone(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatRussianDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function setLoadingState(dateString) {
  currentDateElement.textContent = formatRussianDate(dateString);
  troparionStatusElement.textContent = "Загружаю тропари дня...";
  troparionContentElement.innerHTML =
    '<p class="helper-message">Проверяю календарь и подготавливаю текст на сегодня.</p>';
  refreshButton.disabled = true;
}

function setErrorState(message, helpHtml = "") {
  troparionStatusElement.textContent = "Тропарь сейчас недоступен";
  troparionContentElement.innerHTML = `
    <p class="helper-message helper-error">${escapeHtml(message)}</p>
    ${helpHtml}
  `;
  refreshButton.disabled = false;
}

async function loadTroparion() {
  const dateString = getDateStringForTimezone(MOSCOW_TIMEZONE);
  setLoadingState(dateString);

  if (window.location.protocol === "file:") {
    setErrorState(
      "Тропари дня не загрузятся при открытии файла напрямую.",
      getLocalServerHelpHtml()
    );
    return;
  }

  try {
    const response = await fetch(`/api/troparion?date=${dateString}`);
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      throw createLocalServerError();
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Не удалось загрузить тропари дня.");
    }

    saveTroparionToStorage(data.date, data);
    renderTroparionState(data);
  } catch (error) {
    const cachedData = loadTroparionFromStorage(dateString);
    if (cachedData) {
      renderTroparionState({
        ...cachedData,
        warning: "Показываю сохранённую копию: свежий ответ сейчас не пришёл."
      });
      return;
    }

    if (isLocalServerError(error)) {
      setErrorState(
        "Локальный API тропарей не найден.",
        getLocalServerHelpHtml()
      );
      return;
    }

    setErrorState(error instanceof Error ? error.message : "Не удалось загрузить тропари дня.");
  }
}

function renderTroparionState(data) {
  troparionStatusElement.textContent = data.warning
    ? `Сохранённые тексты на ${formatRussianDate(data.date)}`
    : `Тексты на ${formatRussianDate(data.date)}`;
  troparionContentElement.innerHTML = renderTroparionMarkup(data.items, data.headline, data.warning);
  sourceLinkElement.href = data.sourcePage;
  sourceLinkElement.textContent = data.sourceName;
  refreshButton.disabled = false;
}

function renderTroparionMarkup(items, headline, warning = "") {
  const warningHtml = warning
    ? `<p class="troparion-warning">${escapeHtml(warning)}</p>`
    : "";
  const headlineHtml = headline
    ? `<p class="day-headline">${escapeHtml(headline)}</p>`
    : "";

  const entriesHtml = items
    .map((item) => {
      const tropariaHtml = item.troparia
        .map((troparion) => {
          const translationHtml = troparion.translationHtml
            ? `
              <details class="translation">
                <summary>Перевод</summary>
                <div class="translation-body">${troparion.translationHtml}</div>
              </details>
            `
            : "";

          return `
            <section class="troparion-piece">
              <h3>${escapeHtml(troparion.heading)}</h3>
              <div class="troparion-text">${troparion.textHtml}</div>
              ${translationHtml}
            </section>
          `;
        })
        .join("");

      return `
        <article class="troparion-entry">
          <p class="troparion-entry-title">${escapeHtml(item.title)}</p>
          ${tropariaHtml}
        </article>
      `;
    })
    .join("");

  return `${warningHtml}${headlineHtml}${entriesHtml}`;
}

function renderJesusPrayers() {
  jesusPrayersListElement.innerHTML = SAINT_INVOCATIONS
    .map((invocation, index) => {
      return `
        <li class="jesus-prayers-item">
          <span class="jesus-prayers-number">${index + 1}</span>
          <p class="jesus-prayers-text">Господи, Иисусе Христе Сыне Божий, молитв ради ${escapeHtml(invocation)}, помилуй нас!</p>
        </li>
      `;
    })
    .join("");
}

function createLocalServerError() {
  const error = new Error("Локальный API тропарей не найден.");
  error.code = "LOCAL_SERVER_REQUIRED";
  return error;
}

function isLocalServerError(error) {
  return Boolean(error && typeof error === "object" && error.code === "LOCAL_SERVER_REQUIRED");
}

function getLocalServerHelpHtml() {
  return `
    <div class="helper-tip">
      <p class="helper-message">Автоматические тропари работают только когда сайт открыт через локальный сервер.</p>
      <p class="helper-message"><code>npm start</code></p>
      <p class="helper-message">После запуска откройте <code>http://127.0.0.1:3000</code>, а не файл <code>public/index.html</code>.</p>
    </div>
  `;
}

function loadTroparionFromStorage(dateString) {
  try {
    const rawValue = window.localStorage.getItem(`${TROPARION_STORAGE_PREFIX}${dateString}`);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
}

function saveTroparionToStorage(dateString, payload) {
  try {
    window.localStorage.setItem(
      `${TROPARION_STORAGE_PREFIX}${dateString}`,
      JSON.stringify(payload)
    );
  } catch (error) {
    // Ignore storage failures and keep the live page usable.
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyTextFromElement(button, element, successText) {
  if (!element) {
    return;
  }

  const previousLabel = button.textContent;
  const textToCopy = element.innerText.replace(/\n{3,}/g, "\n\n").trim();

  try {
    await navigator.clipboard.writeText(textToCopy);
    button.textContent = successText;
  } catch (error) {
    button.textContent = "Не удалось скопировать";
  }

  window.setTimeout(() => {
    button.textContent = previousLabel;
  }, 1800);
}
