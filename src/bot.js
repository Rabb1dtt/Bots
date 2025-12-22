const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();
const { createStorage } = require('./storage');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Please set it in your .env file.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing. Please set it in your .env file.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();
let openaiClient = null;

const BACKGROUND_OPTIONS = {
  former_player: 'Бывший игрок',
  legend: 'Легенда футбола',
  head_coach: 'Главный тренер',
  youth_coach: 'Тренер молодежки',
  assistant: 'Помощник главного тренера',
  unknown: 'Ноунейм'
};

const LICENSE_OPTIONS = {
  b: 'B',
  a: 'A',
  pro: 'PRO'
};

const NATIONALITY_OPTIONS = [
  { code: 'russia', label: '🇷🇺 Россия', value: 'Россия' },
  { code: 'germany', label: '🇩🇪 Германия', value: 'Германия' },
  { code: 'england', label: '🇬🇧 Англия', value: 'Англия' },
  { code: 'spain', label: '🇪🇸 Испания', value: 'Испания' },
  { code: 'france', label: '🇫🇷 Франция', value: 'Франция' },
  { code: 'italy', label: '🇮🇹 Италия', value: 'Италия' },
  { code: 'brazil', label: '🇧🇷 Бразилия', value: 'Бразилия' },
  { code: 'argentina', label: '🇦🇷 Аргентина', value: 'Аргентина' }
];

const AGE_OPTIONS = [
  { code: '20_25', label: '20-25', value: 23 },
  { code: '26_30', label: '26-30', value: 28 },
  { code: '31_36', label: '31-36', value: 33 },
  { code: '37_45', label: '37-45', value: 41 },
  { code: '46_55', label: '46-55', value: 50 },
  { code: '55_plus', label: '55+', value: 58 }
];

const LEAGUES = require('./data/leagues.json');

function buildLeaguesSubset(leagues) {
  return leagues.map((league) => {
    const clubs = Array.isArray(league.clubs) ? league.clubs : [];
    if (clubs.length <= 5) {
      return { ...league, clubs: clubs.slice() };
    }

    const sorted = clubs.slice().sort((a, b) => (a.prestige || 0) - (b.prestige || 0));
    const lastIndex = sorted.length - 1;
    const candidateIndexes = [
      0,
      Math.floor(lastIndex * 0.25),
      Math.floor(lastIndex * 0.5),
      Math.floor(lastIndex * 0.75),
      lastIndex
    ];
    const selected = [];
    const usedNames = new Set();

    for (const index of candidateIndexes) {
      const club = sorted[index];
      if (club && !usedNames.has(club.name)) {
        selected.push(club);
        usedNames.add(club.name);
      }
    }

    if (selected.length < 5) {
      for (const club of sorted) {
        if (selected.length >= 5) {
          break;
        }
        if (!usedNames.has(club.name)) {
          selected.push(club);
          usedNames.add(club.name);
        }
      }
    }

    return { ...league, clubs: selected };
  });
}

const LEAGUES_SUBSET_JSON = JSON.stringify(buildLeaguesSubset(LEAGUES));
let storage = null;


const STATES = {
  IDLE: 'idle',
  NATIONALITY: 'awaiting_nationality',
  NATIONALITY_CUSTOM: 'awaiting_custom_nationality',
  GENDER: 'awaiting_gender',
  AGE: 'awaiting_age',
  BACKGROUND: 'awaiting_background',
  LICENSE: 'awaiting_license',
  BIO: 'awaiting_bio',
  OFFER_SELECTION: 'offer_selection',
  OFFER_ROLL: 'offer_roll',
  OFFER_FINAL: 'offer_final',
  SEASON_DATE: 'awaiting_season_date',
  SEASON_LAST_RESULTS: 'awaiting_season_last_results',
  SEASON_SQUAD: 'awaiting_season_squad',
  SEASON_YOUTH_SQUAD: 'awaiting_season_youth_squad',
  SEASON_BUDGET: 'awaiting_season_budget',
  SEASON_COACH_LIMIT: 'awaiting_season_coach_limit',
  SEASON_PROCESSING: 'season_processing'
};

async function getSession(ctx) {
  const userId = ctx.from.id;
  if (!sessions.has(userId)) {
    const persisted = await storage.loadSession(userId);
    if (persisted) {
      sessions.set(userId, { state: persisted.state, data: persisted.data || {}, offers: [] });
    } else {
      sessions.set(userId, { state: STATES.IDLE, data: {}, offers: [] });
    }
  }
  return sessions.get(userId);
}

async function resetSession(ctx) {
  const userId = ctx.from.id;
  sessions.set(userId, { state: STATES.IDLE, data: {}, offers: [] });
  await storage.saveSession(userId, STATES.IDLE, {});
}

function startKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Создать тренера', 'create_coach')],
    [Markup.button.callback('Старт сезона', 'start_season')]
  ]);
}

function nationalityKeyboard() {
  const rows = [];
  for (let i = 0; i < NATIONALITY_OPTIONS.length; i += 2) {
    const slice = NATIONALITY_OPTIONS.slice(i, i + 2);
    rows.push(slice.map((item) => Markup.button.callback(item.label, `nat:${item.code}`)));
  }
  rows.push([Markup.button.callback('Другая', 'nat:other')]);
  return Markup.inlineKeyboard(rows);
}

function genderKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Мужчина', 'gender:male'), Markup.button.callback('Женщина', 'gender:female')]
  ]);
}

function ageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('20-25', 'age:20_25'), Markup.button.callback('26-30', 'age:26_30')],
    [Markup.button.callback('31-36', 'age:31_36'), Markup.button.callback('37-45', 'age:37_45')],
    [Markup.button.callback('46-55', 'age:46_55'), Markup.button.callback('55+', 'age:55_plus')]
  ]);
}

function backgroundKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(BACKGROUND_OPTIONS.former_player, 'background:former_player')],
    [Markup.button.callback(BACKGROUND_OPTIONS.legend, 'background:legend')],
    [Markup.button.callback(BACKGROUND_OPTIONS.head_coach, 'background:head_coach')],
    [Markup.button.callback(BACKGROUND_OPTIONS.youth_coach, 'background:youth_coach')],
    [Markup.button.callback(BACKGROUND_OPTIONS.assistant, 'background:assistant')],
    [Markup.button.callback(BACKGROUND_OPTIONS.unknown, 'background:unknown')]
  ]);
}

function licenseKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('B', 'license:b'), Markup.button.callback('A', 'license:a'), Markup.button.callback('PRO', 'license:pro')]
  ]);
}

function squadDoneKeyboard(context) {
  const suffix = context ? `:${context}` : '';
  return Markup.inlineKeyboard([
    [Markup.button.callback('Готово', `season_squad_done${suffix}`)],
    [Markup.button.callback('Сбросить фото', `season_squad_reset${suffix}`)]
  ]);
}

function getOpenAIClient() {
  if (!OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return openaiClient;
}

function analyzeFitness(trainer, league, club) {
  const backgroundWeight = {
    former_player: 3,
    legend: 5,
    head_coach: 4,
    youth_coach: 3,
    assistant: 3,
    unknown: 2
  };

  const licenseWeight = {
    b: 2,
    a: 3,
    pro: 5
  };

  const experienceScore = (backgroundWeight[trainer.background] || 1) * 10;
  const licenseScore = (licenseWeight[trainer.license] || 1) * 8;
  const clubPrestigeScore = club.prestige * 12;
  const leaguePrestigeScore = league.prestige * 10;
  let synergyScore = 0;
  const ageValue = Number.isFinite(trainer.ageValue)
    ? trainer.ageValue
    : (Number.isFinite(trainer.age) ? trainer.age : undefined);

  if (trainer.nationality && league.country.toLowerCase().includes(trainer.nationality.toLowerCase())) {
    synergyScore += 12;
  }

  if (Number.isFinite(ageValue) && ageValue < 30) {
    synergyScore += club.youthFocus >= 4 ? 8 : 4;
    synergyScore -= club.prestige >= 4 ? 5 : 0;
  }

  if (Number.isFinite(ageValue) && ageValue >= 40) {
    synergyScore += club.prestige >= 4 ? 6 : 3;
  }

  synergyScore += Math.max(0, club.youthFocus - 2) * 2;

  return experienceScore + licenseScore + clubPrestigeScore + leaguePrestigeScore + synergyScore;
}

function pickBestClubs(trainer) {
  const leagueCandidates = LEAGUES.map((league) => {
    const clubScores = league.clubs.map((club) => ({
      league,
      club,
      score: analyzeFitness(trainer, league, club)
    }));

    const bestClub = clubScores.sort((a, b) => b.score - a.score)[0];
    return bestClub;
  });

  const topFive = leagueCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const totalScore = topFive.reduce((sum, entry) => sum + entry.score, 0) || 1;
  const probabilities = topFive.map((entry) => ({
    ...entry,
    probability: Math.max(8, Math.round((entry.score / totalScore) * 100))
  }));

  const sumProb = probabilities.reduce((sum, entry) => sum + entry.probability, 0);
  const delta = 100 - sumProb;
  if (delta !== 0) {
    probabilities[0].probability += delta;
  }

  return probabilities;
}

function buildOfferPrompt(trainer) {
  const profile = formatCoachProfile(trainer);
  return [
    'Ты - спортивный директор в симуляции карьеры EA FC. Подбери клубы для тренера.',
    'Правила:',
    '1) Только клубы из JSON {leagues}, ничего лишнего.',
    '2) Ровно 5 клубов из 5 разных лиг.',
    '3) Реализм обязателен; без завышенных вариантов.',
    '4) probability - целые проценты, сумма 100; избегай 0 и 100.',
    '5) reason - 1-2 предложения.',
    'Формат: JSON массив, без текста.',
    `Профиль: ${profile}`,
    `Лиги и клубы (JSON): ${LEAGUES_SUBSET_JSON}`,
    'В JSON по 5 клубов на лигу (разный престиж). Выбирай только из этого списка.',
    'Выводи поля: league, club, country, league_original, club_original, probability, reason.',
    'Все тексты на русском, включая league/club/country; league_original и club_original - точные как в JSON.',
    'Пример:',
    '[',
    '{"league":"...","club":"...","country":"...","league_original":"...","club_original":"...","probability":12,"reason":"..."},',
    '{"league":"...","club":"...","country":"...","league_original":"...","club_original":"...","probability":27,"reason":"..."}',
    ']'
  ].join('\n');
}

function extractResponseText(response) {
  if (!response) {
    return '';
  }
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }
  if (Array.isArray(response.output)) {
    const chunks = [];
    for (const item of response.output) {
      if (!item || !Array.isArray(item.content)) {
        continue;
      }
      for (const part of item.content) {
        if (part && typeof part.text === 'string') {
          chunks.push(part.text);
        }
      }
    }
    if (chunks.length) {
      return chunks.join('');
    }
  }
  const chatText = response.choices?.[0]?.message?.content;
  if (typeof chatText === 'string') {
    return chatText;
  }
  return '';
}

function parseJsonArray(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response does not contain a JSON array.');
  }
  const jsonText = trimmed.slice(start, end + 1);
  return JSON.parse(jsonText);
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response does not contain a JSON object.');
  }
  const jsonText = trimmed.slice(start, end + 1);
  return JSON.parse(jsonText);
}

function normalizeProbabilities(entries) {
  const normalized = entries.map((entry) => ({
    ...entry,
    probability: Math.max(1, Math.min(99, Math.round(entry.probability)))
  }));
  const total = normalized.reduce((sum, entry) => sum + entry.probability, 0);
  if (total <= 0) {
    throw new Error('Invalid probability total.');
  }
  const delta = 100 - total;
  if (delta !== 0) {
    normalized[0].probability += delta;
  }
  if (normalized[0].probability <= 0) {
    throw new Error('Invalid probability adjustment.');
  }
  return normalized;
}

async function recordTokenUsage(userId, response) {
  const tokens = response?.usage?.total_tokens ?? response?.usage?.totalTokens ?? null;
  if (Number.isFinite(tokens) && tokens > 0) {
    await storage.addTokenUsage(userId, tokens);
  }
}

