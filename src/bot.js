const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Please set it in your .env file.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();

const BACKGROUND_OPTIONS = {
  former_player: 'Бывший игрок',
  legend: 'Легенда футбола',
  youth_coach: 'Тренер молодежки',
  assistant: 'Помощник главного тренера',
  unknown: 'Ноунейм'
};

const LICENSE_OPTIONS = {
  b: 'B',
  a: 'A',
  pro: 'PRO'
};

const LEAGUES = [
  {
    name: 'Английская Премьер-Лига',
    country: 'Англия',
    prestige: 5,
    style: 'Агрессия и интенсивность',
    clubs: [
      { name: 'Брайтон', prestige: 4, youthFocus: 4 },
      { name: 'Брентфорд', prestige: 3, youthFocus: 3 },
      { name: 'Кристал Пэлас', prestige: 3, youthFocus: 3 },
      { name: 'Фулхэм', prestige: 3, youthFocus: 3 }
    ]
  },
  {
    name: 'Ла Лига',
    country: 'Испания',
    prestige: 5,
    style: 'Техника и контроль мяча',
    clubs: [
      { name: 'Реал Сосьедад', prestige: 4, youthFocus: 4 },
      { name: 'Вильярреал', prestige: 4, youthFocus: 4 },
      { name: 'Бетис', prestige: 4, youthFocus: 3 },
      { name: 'Севилья', prestige: 4, youthFocus: 3 }
    ]
  },
  {
    name: 'Бундеслига',
    country: 'Германия',
    prestige: 4,
    style: 'Система и прессинг',
    clubs: [
      { name: 'Фрайбург', prestige: 4, youthFocus: 5 },
      { name: 'Байер Леверкузен', prestige: 5, youthFocus: 4 },
      { name: 'РБ Лейпциг', prestige: 4, youthFocus: 4 },
      { name: 'Вердер Бремен', prestige: 3, youthFocus: 3 }
    ]
  },
  {
    name: 'Серия А',
    country: 'Италия',
    prestige: 4,
    style: 'Тактическая дисциплина',
    clubs: [
      { name: 'Аталанта', prestige: 4, youthFocus: 4 },
      { name: 'Лацио', prestige: 4, youthFocus: 3 },
      { name: 'Болонья', prestige: 3, youthFocus: 3 },
      { name: 'Фиорентина', prestige: 4, youthFocus: 3 }
    ]
  },
  {
    name: 'Лига 1',
    country: 'Франция',
    prestige: 4,
    style: 'Атлетизм и скоростные атаки',
    clubs: [
      { name: 'Лилль', prestige: 4, youthFocus: 4 },
      { name: 'Марсель', prestige: 4, youthFocus: 3 },
      { name: 'Ренн', prestige: 4, youthFocus: 4 },
      { name: 'Монако', prestige: 4, youthFocus: 3 }
    ]
  },
  {
    name: 'Эредивизи',
    country: 'Нидерланды',
    prestige: 3,
    style: 'Атака и креатив',
    clubs: [
      { name: 'АЗ Алкмар', prestige: 3, youthFocus: 5 },
      { name: 'ПСВ', prestige: 4, youthFocus: 4 },
      { name: 'Фейеноорд', prestige: 4, youthFocus: 4 },
      { name: 'Твенте', prestige: 3, youthFocus: 3 }
    ]
  },
  {
    name: 'MLS',
    country: 'США',
    prestige: 3,
    style: 'Маркетинг и развитие бренда',
    clubs: [
      { name: 'Нэшвилл', prestige: 3, youthFocus: 3 },
      { name: 'Сент-Луис Сити', prestige: 3, youthFocus: 3 },
      { name: 'Сиэтл Саундерс', prestige: 3, youthFocus: 4 },
      { name: 'Интер Майами', prestige: 4, youthFocus: 2 }
    ]
  },
  {
    name: 'Бразилейрао',
    country: 'Бразилия',
    prestige: 3,
    style: 'Техника и шоу',
    clubs: [
      { name: 'Ботафого', prestige: 3, youthFocus: 3 },
      { name: 'Палмейрас', prestige: 4, youthFocus: 4 },
      { name: 'Флуминенсе', prestige: 4, youthFocus: 3 },
      { name: 'Атлетико Паранаэнсе', prestige: 3, youthFocus: 3 }
    ]
  },
  {
    name: 'Турецкая Суперлига',
    country: 'Турция',
    prestige: 3,
    style: 'Темперамент и давление трибун',
    clubs: [
      { name: 'Трабзонспор', prestige: 3, youthFocus: 3 },
      { name: 'Галатасарай', prestige: 4, youthFocus: 3 },
      { name: 'Бешикташ', prestige: 4, youthFocus: 3 },
      { name: 'Истанбул Башакшехир', prestige: 3, youthFocus: 3 }
    ]
  },
  {
    name: 'Бельгийская Про Лига',
    country: 'Бельгия',
    prestige: 3,
    style: 'Подготовка молодежи',
    clubs: [
      { name: 'Генк', prestige: 3, youthFocus: 4 },
      { name: 'Брюгге', prestige: 4, youthFocus: 4 },
      { name: 'Андерлехт', prestige: 4, youthFocus: 4 },
      { name: 'Роял Антверпен', prestige: 3, youthFocus: 3 }
    ]
  }
];