function parseMoneyInput(input) {
  if (!input) return null;
  const normalized = String(input).replace(/\s+/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return 'н/д';
  return `${Math.round(value).toLocaleString('ru-RU')} €`;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function getLeagueClass(prestige) {
  if (!Number.isFinite(prestige)) {
    return { name: 'mid', k: 0.85 };
  }
  if (prestige <= 1) return { name: 'micro', k: 0.65 };
  if (prestige === 2) return { name: 'low', k: 0.75 };
  if (prestige === 3) return { name: 'mid', k: 0.85 };
  if (prestige === 4) return { name: 'top', k: 0.9 };
  return { name: 'elite', k: 0.83 };
}

function computeApprovedBudget(fifaBudget, leagueClass, typicalCost, nSignings, youthCost) {
  const kBudget = Math.round(fifaBudget * leagueClass.k);
  const floorTransfers = Math.max(0, nSignings || 0) * Math.max(0, typicalCost || 0);
  const floorYouth = Math.max(0, youthCost || 0);
  const floor = floorTransfers + floorYouth;
  return Math.min(fifaBudget, Math.max(kBudget, floor));
}

function mapOffersFromModel(rawOffers) {
  if (!Array.isArray(rawOffers) || rawOffers.length !== 5) {
    throw new Error('LLM must return 5 offers.');
  }
  const seenLeagues = new Set();
  const mapped = rawOffers.map((offer, index) => {
    if (!offer || typeof offer !== 'object') {
      throw new Error('Invalid offer format.');
    }
    const leagueOriginalName = String(offer.league_original || offer.league || '').trim();
    const clubOriginalName = String(offer.club_original || offer.club || '').trim();
    const leagueDisplayName = String(offer.league || leagueOriginalName).trim();
    const clubDisplayName = String(offer.club || clubOriginalName).trim();
    const countryDisplayName = String(offer.country || '').trim();
    const probability = Number(offer.probability);
    const reason = typeof offer.reason === 'string' ? offer.reason.trim() : '';

    if (!leagueOriginalName || !clubOriginalName) {
      throw new Error('Offer is missing league or club.');
    }
    if (!Number.isFinite(probability)) {
      throw new Error('Offer probability is invalid.');
    }

    const league = LEAGUES.find((item) => item.name.toLowerCase() === leagueOriginalName.toLowerCase());
    if (!league) {
      throw new Error(`Unknown league: ${leagueOriginalName}`);
    }
    if (seenLeagues.has(league.name.toLowerCase())) {
      throw new Error('Leagues must be unique.');
    }
    seenLeagues.add(league.name.toLowerCase());

    const club = league.clubs.find((item) => item.name.toLowerCase() === clubOriginalName.toLowerCase());
    if (!club) {
      throw new Error(`Unknown club: ${clubOriginalName}`);
    }

    return {
      league,
      club,
      leagueDisplayName,
      clubDisplayName,
      countryDisplayName,
      probability,
      reason,
      rank: index + 1
    };
  });

  return normalizeProbabilities(mapped);
}

async function extractBioInsights(userId, trainer) {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }
  const prompt = [
    'Извлеки только явно указанные факты из биографии тренера.',
    'Верни строго JSON-объект без текста. Если данных нет - пустые массивы и null.',
    'Поля:',
    'previous_clubs: [{"club":"...", "from": 2022, "to": 2024}]',
    'trophies: [{"name":"...", "season":"2023/24", "club":"..."}]',
    'reputation_seed: число 0-100 или null.',
    'notes: массив коротких заметок, если есть важные детали (без выдумки).',
    `Биография: ${trainer.bio}`,
    `Профиль: национальность=${trainer.nationality}, возраст=${trainer.ageLabel || trainer.ageValue || trainer.age}, лицензия=${trainer.license}, прошлое=${trainer.background}`
  ].join('\n');

  try {
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
      temperature: 0,
      max_output_tokens: 400
    });
    await recordTokenUsage(userId, response);
    const text = extractResponseText(response);
    if (!text) return null;
    return parseJsonObject(text);
  } catch (error) {
    try {
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 400
      });
      await recordTokenUsage(userId, response);
      const text = extractResponseText(response);
      if (!text) return null;
      return parseJsonObject(text);
    } catch (innerError) {
      return null;
    }
  }
}

async function extractRosterFromImages(userId, imageUrls, kind = 'first') {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY is missing.');
  }
  const label = kind === 'youth' ? 'молодёжной команды' : 'основной команды';
  const content = [
    {
      type: 'input_text',
      text: [
        `Считай таблицу состава ${label} с фото/скринов FIFA.`,
        'Верни строго JSON массив объектов игроков. Никакого текста вне JSON.',
        'На скрине могут быть колонки: позиция/возраст/контракт/цена/зарплата; OVR/POT если есть.',
        'Формат объекта:',
        '{"name":"...","position":"...","age":0,"contract_months":0,"market_cost_eur":0,"wage_eur":0,"ovr":0,"pot":0}',
        'Если поля нет на скрине - ставь null. Не выдумывай значения.'
      ].join('\n')
    }
  ];
  imageUrls.forEach((url) => {
    content.push({ type: 'input_image', image_url: url });
  });

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [{ role: 'user', content }],
    temperature: 0,
    max_output_tokens: 900
  });
  await recordTokenUsage(userId, response);
  const text = extractResponseText(response);
  if (!text) {
    throw new Error('Empty roster response.');
  }
  try {
    return parseJsonArray(text);
  } catch (error) {
    const parsed = parseJsonObject(text);
    if (parsed && Array.isArray(parsed.players)) {
      return parsed.players;
    }
    throw error;
  }
}

async function buildBoardModel(userId, currentClub) {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }
  const prompt = [
    'Используй веб-поиск, чтобы определить архетип поведения руководства клуба.',
    'Клуб/контекст:',
    `Клуб: ${currentClub.club || currentClub.name || ''}`,
    `Лига: ${currentClub.league || ''}`,
    `Страна: ${currentClub.country || ''}`,
    '',
    'Верни строго JSON:',
    '{"archetype":"...","risk":"low|mid|high","patience":"low|mid|high","youth_focus":"low|mid|high","transfer_policy":"...","wage_policy":"...","summary":"...","sources":["..."]}'
  ].join('\n');

  try {
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
      tools: [{ type: 'web_search' }],
      temperature: 0.2,
      max_output_tokens: 700
    });
    await recordTokenUsage(userId, response);
    const text = extractResponseText(response);
    if (!text) return null;
    return parseJsonObject(text);
  } catch (error) {
    return null;
  }
}