const STATES = {
  IDLE: 'idle',
  NATIONALITY: 'awaiting_nationality',
  GENDER: 'awaiting_gender',
  AGE: 'awaiting_age',
  BACKGROUND: 'awaiting_background',
  LICENSE: 'awaiting_license',
  BIO: 'awaiting_bio',
  OFFER_SELECTION: 'offer_selection',
  OFFER_ROLL: 'offer_roll',
  OFFER_FINAL: 'offer_final'
};

function getSession(ctx) {
  const userId = ctx.from.id;
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: STATES.IDLE, data: {}, offers: [] });
  }
  return sessions.get(userId);
}

function resetSession(ctx) {
  const userId = ctx.from.id;
  sessions.set(userId, { state: STATES.IDLE, data: {}, offers: [] });
}

function startKeyboard() {
  return Markup.inlineKeyboard([Markup.button.callback('Создать тренера', 'create_coach')]);
}

function genderKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Мужчина', 'gender:male'), Markup.button.callback('Женщина', 'gender:female')]
  ]);
}

function backgroundKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(BACKGROUND_OPTIONS.former_player, 'background:former_player')],
    [Markup.button.callback(BACKGROUND_OPTIONS.legend, 'background:legend')],
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

function analyzeFitness(trainer, league, club) {
  const backgroundWeight = {
    former_player: 3,
    legend: 5,
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

  if (trainer.nationality && league.country.toLowerCase().includes(trainer.nationality.toLowerCase())) {
    synergyScore += 12;
  }

  if (trainer.age && trainer.age < 30) {
    synergyScore += club.youthFocus >= 4 ? 8 : 4;
    synergyScore -= club.prestige >= 4 ? 5 : 0;
  }

  if (trainer.age && trainer.age >= 40) {
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

function formatCoachProfile(data) {
  return [
    `Национальность: ${data.nationality}`,
    `Пол: ${data.gender === 'male' ? 'Мужчина' : 'Женщина'}`,
    `Возраст: ${data.age}`,
    `Футбольное прошлое: ${BACKGROUND_OPTIONS[data.background]}`,
    `Лицензия: ${LICENSE_OPTIONS[data.license]}`,
    `Описание: ${data.bio}`
  ].join('\n');
}

bot.start((ctx) => {
  resetSession(ctx);
  const intro = [
    '⚽️ Добро пожаловать в EA FC 26 Career Master!',
    'Я помогу подобрать клуб для вашего нового тренера и сгенерирую правдоподобный оффер.',
    'Нажмите кнопку ниже, чтобы начать настройку.'
  ].join('\n');

  ctx.reply(intro, startKeyboard());
});

bot.action('create_coach', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx);
  session.state = STATES.NATIONALITY;
  session.data = {};
  session.offers = [];
  await ctx.editMessageText('Отлично! Давайте создадим тренера. \nВведите национальность (например: Испания, Франция, Россия).');
});

bot.on('text', async (ctx) => {
  const session = getSession(ctx);
  const message = ctx.message.text.trim();

  switch (session.state) {
    case STATES.NATIONALITY: {
      if (!message || message.length < 2) {
        return ctx.reply('Пожалуйста, укажите национальность.');
      }
      session.data.nationality = message;
      session.state = STATES.GENDER;
      return ctx.reply('Выберите пол тренера:', genderKeyboard());
    }
    case STATES.AGE: {
      const age = Number(message);
      if (!Number.isInteger(age) || message.length > 2 || age < 18) {
        return ctx.reply('Возраст должен быть числом от 18 до 99 (2 цифры). Попробуйте снова.');
      }
      session.data.age = age;
      session.state = STATES.BACKGROUND;
      return ctx.reply('Выберите футбольное прошлое:', backgroundKeyboard());
    }
    case STATES.BIO: {
      if (!message || message.length > 100) {
        return ctx.reply('Описание должно быть от 1 до 100 символов.');
      }
      session.data.bio = message;
      session.offers = pickBestClubs(session.data);
      session.state = STATES.OFFER_SELECTION;
      const profileText = `Профиль тренера:\n${formatCoachProfile(session.data)}\n\nПодбор клубов:`;
      const offersText = session.offers
        .map((entry, idx) => `${idx + 1}. ${entry.club.name} (${entry.league.name}) — ${entry.probability}% шанса`)
        .join('\n');

      return ctx.reply(`${profileText}\n${offersText}\n\nГотовы узнать, кто сделает оффер?`,
        Markup.inlineKeyboard([Markup.button.callback('🎲 Получить оффер', 'roll_offer')]));
    }
    default:
      return undefined;
  }
});

bot.action(/gender:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const gender = ctx.match[1];
  const session = getSession(ctx);

  if (session.state !== STATES.GENDER) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.gender = gender;
  session.state = STATES.AGE;
  return ctx.reply('Укажите возраст (число, минимум 18 лет, максимум 2 цифры).');
});