async function buildSeasonPlan(userId, payload) {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY is missing.');
  }
  const prompt = [
    'Алгоритм начала сезона:',
    'Учитывай результаты прошлого сезона (указаны ниже).',
    'Поведение реального спортивного руководства клуба сформировано на основе открытых источников (архетип дан ниже).',
    '',
    '1. Анализ состава команды от лица спортивного директора:',
    '- Выявить перегруженные позиции;',
    '- Выявить наиболее слабые позиции, определить топ 1 приоритетов;',
    '- Оценить молодежную команду, определить потенциальных претендентов на основу и на аренду;',
    '- Обозначить непрекасаемых игроков, которым отводится приоритет при выборе состава и тактики - степень вмешательства зависит от уровня репутации тренера (ноунейм ~80%, топ-уровень ~1%).',
    '',
    '2. На основе бюджета клуба в FIFA определить максимальные траты на трансферы и потолок зарплат.',
    'Используй коэффициент лиги K для расчета стоимости и бюджета.',
    '',
    '3. Определи основные цели на сезон.',
    '',
    'Ответ строго в JSON. Никакого текста вне JSON.',
    'Верни строго JSON, без текста.',
    'Формат:',
    '{',
    '"squad_analysis":{"weak_positions":[],"overloaded_positions":[],"core_players":[],"risks":[]},',
    '"coach_staff_plan":{"total_coaches":0,"lines":{"GK":0,"DEF":0,"MID":0,"ATT":0},"min_stars":{"GK":0,"DEF":0,"MID":0,"ATT":0}},',
    '"youth_scouting_plan":{"package":"none","scouts":{"total":0,"quality_stars":0},"note":""},',
    '"season_objectives":["..."],',
    '"transfer_rules":{"untouchables":[],"sell_rules":"","buy_rules":"","wage_ceiling_eur":0},',
    '"n_signings":0',
    '}',
    '',
    `Клуб: ${payload.clubLabel}`,
    `Результат прошлого сезона: ${payload.lastSeasonResults || 'неизвестно'}`,
    `Лига класс: ${payload.leagueClass.name}`,
    `Коэффициент лиги K: ${payload.leagueClass.k}`,
    `Типичная стоимость игрока: ${payload.typicalCost || 'н/д'}`,
    `Бюджет FIFA: ${payload.fifaBudget}`,
    `Лимит тренеров: ${payload.coachLimit}`,
    `Архетип руководства: ${payload.boardModel ? JSON.stringify(payload.boardModel) : 'нет данных'}`,
    `Репутация тренера (0-100): ${payload.coachReputation ?? 'н/д'}`,
    `Состав (основа, JSON): ${JSON.stringify(payload.players)}`,
    `Состав (молодёжка, JSON): ${JSON.stringify(payload.youthPlayers || [])}`
  ].join('\n');

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
    temperature: 0.4,
    max_output_tokens: 900
  });
  await recordTokenUsage(userId, response);
  const text = extractResponseText(response);
  if (!text) {
    throw new Error('Empty season plan response.');
  }
  return parseJsonObject(text);
}

async function requestOffersFromLLM(trainer) {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY is missing.');
  }
  const prompt = buildOfferPrompt(trainer);
  let responseText = '';

  try {
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
      temperature: 0.6,
      max_output_tokens: 800
    });
    responseText = extractResponseText(response);
    if (trainer.userId) {
      await recordTokenUsage(trainer.userId, response);
    }
  } catch (error) {
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 800
    });
    responseText = extractResponseText(response);
    if (trainer.userId) {
      await recordTokenUsage(trainer.userId, response);
    }
  }

  if (!responseText) {
    throw new Error('Empty LLM response.');
  }

  const rawOffers = parseJsonArray(responseText);
  return mapOffersFromModel(rawOffers);
}

async function buildOffers(trainer) {
  if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set. Falling back to heuristic offers.');
    return pickBestClubs(trainer);
  }
  try {
    return await requestOffersFromLLM(trainer);
  } catch (error) {
    console.warn(`OpenAI offers failed: ${error.message}`);
    return pickBestClubs(trainer);
  }
}

function weightedPick(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.probability, 0);
  let random = Math.random() * total;

  for (const entry of entries) {
    if (random < entry.probability) {
      return entry;
    }
    random -= entry.probability;
  }

  return entries[entries.length - 1];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCoachProfile(data) {
  const ageLabel = data.ageLabel || data.age;
  return [
    `Национальность: ${data.nationality}`,
    `Пол: ${data.gender === 'male' ? 'Мужчина' : 'Женщина'}`,
    `Возраст: ${ageLabel}`,
    `Футбольное прошлое: ${BACKGROUND_OPTIONS[data.background]}`,
    `Лицензия: ${LICENSE_OPTIONS[data.license]}`,
    `Биография: ${data.bio}`
  ].join('\n');
}

async function persistSession(ctx, session) {
  await storage.saveSession(ctx.from.id, session.state, session.data);
}

async function persistProfile(ctx, session) {
  await storage.upsertCareerSnapshot(ctx.from.id, {
    profile: {
      nationality: session.data.nationality,
      gender: session.data.gender,
      age: session.data.ageLabel || session.data.ageValue,
      license: session.data.license,
      background: session.data.background,
      bio: session.data.bio
    },
    reputation: session.data.reputation ?? null,
    coachStyle: session.data.coachStyle || {},
    boardTrust: session.data.boardTrust ?? null,
    boardModel: session.data.boardModel || {},
    goals: session.data.goals || {},
    previousClubs: session.data.previousClubs || [],
    trophies: session.data.trophies || []
  });
}

async function persistContract(ctx, session, winner) {
  const leagueName = winner.leagueDisplayName || winner.league.name;
  const countryName = winner.countryDisplayName || winner.league.country;
  await storage.upsertCareerSnapshot(ctx.from.id, {
    currentClub: {
      league: leagueName,
      country: countryName,
      club: winner.clubDisplayName || winner.club.name,
      prestige: winner.club.prestige,
      leaguePrestige: winner.league.prestige,
      style: winner.league.style,
      tacticalShape: session.data.tacticalShape || '',
      players: session.data.players || []
    }
  });
  const career = await storage.getActiveCareer(ctx.from.id);
  if (career) {
    await storage.addHistoryEvent(career.career_id, 'contract_signed', {
      club: winner.clubDisplayName || winner.club.name,
      league: leagueName,
      country: countryName,
      probability: winner.probability
    });
  }
}

async function runSeasonStart(ctx, session) {
  const career = await storage.getActiveCareer(ctx.from.id);
  if (!career || !career.currentClub) {
    await resetSession(ctx);
    return ctx.reply('Сначала создайте тренера и подпишите контракт с клубом.');
  }

  const seasonInput = session.data.season || {};
  const fileIds = seasonInput.squadPhotos || [];
  if (!fileIds.length) {
    await resetSession(ctx);
    return ctx.reply('Нужны фото или скрины состава, чтобы начать сезон.');
  }
  const youthIdsCheck = seasonInput.youthSquadPhotos || [];
  if (!youthIdsCheck.length) {
    await resetSession(ctx);
    return ctx.reply('Нужны фото или скрины молодежной команды, чтобы начать сезон.');
  }
  if (!seasonInput.seasonStartDate || !seasonInput.fifaTransferBudget || !seasonInput.coachLimit || !seasonInput.lastSeasonResults) {
    await resetSession(ctx);
    return ctx.reply('Не хватает данных сезона. Запустите старт сезона заново.');
  }

  session.state = STATES.SEASON_PROCESSING;
  await persistSession(ctx, session);

  const progressMessage = await ctx.reply('Анализируем состав...');

  try {
    const links = await Promise.all(fileIds.map((fileId) => bot.telegram.getFileLink(fileId)));
    const imageUrls = links.map((link) => link.href || link.toString());
    const players = await extractRosterFromImages(ctx.from.id, imageUrls, 'first');
    const youthIds = seasonInput.youthSquadPhotos || [];
    const youthLinks = youthIds.length
      ? await Promise.all(youthIds.map((fileId) => bot.telegram.getFileLink(fileId)))
      : [];
    const youthUrls = youthLinks.map((link) => link.href || link.toString());
    const youthPlayers = youthUrls.length
      ? await extractRosterFromImages(ctx.from.id, youthUrls, 'youth')
      : [];

    await bot.telegram.editMessageText(
      progressMessage.chat.id,
      progressMessage.message_id,
      undefined,
      'Формируем сезонный план...'
    );

    const leagueClass = getLeagueClass(career.currentClub.leaguePrestige);
    const marketCosts = players
      .map((player) => Number(player.market_cost_eur))
      .filter((value) => Number.isFinite(value) && value > 0);
    let typicalCost = median(marketCosts);
    if (!typicalCost && leagueClass.name === 'micro') {
      typicalCost = 200000;
    }
    if (!typicalCost) {
      typicalCost = 500000;
    }

    const youthCost = 0;
    const existingBoardModel = career.boardModel && Object.keys(career.boardModel).length
      ? career.boardModel
      : null;
    const boardModel = existingBoardModel || await buildBoardModel(ctx.from.id, career.currentClub);
    if (boardModel && !existingBoardModel) {
      await storage.upsertCareerSnapshot(ctx.from.id, { boardModel });
    }

    const clubLabel = `${career.currentClub.club} (${career.currentClub.league}, ${career.currentClub.country})`;
    const plan = await buildSeasonPlan(ctx.from.id, {
      clubLabel,
      leagueClass,
      fifaBudget: seasonInput.fifaTransferBudget,
      lastSeasonResults: seasonInput.lastSeasonResults,
      typicalCost,
      coachLimit: seasonInput.coachLimit,
      coachReputation: career.reputation ?? null,
      boardModel,
      players,
      youthPlayers
    });

    const nSignings = Number.isFinite(plan.n_signings)
      ? Math.max(1, Math.min(3, plan.n_signings))
      : Math.max(1, Math.min(3, plan.squad_analysis?.weak_positions?.length || 1));
    const approvedBudget = computeApprovedBudget(
      seasonInput.fifaTransferBudget,
      leagueClass,
      typicalCost,
      nSignings,
      youthCost
    );
    const coachRating = Number.isFinite(career.reputation) ? career.reputation : 50;

    const youthPackage = plan.youth_scouting_plan?.package || 'none';
    await storage.createSeason(career.career_id, {
      seasonStartDate: seasonInput.seasonStartDate,
      fifaTransferBudget: seasonInput.fifaTransferBudget,
      approvedTransferBudget: approvedBudget,
      coachLimit: seasonInput.coachLimit,
      youthScoutingPackage: youthPackage,
      coachRating
    }, {
      squadSnapshot: {
        players,
        youthPlayers,
        analysis: plan.squad_analysis,
        risks: plan.squad_analysis?.risks || [],
        lastSeasonResults: seasonInput.lastSeasonResults
      },
      coachStaffPlan: plan.coach_staff_plan,
      youthScoutingPlan: plan.youth_scouting_plan,
      seasonObjectives: plan.season_objectives,
      transferRules: plan.transfer_rules
    });

    await storage.upsertCareerSnapshot(ctx.from.id, {
      goals: plan.season_objectives || [],
      boardTrust: coachRating
    });

    const coachPlan = plan.coach_staff_plan || {};
    const linePlan = coachPlan.lines
      ? `GK ${coachPlan.lines.GK || 0} / DEF ${coachPlan.lines.DEF || 0} / MID ${coachPlan.lines.MID || 0} / ATT ${coachPlan.lines.ATT || 0}`
      : 'н/д';
    const starPlan = coachPlan.min_stars
      ? `Мин. звёзды: GK ${coachPlan.min_stars.GK || 0}, DEF ${coachPlan.min_stars.DEF || 0}, MID ${coachPlan.min_stars.MID || 0}, ATT ${coachPlan.min_stars.ATT || 0}`
      : '';
    const youthScouts = plan.youth_scouting_plan?.scouts;
    const youthScoutsText = youthScouts
      ? `Скауты: ${youthScouts.total || 0}, качество: ${youthScouts.quality_stars || 0}★`
      : '';
    const objectivesText = Array.isArray(plan.season_objectives) && plan.season_objectives.length
      ? plan.season_objectives.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : 'н/д';
    const untouchables = plan.transfer_rules?.untouchables?.length
      ? plan.transfer_rules.untouchables.join(', ')
      : 'нет';

    const resultText = [
      'Старт сезона сформирован.',
      `Коэффициент лиги K: ${leagueClass.k}`,
      `Типичная стоимость игрока: ${formatMoney(typicalCost)}`,
      `Одобренный бюджет: ${formatMoney(approvedBudget)} (FIFA: ${formatMoney(seasonInput.fifaTransferBudget)})`,
      `План тренеров: ${coachPlan.total_coaches || 0} из ${seasonInput.coachLimit}`,
      `Линии: ${linePlan}`,
      starPlan,
      `Youth scouting: ${youthPackage}`,
      youthScoutsText,
      '',
      'Цели сезона:',
      objectivesText,
      '',
      `Неприкасаемые: ${untouchables}`,
      `Правила продаж: ${plan.transfer_rules?.sell_rules || 'н/д'}`,
      `Правила покупок: ${plan.transfer_rules?.buy_rules || 'н/д'}`,
      `Потолок зарплат: ${formatMoney(plan.transfer_rules?.wage_ceiling_eur)}`
    ].filter(Boolean).join('\n');

    await resetSession(ctx);
    return bot.telegram.editMessageText(
      progressMessage.chat.id,
      progressMessage.message_id,
      undefined,
      resultText,
      { reply_markup: startKeyboard().reply_markup }
    );
  } catch (error) {
    await resetSession(ctx);
    return bot.telegram.editMessageText(
      progressMessage.chat.id,
      progressMessage.message_id,
      undefined,
      `Не удалось обработать старт сезона: ${error.message}`
    );
  }
}