bot.action(/background:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const background = ctx.match[1];
  const session = getSession(ctx);

  if (session.state !== STATES.BACKGROUND) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.background = background;
  session.state = STATES.LICENSE;
  return ctx.reply('Выберите тренерскую лицензию:', licenseKeyboard());
});

bot.action(/license:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const license = ctx.match[1];
  const session = getSession(ctx);

  if (session.state !== STATES.LICENSE) {
    return ctx.reply('Давайте завершим текущую анкету.');
  }

  session.data.license = license;
  session.state = STATES.BIO;
  return ctx.reply('Напишите краткое описание тренера (до 100 символов).');
});

bot.action('roll_offer', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx);

  if (session.state !== STATES.OFFER_SELECTION || !session.offers.length) {
    return ctx.reply('Сначала заполните профиль тренера, чтобы получить варианты клубов.');
  }

  session.state = STATES.OFFER_ROLL;
  const spinnerFrames = ['⚽️', '🥅', '🏟️', '🎽', '🧤'];
  const spinMessage = await ctx.reply('Запускаем рулетку предложений...');

  for (let i = 0; i < spinnerFrames.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await bot.telegram.editMessageText(
      spinMessage.chat.id,
      spinMessage.message_id,
      undefined,
      `${spinnerFrames[i]} Рулетка крутится...`
    );
  }

  const winner = weightedPick(session.offers);
  session.state = STATES.OFFER_FINAL;
  session.chosenOffer = winner;

  const resultText = [
    '📩 Пришло предложение!',
    `${winner.club.name} (${winner.league.name}) выходит на связь.`,
    `Вероятность по анализу: ${winner.probability}%`,
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
        Markup.button.callback('✍️ Подписать контракт', 'sign_contract'),
        Markup.button.callback('↩️ Начать заново', 'create_coach')
      ]).reply_markup
    }
  );
});

bot.action('sign_contract', async (ctx) => {
  await ctx.answerCbQuery();
  const session = getSession(ctx);

  if (session.state !== STATES.OFFER_FINAL || !session.chosenOffer) {
    return ctx.reply('Сначала получите оффер и выберите клуб.');
  }

  const summary = [
    'Контракт подписан! 🖊️',
    `Клуб: ${session.chosenOffer.club.name} (${session.chosenOffer.league.name})`,
    '',
    'Данные тренера:',
    formatCoachProfile(session.data),
    '',
    'Следующий этап карьеры будет добавлен в будущих версиях.'
  ].join('\n');

  resetSession(ctx);
  return ctx.reply(summary, startKeyboard());
});

bot.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery('Неизвестное действие.');
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