bot.start(async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await resetSession(ctx);
  const intro = [
    '👋 Добро пожаловать в EA FC 26 Career Master!',
    'Я помогу подобрать клуб для вашего нового тренера и сгенерирую правдоподобный оффер.',
    'Нажмите кнопку ниже, чтобы начать настройку.'
  ].join('\n');

  ctx.reply(intro, startKeyboard());
});

bot.action('create_coach', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const session = await getSession(ctx);
  session.state = STATES.NATIONALITY;
  session.data = {};
  session.offers = [];
  await persistSession(ctx, session);
  await ctx.editMessageText(
    'Отлично! Давайте создадим тренера.\nВыберите национальность из списка или нажмите <Другая>.',
    nationalityKeyboard()
  );
});

bot.action('start_season', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const career = await storage.getActiveCareer(ctx.from.id);
  if (!career || !career.currentClub) {
    return ctx.reply('Сначала создайте тренера и подпишите контракт с клубом.');
  }

  const session = await getSession(ctx);
  session.state = STATES.SEASON_LAST_RESULTS;
  session.data.season = {};
  await persistSession(ctx, session);
  return ctx.reply('Опишите результаты прошлого сезона (текстом).');
});

bot.action(/nat:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const selection = ctx.match[1];
  const session = await getSession(ctx);

  if (session.state !== STATES.NATIONALITY) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  if (selection === 'other') {
    session.state = STATES.NATIONALITY_CUSTOM;
    await persistSession(ctx, session);
    return ctx.reply('Введите название страны.');
  }

  const option = NATIONALITY_OPTIONS.find((item) => item.code === selection);
  if (!option) {
    return ctx.reply('Неизвестная национальность. Попробуйте снова.');
  }

  session.data.nationality = option.value;
  session.state = STATES.GENDER;
  await persistSession(ctx, session);
  return ctx.reply('Выберите пол тренера:', genderKeyboard());
});

bot.on('photo', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  const session = await getSession(ctx);
  const isMain = session.state === STATES.SEASON_SQUAD;
  const isYouth = session.state === STATES.SEASON_YOUTH_SQUAD;
  if (!isMain && !isYouth) {
    return;
  }

  const photos = ctx.message.photo || [];
  const best = photos[photos.length - 1];
  if (!best) {
    return ctx.reply('Не удалось прочитать фото. Попробуйте еще раз.');
  }

  if (!session.data.season) {
    session.data.season = {};
  }
  const key = isMain ? 'squadPhotos' : 'youthSquadPhotos';
  const messageKey = isMain ? 'squadMessageId' : 'youthMessageId';
  if (!Array.isArray(session.data.season[key])) {
    session.data.season[key] = [];
  }

  session.data.season[key].push(best.file_id);
  const count = session.data.season[key].length;
  const text = `Фото получены (${count}). Когда закончите, нажмите «Готово».`;
  const keyboard = squadDoneKeyboard(isMain ? 'main' : 'youth');

  if (session.data.season[messageKey]) {
    try {
      await bot.telegram.editMessageText(
        ctx.chat.id,
        session.data.season[messageKey],
        undefined,
        text,
        { reply_markup: keyboard.reply_markup }
      );
      await persistSession(ctx, session);
      return;
    } catch (error) {
      session.data.season[messageKey] = null;
    }
  }

  const msg = await ctx.reply(text, keyboard);
  session.data.season[messageKey] = msg.message_id;
  await persistSession(ctx, session);
});

bot.on('text', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  const session = await getSession(ctx);
  const message = ctx.message.text.trim();

  switch (session.state) {
    case STATES.NATIONALITY: {
      return ctx.reply('Выберите национальность кнопкой ниже или нажмите <Другая>.', nationalityKeyboard());
    }
    case STATES.NATIONALITY_CUSTOM: {
      if (!message || message.length < 2) {
        return ctx.reply('Пожалуйста, укажите национальность.');
      }
      session.data.nationality = message;
      session.state = STATES.GENDER;
      await persistSession(ctx, session);
      return ctx.reply('Выберите пол тренера:', genderKeyboard());
    }
    case STATES.AGE: {
      return ctx.reply('Выберите возрастной диапазон кнопкой ниже.', ageKeyboard());
    }
    case STATES.SEASON_LAST_RESULTS: {
      if (!message || message.length < 3) {
        return ctx.reply('Пожалуйста, опишите результаты прошлого сезона.');
      }
      session.data.season = session.data.season || {};
      session.data.season.lastSeasonResults = message;
      session.state = STATES.SEASON_DATE;
      await persistSession(ctx, session);
      return ctx.reply('Введите дату старта сезона в формате ГГГГ-ММ-ДД.');
    }
    case STATES.SEASON_DATE: {
      const match = message.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) {
        return ctx.reply('Введите дату в формате ГГГГ-ММ-ДД.');
      }
      session.data.season = session.data.season || {};
      session.data.season.seasonStartDate = message;
      session.state = STATES.SEASON_SQUAD;
      await persistSession(ctx, session);
      return ctx.reply('Отправьте фото или скрин состава (таблица игроков). Можно несколько.', squadDoneKeyboard('main'));
    }
    case STATES.SEASON_SQUAD: {
      return ctx.reply('Отправьте фото или скрин состава. После — нажмите «Готово».', squadDoneKeyboard('main'));
    }
    case STATES.SEASON_YOUTH_SQUAD: {
      return ctx.reply('Отправьте фото или скрин молодежной команды. После — нажмите «Готово».', squadDoneKeyboard('youth'));
    }
    case STATES.SEASON_BUDGET: {
      const budget = parseMoneyInput(message);
      if (!Number.isFinite(budget) || budget <= 0) {
        return ctx.reply('Введите трансферный бюджет числом.');
      }
      session.data.season = session.data.season || {};
      session.data.season.fifaTransferBudget = budget;
      session.state = STATES.SEASON_COACH_LIMIT;
      await persistSession(ctx, session);
      return ctx.reply('Введите лимит тренеров из FIFA (например 4, 6, 8).\nСостав -> тактическое видение -> управление тренерами -> нанять тренера (левый верхний угол).');
    }
    case STATES.SEASON_COACH_LIMIT: {
      const limit = Number(message);
      if (!Number.isFinite(limit) || limit <= 0) {
        return ctx.reply('Введите число лимита тренеров, например 4.');
      }
      session.data.season = session.data.season || {};
      session.data.season.coachLimit = Math.round(limit);
      await persistSession(ctx, session);
      return runSeasonStart(ctx, session);
    }
    case STATES.BIO: {
      if (!message || message.length > 350) {
        return ctx.reply('Биография должна быть от 1 до 350 символов.');
      }
      session.data.bio = message;
      if (session.data.gender === 'female' && session.data.background === 'unknown') {
        await resetSession(ctx);
        return ctx.reply(
          'Не удалось найти клуб, желающий заключить с вами контракт.',
          Markup.inlineKeyboard([Markup.button.callback('🔁 Начать заново', 'create_coach')])
        );
      }

      const bioInsights = await extractBioInsights(ctx.from.id, session.data);
      if (bioInsights) {
        if (Array.isArray(bioInsights.previous_clubs)) {
          session.data.previousClubs = bioInsights.previous_clubs;
        }
        if (Array.isArray(bioInsights.trophies)) {
          session.data.trophies = bioInsights.trophies;
        }
        if (Number.isFinite(bioInsights.reputation_seed)) {
          session.data.reputation = Math.round(bioInsights.reputation_seed);
        }
      }

      await persistProfile(ctx, session);

      const progressSteps = [
        'Агент подбирает клубы...',
        'Рассылаются резюме...',
        'Ждём ответы...',
        'Получен отказ...',
        'Ещё один отказ...'
      ];
      const waitingLabel = 'Ожидание оставшихся клубов';
      const spinnerFrames = ['⏳', '⌛'];
      const successLabel = 'Есть заинтересованный клуб! ✅';
      const offersPromise = buildOffers({ ...session.data, userId: ctx.from.id });
      const progressMessage = await ctx.reply(progressSteps[0]);
      let offersReady = false;
      const progressTask = (async () => {
        for (let i = 1; i < progressSteps.length; i += 1) {
          await delay(450);
          if (offersReady) {
            return;
          }
          try {
            await bot.telegram.editMessageText(
              progressMessage.chat.id,
              progressMessage.message_id,
              undefined,
              progressSteps[i]
            );
          } catch (error) {
            return;
          }
        }

        let frameIndex = 0;
        while (!offersReady) {
          await delay(800);
          const spinner = spinnerFrames[frameIndex % spinnerFrames.length];
          frameIndex += 1;
          try {
            await bot.telegram.editMessageText(
              progressMessage.chat.id,
              progressMessage.message_id,
              undefined,
              `${waitingLabel} ${spinner}`
            );
          } catch (error) {
            return;
          }
        }
      })();

      session.offers = await offersPromise;
      offersReady = true;
      await progressTask;
      try {
        await bot.telegram.editMessageText(
          progressMessage.chat.id,
          progressMessage.message_id,
          undefined,
          successLabel
        );
        await delay(1200);
      } catch (error) {
        // Ignore edit errors for deleted/unchanged messages.
      }

      session.state = STATES.OFFER_SELECTION;
      await persistSession(ctx, session);

      const profileText = `Профиль тренера:\n${formatCoachProfile(session.data)}\n\nПодбор клубов:`;
      const offersText = session.offers
        .map((entry, idx) => {
          const clubName = entry.clubDisplayName || entry.club.name;
          const leagueName = entry.leagueDisplayName || entry.league.name;
          const countryName = entry.countryDisplayName || entry.league.country;
          const leagueLabel = countryName ? `${leagueName}, ${countryName}` : leagueName;
          return `${idx + 1}. ${clubName} (${leagueLabel}) - ${entry.probability}% шанса`;
        })
        .join('\n');

      return ctx.reply(
        `${profileText}\n${offersText}\n\nГотовы узнать, кто сделает оффер?`,
        Markup.inlineKeyboard([Markup.button.callback('Получить оффер', 'roll_offer')])
      );
    }
    default:
      return undefined;
  }
});

bot.action(/gender:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const gender = ctx.match[1];
  const session = await getSession(ctx);

  if (session.state !== STATES.GENDER) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.gender = gender;
  session.state = STATES.AGE;
  await persistSession(ctx, session);
  return ctx.reply('Укажите возрастной диапазон:', ageKeyboard());
});

bot.action(/age:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const ageCode = ctx.match[1];
  const session = await getSession(ctx);

  if (session.state !== STATES.AGE) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  const option = AGE_OPTIONS.find((item) => item.code === ageCode);
  if (!option) {
    return ctx.reply('Неизвестный возрастной диапазон. Попробуйте снова.');
  }

  session.data.ageLabel = option.label;
  session.data.ageValue = option.value;
  session.state = STATES.BACKGROUND;
  await persistSession(ctx, session);
  return ctx.reply('Выберите футбольное прошлое:', backgroundKeyboard());
});

bot.action(/background:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const background = ctx.match[1];
  const session = await getSession(ctx);

  if (session.state !== STATES.BACKGROUND) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.background = background;
  session.state = STATES.LICENSE;
  await persistSession(ctx, session);
  return ctx.reply('Выберите тренерскую лицензию:', licenseKeyboard());
});

bot.action(/license:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const license = ctx.match[1];
  const session = await getSession(ctx);

  if (session.state !== STATES.LICENSE) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.license = license;
  session.state = STATES.BIO;
  await persistSession(ctx, session);
  return ctx.reply('Опишите кратко биографию тренера: например образование, родной город, знания языков (до 350 символов).');
});

bot.action(/season_squad_done:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const target = ctx.match[1];
  const session = await getSession(ctx);
  if (target !== 'main' && target !== 'youth') {
    return ctx.reply('Неизвестный шаг.');
  }
  if (target === 'main' && session.state !== STATES.SEASON_SQUAD) {
    return ctx.reply('Сейчас не этап загрузки состава.');
  }
  if (target === 'youth' && session.state !== STATES.SEASON_YOUTH_SQUAD) {
    return ctx.reply('Сейчас не этап загрузки молодежной команды.');
  }
  if (!session.data.season) {
    session.data.season = {};
  }
  if (target === 'main') {
    const photos = session.data.season.squadPhotos || [];
    if (!photos.length) {
      return ctx.reply('Пришлите хотя бы одно фото или скрин состава.');
    }
    session.state = STATES.SEASON_YOUTH_SQUAD;
    await persistSession(ctx, session);
    return ctx.reply('Отправьте фото или скрин молодежной команды. После — нажмите «Готово».', squadDoneKeyboard('youth'));
  }
  const youthPhotos = session.data.season.youthSquadPhotos || [];
  if (!youthPhotos.length) {
    return ctx.reply('Пришлите хотя бы одно фото молодежной команды.');
  }
  session.state = STATES.SEASON_BUDGET;
  await persistSession(ctx, session);
  return ctx.reply('Введите трансферный бюджет FIFA (число).');
});

bot.action(/season_squad_reset:(.+)/, async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const target = ctx.match[1];
  const session = await getSession(ctx);
  if (target !== 'main' && target !== 'youth') {
    return ctx.reply('Неизвестный шаг.');
  }
  if (target === 'main' && session.state !== STATES.SEASON_SQUAD) {
    return ctx.reply('Сейчас не этап загрузки состава.');
  }
  if (target === 'youth' && session.state !== STATES.SEASON_YOUTH_SQUAD) {
    return ctx.reply('Сейчас не этап загрузки молодежной команды.');
  }
  if (!session.data.season) {
    session.data.season = {};
  }
  if (target === 'youth') {
    session.data.season.youthSquadPhotos = [];
    session.data.season.youthMessageId = null;
  } else {
    session.data.season.squadPhotos = [];
    session.data.season.squadMessageId = null;
  }
  await persistSession(ctx, session);
  return ctx.reply(target === 'youth'
    ? 'Фото сброшены. Пришлите фото или скрины молодежной команды.'
    : 'Фото сброшены. Пришлите фото или скрины состава.'
  );
});


bot.action('roll_offer', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const session = await getSession(ctx);

  if (session.state !== STATES.OFFER_SELECTION || !session.offers.length) {
    return ctx.reply('Сначала заполните профиль тренера, чтобы получить варианты клубов.');
  }

  session.state = STATES.OFFER_ROLL;
  await persistSession(ctx, session);
  const negotiationSteps = [
    'Агент обзванивает клубы...',
    'Идут первые переговоры...',
    'Получаем отказ от одного клуба...',
    'Пробуем другие варианты...',
    'Есть позитивный ответ!'
  ];
  const spinMessage = await ctx.reply('Агент начинает обзвон клубов...');

  for (let i = 0; i < negotiationSteps.length; i++) {
    await delay(400);
    await bot.telegram.editMessageText(
      spinMessage.chat.id,
      spinMessage.message_id,
      undefined,
      negotiationSteps[i]
    );
  }

  const winner = weightedPick(session.offers);
  session.state = STATES.OFFER_FINAL;
  session.chosenOffer = winner;
  await persistSession(ctx, session);

  const leagueName = winner.leagueDisplayName || winner.league.name;
  const countryName = winner.countryDisplayName || winner.league.country;
  const leagueLabel = countryName ? `${leagueName}, ${countryName}` : leagueName;

  const resultText = [
    'Есть договоренность!',
    `${winner.clubDisplayName || winner.club.name} (${leagueLabel}) готов обсудить контракт.`,
    `Оценка вероятности: ${winner.probability}%`,
    '',
    `Стиль лиги: ${winner.league.style}`,
    'Подписываем контракт?'
  ].join('\n');

  return bot.telegram.editMessageText(
    spinMessage.chat.id,
    spinMessage.message_id,
    undefined,
    resultText,
    {
      reply_markup: Markup.inlineKeyboard([
        Markup.button.callback('🖊️ Подписать контракт', 'sign_contract'),
        Markup.button.callback('🔁 Начать заново', 'create_coach')
      ]).reply_markup
    }
  );
});

bot.action('sign_contract', async (ctx) => {
  await storage.touchUser(ctx.from.id);
  await ctx.answerCbQuery();
  const session = await getSession(ctx);

  if (session.state !== STATES.OFFER_FINAL || !session.chosenOffer) {
    return ctx.reply('Сначала получите оффер и выберите клуб.');
  }

  await persistContract(ctx, session, session.chosenOffer);

  const leagueName = session.chosenOffer.leagueDisplayName || session.chosenOffer.league.name;
  const countryName = session.chosenOffer.countryDisplayName || session.chosenOffer.league.country;
  const leagueLabel = countryName ? `${leagueName}, ${countryName}` : leagueName;

  const summary = [
    'Контракт подписан! 🖊️',
    `Клуб: ${session.chosenOffer.clubDisplayName || session.chosenOffer.club.name} (${leagueLabel})`,
    '',
    'Данные тренера:',
    formatCoachProfile(session.data)
  ].join('\n');

  await resetSession(ctx);
  return ctx.reply(summary, startKeyboard());
});

bot.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery('Неизвестное действие.');
});

async function bootstrap() {
  storage = await createStorage(DATABASE_URL);
  await bot.launch();
}

bootstrap().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
