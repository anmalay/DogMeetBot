// Импорт необходимых библиотек
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const moment = require("moment");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

const cron = require("node-cron");
require("dotenv").config();
let BOT_START_TIME = Date.now();

// Инициализация Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
  credential: cert(serviceAccount),
});
const db = getFirestore();

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.telegram.setMyCommands([
  { command: "start", description: "Перезапустить бота" },
  { command: "info", description: "Что умеет бот" },
  { command: "help", description: "Помощь и поддержка" },
]);

// Middleware для работы с сессиями
bot.use(session());

// Добавьте этот middleware перед bot.use(stage.middleware())
bot.use(async (ctx, next) => {
  try {
    // Если пользователь находится в сцене (заполняет форму) - не прерываем процесс
    if (ctx.session && ctx.session.__scenes && ctx.session.__scenes.current) {
      console.log(
        `Пользователь ${ctx.from.id} находится в сцене ${ctx.session.__scenes.current}, пропускаем рестарт`
      );
      return next();
    }

    // Если это не callback и не команда /start, проверяем время последнего запуска
    if (!ctx.callbackQuery && (!ctx.message || ctx.message.text !== "/start")) {
      if (
        !ctx.session ||
        !ctx.session.lastInteraction ||
        ctx.session.lastInteraction < BOT_START_TIME
      ) {
        console.log(`Автоматический рестарт для пользователя ${ctx.from.id}`);

        // Сохраняем активные сцены, если есть
        const oldScenes =
          ctx.session && ctx.session.__scenes ? ctx.session.__scenes : null;
        ctx.session = { lastInteraction: Date.now() };

        // Восстанавливаем активную сцену, если была
        if (oldScenes) {
          ctx.session.__scenes = oldScenes;
        }

        // Проверяем, зарегистрирован ли пользователь
        const userDoc = await db
          .collection("users")
          .doc(String(ctx.from.id))
          .get();

        if (userDoc.exists) {
          await ctx.reply("Бот был обновлен. Вот главное меню:", {
            reply_markup: getMainMenuKeyboard(),
          });
        } else {
          if (!oldScenes || oldScenes.current !== "register") {
            const name = ctx.from.first_name || "Друг";
            await ctx.reply(
              `Привет, ${name}! Добро пожаловать в <b>DogMeet</b> — место, где собаки находят друзей, а хозяева — единомышленников!  🐶.\n` +
                "🔍 <b>Находите</b> собачьих друзей поблизости\n\n" +
                "🗓️ <b>Создавайте</b> яркие прогулки одним взмахом лапы\n" +
                "👋 <b>Присоединяйтесь</b> к сообществу любителей собак\n" +
                "🏆 <b>Зарабатывайте</b> уникальные достижения и звания\n\n",
              {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                  [Markup.button.callback("Создать профиль", "create_profile")],
                ]),
              }
            );

            // Устанавливаем флаг, что сообщение приветствия уже отправлено при рестарте
            ctx.session.justRestarted = true;
          }
        }

        // Если мы не в активной сцене, прерываем цепочку
        if (!oldScenes) {
          return;
        }
      }
    }

    // Обновляем время последнего взаимодействия
    if (!ctx.session) ctx.session = {};
    ctx.session.lastInteraction = Date.now();

    return next();
  } catch (error) {
    console.error("Ошибка в middleware автоматического рестарта:", error);
    return next();
  }
});

// Константы для размеров и возраста собак
const DOG_SIZES = {
  SMALL: { text: "Маленькая 🐾 (до 10 кг)", value: "small" },
  MEDIUM: { text: "Средняя 🐕 (10–25 кг)", value: "medium" },
  LARGE: { text: "Крупная 🐕‍🦺 (25+ кг)", value: "large" },
};

const DOG_AGES = {
  PUPPY: { text: "🍼 Щенок (0–6 мес)", value: "puppy" },
  YOUNG: { text: "🐾 Молодая (6 мес – 2 года)", value: "young" },
  ADULT: { text: "🐕 Взрослая (2–7 лет)", value: "adult" },
  SENIOR: { text: "🦴 Старшая (7+ лет)", value: "senior" },
};

const TIME_SELECTION = {
  HOURS: "hours",
  MINUTES: "minutes",
};

// Популярные породы собак
const POPULAR_BREEDS = [
  "Лабрадор",
  "Немецкая овчарка",
  "Хаски",
  "Джек Рассел",
  "Йоркширский терьер",
  "Чихуахуа",
  "Такса",
  "Дворняжка",
  "Корги",
  "Шпиц",
  "Другая (ввести текстом)",
];

// Популярные города
const POPULAR_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
];

// Функция для определения звания участника по количеству прогулок
function getUserRank(totalWalksCount) {
  if (totalWalksCount >= 200) return "Легенда DogMeet";
  if (totalWalksCount >= 120) return "АЛЬФА самец";
  if (totalWalksCount >= 80) return "Мастер прогулок";
  if (totalWalksCount >= 50) return "Бродяга со стажем";
  if (totalWalksCount >= 35) return "Опытный следопыт";
  if (totalWalksCount >= 20) return "Верный спутник";
  if (totalWalksCount >= 10) return "Исследователь парков";
  if (totalWalksCount >= 5) return "Верный друг";
  if (totalWalksCount >= 1) return "Новичок в стае";
  return "Хвостик";
}
// Функция для определения звания организатора
function getOrganizerBadge(organizedCount) {
  if (organizedCount >= 100) return "👑";
  if (organizedCount >= 50) return "🌟🌟🌟";
  if (organizedCount >= 10) return "🌟🌟";
  if (organizedCount >= 1) return "🌟";
  return "";
}

function getNextRankInfo(currentWalkCount) {
  const ranks = [
    { threshold: 1, rank: "Новичок в стае" },
    { threshold: 5, rank: "Верный друг" },
    { threshold: 10, rank: "Исследователь парков" },
    { threshold: 20, rank: "Верный спутник" },
    { threshold: 35, rank: "Опытный следопыт" },
    { threshold: 50, rank: "Бродяга со стажем" },
    { threshold: 80, rank: "Мастер прогулок" },
    { threshold: 120, rank: "АЛЬФА самец" },
    { threshold: 200, rank: "Легенда DogMeet" },
  ];

  for (const rankInfo of ranks) {
    if (currentWalkCount < rankInfo.threshold) {
      return rankInfo;
    }
  }

  return { threshold: "∞", rank: "Легенда DogMeet+" };
}

function isDateToday(dateString) {
  const today = moment().format("DD.MM.YYYY");
  return dateString === today;
}
// Функция для обновления званий пользователяn
async function updateUserRanks(userId) {
  try {
    // Получаем данные пользователя
    const userDoc = await db.collection("users").doc(String(userId)).get();

    if (!userDoc.exists) return;

    const userData = userDoc.data();

    // Инициализируем достижения, если их нет
    if (!userData.achievements) {
      userData.achievements = {
        walkCount: 0,
        organizedCount: 0,
        userRank: "Хвостик",
        organizerBadge: "",
        badges: [],
        specialStatus: {
          title: null,
          expiresAt: null,
        },
        lastUpdated: new Date(),
      };
    }

    // Определяем текущие звания
    const currentUserRank = userData.achievements.userRank;
    const currentOrganizerBadge = userData.achievements.organizerBadge || "";

    // Определяем новые звания
    const newUserRank = getUserRank(userData.achievements.walkCount);
    const newOrganizerBadge = getOrganizerBadge(
      userData.achievements.organizedCount
    );

    // Обновляем звания в базе данных
    await db.collection("users").doc(String(userId)).update({
      "achievements.userRank": newUserRank,
      "achievements.organizerBadge": newOrganizerBadge,
      "achievements.lastUpdated": new Date(),
    });

    // Если достигнут новый ранг, отправляем уведомление
    if (currentUserRank !== newUserRank) {
      await bot.telegram.sendMessage(
        userId,
        `🎖 <b>Поздравляем с новым званием!</b>\n\nВы достигли ранга "${newUserRank}"!\n\nПродолжайте в том же духе и открывайте новые звания!`,
        { parse_mode: "HTML" }
      );
    }

    // Если получена новая метка организатора, отправляем уведомление
    if (currentOrganizerBadge !== newOrganizerBadge && newOrganizerBadge) {
      await bot.telegram.sendMessage(
        userId,
        `🏆 <b>Поздравляем с новой отметкой организатора!</b>\n\nВы получили отметку "${newOrganizerBadge}" за организацию прогулок!\n\nСоздавайте больше прогулок, чтобы получить следующую отметку!`,
        { parse_mode: "HTML" }
      );
    }

    // Возвращаем информацию о изменении званий
    return {
      rankChanged: currentUserRank !== newUserRank,
      badgeChanged: currentOrganizerBadge !== newOrganizerBadge,
      newUserRank,
      newOrganizerBadge,
    };
  } catch (error) {
    console.error("Ошибка при обновлении званий пользователя:", error);
    return null;
  }
}
async function addBadge(userId, badgeId, badgeName, badgeDescription) {
  const userDoc = await db.collection("users").doc(String(userId)).get();
  if (!userDoc.exists) return false;

  const userData = userDoc.data();
  if (!userData.achievements) return false;

  // Проверяем, есть ли уже такой бейдж
  const existingBadge = (userData.achievements.badges || []).find(
    (b) => b.id === badgeId
  );
  if (existingBadge) return false;

  // Создаем объект бейджа
  const badge = {
    id: badgeId,
    name: badgeName,
    description: badgeDescription,
    earnedAt: new Date(),
  };

  // Добавляем бейдж
  await db
    .collection("users")
    .doc(String(userId))
    .update({
      "achievements.badges": admin.firestore.FieldValue.arrayUnion(badge),
    });

  // Отправляем пользователю уведомление
  await bot.telegram.sendMessage(
    userId,
    `🏆 <b>Новое достижение!</b>\n\nВы получили значок "${badgeName}"!\n\n${badgeDescription}`,
    { parse_mode: "HTML" }
  );

  return true;
}

async function checkLuckyTail(userId, walkCount) {
  // Проверяем, является ли это 5-й, 10-й, 15-й и т.д. прогулкой
  if (walkCount % 5 === 0) {
    // Генерируем случайную награду
    const rewards = [
      {
        type: "badge",
        id: "lucky_tail",
        name: "Хвост удачи",
        description: "Случайная удача улыбнулась вам!",
      },
      {
        type: "temp_status",
        id: "dog_star",
        name: "Собачья звезда",
        duration: 3, // дни
        description: "Временный особый статус на 3 дня",
      },
      {
        type: "progress_boost",
        value: 2,
        description: "Двойной прогресс к следующему званию!",
      },
      {
        type: "hidden_achievement",
        id: "mystery_walker",
        name: "Таинственный гуляка",
        description: "Вы открыли скрытое достижение!",
      },
    ];

    // Выбираем случайную награду
    const randomReward = rewards[Math.floor(Math.random() * rewards.length)];

    // Применяем награду в зависимости от типа
    let message = "";

    switch (randomReward.type) {
      case "badge":
        await addBadge(
          userId,
          randomReward.id,
          randomReward.name,
          randomReward.description
        );
        message = `🍀 <b>Хвост удачи!</b>\n\nВы получили особый значок "${randomReward.name}"!`;
        break;

      case "temp_status":
        // Устанавливаем временный статус
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + randomReward.duration);

        await db
          .collection("users")
          .doc(String(userId))
          .update({
            "achievements.specialStatus": {
              title: randomReward.name,
              expiresAt: expiry,
            },
          });

        message = `🍀 <b>Хвост удачи!</b>\n\nВы получили временный статус "${randomReward.name}" на ${randomReward.duration} дня!`;
        break;

      case "progress_boost":
        // В нашем упрощенном варианте просто добавляем еще одну прогулку к счетчику
        await db
          .collection("users")
          .doc(String(userId))
          .update({
            "achievements.walkCount": admin.firestore.FieldValue.increment(1),
          });

        message = `🍀 <b>Хвост удачи!</b>\n\nВы получили бонус +1 к вашему счетчику прогулок!`;
        break;

      case "hidden_achievement":
        await addBadge(
          userId,
          randomReward.id,
          randomReward.name,
          randomReward.description
        );
        message = `🍀 <b>Хвост удачи!</b>\n\nВы открыли скрытое достижение "${randomReward.name}"!`;
        break;
    }

    // Отправляем уведомление о награде
    await bot.telegram.sendMessage(userId, message, { parse_mode: "HTML" });

    return true;
  }

  return false;
}

async function findNearbyWalksUnified(
  ctx,
  latitude,
  longitude,
  statusMsgId,
  maxDistance = 3
) {
  try {
    console.log(
      `Поиск прогулок рядом с (${latitude}, ${longitude}) в радиусе ${maxDistance} км`
    );

    // Получаем ID текущего пользователя
    const currentUserId = ctx.from.id;

    // Получаем все прогулки
    const walksSnapshot = await db.collection("walks").get();

    // Пытаемся удалить статусное сообщение
    try {
      await ctx.deleteMessage(statusMsgId);
    } catch (error) {
      console.log("Не удалось удалить статусное сообщение:", error);
    }

    if (walksSnapshot.empty) {
      await ctx.reply("Прогулок не найдено.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
            [{ text: "⬅️ Назад", callback_data: "find_walk" }],
          ],
        },
      });
      return;
    }

    // Фильтруем прогулки по расстоянию
    const nearbyWalks = [];

    for (const walkDoc of walksSnapshot.docs) {
      const walk = walkDoc.data();

      // Если у прогулки есть координаты
      if (walk.location && walk.location.latitude && walk.location.longitude) {
        const distance = calculateDistance(
          latitude,
          longitude,
          walk.location.latitude,
          walk.location.longitude
        );

        // Если прогулка находится в указанном радиусе
        if (distance <= maxDistance) {
          // Проверяем, является ли пользователь организатором этой прогулки
          const isOwn = walk.organizer.id == currentUserId;

          // Создаем объект с информацией о расстоянии
          const walkWithDistance = {
            ...walk,
            distance: distance,
            isOwn: isOwn,
            // Модифицируем locationText для показа расстояния
            locationText: walk.locationText
              ? `${walk.locationText} (${formatDistance(distance)} от вас)`
              : `По геолокации (${formatDistance(distance)} от вас)`,
          };

          // Создаем объект документа, совместимый с showWalksWithPagination
          nearbyWalks.push({
            id: walkDoc.id,
            data: () => walkWithDistance,
            // Для совместимости с функцией форматирования
            walkWithDistance: walkWithDistance,
          });
        }
      }
    }

    // Если прогулок поблизости не найдено
    if (nearbyWalks.length === 0) {
      await ctx.reply(`Прогулок в радиусе ${maxDistance} км не найдено.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
            [{ text: "⬅️ Назад", callback_data: "find_walk" }],
          ],
        },
      });
      return;
    }

    // Сортируем прогулки по расстоянию (от ближайших к дальним)
    nearbyWalks.sort((a, b) => a.data().distance - b.data().distance);

    // Используем существующую функцию показа прогулок с пагинацией
    await showWalksWithPagination(ctx, nearbyWalks, 0, "find_walk");
  } catch (error) {
    console.error("Ошибка при поиске прогулок поблизости:", error);
    await ctx.reply("Произошла ошибка при поиске прогулок. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
}

// Вспомогательная функция для форматирования расстояния
function formatDistance(distance) {
  return distance < 1
    ? `${Math.round(distance * 1000)} м`
    : `${distance.toFixed(1)} км`;
}

// Модифицированная функция showProfile
async function showProfile(ctx) {
  try {
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

    if (!userDoc.exists) {
      return await ctx.reply(
        "Ваш профиль не найден. Пожалуйста, пройдите регистрацию.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Создать профиль", callback_data: "create_profile" }],
            ],
          },
        }
      );
    }

    const userData = userDoc.data();
    const achievements = userData.achievements || {
      walkCount: 0,
      organizedCount: 0,
      userRank: "Хвостик",
      organizerBadge: "",
      badges: [],
    };

    // Проверяем специальный статус
    let specialStatusText = "";
    if (achievements.specialStatus && achievements.specialStatus.title) {
      const expiryDate = achievements.specialStatus.expiresAt
        ? new Date(achievements.specialStatus.expiresAt)
        : null;
      if (expiryDate && expiryDate > new Date()) {
        specialStatusText = `\n🌟 Особый статус: ${achievements.specialStatus.title}`;
      } else {
        // Если статус истек, удаляем его
        db.collection("users").doc(String(ctx.from.id)).update({
          "achievements.specialStatus.title": null,
          "achievements.specialStatus.expiresAt": null,
        });
      }
    }

    // Формируем текст последних достижений
    let badgesText = "";
    if (achievements.badges && achievements.badges.length > 0) {
      const latestBadges = achievements.badges.slice(-3); // Последние 3 значка
      badgesText = "\n🏅 Последние достижения: \n";
      latestBadges.forEach((badge) => {
        badgesText += `• ${badge.name} - ${badge.description}\n`;
      });
    }

    // Формируем строку с отметкой организатора
    const orgBadge = achievements.organizerBadge
      ? ` ${achievements.organizerBadge}`
      : "";

    const profileText = `
🐕 <b>КАРТОЧКА СОБАКОВОДА</b> 🐕

👤 <b>${userData.name}</b>${orgBadge}
📊 <b>Звание:</b> ${achievements.userRank}
🦴 Прогулок: ${achievements.walkCount} (организовано: ${achievements.organizedCount})${specialStatusText}

📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
${badgesText}
    `;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✏️ Редактировать профиль",
            callback_data: "edit_profile_menu",
          },
          {
            text: "🏆 Все достижения",
            callback_data: "show_all_badges",
          },
        ],
        [
          {
            text: "❓ Как работают звания",
            callback_data: "ranks_info",
          },
        ],
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    };

    // Если у собаки есть фото, отправляем информацию вместе с фото
    if (userData.dog && userData.dog.photoId) {
      // Отправляем фото с подписью
      const photoMsg = await ctx.replyWithPhoto(userData.dog.photoId, {
        caption: profileText,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard.inline_keyboard },
      });

      // Сохраняем ID сообщения с фото
      if (!ctx.session) ctx.session = {};
      ctx.session.lastMessageId = photoMsg.message_id;
    } else {
      // Если нет фото, просто обновляем текущее сообщение
      const msg = await ctx.reply(profileText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Сохраняем ID сообщения
      if (!ctx.session) ctx.session = {};
      ctx.session.lastMessageId = msg.message_id;
    }
  } catch (error) {
    console.error("Ошибка при отображении профиля:", error);
    throw error;
  }
}
// Функция для обновления сообщения вместо отправки нового
// Улучшенная функция обновления сообщений для исправления проблемы с контекстом кнопок
async function updateWizardMessage(ctx, text, keyboard = null) {
  try {
    // Определяем ID сообщения, которое нужно обновить
    let messageId;

    // Если это callback (нажатие на кнопку), используем ID текущего сообщения
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      messageId = ctx.callbackQuery.message.message_id;
    }
    // Иначе берем ID из сессии (если есть)
    else if (ctx.session && ctx.session.lastMessageId) {
      messageId = ctx.session.lastMessageId;
    }

    // Если нашли ID сообщения, обновляем его
    if (messageId) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });

        // Сохраняем ID в сессии для будущих обновлений
        if (!ctx.session) ctx.session = {};
        ctx.session.lastMessageId = messageId;
        return;
      } catch (error) {
        console.log("Ошибка при обновлении сообщения:", error.message);
        // Если не удалось обновить, отправим новое
      }
    }

    // Если не удалось обновить, отправляем новое сообщение
    const msg = await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    // Сохраняем ID нового сообщения
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = msg.message_id;
  } catch (error) {
    console.error("Ошибка в функции updateWizardMessage:", error);
  }
}

// Функция для получения текстового представления размера собаки
function getDogSizeText(size) {
  const sizeObj = Object.values(DOG_SIZES).find((s) => s.value === size);
  return sizeObj ? sizeObj.text.split(" ")[0] : "Средняя";
}

// Добавить эту функцию для форматирования данных о прогулке
function formatWalkInfo(walk, isOwn = false) {
  // Добавляем пометку для собственных прогулок - создает чувство владения
  const ownLabel = isOwn ? "🌟 <b>ВАША ПРОГУЛКА</b>\n" : "";

  // Форматируем информацию о дистанции
  const distanceText = walk.distance
    ? walk.distance < 1
      ? `${Math.round(walk.distance * 1000)} м`
      : `${walk.distance.toFixed(1)} км`
    : "";

  // Добавляем информацию о дистанции с элементом срочности
  const locationInfo = walk.locationText || "По геолокации";
  const locationWithDistance = distanceText
    ? `${locationInfo} (${distanceText} от вас 📌)`
    : locationInfo;

  // Добавляем бейдж организатора, если он есть - статусный элемент
  const organizerBadge =
    walk.organizer.achievements && walk.organizer.achievements.organizerBadge
      ? ` ${walk.organizer.achievements.organizerBadge}`
      : "";

  // Добавляем звание пользователя с элементом престижа
  const userRankDisplay =
    walk.organizer.achievements && walk.organizer.achievements.userRank
      ? `\n🏆 <i>${walk.organizer.achievements.userRank}</i>`
      : "";

  // Добавляем элемент срочности/актуальности
  const timeInfo = isDateToday(walk.date) ? "🔥 СЕГОДНЯ!" : `🗓 ${walk.date}`;

  // Добавляем элемент социального доказательства
  const participantsInfo =
    walk.participants && walk.participants.length > 0
      ? `🐕 Присоединились: ${walk.participants.length + 1} собаководов!`
      : `🐕 Станьте первым участником!`;

  // Собираем текст для предпросмотра прогулки
  return `${ownLabel}${timeInfo}, ${walk.time}
📍 ${locationWithDistance}
${participantsInfo}
👤 ${walk.dog.name} (${walk.organizer.name}${organizerBadge}) ${getDogAgeText(walk.dog.age)}${userRankDisplay}
${walk.organizer.username ? "@" + walk.organizer.username : ""}`.trim();
}

// Функция для миграции данных
async function migrateParticipantsHistory() {
  try {
    // Получаем все прогулки
    const walksSnapshot = await db.collection("walks").get();

    // Словарь для отслеживания участников каждого организатора
    const organizerParticipants = {};

    // Обрабатываем каждую прогулку
    for (const walkDoc of walksSnapshot.docs) {
      const walk = walkDoc.data();

      if (!walk.organizer || !walk.organizer.id) {
        continue;
      }

      const organizerId = String(walk.organizer.id);

      // Инициализируем массив участников для этого организатора
      if (!organizerParticipants[organizerId]) {
        organizerParticipants[organizerId] = [];
      }

      // Добавляем участников в список
      if (walk.participants && Array.isArray(walk.participants)) {
        for (const participant of walk.participants) {
          if (
            participant.id &&
            !organizerParticipants[organizerId].includes(String(participant.id))
          ) {
            organizerParticipants[organizerId].push(String(participant.id));
          }
        }
      }
    }

    // Обновляем данные каждого организатора
    let updatedCount = 0;
    for (const [organizerId, participants] of Object.entries(
      organizerParticipants
    )) {
      if (participants.length > 0) {
        try {
          await db.collection("users").doc(organizerId).update({
            "walkHistory.participants": participants,
            "walkHistory.lastUpdated": new Date(),
          });
          updatedCount++;
        } catch (error) {
          console.error(
            `Ошибка при обновлении организатора ${organizerId}:`,
            error
          );
        }
      }
    }

    return {
      success: true,
      message: `Миграция завершена. Обновлено ${updatedCount} организаторов.`,
    };
  } catch (error) {
    console.error("Ошибка при миграции данных:", error);
    return {
      success: false,
      message: "Произошла ошибка при миграции данных: " + error.message,
    };
  }
}

// Улучшенная функция для уведомления пользователей поблизости о новой прогулке
async function notifyNearbyUsers(walkId, organizer, walkData) {
  try {
    console.log(`Отправка уведомлений о новой прогулке ${walkId}`);

    // Если у прогулки нет координат, не можем определить расстояние
    if (
      !walkData.location ||
      !walkData.location.latitude ||
      !walkData.location.longitude
    ) {
      console.log(
        "У прогулки нет координат, пропускаем отправку уведомлений по геолокации"
      );
      return;
    }

    // Получаем координаты места прогулки
    const walkLatitude = walkData.location.latitude;
    const walkLongitude = walkData.location.longitude;

    // Получаем всех пользователей из базы данных
    const usersSnapshot = await db.collection("users").get();

    let notificationCount = 0;

    // Перебираем всех пользователей
    for (const userDoc of usersSnapshot.docs) {
      const user = userDoc.data();

      // Пропускаем организатора (не отправляем уведомление самому себе)
      if (user.id === organizer.id) continue;

      // Проверяем, есть ли у пользователя сохраненная геолокация
      if (user.location && user.location.latitude && user.location.longitude) {
        // Рассчитываем расстояние между пользователем и местом прогулки
        const distance = calculateDistance(
          user.location.latitude,
          user.location.longitude,
          walkLatitude,
          walkLongitude
        );

        // Если пользователь находится в радиусе 3 км от места прогулки
        if (distance <= 3) {
          console.log(
            `Пользователь ${user.id} находится в ${distance.toFixed(2)} км от прогулки, отправляем уведомление`
          );

          // Форматируем расстояние для отображения
          const distanceText =
            distance < 1
              ? `${Math.round(distance * 1000)} метрах`
              : `${distance.toFixed(1)} км`;

          // Формируем подробную информацию о прогулке
          const walkDetailsText = `
  🔔 НОВАЯ ПРОГУЛКА РЯДОМ С ВАМИ!
  
  🗓 Дата и время: ${walkData.date}, ${walkData.time}
  📍 Место: ${walkData.locationText || "По геолокации"} (в ${distanceText} от вас)
  🔄 Тип: ${walkData.type === "single" ? "Разовая" : "Регулярная"}
            
  👤 Организатор: ${organizer.name}
  🐕 Собака: ${organizer.dog.name}, ${organizer.dog.breed}, ${getDogSizeText(organizer.dog.size)}, ${getDogAgeText(organizer.dog.age)}
  
  ❗️ Помните: звания и отметки начисляются только после завершения прогулки

  Присоединяйтесь к прогулке!
  `;

          // Отправляем уведомление пользователю
          await bot.telegram.sendMessage(user.id, walkDetailsText, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Присоединиться",
                    callback_data: `join_walk_${walkId}`,
                  },
                ],
                [
                  {
                    text: "🔍 Подробности",
                    callback_data: `walk_details_${walkId}`,
                  },
                ],
                [
                  {
                    text: "❌ Пропустить",
                    callback_data: "dismiss_notification",
                  },
                ],
              ],
            },
          });

          // Если у организатора есть фото собаки, отправляем и его
          if (organizer.dog.photoId) {
            await bot.telegram.sendPhoto(user.id, organizer.dog.photoId, {
              caption: "Фото собаки организатора",
            });
          }

          notificationCount++;
        }
      }
    }

    console.log(`Отправлено ${notificationCount} уведомлений о новой прогулке`);

    // Информируем организатора о количестве отправленных уведомлений
    if (notificationCount > 0) {
      await bot.telegram.sendMessage(
        organizer.id,
        `✅ <b>🎉 ПРОГУЛКА СОЗДАНА! 🎉</b>\n\n` +
          `🔔 Мы уведомили ${notificationCount} владельцев собак поблизости`,
        { parse_mode: "HTML" }
      );
    }
  } catch (error) {
    console.error("Ошибка при отправке уведомлений о новой прогулке:", error);
  }
}

async function remindAboutWalks() {
  const now = new Date();
  const today = moment(now).format("DD.MM.YYYY");

  // Получаем все прогулки
  const walksSnapshot = await db.collection("walks").get();
  console.log(`Проверка ${walksSnapshot.docs.length} прогулок на ${today}`);

  for (const walkDoc of walksSnapshot.docs) {
    const walk = walkDoc.data();
    const walkId = walkDoc.id;

    // Парсим время прогулки
    const [hours, minutes] = walk.time.split(":").map(Number);
    const walkTime = new Date();

    // Парсим дату прогулки
    const [day, month, year] = walk.date.split(".").map(Number);
    walkTime.setFullYear(year, month - 1, day); // Месяцы в JavaScript начинаются с 0
    walkTime.setHours(hours, minutes, 0, 0);

    // Проверяем, что прогулка уже прошла и прошло более часа
    const timeDiffMinutes = Math.round((now - walkTime) / (1000 * 60));

    // Обрабатываем разовые прогулки
    if (walk.type === "single" && timeDiffMinutes > 60) {
      // Проверяем, не архивирована ли уже прогулка
      if (!walk.status || walk.status !== "archived") {
        // Архивируем прогулку
        await db.collection("walks").doc(walkId).update({
          status: "archived",
          archivedAt: new Date(),
        });
        console.log(
          `Прогулка ${walkId} архивирована (прошла более часа назад)`
        );

        // Записываем прогулку в достижения
        await recordCompletedWalk(walkId);
      }
      continue;
    }

    // Обрабатываем регулярные прогулки
    if (
      walk.type === "regular" &&
      walk.date === today &&
      timeDiffMinutes > 60
    ) {
      // Создаем или обновляем массив прошедших экземпляров регулярной прогулки
      const lastOccurrences = walk.lastOccurrences || [];
      const isTodayCompleted = lastOccurrences.some(
        (occurrence) => occurrence.date === today
      );

      if (!isTodayCompleted) {
        // Добавляем сегодняшнюю дату как завершенную
        const updatedOccurrences = [
          ...lastOccurrences,
          {
            date: today,
            status: "completed",
            completedAt: new Date(),
          },
        ];

        // Ограничиваем размер истории (хранить последние 30 дней)
        if (updatedOccurrences.length > 30) {
          updatedOccurrences.shift();
        }

        await db.collection("walks").doc(walkId).update({
          lastOccurrences: updatedOccurrences,
        });

        console.log(
          `Регулярная прогулка ${walkId} отмечена как завершенная на ${today}`
        );

        // Записываем прогулку в достижения
        await recordCompletedWalk(walkId);
      }
      continue;
    }

    // Напоминание о предстоящей прогулке (только для прогулок сегодня)
    if (walk.date === today) {
      // Проверяем, что до прогулки осталось примерно 15 минут
      const timeToWalkMinutes = Math.round((walkTime - now) / (1000 * 60));

      if (timeToWalkMinutes > 14 && timeToWalkMinutes < 16) {
        // Отправляем напоминания всем участникам и организатору
        const reminderText = `
🔔 Напоминание: у вас прогулка через 15 минут!
🗓 ${walk.date}, ${walk.time}
📍 ${walk.locationText || "По геолокации"}
`;

        // Уведомляем организатора
        try {
          await bot.telegram.sendMessage(walk.organizer.id, reminderText, {
            reply_markup: getMainMenuKeyboard(),
          });
        } catch (error) {
          console.error(
            `Ошибка при отправке напоминания организатору ${walk.organizer.id}:`,
            error
          );
        }

        // Уведомляем всех участников
        if (walk.participants && Array.isArray(walk.participants)) {
          for (const participant of walk.participants) {
            try {
              await bot.telegram.sendMessage(participant.id, reminderText, {
                reply_markup: getMainMenuKeyboard(),
              });
            } catch (error) {
              console.error(
                `Ошибка при отправке напоминания участнику ${participant.id}:`,
                error
              );
            }
          }
        }
      }
    }
  }
}

// Функция для расчёта расстояния между двумя точками в км (формула гаверсинусов)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Радиус Земли в километрах

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Расстояние в километрах

  return distance;
}

// Функция для поиска прогулок поблизости

// Функция для отображения списка прогулок с пагинацией
async function showWalksWithPagination(
  ctx,
  walks,
  page = 0,
  returnCommand = "back_to_main_menu"
) {
  // Настройки пагинации
  const walksPerPage = 3; // Прогулок на странице
  const totalPages = Math.ceil(walks.length / walksPerPage);
  const currentPageWalks = walks.slice(
    page * walksPerPage,
    (page + 1) * walksPerPage
  );

  if (walks.length === 0) {
    return await updateWizardMessage(ctx, "Прогулок не найдено.", {
      inline_keyboard: [
        [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
        [{ text: "⬅️ Назад", callback_data: returnCommand }],
      ],
    });
  }

  // Сначала построим текст для списка прогулок
  let messageText = `Найдено ${walks.length} прогулок:\n\n`;

  // Добавляем каждую прогулку в сообщение
  currentPageWalks.forEach((walkDoc, index) => {
    const walk = walkDoc.data ? walkDoc.data() : walkDoc;
    const isOwn = walk.organizer && walk.organizer.id == ctx.from.id;
    messageText += formatWalkInfo(walk, isOwn);

    // Добавляем разделитель между прогулками
    if (index < currentPageWalks.length - 1) {
      messageText += "\n\n" + "─────────────────\n\n";
    }
  });

  // Добавим информацию о странице
  messageText += `\n\nСтраница ${page + 1} из ${totalPages}`;

  // Строим клавиатуру для прогулок
  const keyboard = [];

  // Добавляем кнопки для каждой прогулки
  currentPageWalks.forEach((walkDoc, index) => {
    const walkId = walkDoc.id;
    keyboard.push([
      {
        text: `Подробнее о прогулке ${index + 1}`,
        callback_data: `walk_details_${walkId}`,
      },
    ]);
  });

  // Добавляем кнопки пагинации
  const paginationRow = [];
  if (page > 0) {
    paginationRow.push({
      text: "◀️ Назад",
      callback_data: `pagination_${page - 1}_${returnCommand}`,
    });
  }
  if (page < totalPages - 1) {
    paginationRow.push({
      text: "Вперёд ▶️",
      callback_data: `pagination_${page + 1}_${returnCommand}`,
    });
  }

  if (paginationRow.length > 0) {
    keyboard.push(paginationRow);
  }

  // Добавляем кнопку возврата
  keyboard.push([{ text: "⬅️ Назад в меню", callback_data: returnCommand }]);

  // Обновляем сообщение
  await updateWizardMessage(ctx, messageText, { inline_keyboard: keyboard });

  // Сохраняем данные в сессии для пагинации
  if (!ctx.session) ctx.session = {};
  ctx.session.lastWalks = walks;
  ctx.session.lastReturnCommand = returnCommand;
}

async function recordCompletedWalk(walkId) {
  try {
    const walkDoc = await db.collection("walks").doc(walkId).get();
    if (!walkDoc.exists) return false;

    const walk = walkDoc.data();

    // Обновляем счетчик организованных прогулок для организатора
    await db
      .collection("users")
      .doc(String(walk.organizer.id))
      .update({
        "achievements.organizedCount": admin.firestore.FieldValue.increment(1),
      });

    // Обновляем звания организатора
    await updateUserRanks(walk.organizer.id);

    // Обновляем счетчик прогулок для организатора
    const organizerDoc = await db
      .collection("users")
      .doc(String(walk.organizer.id))
      .get();
    const newOrganizerWalkCount =
      (organizerDoc.data().achievements.walkCount || 0) + 1;

    await db.collection("users").doc(String(walk.organizer.id)).update({
      "achievements.walkCount": newOrganizerWalkCount,
    });

    // ДОБАВИТЬ: Проверка на случайную награду для организатора
    await checkLuckyTail(walk.organizer.id, newOrganizerWalkCount);

    // Обновляем счетчик прогулок для всех участников
    if (walk.participants && walk.participants.length > 0) {
      for (const participant of walk.participants) {
        // Получаем текущее количество прогулок
        const userDoc = await db
          .collection("users")
          .doc(String(participant.id))
          .get();
        const newWalkCount = (userDoc.data().achievements.walkCount || 0) + 1;

        await db.collection("users").doc(String(participant.id)).update({
          "achievements.walkCount": newWalkCount,
        });

        // ДОБАВИТЬ: Проверка на случайную награду для участника
        await checkLuckyTail(participant.id, newWalkCount);

        // Обновляем звания участника
        await updateUserRanks(participant.id);
      }
    }

    console.log(`Прогулка ${walkId} учтена в достижениях всех участников`);
    return true;
  } catch (error) {
    console.error("Ошибка при записи завершенной прогулки:", error);
    return false;
  }
}
// Вспомогательная функция для завершения регистрации
// Вспомогательная функция для завершения регистрации
async function finishRegistration(ctx) {
  try {
    const userData = ctx.wizard.state.userData || {};

    // Устанавливаем дефолтные значения для всех отсутствующих полей
    userData.name = userData.name || "Не указано";
    userData.city = userData.city || "Не указан";
    userData.dogName = userData.dogName || "Не указано";
    userData.dogBreed = userData.dogBreed || "Не указана";
    userData.dogSize = userData.dogSize || "Не указана";
    userData.dogAge = userData.dogAge || "Не указана";

    // Добавляем систему достижений при регистрации
    const achievements = {
      walkCount: 0,
      organizedCount: 0,
      userRank: "Хвостик",
      organizerBadge: "",
      badges: [],
      specialStatus: {
        title: null,
        expiresAt: null,
      },
      lastUpdated: new Date(),
    };

    // Сохраняем данные пользователя в базу данных
    const user = {
      id: ctx.from.id,
      username: ctx.from.username || null,
      name: userData.name,
      city: userData.city,
      location: userData.location || null,
      dog: {
        name: userData.dogName,
        breed: userData.dogBreed,
        size: userData.dogSize,
        age: userData.dogAge,
        photoId: userData.dogPhotoId || null,
      },
      achievements: achievements,
      createdAt: new Date(),
    };

    await db.collection("users").doc(String(ctx.from.id)).set(user);

    // Отправляем завершающее сообщение
    await updateWizardMessage(
      ctx,
      "<b>🎉 УРА! ПРОФИЛЬ СОЗДАН! 🎉</b> \n\n" +
        '🏆 Вы получили звание "<b>Хвостик</b>"!\n\n' +
        "🐾 Теперь вы можете:\n" +
        "- Создавать веселые прогулки\n" +
        "- Искать новых друзей поблизости \n" +
        "- Зарабатывать достижения и повышать уровень\n\n" +
        "<i>Готовы к первой прогулке? Начните прямо сейчас!</i>",
      getMainMenuKeyboard()
    );
  } catch (error) {
    console.error("Ошибка при завершении регистрации:", error);
    await ctx.reply(
      "Произошла ошибка при регистрации. Попробуйте снова.",
      Markup.removeKeyboard()
    );
  }
}
// Добавить эту функцию перед определением сцен редактирования прогулки
async function initWalkEditScene(ctx, sceneName) {
  try {
    console.log(`Инициализация сцены редактирования ${sceneName}`);

    // Получаем ID из сессии
    if (!ctx.session) ctx.session = {};
    const walkId = ctx.session.editWalkId;

    if (!walkId) {
      console.error("ID прогулки не найден в сессии!");
      ctx.reply("Ошибка: не удалось найти идентификатор прогулки", {
        reply_markup: getMainMenuKeyboard(),
      });
      return { success: false };
    }

    // Сохраняем ID в state
    ctx.wizard.state.walkId = walkId;
    ctx.wizard.state.walkData = {};

    return { success: true, walkId };
  } catch (error) {
    console.error(`Ошибка при инициализации сцены ${sceneName}:`, error);
    ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
    return { success: false };
  }
}

async function requestLocation(ctx, message, buttonText, flagName) {
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      message,
      Markup.keyboard([[Markup.button.locationRequest(buttonText)]]).resize()
    );

    // Устанавливаем флаг в wizard.state
    if (ctx.wizard && ctx.wizard.state) {
      ctx.wizard.state[flagName] = true;
    }
  } catch (error) {
    console.error("Ошибка при запросе геолокации:", error);
    await ctx.reply("Произошла ошибка. Пожалуйста, попробуйте снова.");
  }
}

// Функция для поиска прогулок в городе (без учета регистра)
async function findWalksInCity(ctx, city) {
  try {
    console.log(`Поиск прогулок в городе: ${city}`);

    // Получаем ID текущего пользователя
    const currentUserId = ctx.from.id;

    // Получаем все прогулки
    const walksSnapshot = await db.collection("walks").get();

    if (walksSnapshot.empty) {
      await ctx.reply("Прогулок не найдено.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
            [{ text: "⬅️ Назад", callback_data: "find_walk" }],
          ],
        },
      });
      return;
    }

    // Нормализуем город для сравнения (приводим к нижнему регистру)
    const normalizedCity = city.toLowerCase();

    // Фильтруем прогулки по городу
    const cityWalks = [];

    for (const walkDoc of walksSnapshot.docs) {
      const walk = walkDoc.data();

      // Получаем данные организатора для проверки города
      const organizerDoc = await db
        .collection("users")
        .doc(String(walk.organizer.id))
        .get();

      if (organizerDoc.exists) {
        const organizerData = organizerDoc.data();

        // Проверяем совпадение города (без учета регистра)
        if (
          organizerData.city &&
          organizerData.city.toLowerCase() === normalizedCity
        ) {
          // Проверяем, является ли пользователь организатором этой прогулки
          const isOwn = walk.organizer.id == currentUserId;

          cityWalks.push({
            id: walkDoc.id,
            ...walk,
            isOwn: isOwn, // Добавляем пометку
          });
        }
      }
    }

    // Если в городе нет прогулок
    if (cityWalks.length === 0) {
      await ctx.reply(
        `В городе ${city} пока нет активных прогулок. 😔\n\n` +
          `💡 Пригласите друзей и соседей присоединиться к DogMeet, чтобы вместе гулять с собаками!\n\n` +
          `🐕 Или создайте свою прогулку, и другие владельцы собак смогут к вам присоединиться.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
              [
                {
                  text: "👥 Пригласить друзей",
                  callback_data: "invite_friends",
                },
              ],
              [{ text: "⬅️ Назад", callback_data: "find_walk" }],
            ],
          },
        }
      );
      return;
    }

    // Сортируем прогулки по дате и времени
    cityWalks.sort((a, b) => {
      // Сначала сравниваем даты
      const dateA = a.date.split(".").reverse().join("-");
      const dateB = b.date.split(".").reverse().join("-");

      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      // Если даты одинаковые, сравниваем время
      return a.time.localeCompare(b.time);
    });

    // Выводим найденные прогулки
    await ctx.reply(`Найдено ${cityWalks.length} прогулок в городе ${city}:`);

    // Показываем список прогулок
    for (const walk of cityWalks) {
      // Добавляем пометку для собственных прогулок
      const ownLabel = walk.isOwn ? "🌟 МОЯ ПРОГУЛКА\n" : "";

      const organizerBadge =
        walk.organizer.achievements &&
        walk.organizer.achievements.organizerBadge
          ? ` ${walk.organizer.achievements.organizerBadge}`
          : "";

      const walkPreview = `${ownLabel}🕒 ${walk.date}, ${walk.time}
📍 ${locationWithDistance}
🐕 Участников: ${walk.participants ? walk.participants.length + 1 : 1}
👤 ${walk.dog.name} (${walk.organizer.name}${organizerBadge}) ${getDogAgeText(walk.dog.age)}${userRankDisplay}
${walk.organizer.username ? "@" + walk.organizer.username : ""}`.trim();

      await ctx.reply(walkPreview, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Подробнее", callback_data: `walk_details_${walk.id}` }],
          ],
        },
      });
    }

    await ctx.reply("Вернуться:", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  } catch (error) {
    console.error("Ошибка при поиске прогулок в городе:", error);
    await ctx.reply("Произошла ошибка при поиске прогулок. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
}

// Общая функция публикации прогулки
async function publishWalk(ctx, walkData, userData) {
  // Создаем прогулку в БД
  const walkRef = await db.collection("walks").add({
    date: walkData.date,
    time: walkData.time,
    locationText: walkData.locationText || null,
    location: walkData.location || null,
    type: walkData.type,
    organizer: {
      id: ctx.from.id,
      name: userData.name,
      username: ctx.from.username || null,
    },
    dog: {
      name: userData.dog.name,
      breed: userData.dog.breed,
      size: userData.dog.size,
      age: userData.dog.age,
      photoId: userData.dog.photoId,
    },
    participants: [],
    createdAt: new Date(),
  });

  // Сообщаем об успехе
  await ctx.reply("<b>🎉 ПРОГУЛКА СОЗДАНА! 🎉</b>", {
    reply_markup: getMainMenuKeyboard(),
  });

  console.log("Запускаем отправку уведомлений");
  try {
    // Уведомляем пользователей поблизости
    await notifyNearbyUsers(walkRef.id, userData, walkData);

    // Уведомляем предыдущих участников
    console.log("Запускаем отправку уведомлений предыдущим участникам");
    await notifyPreviousParticipantsFromProfiles(
      ctx.from.id,
      walkRef.id,
      walkData
    );
  } catch (error) {
    console.error("Ошибка при отправке уведомлений:", error);
  }

  return walkRef.id;
}
async function getLocationCity(latitude, longitude) {
  try {
    // Используем OpenStreetMap Nominatim API для обратного геокодирования
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
      {
        headers: {
          "User-Agent": "DogMeetBot/1.0", // Важно указать User-Agent для Nominatim API
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Ошибка API: ${response.status}`);
    }

    const data = await response.json();

    // Извлекаем название города из ответа
    // Nominatim может вернуть разные уровни: city, town, village и т.д.
    const city =
      data.address.city ||
      data.address.town ||
      data.address.village ||
      data.address.suburb ||
      data.address.county ||
      data.address.state;

    return city || null;
  } catch (error) {
    console.error("Ошибка при определении города:", error);
    return null; // В случае ошибки возвращаем null
  }
}
async function notifyPreviousParticipantsFromProfiles(
  organizerId,
  walkId,
  walkData
) {
  try {
    // Преобразуем ID организатора в строку (для работы с Firestore)
    const organizerIdStr = String(organizerId);

    const organizerDoc = await db.collection("users").doc(organizerIdStr).get();

    if (!organizerDoc.exists) {
      console.error(`Не найден профиль организатора с ID: ${organizerIdStr}`);
      return 0;
    }

    const organizer = organizerDoc.data();

    // Проверяем наличие walkHistory
    if (!organizer.walkHistory) {
      console.log("У организатора нет объекта walkHistory");
      return 0;
    }

    // Проверяем наличие массива participants
    if (!organizer.walkHistory.participants) {
      console.log("У организатора нет walkHistory.participants");
      return 0;
    }

    // Проверяем, что participants - это массив
    if (!Array.isArray(organizer.walkHistory.participants)) {
      console.log(
        "walkHistory.participants не является массивом, его тип:",
        typeof organizer.walkHistory.participants
      );
      return 0;
    }

    // Проверяем, что массив не пустой
    if (organizer.walkHistory.participants.length === 0) {
      console.log("Массив participants пуст");
      return 0;
    }

    const participants = organizer.walkHistory.participants;

    let sentCount = 0;

    for (const participantId of participants) {
      try {
        // Проверяем ID на валидность
        if (!participantId) {
          console.log("Пустой ID участника, пропускаем");
          continue;
        }

        // Преобразуем ID участника в число для отправки через Telegram API
        const participantIdNum = Number(participantId);

        if (isNaN(participantIdNum)) {
          console.log(`ID участника не является числом: ${participantId}`);
          continue;
        }

        // Проверяем, существует ли пользователь
        const userDoc = await db
          .collection("users")
          .doc(String(participantId))
          .get();

        if (!userDoc.exists) {
          console.log(`Пользователь ${participantId} не найден, пропускаем`);
          continue;
        }

        const notificationText = `
🔔 НОВАЯ ПРОГУЛКА ОТ ЗНАКОМОГО ХОЗЯИНА!
  
👋 Ранее вы присоединялись к прогулке с ${organizer.name} и ${organizer.dog.name}! 
Хотите присоединиться снова?
  
🗓 Дата и время: ${walkData.date}, ${walkData.time}
📍 Место: ${walkData.locationText || "По геолокации"}
🔄 Тип: ${walkData.type === "single" ? "Разовая" : "Регулярная"}
`;

        await bot.telegram.sendMessage(participantIdNum, notificationText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Присоединиться",
                  callback_data: `join_walk_${walkId}`,
                },
              ],
              [
                {
                  text: "🔍 Подробности",
                  callback_data: `walk_details_${walkId}`,
                },
              ],
              [
                {
                  text: "❌ Пропустить",
                  callback_data: "dismiss_notification",
                },
              ],
            ],
          },
        });

        sentCount++;
      } catch (error) {
        console.error(
          `❌ Ошибка отправки уведомления участнику ${participantId}:`,
          error
        );
      }
    }

    // Возвращаем количество отправленных уведомлений
    return sentCount;
  } catch (error) {
    console.error("❌ ОШИБКА при уведомлении предыдущих участников:", error);
    return 0;
  }
}
// Функция для получения текстового представления возраста собаки
function getDogAgeText(age) {
  const ageObj = Object.values(DOG_AGES).find((a) => a.value === age);
  return ageObj ? ageObj.text.split(" ")[0] : "Взрослая";
}

function getWalkFiltersKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔹 Прогулки рядом", callback_data: "walks_nearby" }],
      [
        { text: "📅 Сегодня", callback_data: "walks_today" },
        { text: "📅 Завтра", callback_data: "walks_tomorrow" },
        { text: "📅 Все даты", callback_data: "walks_all_dates" },
      ],
      [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
    ],
  };
}

// Функция для проверки валидности строковых данных
function isValidString(str) {
  // Проверяем, что строка не пустая, не "null", "undefined", и т.д.
  return (
    str &&
    typeof str === "string" &&
    str.trim() !== "" &&
    str.toLowerCase() !== "null" &&
    str.toLowerCase() !== "undefined"
  );
}

function isValidDate(dateStr) {
  // Проверка формата ДД.ММ.ГГГГ
  const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
  if (!dateRegex.test(dateStr)) {
    return false;
  }

  // Проверка валидности даты
  const [day, month, year] = dateStr.split(".").map(Number);
  const date = new Date(year, month - 1, day);

  // Проверка существования даты в календаре
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }

  // Проверка, что дата не из прошлого
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Сбрасываем время, чтобы сравнивать только даты

  return date >= today;
}

async function notifyWalkParticipants(participants, message) {
  if (!participants || participants.length === 0) return;

  for (const participant of participants) {
    try {
      // Добавляем главное меню к каждому уведомлению
      await bot.telegram.sendMessage(participant.id, message, {
        reply_markup: getMainMenuKeyboard(),
      });
    } catch (error) {
      console.error(
        `Ошибка при отправке уведомления участнику ${participant.id}:`,
        error
      );
    }
  }
}

// Сцена регистрации пользователя
const registerScene = new Scenes.WizardScene(
  "register",
  async (ctx) => {
    // Инициализируем объект с данными пользователя
    ctx.wizard.state.userData = {};

    // Получаем имя из профиля Telegram
    const firstName = ctx.from.first_name || "";
    const lastName = ctx.from.last_name || "";

    // Сохраняем полное имя
    ctx.wizard.state.userData.name =
      firstName + (lastName ? " " + lastName : "");

    // Отправляем первое сообщение и сохраняем его ID
    const welcomeText =
      `${ctx.wizard.state.userData.name}, Чтобы находить прогулки рядом с вами, мне нужно узнать, где вы находитесь.\n\n` +
      `💡 <b>Совет</b>: Отправка геолокации позволит:\n` +
      `• Получать уведомления о прогулках поблизости\n` +
      `• Использовать фильтр "Прогулки рядом"\n` +
      `• Находить собачьих друзей в вашем районе`;

    const keyboard = {
      inline_keyboard: [
        // Кнопки с городами
        ...POPULAR_CITIES.map((city) => [
          { text: city, callback_data: `city_${city}` },
        ]),
        // Кнопка геолокации
        [
          {
            text: "📍 Отправить геолокацию (рекомендуется)",
            callback_data: "send_location_reg",
          },
        ],
      ],
    };

    // Отправляем сообщение и сохраняем ID
    const msg = await ctx.reply(welcomeText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    // Сохраняем ID сообщения
    ctx.wizard.state.messageId = msg.message_id;

    return ctx.wizard.next();
  },

  // Шаг 2: Обработка города/геолокации
  async (ctx) => {
    try {
      // Обработка callback
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data.startsWith("city_")) {
          ctx.wizard.state.userData.city = data.replace("city_", "");

          // Обновляем сообщение - переходим к имени собаки
          await updateWizardMessage(
            ctx,
            "<b>А как зовут вашего хвостатого друга?</b> 🐶",
            null
          );

          return ctx.wizard.next();
        } else if (data === "send_location_reg") {
          // Обновляем сообщение с запросом геолокации
          await updateWizardMessage(
            ctx,
            "Нажмите кнопку внизу экрана, чтобы отправить вашу геолокацию:",
            null
          );

          // Показываем физическую клавиатуру с кнопкой геолокации
          const keyboardMsg = await ctx.reply(
            "Используйте эту кнопку:",
            Markup.keyboard([
              [Markup.button.locationRequest("📍 Отправить мою геолокацию")],
            ]).resize()
          );

          // Сохраняем ID сообщения с клавиатурой чтобы удалить позже
          ctx.wizard.state.keyboardMsgId = keyboardMsg.message_id;
          ctx.wizard.state.waitingForLocationReg = true;
          return;
        }
      }
      // Обработка геолокации
      else if (ctx.message && ctx.message.location) {
        console.log("Получены координаты:", ctx.message.location);

        // Сохраняем координаты
        ctx.wizard.state.userData.location = {
          latitude: ctx.message.location.latitude,
          longitude: ctx.message.location.longitude,
        };

        // Удаляем сообщение с геолокацией
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение с геолокацией");
        }

        // Удаляем сообщение с клавиатурой
        if (ctx.wizard.state.keyboardMsgId) {
          try {
            await ctx.deleteMessage(ctx.wizard.state.keyboardMsgId);
            delete ctx.wizard.state.keyboardMsgId;
          } catch (error) {
            console.log("Не удалось удалить сообщение с клавиатурой");
          }
        }

        // Получаем название города из координат
        const cityName = await getLocationCity(
          ctx.message.location.latitude,
          ctx.message.location.longitude
        ).catch((err) => {
          console.error("Ошибка при определении города:", err);
          return "Определен по геолокации";
        });

        ctx.wizard.state.userData.city = cityName || "Определен по геолокации";

        // Обновляем основное сообщение с подтверждением и запросом имени собаки
        await updateWizardMessage(
          ctx,
          "🎉 Отлично! Геолокация сохранена.\n\n<b>А как зовут вашего хвостатого друга?</b> 🐶",
          null
        );

        return ctx.wizard.next();
      }

      // Если мы здесь без геолокации/callback, спрашиваем имя собаки
      await updateWizardMessage(
        ctx,
        "<b>А как зовут вашего хвостатого друга?</b> 🐶",
        null
      );
      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка при обработке города/геолокации:", error);
      await updateWizardMessage(
        ctx,
        "Произошла ошибка. Пожалуйста, выберите город из списка:",
        {
          inline_keyboard: POPULAR_CITIES.map((city) => [
            { text: city, callback_data: `city_${city}` },
          ]),
        }
      );
      // Не переходим дальше, оставаясь на этом шаге
      return;
    }
  },

  // Шаг 3: Имя собаки
  async (ctx) => {
    if (ctx.message && ctx.message.text) {
      if (!isValidString(ctx.message.text)) {
        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите корректное имя собаки:"
        );
        return; // Остаемся на этом же шаге
      }

      ctx.wizard.state.userData.dogName = ctx.message.text;

      // Удаляем сообщение пользователя, чтобы не засорять чат
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя");
      }
    }

    // Обновляем сообщение с выбором породы
    const keyboard = {
      inline_keyboard: POPULAR_BREEDS.map((breed) => [
        { text: breed, callback_data: `breed_${breed}` },
      ]),
    };

    await updateWizardMessage(
      ctx,
      "<b>Какой породы ваш четвероногий компаньон?</b> 🧬\n" +
        "<i>(Выберите из списка или введите вручную)</i>",
      keyboard
    );
    return ctx.wizard.next();
  },

  // Шаг 4: Порода собаки
  async (ctx) => {
    // Обработка callback для выбора породы
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("breed_")) {
      const breed = ctx.callbackQuery.data.replace("breed_", "");
      await ctx.answerCbQuery();

      if (breed === "Другая (ввести текстом)") {
        await updateWizardMessage(
          ctx,
          "<b>Какой породы ваш четвероногий компаньон?</b> 🧬\n" +
            "<i>(Выберите из списка или введите вручную)</i>"
        );
        ctx.wizard.state.waitingForCustomBreed = true;
        return;
      } else {
        ctx.wizard.state.userData.dogBreed = breed;

        // Переходим к следующему шагу - размер собаки
        const sizeKeyboard = {
          inline_keyboard: [
            [
              {
                text: "🐾 Маленькая (до 10 кг)",
                callback_data: "size_small",
              },
            ],
            [
              {
                text: "🐕 Средняя (10–25 кг)",
                callback_data: "size_medium",
              },
            ],
            [{ text: "🐕‍🦺 Крупная (25+ кг)", callback_data: "size_large" }],
          ],
        };

        await updateWizardMessage(
          ctx,
          "<b>Размер имеет значение!</b> 📏 \n\n" +
            "Подберем подходящую компанию для вашего питомца:",
          sizeKeyboard
        );
        return ctx.wizard.next();
      }
    }
    // Обработка ввода произвольной породы
    else if (
      ctx.wizard.state.waitingForCustomBreed &&
      ctx.message &&
      ctx.message.text
    ) {
      if (!isValidString(ctx.message.text)) {
        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите корректную породу:"
        );
        return; // Остаемся на этом же шаге
      }

      ctx.wizard.state.userData.dogBreed = ctx.message.text;
      ctx.wizard.state.waitingForCustomBreed = false;

      // Удаляем сообщение пользователя, чтобы не засорять чат
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя");
      }

      // Переходим к следующему шагу - размер собаки
      const sizeKeyboard = {
        inline_keyboard: [
          [
            [
              {
                text: "🐾 Маленькая (до 10 кг)",
                callback_data: "size_small",
              },
            ],
            [
              {
                text: "🐕 Средняя (10–25 кг)",
                callback_data: "size_medium",
              },
            ],
            [{ text: "🐕‍🦺 Крупная (25+ кг)", callback_data: "size_large" }],
          ],
        ],
      };

      await updateWizardMessage(
        ctx,
        "Какого размера ваша собака?",
        sizeKeyboard
      );
      return ctx.wizard.next();
    }
    // Если напрямую ввели текст (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      ctx.wizard.state.userData.dogBreed = ctx.message.text;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя");
      }

      // Переходим к следующему шагу
      const sizeKeyboard = {
        inline_keyboard: [
          [
            {
              text: "🐾 Маленькая (до 10 кг)",
              callback_data: "size_small",
            },
          ],
          [
            {
              text: "🐕 Средняя (10–25 кг)",
              callback_data: "size_medium",
            },
          ],
          [{ text: "🐕‍🦺 Крупная (25+ кг)", callback_data: "size_large" }],
        ],
      };

      await updateWizardMessage(
        ctx,
        "Какого размера ваша собака?",
        sizeKeyboard
      );
      return ctx.wizard.next();
    }

    // Запрашиваем породу, если как-то попали сюда без данных
    const breedKeyboard = {
      inline_keyboard: POPULAR_BREEDS.map((breed) => [
        { text: breed, callback_data: `breed_${breed}` },
      ]),
    };

    await updateWizardMessage(
      ctx,
      "📍 Отправить геолокацию (рекомендуется)\n" +
        "<i>(Геолокация поможет находить прогулки в пешей доступности)</i>",
      breedKeyboard
    );
    return;
  },

  // Шаг 5: Размер собаки
  async (ctx) => {
    // Обработка callback для выбора размера
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCbQuery();

      if (data === "size_small") {
        ctx.wizard.state.userData.dogSize = "small";
      } else if (data === "size_medium") {
        ctx.wizard.state.userData.dogSize = "medium";
      } else if (data === "size_large") {
        ctx.wizard.state.userData.dogSize = "large";
      }

      // Переходим к следующему шагу - возраст собаки
      const ageKeyboard = {
        inline_keyboard: [
          [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
          [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
          [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
          [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
        ],
      };

      await updateWizardMessage(
        ctx,
        "<b>Сколько лет вашему хвостатому другу?</b> 🗓️",
        ageKeyboard
      );
      return ctx.wizard.next();
    }
    // Обработка текстового ввода размера (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      const size = Object.values(DOG_SIZES).find((size) =>
        size.text.includes(ctx.message.text)
      );

      ctx.wizard.state.userData.dogSize = size
        ? size.value
        : DOG_SIZES.MEDIUM.value;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя");
      }

      // Переходим к следующему шагу
      const ageKeyboard = {
        inline_keyboard: [
          [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
          [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
          [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
          [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
        ],
      };

      await updateWizardMessage(
        ctx,
        "<b>Сколько лет вашему хвостатому другу?</b> 🗓️",
        ageKeyboard
      );
      return ctx.wizard.next();
    }

    // Если почему-то размер не был выбран, устанавливаем средний по умолчанию
    if (!ctx.wizard.state.userData.dogSize) {
      ctx.wizard.state.userData.dogSize = DOG_SIZES.MEDIUM.value;
    }

    // Запрашиваем возраст (на всякий случай)
    const ageKeyboard = {
      inline_keyboard: [
        [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
        [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
        [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
        [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
      ],
    };

    await updateWizardMessage(
      ctx,
      "<b>Сколько лет вашему хвостатому другу?</b> 🗓️",
      ageKeyboard
    );
    return ctx.wizard.next();
  },

  // Шаг 6: Возраст собаки
  async (ctx) => {
    // Обработка callback для выбора возраста
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCbQuery();

      if (data === "age_puppy") {
        ctx.wizard.state.userData.dogAge = "puppy";
      } else if (data === "age_young") {
        ctx.wizard.state.userData.dogAge = "young";
      } else if (data === "age_adult") {
        ctx.wizard.state.userData.dogAge = "adult";
      } else if (data === "age_senior") {
        ctx.wizard.state.userData.dogAge = "senior";
      }

      // Переходим к следующему шагу - загрузка фото
      const photoKeyboard = {
        inline_keyboard: [
          [{ text: "Пропустить ⏭️", callback_data: "skip_photo" }],
        ],
      };

      await updateWizardMessage(
        ctx,
        "<b>Покажите миру вашего красавчика/красавицу!</b> 📸\n\n" +
          "Загрузите фото вашей собаки 📸 \n" +
          "<i>(Необязательно, но увеличивает шансы найти компанию на 70%)</i>",
        photoKeyboard
      );
      return ctx.wizard.next();
    }
    // Обработка текстового ввода возраста (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      const age = Object.values(DOG_AGES).find((age) =>
        age.text.includes(ctx.message.text)
      );

      ctx.wizard.state.userData.dogAge = age ? age.value : DOG_AGES.ADULT.value;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя");
      }

      // Переходим к следующему шагу
      const photoKeyboard = {
        inline_keyboard: [
          [{ text: "Пропустить ⏭️", callback_data: "skip_photo" }],
        ],
      };

      await updateWizardMessage(
        ctx,
        "<b>Покажите миру вашего красавчика/красавицу!</b> 📸\n\n" +
          "Загрузите фото вашей собаки 📸 (необязательно)\n" +
          "<i>(Необязательно, но увеличивает шансы найти компанию на 70%)</i>",
        photoKeyboard
      );
      return ctx.wizard.next();
    }

    // Если возраст не был выбран, устанавливаем взрослый по умолчанию
    if (!ctx.wizard.state.userData.dogAge) {
      ctx.wizard.state.userData.dogAge = DOG_AGES.ADULT.value;
    }

    // Запрашиваем фото (на всякий случай)
    const photoKeyboard = {
      inline_keyboard: [
        [{ text: "Пропустить ⏭️", callback_data: "skip_photo" }],
      ],
    };

    await updateWizardMessage(
      ctx,
      "<b>Покажите миру вашего красавчика/красавицу!</b> 📸\n\n" +
        "Загрузите фото вашей собаки 📸 (необязательно)\n" +
        "<i>(Необязательно, но увеличивает шансы найти компанию на 70%)</i>",
      photoKeyboard
    );
    return ctx.wizard.next();
  },

  // Шаг 7: Фото собаки
  async (ctx) => {
    try {
      const userData = ctx.wizard.state.userData || {};

      // Обработка callback для пропуска фото
      if (ctx.callbackQuery && ctx.callbackQuery.data === "skip_photo") {
        await ctx.answerCbQuery();

        // Завершаем регистрацию
        await finishRegistration(ctx);
        return ctx.scene.leave();
      }
      // Обработка отправки фото
      else if (ctx.message && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        userData.dogPhotoId = photoId;

        // Завершаем регистрацию
        await finishRegistration(ctx);
        return ctx.scene.leave();
      }

      // Если пользователь отправил что-то, но не фото
      else if (ctx.message) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя");
        }

        // Напоминаем о необходимости загрузить фото или пропустить
        await updateWizardMessage(
          ctx,
          "<b>Покажите миру вашего красавчика/красавицу!</b> 📸\n\n" +
            "Загрузите фото вашей собаки 📸 (необязательно)\n" +
            "<i>(Необязательно, но увеличивает шансы найти компанию на 70%)</i>",
          {
            inline_keyboard: [
              [{ text: "Пропустить ⏭️", callback_data: "skip_photo" }],
            ],
          }
        );
        return;
      }

      return;
    } catch (error) {
      console.error("Ошибка при обработке фото:", error);
      await ctx.reply(
        "Произошла ошибка при загрузке фото. Попробуйте снова.",
        Markup.removeKeyboard()
      );
      return ctx.scene.leave();
    }
  }
);
// Сцена создания прогулки
const createWalkScene = new Scenes.WizardScene(
  "createWalk",
  // Шаг 1: Дата прогулки
  async (ctx) => {
    // Инициализация сессии и состояния
    if (!ctx.session) ctx.session = {};
    ctx.wizard.state.walkData = {};

    // Проверяем, нужно ли пропустить первый шаг (если мы уже показали сообщение с выбором даты)
    if (ctx.scene.state && ctx.scene.state.skipFirstStep) {
      return ctx.wizard.next();
    }

    // Если мы здесь, значит нужно показать первый шаг
    await updateWizardMessage(
      ctx,
      "<b>Когда отправляемся на поиски приключений?</b> 🗓️\n\n" +
        "<i>Создавая прогулки, вы зарабатываете очки организатора и повышаете свой статус!</i>",
      {
        inline_keyboard: [
          [
            { text: "Сегодня", callback_data: "date_today" },
            { text: "Завтра", callback_data: "date_tomorrow" },
          ],
          [{ text: "Выбрать дату", callback_data: "date_custom" }],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ],
      }
    );
    return ctx.wizard.next();
  },

  // Шаг 2: Обработка выбора даты в сцене создания прогулки
  async (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      await ctx.answerCbQuery();
      await updateWizardMessage(
        ctx,
        "Создание прогулки отменено",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }

    // Обработка выбора даты через кнопки
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCbQuery();

      if (data === "date_today") {
        ctx.wizard.state.walkData.date = moment().format("DD.MM.YYYY");
      } else if (data === "date_tomorrow") {
        ctx.wizard.state.walkData.date = moment()
          .add(1, "days")
          .format("DD.MM.YYYY");
      } else if (data === "date_custom") {
        await updateWizardMessage(
          ctx,
          "<b>Когда отправляемся на поиски приключений?</b> 🗓️\n\n" +
            "<i>Создавая прогулки, вы зарабатываете очки организатора и повышаете свой статус!</i>\n\n" +
            "Введите дату в формате ДД.ММ.ГГГГ:",
          {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          }
        );
        ctx.wizard.state.customDate = true;
        return;
      }
    }
    // Обработка ввода произвольной даты
    else if (ctx.message && ctx.message.text) {
      // Проверяем валидность даты и что она не из прошлого
      if (!isValidDate(ctx.message.text)) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите корректную будущую дату в формате ДД.ММ.ГГГГ:",
          {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          }
        );
        return; // Остаемся на этом шаге
      }

      ctx.wizard.state.walkData.date = ctx.message.text;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }
    }

    // Если дата была выбрана, переходим к выбору времени
    if (ctx.wizard.state.walkData.date) {
      await updateWizardMessage(ctx, "Выберите час:", {
        inline_keyboard: [
          ...["6", "7", "8", "9", "10", "11", "12"].map((h) => [
            { text: h, callback_data: `hour_${h}` },
          ]),
          ...["13", "14", "15", "16", "17", "18"].map((h) => [
            { text: h, callback_data: `hour_${h}` },
          ]),
          ...["19", "20", "21", "22", "23"].map((h) => [
            { text: h, callback_data: `hour_${h}` },
          ]),
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ],
      });
    }

    return ctx.wizard.next();
  },

  // Шаг 3: Обработка выбора часа
  async (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      await ctx.answerCbQuery();
      await updateWizardMessage(
        ctx,
        "Создание прогулки отменено",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }

    // Обработка выбора часа
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("hour_")) {
      const hour = ctx.callbackQuery.data.replace("hour_", "");
      await ctx.answerCbQuery();

      ctx.wizard.state.walkData.hours = hour;

      await updateWizardMessage(ctx, `Выбрано: ${hour} ч.\nВыберите минуты:`, {
        inline_keyboard: [
          ...["00", "05", "10", "15"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          ...["20", "25", "30", "35"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          ...["40", "45", "50", "55"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ],
      });
    }
    // Обработка текстового ввода часа
    else if (ctx.message && ctx.message.text) {
      if (ctx.message.text === "❌ Отмена") {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Создание прогулки отменено",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Проверка, что введено число от 0 до 23
      const hours = parseInt(ctx.message.text, 10);
      if (isNaN(hours) || hours < 0 || hours > 23) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите корректное значение часов (0-23):",
          {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          }
        );
        return; // Остаемся на том же шаге
      }

      ctx.wizard.state.walkData.hours = String(hours);

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }

      await updateWizardMessage(ctx, `Выбрано: ${hours} ч.\nВыберите минуты:`, {
        inline_keyboard: [
          ...["00", "05", "10", "15"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          ...["20", "25", "30", "35"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          ...["40", "45", "50", "55"].map((m) => [
            { text: m, callback_data: `minute_${m}` },
          ]),
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ],
      });
    }

    return ctx.wizard.next();
  },

  // Шаг 4: Обработка выбора минут и выбор места
  // Шаг 4: Обработка выбора минут и выбор места
  async (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      await ctx.answerCbQuery();
      await updateWizardMessage(
        ctx,
        "Создание прогулки отменено",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }

    // Обработка выбора минут
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("minute_")) {
      const minute = ctx.callbackQuery.data.replace("minute_", "");
      await ctx.answerCbQuery();

      ctx.wizard.state.walkData.minutes = minute;
      ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${minute}`;

      // Улучшенные опции для выбора места
      await updateWizardMessage(
        ctx,
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся? 📍\n\n` +
          "<i>Укажите точное место встречи для удобства всех участников</i>",
        {
          inline_keyboard: [
            [
              {
                text: "🟢 Гуляю здесь (текущее место)",
                callback_data: "walk_here",
              },
            ],
            [{ text: "✏️ Ввести адрес", callback_data: "enter_location_text" }],
            [{ text: "❌ Отмена", callback_data: "cancel" }],
          ],
        }
      );
    }
    // Обработка текстового ввода минут
    else if (
      ctx.message &&
      ctx.message.text &&
      !ctx.wizard.state.waitingForLocationText &&
      !ctx.message.location
    ) {
      if (ctx.message.text === "❌ Отмена") {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Создание прогулки отменено",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Проверка, что введено число от 0 до 59
      const minutes = parseInt(ctx.message.text, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 59) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите корректное значение минут (0-59):",
          {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          }
        );
        return; // Остаемся на том же шаге
      }

      // Форматируем минуты с ведущим нулем
      const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
      ctx.wizard.state.walkData.minutes = formattedMinutes;
      ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${formattedMinutes}`;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }

      await updateWizardMessage(
        ctx,
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся? 📍\n\n` +
          "<i>Укажите точное место встречи для удобства всех участников</i>",
        {
          inline_keyboard: [
            [
              {
                text: "🟢 Гуляю здесь (текущее место)",
                callback_data: "walk_here",
              },
            ],
            [{ text: "✏️ Ввести адрес", callback_data: "enter_location_text" }],
            [{ text: "❌ Отмена", callback_data: "cancel" }],
          ],
        }
      );
    }
    // Обработка выбора типа ввода места
    else if (ctx.callbackQuery) {
      await ctx.answerCbQuery();

      if (
        ctx.callbackQuery.data === "walk_here" ||
        ctx.callbackQuery.data === "choose_map_walk"
      ) {
        // Определяем тип действия и соответствующие тексты
        const isWalkHere = ctx.callbackQuery.data === "walk_here";
        const actionText = isWalkHere
          ? "Пришлите ваше текущее местоположение. Внизу появится кнопка 📍"
          : "Выберите место встречи на карте. Внизу появится кнопка 📍";

        const buttonText = isWalkHere
          ? "📍 Отправить моё местоположение"
          : "📍 Выбрать место на карте";

        // Показываем основное сообщение с инструкциями
        await updateWizardMessage(
          ctx,
          `${actionText}\n\nНажмите на кнопку внизу экрана`
        );

        // Показываем клавиатуру с кнопкой геолокации
        const locMsg = await ctx.telegram.sendMessage(
          ctx.chat.id,
          "👇 Нажмите кнопку ниже для отправки геолокации 👇",
          {
            reply_markup: {
              keyboard: [[{ text: buttonText, request_location: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );

        ctx.wizard.state.locationKeyboardMsgId = locMsg.message_id;

        if (isWalkHere) {
          ctx.wizard.state.waitingForWalkHere = true;
        } else {
          ctx.wizard.state.waitingForMapLocation = true;
        }
        return;
      } else if (ctx.callbackQuery.data === "enter_location_text") {
        await updateWizardMessage(ctx, "Опишите место встречи:", {
          inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
        });
        ctx.wizard.state.waitingForLocationText = true;
        return;
      }
    }
    // Обработка полученной геолокации
    else if (ctx.message && ctx.message.location) {
      // Сохраняем координаты
      ctx.wizard.state.walkData.location = {
        latitude: ctx.message.location.latitude,
        longitude: ctx.message.location.longitude,
      };

      // Определяем тип местоположения
      if (ctx.wizard.state.waitingForWalkHere) {
        ctx.wizard.state.walkData.locationDescription =
          "Текущее местоположение";
        ctx.wizard.state.waitingForWalkHere = false;
      } else if (ctx.wizard.state.waitingForMapLocation) {
        ctx.wizard.state.walkData.locationDescription = "Выбрано на карте";
        ctx.wizard.state.waitingForMapLocation = false;
      }

      // Удаляем сообщение с геолокацией
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение с геолокацией:", error);
      }

      // Удаляем сообщение с клавиатурой геолокации
      if (ctx.wizard.state.locationKeyboardMsgId) {
        try {
          await ctx.deleteMessage(ctx.wizard.state.locationKeyboardMsgId);
          delete ctx.wizard.state.locationKeyboardMsgId;
        } catch (error) {
          console.log("Не удалось удалить сообщение с клавиатурой:", error);
        }
      }

      // Восстанавливаем основное сообщение и клавиатуру
      await updateWizardMessage(
        ctx,
        `Координаты места встречи сохранены! 📍\n` +
          "<b>Это будет единичное приключение или регулярная традиция?</b> 🔄\n\n" +
          "<i>Регулярные прогулки также засчитываются в ваш счетчик организатора и помогают быстрее получить новое звание!</i>\n" +
          "<i>Важно: если вы не сможете прийти на собственную прогулку, пожалуйста, отмените её заранее, чтобы не подводить других участников.</i>",
        {
          inline_keyboard: [
            [
              { text: "Разовая 🔹", callback_data: "type_single" },
              { text: "Регулярная 🔄", callback_data: "type_regular" },
            ],
            [{ text: "❌ Отмена", callback_data: "cancel" }],
          ],
        }
      );

      return ctx.wizard.next();
    }
    // Обработка текстового ввода места
    else if (
      ctx.message &&
      ctx.message.text &&
      ctx.wizard.state.waitingForLocationText
    ) {
      if (!isValidString(ctx.message.text)) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        await updateWizardMessage(
          ctx,
          "Описание места встречи не может быть пустым или 'null'. Пожалуйста, введите корректное описание:",
          {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          }
        );
        return;
      }

      ctx.wizard.state.walkData.locationText = ctx.message.text;
      ctx.wizard.state.waitingForLocationText = false;

      // Удаляем сообщение пользователя
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }

      // Переходим к выбору типа прогулки
      await updateWizardMessage(
        ctx,
        "Текстовое описание места сохранено!\n" +
          "<b>Это будет единичное приключение или регулярная традиция?</b> 🔄\n\n" +
          "<i>Регулярные прогулки также засчитываются в ваш счетчик организатора и помогают быстрее получить новое звание!</i>\n" +
          "<i>Важно: если вы не сможете прийти на собственную прогулку, пожалуйста, отмените её заранее, чтобы не подводить других участников.</i>",
        {
          inline_keyboard: [
            [
              { text: "Разовая 🔹", callback_data: "type_single" },
              { text: "Регулярная 🔄", callback_data: "type_regular" },
            ],
            [{ text: "❌ Отмена", callback_data: "cancel" }],
          ],
        }
      );

      return ctx.wizard.next();
    }
  },

  // Шаг 5: Тип прогулки и подтверждение
  async (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      await ctx.answerCbQuery();
      await updateWizardMessage(
        ctx,
        "Создание прогулки отменено",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }

    // Обработка выбора типа прогулки
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();

      if (ctx.callbackQuery.data === "type_single") {
        ctx.wizard.state.walkData.type = "single";
      } else if (ctx.callbackQuery.data === "type_regular") {
        ctx.wizard.state.walkData.type = "regular";
      }
    }

    // Получаем информацию о пользователе
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();

    // Сохраняем данные в scene.state для доступа в обработчиках
    ctx.scene.state.walkData = { ...ctx.wizard.state.walkData };
    ctx.scene.state.userData = userData;

    // Удаляем предыдущее сообщение перед созданием новых
    try {
      if (ctx.session && ctx.session.lastMessageId) {
        await ctx.deleteMessage(ctx.session.lastMessageId);
        delete ctx.session.lastMessageId;
      }
    } catch (error) {
      console.log(
        "Ошибка при удалении предыдущего сообщения, продолжаем дальше:",
        error.message
      );
    }

    // Сбрасываем ID сообщений в state
    ctx.wizard.state.messageIds = [];

    // Шаг 1: Отправляем заголовок
    try {
      const titleMsg = await ctx.reply("✨ <b>ДЕТАЛИ ПРОГУЛКИ</b> ✨", {
        parse_mode: "HTML",
      });
      ctx.wizard.state.messageIds.push(titleMsg.message_id);
    } catch (error) {
      console.log("Ошибка при отправке заголовка:", error.message);
    }

    // Шаг 2: Формируем и отправляем детали прогулки
    try {
      let previewText = `
🗓️ <b>Встреча:</b>  ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
📍 <b>Место сбора:</b> ${ctx.wizard.state.walkData.locationText || "По геолокации"}
🔄 <b>Формат:</b> ${ctx.wizard.state.walkData.type === "single" ? "Разовая" : "Регулярная"}
👑 <b>Организатор:</b> ${userData.name}
🐕 <b>Компаньон:</b> ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
`;

      let previewMsg;
      if (userData.dog.photoId) {
        previewMsg = await ctx.replyWithPhoto(userData.dog.photoId, {
          caption: previewText,
          parse_mode: "HTML",
        });
      } else {
        previewMsg = await ctx.reply(previewText, {
          parse_mode: "HTML",
        });
      }
      ctx.wizard.state.messageIds.push(previewMsg.message_id);
    } catch (error) {
      console.log("Ошибка при отправке превью:", error.message);
    }

    // Шаг 3: Отправляем кнопки
    try {
      const buttonMsg = await ctx.reply("Выберите действие:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Опубликовать ✅", callback_data: "publish_walk" },
              { text: "Отменить ❌", callback_data: "cancel_walk" },
            ],
          ],
        },
      });
      ctx.wizard.state.messageIds.push(buttonMsg.message_id);

      // Последнее сообщение в цепочке - для updateWizardMessage
      if (!ctx.session) ctx.session = {};
      ctx.session.lastMessageId = buttonMsg.message_id;
    } catch (error) {
      console.log("Ошибка при отправке кнопок:", error.message);
    }

    return ctx.wizard.next();
  },

  // Шаг 6: Публикация или отмена
  async (ctx) => {
    // Обрабатываем только callback
    if (!ctx.callbackQuery) return;

    const action = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (action === "publish_walk") {
      try {
        // Получаем данные из scene.state
        const walkData = ctx.scene.state.walkData;
        const userData = ctx.scene.state.userData;

        // Чистим предыдущие сообщения
        try {
          // Удаляем все предыдущие сообщения
          if (
            ctx.wizard.state.messageIds &&
            ctx.wizard.state.messageIds.length > 0
          ) {
            for (const msgId of ctx.wizard.state.messageIds) {
              try {
                await ctx.deleteMessage(msgId);
              } catch (error) {
                console.log(
                  `Не удалось удалить сообщение ${msgId}:`,
                  error.message
                );
              }
            }
          }
        } catch (error) {
          console.log("Ошибка при удалении сообщений:", error.message);
        }

        // Отправляем новое сообщение о публикации вместо обновления
        const statusMsg = await ctx.reply("Публикация прогулки...");

        // Создаем прогулку в БД
        const walkRef = await db.collection("walks").add({
          date: walkData.date,
          time: walkData.time,
          locationText: walkData.locationText || null,
          location: walkData.location || null,
          type: walkData.type,
          organizer: {
            id: ctx.from.id,
            name: userData.name,
            username: ctx.from.username || null,
          },
          dog: {
            name: userData.dog.name,
            breed: userData.dog.breed,
            size: userData.dog.size,
            age: userData.dog.age,
            photoId: userData.dog.photoId,
          },
          participants: [],
          createdAt: new Date(),
        });

        // Отправляем уведомления и получаем результат
        try {
          console.log("Запускаем отправку уведомлений");
          await notifyNearbyUsers(walkRef.id, userData, walkData);

          console.log("Запускаем отправку уведомлений предыдущим участникам");
          const sentCount = await notifyPreviousParticipantsFromProfiles(
            ctx.from.id,
            walkRef.id,
            walkData
          );

          // Обновляем или отправляем новое сообщение с результатом
          try {
            await ctx.deleteMessage(statusMsg.message_id);
          } catch (error) {
            console.log(
              "Не удалось удалить статусное сообщение:",
              error.message
            );
          }

          // Отправляем результат
          if (sentCount > 0) {
            await ctx.reply(
              "✅ <b>🎉 ПРОГУЛКА СОЗДАНА! 🎉</b>\n\n" +
                `🔔 Мы уведомили ${sentCount} владельцев собак поблизости`,
              {
                parse_mode: "HTML",
                reply_markup: getMainMenuKeyboard(),
              }
            );
          } else {
            await ctx.reply("✅ Прогулка успешно создана!", {
              reply_markup: getMainMenuKeyboard(),
            });
          }
        } catch (error) {
          console.error("Ошибка при отправке уведомлений:", error);
          // Даже при ошибке отправки уведомлений показываем успешное создание прогулки
          await ctx.reply(
            "✅ Прогулка успешно создана!",
            getMainMenuKeyboard()
          );
        }

        return ctx.scene.leave();
      } catch (error) {
        console.error("Ошибка при публикации прогулки:", error);
        await ctx.reply(
          "Произошла ошибка при публикации прогулки. Попробуйте снова.",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }
    } else if (action === "cancel_walk") {
      // Удаляем все предыдущие сообщения
      try {
        if (
          ctx.wizard.state.messageIds &&
          ctx.wizard.state.messageIds.length > 0
        ) {
          for (const msgId of ctx.wizard.state.messageIds) {
            try {
              await ctx.deleteMessage(msgId);
            } catch (error) {
              console.log(
                `Не удалось удалить сообщение ${msgId}:`,
                error.message
              );
            }
          }
        }
      } catch (error) {
        console.log("Ошибка при удалении сообщений:", error.message);
      }

      // Отправляем новое сообщение вместо обновления
      await ctx.reply("❌ Создание прогулки отменено.", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  }
);

// Сцена выбора параметра для редактирования
const editProfileMenuScene = new Scenes.BaseScene("editProfileMenu");

editProfileMenuScene.enter(async (ctx) => {
  const menuText = "Что вы хотите изменить?";
  const keyboard = {
    inline_keyboard: [
      [
        { text: "📝 Имя", callback_data: "edit_name" },
        { text: "🏙 Город", callback_data: "edit_city" },
      ],
      [
        { text: "🐕 Имя собаки", callback_data: "edit_dog_name" },
        { text: "🐶 Порода собаки", callback_data: "edit_dog_breed" },
      ],
      [
        { text: "📏 Размер собаки", callback_data: "edit_dog_size" },
        { text: "🗓 Возраст собаки", callback_data: "edit_dog_age" },
      ],
      [{ text: "📸 Фото собаки", callback_data: "edit_dog_photo" }],
      [{ text: "↩️ Вернуться в профиль", callback_data: "my_profile" }],
    ],
  };

  await updateWizardMessage(ctx, menuText, keyboard);
});

// Обновленная сцена редактирования имени
const editNameScene = new Scenes.WizardScene(
  "editName",
  // Шаг 1: Ввод нового имени
  async (ctx) => {
    try {
      const promptText = "Введите ваше новое имя:";

      // Если есть ID последнего сообщения, редактируем его
      if (ctx.session && ctx.session.lastMessageId) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            ctx.session.lastMessageId,
            null,
            promptText,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
                ],
              },
            }
          );
        } catch (error) {
          console.error("Ошибка при редактировании сообщения:", error);
          // Если не удалось отредактировать, отправим новое
          const msg = await ctx.reply(promptText, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
              ],
            },
          });

          // Обновляем ID последнего сообщения
          ctx.session.lastMessageId = msg.message_id;
        }
      } else {
        // Отправляем новое сообщение
        const msg = await ctx.reply(promptText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
            ],
          },
        });

        // Сохраняем ID для будущих редактирований
        if (!ctx.session) ctx.session = {};
        ctx.session.lastMessageId = msg.message_id;
      }

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка при запросе нового имени:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  },

  // Шаг 2: Сохранение нового имени
  async (ctx) => {
    try {
      // Проверяем, не была ли нажата кнопка отмены
      if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel_edit") {
        await ctx.answerCbQuery();
        return ctx.scene.enter("editProfileMenu");
      }

      if (!ctx.message || !ctx.message.text) {
        // Если это не текстовое сообщение, просим ввести имя еще раз
        if (ctx.session && ctx.session.lastMessageId) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            ctx.session.lastMessageId,
            null,
            "Пожалуйста, введите корректное имя текстом:",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
                ],
              },
            }
          );
        } else {
          await ctx.reply("Пожалуйста, введите корректное имя текстом:");
        }
        return; // Остаемся на том же шаге
      }

      const newName = ctx.message.text;

      // Проверяем валидность имени
      if (!isValidString(newName)) {
        if (ctx.session && ctx.session.lastMessageId) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            ctx.session.lastMessageId,
            null,
            "Имя не может быть пустым или 'null'. Пожалуйста, введите корректное имя:",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
                ],
              },
            }
          );
        } else {
          await ctx.reply(
            "Имя не может быть пустым или 'null'. Пожалуйста, введите корректное имя:"
          );
        }
        return; // Остаемся на том же шаге для повторного ввода
      }

      // Обновляем имя в базе данных
      await db.collection("users").doc(String(ctx.from.id)).update({
        name: newName,
      });

      // Удаляем сообщение с введенным пользователем именем
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }

      // Редактируем сообщение с подтверждением
      if (ctx.session && ctx.session.lastMessageId) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.session.lastMessageId,
          null,
          "✅ Имя успешно изменено!",
          { reply_markup: { inline_keyboard: [] } }
        );
      } else {
        await ctx.reply("✅ Имя успешно изменено!");
      }

      // Возвращаемся в меню редактирования
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);

      return;
    } catch (error) {
      console.error("Ошибка при обновлении имени:", error);
      await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);

// Обновленная сцена редактирования города

const editCityScene = new Scenes.WizardScene(
  "editCity",
  // Шаг 1: Выбор города
  (ctx) => {
    ctx.reply(
      `${ctx.from.first_name}, Чтобы находить прогулки рядом с вами, мне нужно узнать, где вы находитесь.\n\n` +
        `💡 <b>Совет</b>: Отправка геолокации позволит:\n` +
        `• Получать уведомления о прогулках поблизости\n` +
        `• Использовать фильтр "Прогулки рядом"\n` +
        `• Находить собачьих друзей в вашем районе`,
      { parse_mode: "HTML" },
      Markup.inlineKeyboard([
        ...POPULAR_CITIES.map((city) => [
          { text: city, callback_data: `city_${city}` },
        ]),
        [
          {
            text: "📍 Моё текущее местоположение",
            callback_data: "current_location",
          },
        ],
        [{ text: "↩️ Отмена", callback_data: "cancel_edit" }],
      ])
    );
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение города
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel_edit") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "current_location") {
          // Показываем кнопку для отправки текущего местоположения
          await ctx.reply(
            "Нажмите кнопку, чтобы отправить ваше текущее местоположение:",
            Markup.keyboard([
              [
                Markup.button.locationRequest(
                  "📍 Отправить моё местоположение"
                ),
              ],
            ]).resize()
          );
          ctx.wizard.state.waitingForCurrentLocation = true;
          return;
        } else if (data.startsWith("city_")) {
          const city = data.replace("city_", "");
          await db.collection("users").doc(String(ctx.from.id)).update({
            city: city,
            // Очищаем геоданные, так как выбран конкретный город
            location: null,
          });

          await ctx.reply("✅ Город успешно изменен!", {
            reply_markup: { remove_keyboard: true },
          });

          // После успешного изменения города показываем главное меню
          await ctx.reply(
            "<b>Главное меню DogMeet</b> 🎮\n\n" + "Чем займемся сегодня?",
            {
              parse_mode: "HTML",
              reply_markup: getMainMenuKeyboard(),
            }
          );

          return ctx.scene.leave(); // Выходим из сцены полностью
        }
      }
      // Обработка геолокации
      else if (ctx.message && ctx.message.location) {
        let locationDescription = "Геолокация";

        // Определяем тип местоположения
        if (ctx.wizard.state.waitingForCurrentLocation) {
          locationDescription = "Текущее местоположение";
          ctx.wizard.state.waitingForCurrentLocation = false;
        } else if (ctx.wizard.state.waitingForMapLocation) {
          locationDescription = "Выбрано на карте";
          ctx.wizard.state.waitingForMapLocation = false;
        }

        await db
          .collection("users")
          .doc(String(ctx.from.id))
          .update({
            location: {
              latitude: ctx.message.location.latitude,
              longitude: ctx.message.location.longitude,
              description: locationDescription,
            },
            city: "Определен по геолокации",
          });

        await ctx.reply("✅ Местоположение успешно сохранено!", {
          reply_markup: { remove_keyboard: true },
        });

        // После успешного сохранения местоположения показываем главное меню
        await ctx.reply("Главное меню:", {
          reply_markup: getMainMenuKeyboard(),
        });

        return ctx.scene.leave(); // Выходим из сцены полностью
      }
      // Обработка текстового ввода города
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "↩️ Отмена") {
          await ctx.reply("Редактирование отменено", {
            reply_markup: { remove_keyboard: true },
          });
          return ctx.scene.enter("editProfileMenu");
        }

        await db.collection("users").doc(String(ctx.from.id)).update({
          city: ctx.message.text,
          // Очищаем геоданные, так как введен текстовый город
          location: null,
        });

        await ctx.reply("✅ Город успешно изменен!", {
          reply_markup: { remove_keyboard: true },
        });

        // После успешного изменения города показываем главное меню
        await ctx.reply("Главное меню:", {
          reply_markup: getMainMenuKeyboard(),
        });

        return ctx.scene.leave(); // Выходим из сцены полностью
      }
    } catch (error) {
      console.error("Ошибка при редактировании города:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.", {
        reply_markup: { remove_keyboard: true },
      });

      // При ошибке тоже возвращаемся в главное меню
      await ctx.reply("Главное меню:", {
        reply_markup: getMainMenuKeyboard(),
      });

      return ctx.scene.leave();
    }
  }
);

// Сцена редактирования имени собаки
// Сцена редактирования имени собаки
const editDogNameScene = new Scenes.WizardScene(
  "editDogName",
  // Шаг 1: Ввод нового имени собаки
  async (ctx) => {
    await updateWizardMessage(ctx, "Введите новое имя собаки:", {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel_edit" }]],
    });
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение имени собаки
  async (ctx) => {
    try {
      // Проверяем, не была ли нажата кнопка отмены
      if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel_edit") {
        await ctx.answerCbQuery();
        return ctx.scene.enter("editProfileMenu");
      }

      if (!ctx.message || !ctx.message.text) {
        await updateWizardMessage(
          ctx,
          "Пожалуйста, введите имя собаки текстом:",
          {
            inline_keyboard: [
              [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
            ],
          }
        );
        return; // Остаемся на том же шаге
      }

      const newDogName = ctx.message.text;

      // Проверяем валидность имени собаки
      if (!isValidString(newDogName)) {
        await updateWizardMessage(
          ctx,
          "Имя собаки не может быть пустым или 'null'. Пожалуйста, введите корректное имя:",
          {
            inline_keyboard: [
              [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
            ],
          }
        );
        return; // Остаемся на том же шаге для повторного ввода
      }

      // Удаляем сообщение пользователя для поддержания "матрешки"
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        console.log("Не удалось удалить сообщение пользователя:", error);
      }

      // Обновляем имя собаки в базе данных
      await db.collection("users").doc(String(ctx.from.id)).update({
        "dog.name": newDogName,
      });

      // Сообщаем об успехе и возвращаемся в меню
      await updateWizardMessage(ctx, "✅ Имя собаки успешно изменено!");

      // Добавляем небольшую задержку перед возвратом в меню
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    } catch (error) {
      console.error("Ошибка при редактировании имени собаки:", error);
      await updateWizardMessage(ctx, "Произошла ошибка. Попробуйте снова.");
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    }
  }
);

// Сцена редактирования породы собаки
const editDogBreedScene = new Scenes.WizardScene(
  "editDogBreed",
  // Шаг 1: Выбор породы
  async (ctx) => {
    const keyboard = {
      inline_keyboard: POPULAR_BREEDS.map((breed) => [
        { text: breed, callback_data: `breed_${breed}` },
      ]).concat([[{ text: "❌ Отмена", callback_data: "cancel_edit" }]]),
    };

    await updateWizardMessage(
      ctx,
      "<b>Какой породы ваш четвероногий компаньон?</b> 🧬\n" +
        "<i>(Выберите из списка или введите вручную)</i>",
      keyboard
    );
    return ctx.wizard.next();
  },
  // Шаг 2: Обработка выбора породы
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel_edit") {
          return ctx.scene.enter("editProfileMenu");
        } else if (data.startsWith("breed_")) {
          const breed = data.replace("breed_", "");

          if (breed === "Другая (ввести текстом)") {
            await updateWizardMessage(ctx, "Введите породу вашей собаки:", {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
              ],
            });
            ctx.wizard.state.waitingForCustomBreed = true;
            return;
          } else {
            await db.collection("users").doc(String(ctx.from.id)).update({
              "dog.breed": breed,
            });

            await updateWizardMessage(
              ctx,
              "✅ Порода собаки успешно изменена!"
            );
            setTimeout(() => {
              ctx.scene.enter("editProfileMenu");
            }, 1500);
            return;
          }
        }
      }
      // Обработка текстового ввода породы
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          return ctx.scene.enter("editProfileMenu");
        }

        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        if (ctx.wizard.state.waitingForCustomBreed) {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.breed": ctx.message.text,
          });

          await updateWizardMessage(ctx, "✅ Порода собаки успешно изменена!");
        } else {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.breed": ctx.message.text,
          });

          await updateWizardMessage(ctx, "✅ Порода собаки успешно изменена!");
        }

        setTimeout(() => {
          ctx.scene.enter("editProfileMenu");
        }, 1500);
        return;
      }
    } catch (error) {
      console.error("Ошибка при редактировании породы собаки:", error);
      await updateWizardMessage(ctx, "Произошла ошибка. Попробуйте снова.");
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    }
  }
);
// Сцена редактирования размера собаки
const editDogSizeScene = new Scenes.WizardScene(
  "editDogSize",
  // Шаг 1: Выбор размера
  async (ctx) => {
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "🐾 Маленькая (до 10 кг)",
            callback_data: "size_small",
          },
        ],
        [
          {
            text: "🐕 Средняя (10–25 кг)",
            callback_data: "size_medium",
          },
        ],
        [{ text: "🐕‍🦺 Крупная (25+ кг)", callback_data: "size_large" }],
      ],
    };

    await updateWizardMessage(ctx, "Выберите новый размер собаки:", keyboard);
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение размера
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel_edit") {
          return ctx.scene.enter("editProfileMenu");
        } else if (
          data === "size_small" ||
          data === "size_medium" ||
          data === "size_large"
        ) {
          const size = data.replace("size_", "");

          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.size": size,
          });

          await updateWizardMessage(ctx, "✅ Размер собаки успешно изменен!");
          setTimeout(() => {
            ctx.scene.enter("editProfileMenu");
          }, 1500);
          return;
        }
      }
    } catch (error) {
      console.error("Ошибка при редактировании размера собаки:", error);
      await updateWizardMessage(ctx, "Произошла ошибка. Попробуйте снова.");
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    }
  }
);

// Сцена редактирования возраста собаки
const editDogAgeScene = new Scenes.WizardScene(
  "editDogAge",
  // Шаг 1: Выбор возраста
  async (ctx) => {
    const keyboard = {
      inline_keyboard: [
        [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
        [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
        [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
        [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
        [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
      ],
    };

    await updateWizardMessage(ctx, "Выберите новый возраст собаки:", keyboard);
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение возраста
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel_edit") {
          return ctx.scene.enter("editProfileMenu");
        } else if (data.startsWith("age_")) {
          const age = data.replace("age_", "");

          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": age,
          });

          await updateWizardMessage(ctx, "✅ Возраст собаки успешно изменен!");
          setTimeout(() => {
            ctx.scene.enter("editProfileMenu");
          }, 1500);
          return;
        }
      }
    } catch (error) {
      console.error("Ошибка при редактировании возраста собаки:", error);
      await updateWizardMessage(ctx, "Произошла ошибка. Попробуйте снова.");
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    }
  }
);
// Сцена редактирования фото собаки
const editDogPhotoScene = new Scenes.WizardScene(
  "editDogPhoto",
  // Шаг 1: Запрос фото
  async (ctx) => {
    await updateWizardMessage(ctx, "Отправьте новое фото вашей собаки 📸", {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel_edit" }]],
    });
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение фото
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel_edit") {
          return ctx.scene.enter("editProfileMenu");
        }
      }
      // Обработка загрузки фото
      else if (ctx.message && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        // Удаляем сообщение с фото (опционально)
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение с фото:", error);
        }

        await db.collection("users").doc(String(ctx.from.id)).update({
          "dog.photoId": photoId,
        });

        await updateWizardMessage(ctx, "✅ Фото собаки успешно обновлено!");
        setTimeout(() => {
          ctx.scene.enter("editProfileMenu");
        }, 1500);
        return;
      }
      // Обработка текстовых сообщений
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          return ctx.scene.enter("editProfileMenu");
        } else {
          await updateWizardMessage(
            ctx,
            "Пожалуйста, отправьте фото собаки или нажмите 'Отмена'.",
            {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
              ],
            }
          );
        }
      }
    } catch (error) {
      console.error("Ошибка при редактировании фото собаки:", error);
      await updateWizardMessage(ctx, "Произошла ошибка. Попробуйте снова.");
      setTimeout(() => {
        ctx.scene.enter("editProfileMenu");
      }, 1500);
    }
  }
);

const editWalkMenuScene = new Scenes.BaseScene("editWalkMenu");

editWalkMenuScene.enter(async (ctx) => {
  try {
    console.log("Вход в меню редактирования прогулки");

    // Получаем ID из сессии
    if (!ctx.session) ctx.session = {};
    const walkId = ctx.session.editWalkId;

    console.log(`Получили ID из сессии: ${walkId}`);

    if (!walkId) {
      console.error("ID прогулки не найден в сессии!");
      await updateWizardMessage(
        ctx,
        "Ошибка: не удалось найти идентификатор прогулки",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }

    // Сохраняем ID в сцене
    ctx.scene.state.walkId = walkId;

    await updateWizardMessage(ctx, "Что вы хотите изменить?", {
      inline_keyboard: [
        [
          { text: "🗓 Дата и время", callback_data: "edit_date_time" },
          { text: "📍 Место встречи", callback_data: "edit_location" },
        ],
        [{ text: "🔄 Тип прогулки", callback_data: "edit_type" }],
        [{ text: "❌ Отмена редактирования", callback_data: "cancel_edit" }],
      ],
    });
  } catch (error) {
    console.error("Ошибка при входе в меню редактирования:", error);
    await updateWizardMessage(ctx, "Произошла ошибка", getMainMenuKeyboard());
    return ctx.scene.leave();
  }
});

const editWalkDateTimeScene = new Scenes.WizardScene(
  "editWalkDateTime",
  // Шаг 1: Выбор даты
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkDateTime");
    if (!initResult.success) return ctx.scene.leave();

    // Инициализируем состояние
    ctx.wizard.state.walkData = {};

    await updateWizardMessage(ctx, "Выберите новую дату прогулки:", {
      inline_keyboard: [
        [
          { text: "Сегодня", callback_data: "date_today" },
          { text: "Завтра", callback_data: "date_tomorrow" },
        ],
        [{ text: "Выбрать дату", callback_data: "date_custom" }],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ],
    });

    return ctx.wizard.next();
  },

  // Шаг 2: Обработка выбора даты
  async (ctx) => {
    try {
      // Обработка кнопки отмены
      if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
        await ctx.answerCbQuery();
        await updateWizardMessage(
          ctx,
          "Редактирование отменено",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "date_today") {
          ctx.wizard.state.walkData.date = moment().format("DD.MM.YYYY");
        } else if (data === "date_tomorrow") {
          ctx.wizard.state.walkData.date = moment()
            .add(1, "days")
            .format("DD.MM.YYYY");
        } else if (data === "date_custom") {
          await updateWizardMessage(
            ctx,
            "<b>Когда отправляемся на поиски приключений?</b> 🗓️\n\n" +
              "<i>Создавая прогулки, вы зарабатываете очки организатора и повышаете свой статус!</i>\n\n" +
              "Введите дату в формате ДД.ММ.ГГГГ:",
            {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel" }],
              ],
            }
          );
          ctx.wizard.state.customDate = true;
          retur;
        }
      }
      // Обработка ввода даты текстом
      else if (ctx.message && ctx.message.text) {
        if (ctx.wizard.state.customDate) {
          if (!isValidDate(ctx.message.text)) {
            // Удаляем сообщение пользователя
            try {
              await ctx.deleteMessage(ctx.message.message_id);
            } catch (error) {
              console.log("Не удалось удалить сообщение пользователя:", error);
            }

            await updateWizardMessage(
              ctx,
              "Пожалуйста, введите корректную дату в формате ДД.ММ.ГГГГ:",
              {
                inline_keyboard: [
                  [{ text: "❌ Отмена", callback_data: "cancel" }],
                ],
              }
            );
            return; // Остаемся на этом шаге
          }

          ctx.wizard.state.walkData.date = ctx.message.text;
          ctx.wizard.state.customDate = false;

          // Удаляем сообщение пользователя
          try {
            await ctx.deleteMessage(ctx.message.message_id);
          } catch (error) {
            console.log("Не удалось удалить сообщение пользователя:", error);
          }
        }
      }

      // Если дата выбрана, переходим к выбору времени
      if (ctx.wizard.state.walkData.date) {
        await updateWizardMessage(ctx, "Выберите идеальный час для встречи:", {
          inline_keyboard: [
            ...["6", "7", "8", "9", "10", "11", "12"].map((h) => [
              { text: h, callback_data: `hour_${h}` },
            ]),
            ...["13", "14", "15", "16", "17", "18"].map((h) => [
              { text: h, callback_data: `hour_${h}` },
            ]),
            ...["19", "20", "21", "22", "23"].map((h) => [
              { text: h, callback_data: `hour_${h}` },
            ]),
            [{ text: "❌ Отмена", callback_data: "cancel" }],
          ],
        });
      }

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования даты:", error);
      await updateWizardMessage(ctx, "Произошла ошибка", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  },

  // Шаг 3: Обработка выбора часа
  async (ctx) => {
    try {
      // Обработка кнопки отмены
      if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
        await ctx.answerCbQuery();
        await updateWizardMessage(
          ctx,
          "Редактирование отменено",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Обработка выбора часа
      if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("hour_")) {
        const hour = ctx.callbackQuery.data.replace("hour_", "");
        await ctx.answerCbQuery();

        ctx.wizard.state.walkData.hour = hour;

        // Переходим к выбору минут
        await updateWizardMessage(
          ctx,
          `Выбрано: ${hour} ч.\nВыберите минуты:`,
          {
            inline_keyboard: [
              ...["00", "05", "10", "15"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              ...["20", "25", "30", "35"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              ...["40", "45", "50", "55"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              [{ text: "❌ Отмена", callback_data: "cancel" }],
            ],
          }
        );
      }
      // Обработка текстового ввода часа
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        // Проверка, что введено число от 0 до 23
        const hours = parseInt(ctx.message.text, 10);
        if (isNaN(hours) || hours < 0 || hours > 23) {
          // Удаляем сообщение пользователя
          try {
            await ctx.deleteMessage(ctx.message.message_id);
          } catch (error) {
            console.log("Не удалось удалить сообщение пользователя:", error);
          }

          await updateWizardMessage(
            ctx,
            "Пожалуйста, введите корректное значение часов (0-23):",
            {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel" }],
              ],
            }
          );
          return; // Остаемся на том же шаге
        }

        ctx.wizard.state.walkData.hour = String(hours);

        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        // Переходим к выбору минут
        await updateWizardMessage(
          ctx,
          `Выбрано: ${hours} ч.\nВыберите минуты:`,
          {
            inline_keyboard: [
              ...["00", "05", "10", "15"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              ...["20", "25", "30", "35"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              ...["40", "45", "50", "55"].map((m) => [
                { text: m, callback_data: `minute_${m}` },
              ]),
              [{ text: "❌ Отмена", callback_data: "cancel" }],
            ],
          }
        );
      }

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка в шаге 3 редактирования времени:", error);
      await updateWizardMessage(ctx, "Произошла ошибка", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  },

  // Шаг 4: Выбор минут и сохранение
  async (ctx) => {
    try {
      // Обработка кнопки отмены
      if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
        await ctx.answerCbQuery();
        await updateWizardMessage(
          ctx,
          "Редактирование отменено",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Обработка выбора минут
      if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("minute_")) {
        // Сохраняем минуты
        const minute = ctx.callbackQuery.data.replace("minute_", "");
        await ctx.answerCbQuery();

        // Формируем полное время
        const walkId = ctx.wizard.state.walkId;
        const newDate = ctx.wizard.state.walkData.date;
        const newTime = `${ctx.wizard.state.walkData.hour}:${minute}`;

        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await updateWizardMessage(
            ctx,
            "Прогулка не найдена",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        const walkData = walkDoc.data();

        // Сохраняем изменения в базе данных
        await db.collection("walks").doc(walkId).update({
          date: newDate,
          time: newTime,
        });

        // Отправляем уведомление участникам
        if (walkData.participants && walkData.participants.length > 0) {
          const message = `
📢 Внимание! Организатор изменил дату и время прогулки:
🗓 Новая дата и время: ${newDate}, ${newTime}
📍 Место: ${walkData.locationText || "По геолокации"}
`;
          await notifyWalkParticipants(walkData.participants, message);
        }

        // Показываем сообщение об успехе
        await updateWizardMessage(
          ctx,
          `✅ Дата и время прогулки обновлены на: ${newDate}, ${newTime}`,
          getMainMenuKeyboard()
        );

        return ctx.scene.leave();
      }
      // Обработка текстового ввода минут
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        // Проверка, что введено число от 0 до 59
        const minutes = parseInt(ctx.message.text, 10);
        if (isNaN(minutes) || minutes < 0 || minutes > 59) {
          // Удаляем сообщение пользователя
          try {
            await ctx.deleteMessage(ctx.message.message_id);
          } catch (error) {
            console.log("Не удалось удалить сообщение пользователя:", error);
          }

          await updateWizardMessage(
            ctx,
            "Пожалуйста, введите корректное значение минут (0-59):",
            {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel" }],
              ],
            }
          );
          return; // Остаемся на том же шаге
        }

        // Форматируем минуты с ведущим нулем
        const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;

        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        // Формируем полное время
        const walkId = ctx.wizard.state.walkId;
        const newDate = ctx.wizard.state.walkData.date;
        const newTime = `${ctx.wizard.state.walkData.hour}:${formattedMinutes}`;

        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await updateWizardMessage(
            ctx,
            "Прогулка не найдена",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        const walkData = walkDoc.data();

        // Сохраняем изменения в базе данных
        await db.collection("walks").doc(walkId).update({
          date: newDate,
          time: newTime,
        });

        // Отправляем уведомление участникам
        if (walkData.participants && walkData.participants.length > 0) {
          const message = `
📢 Внимание! Организатор изменил дату и время прогулки:
🗓 Новая дата и время: ${newDate}, ${newTime}
📍 Место: ${walkData.locationText || "По геолокации"}
`;
          await notifyWalkParticipants(walkData.participants, message);
        }

        // Показываем сообщение об успехе
        await updateWizardMessage(
          ctx,
          `✅ Дата и время прогулки обновлены на: ${newDate}, ${newTime}`,
          getMainMenuKeyboard()
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error("Ошибка в шаге 4 редактирования времени:", error);
      await updateWizardMessage(
        ctx,
        "Произошла ошибка при обновлении даты и времени",
        getMainMenuKeyboard()
      );
      return ctx.scene.leave();
    }
  }
);
const editWalkLocationScene = new Scenes.WizardScene(
  "editWalkLocation",
  // Шаг 1: Выбор типа места
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkLocation");
    if (!initResult.success) return ctx.scene.leave();

    await updateWizardMessage(ctx, "📍 Укажите новое место встречи:", {
      inline_keyboard: [
        [
          {
            text: "🟢 Мое текущее местоположение",
            callback_data: "current_location_walk",
          },
        ],
        [{ text: "✏️ Ввести текстом", callback_data: "enter_location_text" }],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ],
    });

    return ctx.wizard.next();
  },

  // Шаг 2: Ввод места
  async (ctx) => {
    try {
      const walkId = ctx.wizard.state.walkId;

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        } else if (data === "current_location_walk") {
          // ИСПРАВЛЕНО: Просто обновляем сообщение с инструкцией
          await updateWizardMessage(
            ctx,
            "Отправьте ваше текущее местоположение. Используйте кнопку ниже 👇"
          );

          // И отправляем НОВОЕ сообщение с клавиатурой геолокации
          const locMsg = await ctx.reply(
            "📍 Нажмите на кнопку для отправки геолокации:",
            {
              reply_markup: {
                keyboard: [
                  [
                    {
                      text: "📍 Отправить моё местоположение",
                      request_location: true,
                    },
                  ],
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
              },
            }
          );

          ctx.wizard.state.locationKeyboardMsgId = locMsg.message_id;
          ctx.wizard.state.waitingForCurrentLocation = true;
          return;
        } else if (data === "choose_map_walk") {
          // ИСПРАВЛЕНО: Также для выбора на карте
          await updateWizardMessage(
            ctx,
            "Выберите место встречи на карте. Используйте кнопку ниже 👇"
          );

          // И отправляем НОВОЕ сообщение с клавиатурой для выбора на карте
          const mapMsg = await ctx.reply(
            "📍 Нажмите на кнопку для выбора места на карте:",
            {
              reply_markup: {
                keyboard: [
                  [
                    {
                      text: "📍 Выбрать место на карте",
                      request_location: true,
                    },
                  ],
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
              },
            }
          );

          ctx.wizard.state.locationKeyboardMsgId = mapMsg.message_id;
          ctx.wizard.state.waitingForMapLocation = true;
          return;
        } else if (data === "enter_location_text") {
          await updateWizardMessage(ctx, "Опишите место встречи:", {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]],
          });
          ctx.wizard.state.waitingForLocationText = true;
          return;
        }
      }

      // Обработка геолокации
      else if (ctx.message && ctx.message.location) {
        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await updateWizardMessage(
            ctx,
            "Прогулка не найдена",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        const walkData = walkDoc.data();

        // Определяем тип местоположения для описания
        let locationDescription = "Обновлено местоположение";

        if (ctx.wizard.state.waitingForCurrentLocation) {
          locationDescription = "Текущее местоположение организатора";
          ctx.wizard.state.waitingForCurrentLocation = false;
        } else if (ctx.wizard.state.waitingForMapLocation) {
          locationDescription = "Место выбрано на карте";
          ctx.wizard.state.waitingForMapLocation = false;
        }

        // Удаляем сообщение с геолокацией
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение с геолокацией:", error);
        }

        // Удаляем сообщение с клавиатурой
        if (ctx.wizard.state.locationKeyboardMsgId) {
          try {
            await ctx.deleteMessage(ctx.wizard.state.locationKeyboardMsgId);
            delete ctx.wizard.state.locationKeyboardMsgId;
          } catch (error) {
            console.log("Не удалось удалить сообщение с клавиатурой:", error);
          }
        }

        // Обновляем геолокацию в базе данных
        await db
          .collection("walks")
          .doc(walkId)
          .update({
            location: {
              latitude: ctx.message.location.latitude,
              longitude: ctx.message.location.longitude,
              description: locationDescription,
            },
            locationText: null,
          });

        // Отправляем уведомление участникам
        if (walkData.participants && walkData.participants.length > 0) {
          const message = `
📢 Внимание! Организатор изменил место встречи:
🗓 Дата и время: ${walkData.date}, ${walkData.time}
📍 Место: ${locationDescription} (проверьте детали прогулки)
`;
          await notifyWalkParticipants(walkData.participants, message);
        }

        await updateWizardMessage(
          ctx,
          "✅ Место встречи успешно обновлено!",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Обработка текстового ввода места
      else if (
        ctx.message &&
        ctx.message.text &&
        ctx.wizard.state.waitingForLocationText
      ) {
        if (!isValidString(ctx.message.text)) {
          // Удаляем сообщение пользователя
          try {
            await ctx.deleteMessage(ctx.message.message_id);
          } catch (error) {
            console.log("Не удалось удалить сообщение пользователя:", error);
          }

          await updateWizardMessage(
            ctx,
            "Описание места встречи не может быть пустым или 'null'. Пожалуйста, введите корректное описание:",
            {
              inline_keyboard: [
                [{ text: "❌ Отмена", callback_data: "cancel" }],
              ],
            }
          );
          return;
        }

        const newLocation = ctx.message.text;

        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await updateWizardMessage(
            ctx,
            "Прогулка не найдена",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }

        const walkData = walkDoc.data();

        // Обновляем место в базе данных
        await db.collection("walks").doc(walkId).update({
          locationText: newLocation,
          location: null,
        });

        // Отправляем уведомление участникам
        if (walkData.participants && walkData.participants.length > 0) {
          const message = `
📢 Внимание! Организатор изменил место встречи:
🗓 Дата и время: ${walkData.date}, ${walkData.time}
📍 Новое место: ${newLocation}
`;
          await notifyWalkParticipants(walkData.participants, message);
        }

        await updateWizardMessage(
          ctx,
          "✅ Место встречи успешно обновлено!",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }

      // Обработка других текстовых сообщений
      else if (ctx.message && ctx.message.text) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        if (ctx.message.text === "❌ Отмена") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        } else {
          // Если получили текст, но не ожидали его, просим выбрать опцию
          await updateWizardMessage(
            ctx,
            "Пожалуйста, выберите опцию из меню или отправьте запрошенную информацию.",
            {
              inline_keyboard: [
                [
                  {
                    text: "🟢 Мое текущее местоположение",
                    callback_data: "current_location_walk",
                  },
                ],
                [
                  {
                    text: "📍 Выбрать на карте",
                    callback_data: "choose_map_walk",
                  },
                ],
                [
                  {
                    text: "✏️ Ввести текстом",
                    callback_data: "enter_location_text",
                  },
                ],
                [{ text: "❌ Отмена", callback_data: "cancel" }],
              ],
            }
          );
        }
      }
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования места:", error);
      await updateWizardMessage(ctx, "Произошла ошибка", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  }
);

const editWalkTypeScene = new Scenes.WizardScene(
  "editWalkType",
  // Шаг 1: Выбор типа
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkType");
    if (!initResult.success) return ctx.scene.leave();

    await updateWizardMessage(
      ctx,
      "<b>Это будет единичное приключение или регулярная традиция?</b> 🔄\n" +
        "<i>Регулярные прогулки помогают быстрее заработать звание Организатора и особые достижения!</i>\n\n" +
        "<i>Регулярные прогулки также засчитываются в ваш счетчик организатора и помогают быстрее получить новое звание!</i>\n" +
        "<i>Важно: если вы не сможете прийти на собственную прогулку, пожалуйста, отмените её заранее, чтобы не подводить других участников.</i>",
      {
        inline_keyboard: [
          [
            { text: "Разовая 🔹", callback_data: "type_single" },
            { text: "Регулярная 🔄", callback_data: "type_regular" },
          ],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ],
      }
    );

    return ctx.wizard.next();
  },

  // Шаг 2: Сохранение типа
  async (ctx) => {
    try {
      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        } else if (data === "type_single" || data === "type_regular") {
          const walkId = ctx.wizard.state.walkId;
          const newType = data === "type_single" ? "single" : "regular";
          const typeText = data === "type_single" ? "Разовая" : "Регулярная";

          // Получаем текущую информацию о прогулке
          const walkDoc = await db.collection("walks").doc(walkId).get();
          if (!walkDoc.exists) {
            await updateWizardMessage(
              ctx,
              "Прогулка не найдена",
              getMainMenuKeyboard()
            );
            return ctx.scene.leave();
          }

          const walkData = walkDoc.data();

          // Обновляем тип прогулки
          await db.collection("walks").doc(walkId).update({
            type: newType,
          });

          // Отправляем уведомление участникам
          if (walkData.participants && walkData.participants.length > 0) {
            const message = `
📢 Внимание! Организатор изменил тип прогулки:
🗓 Дата и время: ${walkData.date}, ${walkData.time}
📍 Место: ${walkData.locationText || "По геолокации"}
🔄 Новый тип: ${typeText}
`;
            await notifyWalkParticipants(walkData.participants, message);
          }

          await updateWizardMessage(
            ctx,
            `✅ Тип прогулки изменен на "${typeText}"`,
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }
      }
      // Обработка текстового ввода (на всякий случай)
      else if (ctx.message && ctx.message.text) {
        // Удаляем сообщение пользователя
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          console.log("Не удалось удалить сообщение пользователя:", error);
        }

        if (ctx.message.text === "❌ Отмена") {
          await updateWizardMessage(
            ctx,
            "Редактирование отменено",
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        } else {
          // Определяем тип прогулки из текста
          const walkId = ctx.wizard.state.walkId;
          const newType = ctx.message.text.toLowerCase().includes("разов")
            ? "single"
            : "regular";
          const typeText = newType === "single" ? "Разовая" : "Регулярная";

          // Получаем текущую информацию о прогулке
          const walkDoc = await db.collection("walks").doc(walkId).get();
          if (!walkDoc.exists) {
            await updateWizardMessage(
              ctx,
              "Прогулка не найдена",
              getMainMenuKeyboard()
            );
            return ctx.scene.leave();
          }

          const walkData = walkDoc.data();

          // Обновляем тип прогулки
          await db.collection("walks").doc(walkId).update({
            type: newType,
          });

          // Отправляем уведомление участникам
          if (walkData.participants && walkData.participants.length > 0) {
            const message = `
📢 Внимание! Организатор изменил тип прогулки:
🗓 Дата и время: ${walkData.date}, ${walkData.time}
📍 Место: ${walkData.locationText || "По геолокации"}
🔄 Новый тип: ${typeText}
`;
            await notifyWalkParticipants(walkData.participants, message);
          }

          await updateWizardMessage(
            ctx,
            `✅ Тип прогулки изменен на "${typeText}"`,
            getMainMenuKeyboard()
          );
          return ctx.scene.leave();
        }
      }
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования типа:", error);
      await updateWizardMessage(ctx, "Произошла ошибка", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  }
);

// Настройка сцен
const stage = new Scenes.Stage([
  registerScene,
  createWalkScene,
  editProfileMenuScene,
  editNameScene,
  editCityScene,
  editDogNameScene,
  editDogBreedScene,
  editDogSizeScene,
  editDogAgeScene,
  editDogPhotoScene,
  editWalkMenuScene,
  editWalkDateTimeScene,
  editWalkLocationScene,
  editWalkTypeScene,
]);

bot.use(stage.middleware());

// Обработка команды /start
bot.command("start", async (ctx) => {
  // Если уже было автоматическое приветствие, не отправляем повторно
  if (ctx.session && ctx.session.justRestarted) {
    // Сбрасываем флаг, чтобы при следующем запуске снова можно было отправлять приветствие, если понадобится
    delete ctx.session.justRestarted;
    return;
  }

  // Проверяем, зарегистрирован ли пользователь
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (userDoc.exists) {
    ctx.reply(
      `Привет, ${userDoc.data().name || ctx.from.first_name}! С возвращением в DogMeet 🐶`,
      { reply_markup: getMainMenuKeyboard() }
    );
  } else {
    const name = ctx.from.first_name || "гость";
    ctx.reply(
      `Привет, ${name}! Добро пожаловать в <b>DogMeet</b> — место, где собаки находят друзей, а хозяева — единомышленников!  🐶.\n` +
        "🔍 <b>Находите</b> собачьих друзей поблизости\n\n" +
        "🗓️ <b>Создавайте</b> яркие прогулки одним взмахом лапы\n" +
        "👋 <b>Присоединяйтесь</b> к сообществу любителей собак\n" +
        "🏆 <b>Зарабатывайте</b> уникальные достижения и звания\n\n",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("Создать профиль", "create_profile")],
          ],
        },
      }
    );
  }
});

bot.command("info", async (ctx) => {
  await ctx.reply(
    "🐶 <b>DogMeet - ваш помощник для прогулок с собакой!</b>\n\n" +
      "С DogMeet вы можете:\n" +
      "• 📍 <b>Находить владельцев собак рядом</b> - используйте геолокацию для поиска прогулок в вашем районе\n" +
      "• 🗓 <b>Создавать прогулки в один клик</b> - выберите дату, время и место встречи\n" +
      "• 👥 <b>Присоединяться к другим участникам</b> - знакомьтесь с единомышленниками\n" +
      "• 🔔 <b>Получать уведомления</b> - будьте в курсе новых прогулок и участников\n" +
      "• 👤 <b>Управлять профилем</b> - редактируйте информацию о себе и вашей собаке\n\n" +
      "Начните с создания профиля и находите новых друзей для вас и вашей собаки!",
    { parse_mode: "HTML", reply_markup: getMainMenuKeyboard() }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "🆘 <b>Нужна помощь с DogMeet?</b>\n\n" +
      "Если у вас возникли вопросы или предложения по улучшению бота, вы можете:\n\n" +
      "• Написать разработчику: <a href='https://t.me/anmalay'>@anmalay</a>\n" +
      "• Ознакомиться с информацией о боте: /info\n" +
      "• Перезапустить бота: /start\n\n" +
      "Мы всегда рады обратной связи и стремимся сделать DogMeet удобнее для вас и вашей собаки! 🐕",
    {
      parse_mode: "HTML",
      reply_markup: getMainMenuKeyboard(),
      disable_web_page_preview: true,
    }
  );
});

// Обработчики текстовых команд клавиатуры
bot.hears("📍 Найти прогулку", (ctx) => {
  ctx.reply("<b>Как будем искать новых друзей сегодня?</b> 🔍", {
    reply_markup: getWalkFiltersKeyboard(),
  });
});

bot.hears("🐕 Создать прогулку", (ctx) => {
  ctx.scene.enter("createWalk");
});

bot.hears("👤 Мой профиль", async (ctx) => {
  try {
    await showProfile(ctx);
  } catch (error) {
    console.error("Ошибка при показе профиля:", error);
    await ctx.reply(
      "Произошла ошибка при загрузке профиля. Попробуйте еще раз.",
      { reply_markup: getPersistentKeyboard() }
    );
  }
});

bot.hears("❓ Помощь", async (ctx) => {
  await ctx.reply(
    "🆘 <b>Нужна помощь с DogMeet?</b>\n\n" +
      "Если у вас возникли вопросы или предложения по улучшению бота, вы можете:\n\n" +
      "• Написать разработчику: <a href='https://t.me/anmalay'>@anmalay</a>\n" +
      "• Ознакомиться с информацией о боте: /info\n" +
      "• Перезапустить бота: /start\n\n" +
      "Мы всегда рады обратной связи и стремимся сделать DogMeet удобнее для вас и вашей собаки! 🐕",
    { parse_mode: "HTML", disable_web_page_preview: true }
  );
});
// Обработка кнопок
bot.action("create_profile", (ctx) => {
  ctx.scene.enter("register");
});

bot.action("ranks_info", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const ranksInfoText = `
    🏆 <b>Система званий и достижений</b> 🏆
    
    Чтобы заработать звания и отметки в DogMeet, важно участвовать в <b>реальных прогулках</b>!
    
    <b>Как это работает:</b>
    - Звания присваиваются за <b>завершенные прогулки</b> — те, которые реально состоялись
    - Прогулка считается завершенной через час после указанного времени
    - Создание прогулки и присоединение к ней не повышают ранг автоматически
    - Отмена прогулки не приносит очков опыта
    
    <b>Шкала званий:</b>
    - 🐾 Хвостик — новичок
    - 🐕 Новичок в стае — 1 прогулка
    - 🐕 Верный друг — 5 прогулок
    - 🐕 Исследователь парков — 10 прогулок
    - 🐕 Верный спутник — 20 прогулок
    - 🐕 Опытный следопыт — 35 прогулок
    - 🐕 Бродяга со стажем — 50 прогулок
    - 🐕 Мастер прогулок — 80 прогулок
    - 🐕 АЛЬФА самец — 120 прогулок
    - 🐕 Легенда DogMeet — 200+ прогулок
    
    <b>Отметки организатора:</b>
    - 🌟 — 1–9 организованных прогулок
    - 🌟🌟 — 10–49 организованных прогулок
    - 🌟🌟🌟 — 50–99 организованных прогулок
    - 👑 — 100+ организованных прогулок (Высшая награда!)
    
    <b>Зачем это всё?</b> 🎁
    
    DogMeet — это не только про прогулки и социализацию. Мы готовим для самых активных участников <b>специальные бонусы</b>:
    
    💥 <b>Скидки</b> в зоомагазинах и ветклиниках  
    🎓 <b>Подарки</b> от школ дрессировки  
    🛍️ <b>Эксклюзивные предложения</b> от партнёров DogMeet  
    
    Чем выше ваш ранг и активность — тем больше привилегий вы получаете.  
    Участвуйте, организовывайте, прокачивайте звания и будьте первыми, кто получит доступ к бонусам!
    
    Будьте ответственны и не пропускайте запланированные прогулки — так вы быстрее заработаете новые звания и уважение в сообществе!
    `;

    // Вместо updateWizardMessage используем прямое редактирование сообщения
    try {
      await ctx.editMessageText(ranksInfoText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👤 Вернуться в профиль", callback_data: "my_profile" }],
            [{ text: "🏠 В главное меню", callback_data: "back_to_main_menu" }],
          ],
        },
      });
    } catch (error) {
      console.error("Ошибка при обновлении сообщения:", error);

      // Если не удалось обновить, отправляем новое сообщение
      await ctx.reply(ranksInfoText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👤 Вернуться в профиль", callback_data: "my_profile" }],
            [{ text: "🏠 В главное меню", callback_data: "back_to_main_menu" }],
          ],
        },
      });
    }
  } catch (error) {
    console.error("Ошибка при показе информации о званиях:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Вернуться в меню", callback_data: "back_to_main_menu" }],
        ],
      },
    });
  }
});

bot.action(/show_more_nearby_(.+)_(.+)_(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const latitude = parseFloat(ctx.match[1]);
    const longitude = parseFloat(ctx.match[2]);
    const offset = parseInt(ctx.match[3]);

    // Если нет сохраненных прогулок в сессии, выполняем новый поиск
    if (!ctx.session || !ctx.session.nearbyWalks) {
      const statusMsg = await ctx.reply(
        "Ищем прогулки рядом с вашей сохранённой локацией..."
      );
      await findNearbyWalksUnified(
        ctx,
        latitude,
        longitude,
        statusMsg.message_id
      );
      return;
    }

    const nearbyWalks = ctx.session.nearbyWalks;

    // Показываем следующие 5 прогулок
    const walksToShow = nearbyWalks.slice(offset, offset + 5);

    if (walksToShow.length === 0) {
      await ctx.reply("Больше прогулок не найдено.");
      return;
    }

    for (const walk of walksToShow) {
      const distanceText =
        walk.distance < 1
          ? `${Math.round(walk.distance * 1000)} м`
          : `${walk.distance.toFixed(1)} км`;

      const ownLabel = walk.isOwn ? "🌟 МОЯ ПРОГУЛКА\n" : "";

      const organizerBadge =
        walk.organizer.achievements &&
        walk.organizer.achievements.organizerBadge
          ? ` ${walk.organizer.achievements.organizerBadge}`
          : "";

      const walkPreview = `${ownLabel}🕒 ${walk.date}, ${walk.time}
📍 ${locationWithDistance}
🐕 Участников: ${walk.participants ? walk.participants.length + 1 : 1}
👤 ${walk.dog.name} (${walk.organizer.name}${organizerBadge}) ${getDogAgeText(walk.dog.age)}${userRankDisplay}
${walk.organizer.username ? "@" + walk.organizer.username : ""}`.trim();

      await ctx.reply(walkPreview, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Подробнее", callback_data: `walk_details_${walk.id}` }],
          ],
        },
      });
    }

    // Если есть еще прогулки, показываем кнопку "Показать еще"
    const newOffset = offset + 5;
    if (newOffset < nearbyWalks.length) {
      await ctx.reply(
        `Показано ${newOffset} из ${nearbyWalks.length} прогулок`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Показать больше",
                  callback_data: `show_more_nearby_${latitude}_${longitude}_${newOffset}`,
                },
              ],
              [{ text: "⬅️ Назад", callback_data: "find_walk" }],
            ],
          },
        }
      );
    } else {
      await ctx.reply("Больше прогулок нет:", {
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
        },
      });
    }
  } catch (error) {
    console.error("Ошибка при показе дополнительных прогулок:", error);
    await ctx.reply("Произошла ошибка. Пожалуйста, попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
});

bot.action("show_all_badges", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    if (!userDoc.exists) return;

    const userData = userDoc.data();
    if (
      !userData.achievements ||
      !userData.achievements.badges ||
      userData.achievements.badges.length === 0
    ) {
      await updateWizardMessage(
        ctx,
        "У вас пока нет заработанных достижений. Присоединяйтесь к прогулкам, чтобы получить их!",
        {
          inline_keyboard: [
            [{ text: "⬅️ Назад в профиль", callback_data: "my_profile" }],
          ],
        }
      );
      return;
    }

    // Сортируем бейджи по дате получения (новые вверху)
    const sortedBadges = [...userData.achievements.badges].sort((a, b) => {
      return new Date(b.earnedAt) - new Date(a.earnedAt);
    });

    // Формируем сообщение с достижениями
    let message = "🏆 <b>Ваши достижения</b> 🏆\n\n";

    sortedBadges.forEach((badge, index) => {
      const date = new Date(badge.earnedAt).toLocaleDateString();
      message += `${index + 1}. <b>${badge.name}</b> (${date})\n   ${badge.description}\n\n`;
    });

    await updateWizardMessage(ctx, message, {
      parse_mode: "HTML",
      inline_keyboard: [
        [{ text: "⬅️ Назад в профиль", callback_data: "my_profile" }],
      ],
    });
  } catch (error) {
    console.error("Ошибка при показе достижений:", error);
    await ctx.reply("Произошла ошибка при загрузке достижений.");
  }
});

bot.action("show_rating", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    // Получаем всех пользователей
    const usersSnapshot = await db.collection("users").get();

    // Создаем массивы для участников и организаторов
    const participants = [];
    const organizers = [];

    // Заполняем данные
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();

      if (userData.achievements) {
        if (userData.achievements.walkCount > 0) {
          participants.push({
            name: userData.name,
            username: userData.username,
            rank: userData.achievements.userRank,
            count: userData.achievements.walkCount,
          });
        }

        if (userData.achievements.organizedCount > 0) {
          organizers.push({
            name: userData.name,
            username: userData.username,
            rank: userData.achievements.organizerBadge || "Организатор",
            count: userData.achievements.organizedCount,
          });
        }
      }
    });

    // Сортируем по количеству прогулок
    participants.sort((a, b) => b.count - a.count);
    organizers.sort((a, b) => b.count - a.count);

    // Ограничиваем топ-10
    const topParticipants = participants.slice(0, 10);
    const topOrganizers = organizers.slice(0, 10);

    // Функция для получения эмодзи места
    const getPlaceEmoji = (index) => {
      switch (index) {
        case 0:
          return "🥇 "; // Золотая медаль для 1 места
        case 1:
          return "🥈 "; // Серебряная медаль для 2 места
        case 2:
          return "🥉 "; // Бронзовая медаль для 3 места
        default:
          return `${index + 1}. `;
      }
    };

    // Формируем сообщение
    let message = "🏆 <b>Рейтинг пользователей DogMeet</b>\n\n";

    message += "<b>Топ участников прогулок:</b>\n";
    if (topParticipants.length > 0) {
      topParticipants.forEach((p, index) => {
        const usernameDisplay = p.username ? ` (@${p.username})` : "";
        // Используем эмодзи для первых трех мест
        const placePrefix = getPlaceEmoji(index);
        message += `${placePrefix}${p.name}${usernameDisplay} - ${p.rank} (${p.count} прогулок)\n`;
      });
    } else {
      message += "Пока нет участников с прогулками.\n";
    }

    message += "\n<b>Топ организаторов прогулок:</b>\n";
    if (topOrganizers.length > 0) {
      topOrganizers.forEach((o, index) => {
        const usernameDisplay = o.username ? ` (@${o.username})` : "";
        // Используем эмодзи для первых трех мест
        const placePrefix = getPlaceEmoji(index);
        message += `${placePrefix}${o.name}${usernameDisplay} - ${o.rank} (${o.count} прогулок)\n`;
      });
    } else {
      message += "Пока нет организаторов прогулок.\n";
    }

    await updateWizardMessage(ctx, message, {
      parse_mode: "HTML",
      inline_keyboard: [
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    });
  } catch (error) {
    console.error("Ошибка при получении рейтинга:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при получении рейтинга", {
      inline_keyboard: [
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    });
  }
});

// Обработчик для возврата к выбору города
bot.action("back_to_city_selection", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Выберите город из списка:",
    Markup.inlineKeyboard([
      ...POPULAR_CITIES.map((city) => [
        { text: city, callback_data: `city_${city}` },
      ]),
      [
        {
          text:
            "📍 Отправить геолокацию (рекомендуется)\n" +
            "<i>(Геолокация поможет находить прогулки в пешей доступности)</i>",
          callback_data: "send_location_reg",
        },
      ],
    ])
  );
});

// Отмена создания прогулки
// Обработчик кнопки "Отменить" в конце создания прогулки
bot.action("cancel_walk", async (ctx) => {
  try {
    await ctx.answerCbQuery("Создание прогулки отменено");

    // Пытаемся удалить инлайн кнопки
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      console.error("Ошибка при удалении клавиатуры:", error);
    }

    await ctx.reply("❌ Создание прогулки отменено.", {
      reply_markup: getMainMenuKeyboard(),
    });

    return ctx.scene.leave();
  } catch (error) {
    console.error("Ошибка при отмене создания прогулки:", error);
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return ctx.scene.leave();
  }
});

// Обработчик для главного меню
// Модифицируем функцию главного меню
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📍 Найти прогулку", callback_data: "find_walk" },
        { text: "🐕 Создать прогулку", callback_data: "create_walk" },
      ],
      [
        { text: "📋 Мои прогулки", callback_data: "my_walks" },
        { text: "👥 Где я участвую", callback_data: "my_participations" },
      ],
      [
        { text: "👤 Мой профиль", callback_data: "my_profile" },
        { text: "🏆 Рейтинг", callback_data: "show_rating" },
      ],
    ],
  };
}

// Новая функция для постоянной клавиатуры
function getPersistentKeyboard() {
  return {
    resize_keyboard: true,
    persistent: true,
    keyboard: [
      [{ text: "📍 Найти прогулку" }, { text: "🐕 Создать прогулку" }],
      [{ text: "👤 Мой профиль" }, { text: "❓ Помощь" }],
    ],
  };
}

// Меню фильтров прогулок
function getWalkFiltersKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔹 Прогулки рядом", callback_data: "walks_nearby" }],
      [
        { text: "📅 Сегодня", callback_data: "walks_today" },
        { text: "📅 Завтра", callback_data: "walks_tomorrow" },
        { text: "📅 Все даты", callback_data: "walks_all_dates" },
      ],
      [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
    ],
  };
}

bot.action("my_profile", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Получаем ID сообщения из callback-запроса
    const messageId =
      ctx.callbackQuery && ctx.callbackQuery.message
        ? ctx.callbackQuery.message.message_id
        : ctx.session
          ? ctx.session.lastMessageId
          : null;

    // Удаляем предыдущее сообщение, если оно есть
    if (messageId) {
      try {
        await ctx.deleteMessage(messageId);
      } catch (error) {
        console.log("Не удалось удалить предыдущее сообщение:", error);
      }
    }

    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

    if (!userDoc.exists) {
      return await ctx.reply(
        "Ваш профиль не найден. Пожалуйста, пройдите регистрацию.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🐾 Создать профиль", callback_data: "create_profile" }],
            ],
          },
        }
      );
    }

    const userData = userDoc.data();
    const achievements = userData.achievements || {
      walkCount: 0,
      organizedCount: 0,
      userRank: "Хвостик",
      organizerBadge: "",
      badges: [],
    };

    // Проверяем специальный статус
    let specialStatusText = "";
    if (achievements.specialStatus && achievements.specialStatus.title) {
      const expiryDate = achievements.specialStatus.expiresAt
        ? new Date(achievements.specialStatus.expiresAt)
        : null;
      if (expiryDate && expiryDate > new Date()) {
        specialStatusText = `\n✨ <b>Особый статус:</b> ${achievements.specialStatus.title} (до ${moment(expiryDate).format("DD.MM")})`;
      } else {
        // Если статус истек, удаляем его
        db.collection("users").doc(String(ctx.from.id)).update({
          "achievements.specialStatus.title": null,
          "achievements.specialStatus.expiresAt": null,
        });
      }
    }

    let badgesText = "";
    if (achievements.badges && achievements.badges.length > 0) {
      const latestBadges = achievements.badges.slice(-3); // Последние 3 значка
      badgesText = "\n🏅 <b>Последние достижения:</b>\n";
      latestBadges.forEach((badge) => {
        badgesText += `• <i>${badge.name}</i> - ${badge.description}\n`;
      });
    }

    const orgBadge = achievements.organizerBadge
      ? ` ${achievements.organizerBadge}`
      : "";

    const nextRankInfo = getNextRankInfo(achievements.walkCount);
    const progressText = `📈 <b>Прогресс:</b> ${achievements.walkCount}/${nextRankInfo.threshold} прогулок до звания "${nextRankInfo.rank}"`;

    const profileText = `
      🐕 <b>КАРТОЧКА СОБАКОВОДА</b> 🐕
      
      👤 <b>${userData.name}</b>${orgBadge} ${userData.username ? "@" + userData.username : ""}
      📊 <b>Звание:</b> ${achievements.userRank}
      🦴 <b>Прогулок:</b> ${achievements.walkCount} (организовано: ${achievements.organizedCount})${specialStatusText}
      ${progressText}
      📍 <b>Город:</b> ${userData.city}
      🐕 <b>Собака:</b> ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
      ${badgesText}
          `;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✏️ Редактировать профиль",
            callback_data: "edit_profile_menu",
          },
          {
            text: "🏆 Все достижения",
            callback_data: "show_all_badges",
          },
        ],
        [
          {
            text: "❓ Как работают звания",
            callback_data: "ranks_info",
          },
        ],
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    };

    // Если у собаки есть фото, отправляем с фото
    if (userData.dog && userData.dog.photoId) {
      // Отправляем фото с подписью
      const photoMsg = await ctx.replyWithPhoto(userData.dog.photoId, {
        caption: profileText,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard.inline_keyboard },
      });

      // Сохраняем ID сообщения
      if (!ctx.session) ctx.session = {};
      ctx.session.lastMessageId = photoMsg.message_id;
    } else {
      // Если редактирование не удалось, отправляем новое сообщение
      const msg = await ctx.reply(profileText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Сохраняем ID нового сообщения
      ctx.session.lastMessageId = msg.message_id;
    }
  } catch (error) {
    console.error("Ошибка при отображении профиля:", error);
    await ctx.reply(
      "Произошла ошибка при загрузке профиля. Попробуйте еще раз."
    );
  }
});

bot.action("back_to_main_menu", async (ctx) => {
  await ctx.answerCbQuery();
  const menuText =
    "<b>Главное меню DogMeet</b> 🎮\n\n" + "Чем займемся сегодня?";
  await updateWizardMessage(ctx, menuText, getMainMenuKeyboard());
});
// Редактирование профиля
bot.action("edit_profile_menu", async (ctx) => {
  await ctx.answerCbQuery();

  // Простой текст без маркеров и цифр
  const menuText = "Что вы хотите изменить?";

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📝 Имя", callback_data: "edit_name" },
        { text: "🏙 Город", callback_data: "edit_city" },
      ],
      [
        { text: "🐕 Имя собаки", callback_data: "edit_dog_name" },
        { text: "🐶 Порода собаки", callback_data: "edit_dog_breed" },
      ],
      [
        { text: "📏 Размер собаки", callback_data: "edit_dog_size" },
        { text: "🗓 Возраст собаки", callback_data: "edit_dog_age" },
      ],
      [{ text: "📸 Фото собаки", callback_data: "edit_dog_photo" }],
      [{ text: "↩️ Вернуться в профиль", callback_data: "my_profile" }],
    ],
  };

  // Пытаемся обновить текущее сообщение
  try {
    await ctx.editMessageText(menuText, {
      reply_markup: keyboard,
    });
  } catch (error) {
    // Если возникла ошибка, отправляем новое сообщение
    console.log("Ошибка при обновлении сообщения:", error.message);
    await ctx.reply(menuText, {
      reply_markup: keyboard,
    });
  }
});
// Обработчик для поиска в своем городе
bot.action("search_in_my_city", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Получаем данные пользователя
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

    if (!userDoc.exists || !userDoc.data().city) {
      await ctx.reply(
        "Не удалось определить ваш город. Пожалуйста, выберите город:",
        {
          reply_markup: {
            inline_keyboard: [
              ...POPULAR_CITIES.map((city) => [
                { text: city, callback_data: `search_city_${city}` },
              ]),
              [{ text: "⬅️ Назад", callback_data: "find_walk" }],
            ],
          },
        }
      );
      return;
    }

    const city = userDoc.data().city;
    await findWalksInCity(ctx, city);
  } catch (error) {
    console.error("Ошибка при поиске прогулок в городе:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
});

// Обработчик для обновления геолокации
bot.action("update_user_location", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    await ctx.reply(
      "Чтобы находить прогулки рядом с вами, отправьте свою текущую геолокацию:\n\n" +
        "💡 Проверьте, что в настройках вашего устройства включена геолокация.",
      {
        reply_markup: {
          keyboard: [
            [
              {
                text: "📍 Отправить моё местоположение",
                request_location: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );

    // Сохраняем в сессии, что мы ожидаем геолокацию
    if (!ctx.session) ctx.session = {};
    ctx.session.waitingLocationForNearbyWalks = true;
  } catch (error) {
    console.error("Ошибка при запросе геолокации:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Обработчик для выбора города для поиска
bot.action("select_city_for_search", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    await ctx.reply("Выберите город для поиска прогулок:", {
      reply_markup: {
        inline_keyboard: [
          ...POPULAR_CITIES.map((city) => [
            { text: city, callback_data: `search_city_${city}` },
          ]),
          [{ text: "Другой город", callback_data: "other_city_for_search" }],
          [{ text: "⬅️ Назад", callback_data: "find_walk" }],
        ],
      },
    });
  } catch (error) {
    console.error("Ошибка при выборе города:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Обработчик для ввода другого города
bot.action("other_city_for_search", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    await ctx.reply("Введите название города для поиска прогулок:");

    // Сохраняем в сессии, что мы ожидаем ввод города
    if (!ctx.session) ctx.session = {};
    ctx.session.waitingForCityInput = true;
  } catch (error) {
    console.error("Ошибка при запросе города:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Обработчик для выбора города из списка
bot.action(/search_city_(.+)/, async (ctx) => {
  try {
    const city = ctx.match[1];
    await ctx.answerCbQuery();

    // Начинаем поиск в выбранном городе
    await findWalksInCity(ctx, city);
  } catch (error) {
    console.error("Ошибка при поиске прогулок в городе:", error);
    await ctx.reply("Произошла ошибка при поиске прогулок. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
});

bot.action(/pagination_(\d+)_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1]);
    const returnCommand = ctx.match[2];

    // Получаем данные из сессии
    if (!ctx.session || !ctx.session.lastWalks) {
      return await ctx.reply("Ошибка навигации. Вернитесь в меню.", {
        reply_markup: getMainMenuKeyboard(),
      });
    }

    // Показываем прогулки с пагинацией
    await showWalksWithPagination(
      ctx,
      ctx.session.lastWalks,
      page,
      returnCommand
    );
  } catch (error) {
    console.error("Ошибка пагинации:", error);
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Обработчик для приглашения друзей
bot.action("invite_friends", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Создаем текст приглашения
    const inviteText =
      `🐶 Привет! Я использую DogMeet для поиска компании на прогулки с собакой.\n\n` +
      `Присоединяйся, чтобы:\n` +
      `• Находить владельцев собак рядом\n` +
      `• Создавать прогулки одним кликом\n` +
      `• Присоединяться к другим собачникам\n\n` +
      `Переходи в @DogMeetBot и регистрируйся!`;

    await ctx.reply(
      "Поделитесь этим сообщением с друзьями, чтобы пригласить их в DogMeet:",
      {
        reply_markup: getMainMenuKeyboard(),
      }
    );

    // Отправляем отдельное сообщение с текстом для пересылки
    await ctx.reply(inviteText);
  } catch (error) {
    console.error("Ошибка при создании приглашения:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Расширенный обработчик для текстовых сообщений (для ввода города)
bot.on("text", async (ctx) => {
  try {
    // Если ожидаем ввод города для поиска
    if (ctx.session && ctx.session.waitingForCityInput) {
      const city = ctx.message.text.trim();

      // Валидация города
      if (!isValidString(city)) {
        await ctx.reply("Пожалуйста, введите корректное название города:");
        return;
      }

      // Сбрасываем флаг ожидания
      ctx.session.waitingForCityInput = false;

      // Начинаем поиск в указанном городе
      await findWalksInCity(ctx, city);
    }
    // Другие обработчики текстовых сообщений могут быть здесь
  } catch (error) {
    console.error("Ошибка при обработке текстового сообщения:", error);
  }
});

// Обработчики фильтров прогулок
bot.action("walks_nearby", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    // Получаем данные пользователя
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

    if (!userDoc.exists) {
      await ctx.reply("Ваш профиль не найден. Пожалуйста, создайте профиль.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Создать профиль", callback_data: "create_profile" }],
            [{ text: "⬅️ Назад", callback_data: "find_walk" }],
          ],
        },
      });
      return;
    }

    const userData = userDoc.data();

    // Проверяем, есть ли у пользователя сохранённая геолокация
    if (
      userData.location &&
      userData.location.latitude &&
      userData.location.longitude
    ) {
      // Используем сохранённую геолокацию
      const statusMsg = await ctx.reply(
        "Ищем прогулки рядом с вашей сохранённой локацией..."
      );
      await findNearbyWalksUnified(
        ctx,
        userData.location.latitude,
        userData.location.longitude,
        statusMsg.message_id
      );
    }
    // Проверяем, есть ли у пользователя город
    else if (userData.city) {
      await ctx.reply(
        `У вас не указана геолокация, но есть город (${userData.city}).\n\n` +
          `💡 <b>Совет</b>: Для поиска прогулок именно рядом с вами, рекомендуем отправить геолокацию. Это позволит:\n` +
          `• Находить прогулки в пешей доступности\n` +
          `• Получать уведомления о прогулках поблизости\n` +
          `• Видеть точное расстояние до места прогулки\n\n` +
          `Что предпочитаете?`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📍 Отправить геолокацию",
                  callback_data: "update_user_location",
                },
              ],
              [
                {
                  text: "🏙 Искать прогулки в моём городе",
                  callback_data: "search_in_my_city",
                },
              ],
            ],
          },
        }
      );
    }
    // Если нет ни геолокации, ни города
    else {
      await ctx.reply(
        "Для поиска прогулок поблизости нам нужно знать ваше местоположение.\n\nЧто предпочитаете?",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📍 Отправить геолокацию (рекомендуется)",
                  callback_data: "send_location_for_search",
                },
              ],
              [
                {
                  text: "🏙 Выбрать город",
                  callback_data: "select_city_for_search",
                },
              ],
              [{ text: "⬅️ Назад", callback_data: "find_walk" }],
            ],
          },
        }
      );
    }
  } catch (error) {
    console.error("Ошибка при поиске прогулок поблизости:", error);
    await ctx.reply("Произошла ошибка при поиске прогулок. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
});
// Обработчик прогулок сегодня
bot.action("walks_today", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const today = moment().format("DD.MM.YYYY");
    const walksSnapshot = await db
      .collection("walks")
      .where("date", "==", today)
      .get();

    // Показываем прогулки с пагинацией
    await showWalksWithPagination(ctx, walksSnapshot.docs, 0, "find_walk");
  } catch (error) {
    console.error("Ошибка при показе прогулок:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при загрузке прогулок.", {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    });
  }
});

// Обработчик прогулок завтра
bot.action("walks_tomorrow", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const tomorrow = moment().add(1, "days").format("DD.MM.YYYY");
    const walksSnapshot = await db
      .collection("walks")
      .where("date", "==", tomorrow)
      .get();

    // Показываем прогулки с пагинацией
    await showWalksWithPagination(ctx, walksSnapshot.docs, 0, "find_walk");
  } catch (error) {
    console.error("Ошибка при показе прогулок:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при загрузке прогулок.", {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    });
  }
});

// Обработчик всех прогулок
bot.action("walks_all_dates", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const walksSnapshot = await db.collection("walks").get();

    // Показываем прогулки с пагинацией
    await showWalksWithPagination(ctx, walksSnapshot.docs, 0, "find_walk");
  } catch (error) {
    console.error("Ошибка при показе прогулок:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при загрузке прогулок.", {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    });
  }
});

// Обновление функции отображения деталей прогулки
bot.action(/walk_details_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    await ctx.answerCbQuery();

    const walkDoc = await db.collection("walks").doc(walkId).get();

    if (!walkDoc.exists) {
      return await updateWizardMessage(
        ctx,
        "Прогулка не найдена или была отменена.",
        {
          inline_keyboard: [
            [{ text: "⬅️ Назад", callback_data: "return_to_walks" }],
          ],
        }
      );
    }

    const walk = walkDoc.data();

    // Формируем информацию о местоположении
    let locationInfo = "Не указано";
    if (walk.locationText) {
      locationInfo = walk.locationText;
    } else if (walk.location) {
      locationInfo = walk.location.description || "По геолокации";
    }

    // Формируем детальную информацию о прогулке
    let walkDetails =
      "✨ <b>ДЕТАЛИ ПРОГУЛКИ</b> ✨\n\n" +
      `
🗓 Прогулка: ${walk.date}, ${walk.time}  
📍 Место: ${locationInfo}  
🔄 Тип: ${walk.type === "single" ? "Разовая" : "Регулярная"}  
👤 Организатор: ${walk.organizer.name} ${walk.organizer.username ? "@" + walk.organizer.username : ""}  
🐕 Собака: ${walk.dog.name}, ${walk.dog.breed}, ${getDogSizeText(walk.dog.size)}, ${getDogAgeText(walk.dog.age)}  
`;

    // Добавляем список участников
    if (walk.participants && walk.participants.length > 0) {
      walkDetails += "\n👥 Присоединились:\n";
      for (const participant of walk.participants) {
        walkDetails += `- ${participant.name} с ${participant.dogName}\n`;
      }
    }

    // Проверяем, является ли текущий пользователь организатором
    const isOrganizer = walk.organizer.id == ctx.from.id;

    // Проверяем, является ли текущий пользователь участником
    const isParticipant =
      walk.participants && walk.participants.some((p) => p.id == ctx.from.id);

    // Кнопки в зависимости от роли пользователя
    const keyboard = [];

    // Если есть координаты, добавляем кнопку открытия карты
    if (walk.location && walk.location.latitude && walk.location.longitude) {
      keyboard.push([
        {
          text: "🗺️ Открыть на карте",
          url: `https://maps.google.com/maps?q=${walk.location.latitude},${walk.location.longitude}`,
        },
      ]);
    }

    if (isOrganizer) {
      // Кнопки для организатора
      keyboard.push([
        {
          text: "Редактировать прогулку ✏️",
          callback_data: `edit_walk_${walkId}`,
        },
        {
          text: "Отменить прогулку ❌",
          callback_data: `cancel_walk_${walkId}`,
        },
      ]);
    } else {
      // Кнопки для обычных пользователей
      if (!isParticipant) {
        keyboard.push([
          { text: "Присоединиться ✅", callback_data: `join_walk_${walkId}` },
        ]);
      } else {
        keyboard.push([
          {
            text: "Покинуть прогулку ❌",
            callback_data: `leave_walk_${walkId}`,
          },
        ]);
      }
      keyboard.push([
        {
          text: "Связаться с организатором 📩",
          callback_data: `contact_organizer_${walkId}`,
        },
      ]);
    }

    // Добавляем кнопку "Назад к списку"
    keyboard.push([
      { text: "⬅️ Назад к списку", callback_data: "return_to_walks" },
    ]);

    // Удаляем предыдущее сообщение с фото, если оно было
    if (ctx.session && ctx.session.photoMessageId) {
      try {
        await ctx.deleteMessage(ctx.session.photoMessageId);
        delete ctx.session.photoMessageId;
      } catch (error) {
        console.log("Не удалось удалить предыдущее фото:", error);
      }
    }

    // Если у собаки есть фото, отправляем информацию вместе с фото
    if (walk.dog.photoId) {
      // Отправляем фото с подписью
      const photoMsg = await ctx.replyWithPhoto(walk.dog.photoId, {
        caption: walkDetails,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      });

      // Сохраняем ID сообщения с фото
      if (!ctx.session) ctx.session = {};
      ctx.session.lastMessageId = photoMsg.message_id;
      ctx.session.photoMessageId = photoMsg.message_id;
    } else {
      // Если нет фото, просто обновляем текущее сообщение
      await updateWizardMessage(ctx, walkDetails, {
        inline_keyboard: keyboard,
      });
    }
  } catch (error) {
    console.error("Ошибка при отображении деталей прогулки:", error);
    await updateWizardMessage(
      ctx,
      "Произошла ошибка. Возврат в главное меню.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      }
    );
  }
});

// Обработчик возврата к списку прогулок
bot.action("return_to_walks", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Удаляем сообщение с фото, если оно было
    if (ctx.session && ctx.session.photoMessageId) {
      try {
        await ctx.deleteMessage(ctx.session.photoMessageId);
        delete ctx.session.photoMessageId;
      } catch (error) {
        console.log("Не удалось удалить сообщение с фото:", error);
      }
    }

    // Возвращаемся к последнему списку прогулок
    if (ctx.session && ctx.session.lastWalks) {
      const returnCommand =
        ctx.session.lastReturnCommand || "back_to_main_menu";
      await showWalksWithPagination(
        ctx,
        ctx.session.lastWalks,
        0,
        returnCommand
      );
    } else {
      // Если нет сохраненных прогулок, возвращаемся в главное меню
      await updateWizardMessage(ctx, "Главное меню", getMainMenuKeyboard());
    }
  } catch (error) {
    console.error("Ошибка при возврате к списку прогулок:", error);
    await updateWizardMessage(
      ctx,
      "Произошла ошибка. Возврат в главное меню.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      }
    );
  }
});
// Исправленный обработчик присоединения к прогулке
bot.action(/join_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkRef = db.collection("walks").doc(walkId);
    const walkDoc = await walkRef.get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или была отменена.");
      await updateWizardMessage(ctx, "Прогулка не найдена или была отменена.", {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "return_to_walks" }],
        ],
      });
      return;
    }

    const walk = walkDoc.data();

    // Проверяем, не присоединился ли пользователь уже
    if (
      walk.participants &&
      walk.participants.some((p) => p.id === ctx.from.id)
    ) {
      await ctx.answerCbQuery("Вы уже присоединились к этой прогулке!");
      return;
    }

    // Получаем данные пользователя
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();

    // Добавляем пользователя в список участников
    const newParticipant = {
      id: ctx.from.id,
      name: userData.name,
      username: ctx.from.username || null,
      dogName: userData.dog.name,
      dogBreed: userData.dog.breed,
      dogSize: userData.dog.size,
      dogAge: userData.dog.age,
      dogPhotoId: userData.dog.photoId,
    };

    const participants = walk.participants || [];
    await walkRef.update({
      participants: [...participants, newParticipant],
    });

    // Добавляем участника в историю организатора
    await db
      .collection("users")
      .doc(String(walk.organizer.id))
      .update({
        "walkHistory.participants": admin.firestore.FieldValue.arrayUnion(
          String(ctx.from.id)
        ),
        "walkHistory.lastUpdated": new Date(),
      });

    // Уведомляем пользователя о успешном присоединении
    await ctx.answerCbQuery("✅ Вы присоединились к прогулке!");

    // Обновляем то же сообщение, в котором была нажата кнопка
    await updateWizardMessage(
      ctx,
      "✅ Вы присоединились к прогулке! Организатор получил уведомление.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Назад к списку", callback_data: "return_to_walks" }],
          [{ text: "⬅️ В главное меню", callback_data: "back_to_main_menu" }],
        ],
      }
    );

    // Уведомляем организатора о новом участнике
    try {
      const notificationText = `
📢 <b>Новый участник в вашей прогулке!</b>
👤 ${userData.name}
🐕 ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
📩 Контакт: ${ctx.from.username ? "@" + ctx.from.username : "Нет username"}
`;

      // По аналогии с деталями прогулок
      if (userData.dog && userData.dog.photoId) {
        await bot.telegram.sendPhoto(walk.organizer.id, userData.dog.photoId, {
          caption: notificationText,
          parse_mode: "HTML",
          reply_markup: getMainMenuKeyboard(),
        });
      } else {
        await bot.telegram.sendMessage(walk.organizer.id, notificationText, {
          parse_mode: "HTML",
          reply_markup: getMainMenuKeyboard(),
        });
      }
    } catch (error) {
      console.error("Ошибка при отправке уведомления организатору:", error);
    }
  } catch (error) {
    console.error("Ошибка при присоединении к прогулке:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    await updateWizardMessage(
      ctx,
      "Произошла ошибка. Возврат в главное меню.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      }
    );
  }
});
// Покинуть прогулку
bot.action(/leave_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkRef = db.collection("walks").doc(walkId);
    const walkDoc = await walkRef.get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или была отменена.");
      await updateWizardMessage(ctx, "Прогулка не найдена или была отменена.", {
        inline_keyboard: [
          [{ text: "⬅️ Назад", callback_data: "return_to_walks" }],
        ],
      });
      return;
    }

    const walk = walkDoc.data();

    // Удаляем пользователя из списка участников
    const updatedParticipants = walk.participants.filter(
      (p) => p.id !== ctx.from.id
    );

    await walkRef.update({
      participants: updatedParticipants,
    });

    await ctx.answerCbQuery("Вы покинули прогулку.");

    // Обновляем то же сообщение, в котором была нажата кнопка
    await updateWizardMessage(ctx, "Вы покинули прогулку.", {
      inline_keyboard: [
        [{ text: "⬅️ Назад к списку", callback_data: "return_to_walks" }],
        [{ text: "⬅️ В главное меню", callback_data: "back_to_main_menu" }],
      ],
    });

    // Уведомляем организатора
    try {
      await bot.telegram.sendMessage(
        walk.organizer.id,
        `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} покинул вашу прогулку.`
      );
    } catch (error) {
      console.error("Ошибка при отправке уведомления организатору:", error);
    }
  } catch (error) {
    console.error("Ошибка при покидании прогулки:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    await updateWizardMessage(
      ctx,
      "Произошла ошибка. Возврат в главное меню.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      }
    );
  }
});

// Отмена прогулки организатором
bot.action(/cancel_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkRef = db.collection("walks").doc(walkId);
    const walkDoc = await walkRef.get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или уже отменена.");
      await ctx.reply("Прогулка не найдена или уже отменена.", {
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }

    const walk = walkDoc.data();

    // Проверяем, что пользователь - организатор
    if (walk.organizer.id !== ctx.from.id) {
      await ctx.answerCbQuery("Только организатор может отменить прогулку.");
      return;
    }

    // Уведомляем всех участников об отмене с подробностями
    if (walk.participants && walk.participants.length > 0) {
      const message = `
  ❌ ПРОГУЛКА ОТМЕНЕНА!
  Организатор отменил прогулку со следующими деталями:
  🗓 Дата и время: ${walk.date}, ${walk.time}
  📍 Место: ${walk.locationText || "По геолокации"}
  👤 Организатор: ${walk.organizer.name}
  🐕 Собака: ${walk.dog.name}, ${walk.dog.breed}
  `;
      await notifyWalkParticipants(walk.participants, message);
    }

    // Удаляем прогулку
    await walkRef.delete();

    await ctx.answerCbQuery("Прогулка отменена.");

    // Добавляем возврат в главное меню
    await ctx.reply(
      "Прогулка успешно отменена. Все участники получили уведомления.",
      { reply_markup: getMainMenuKeyboard() }
    );
  } catch (error) {
    console.error("Ошибка при отмене прогулки:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    await ctx.reply("Произошла ошибка при отмене прогулки. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Контакт с организатором
bot.action(/contact_organizer_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkDoc = await db.collection("walks").doc(walkId).get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или была отменена.");
      await ctx.reply("Прогулка не найдена или была отменена.", {
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }

    const walk = walkDoc.data();
    await ctx.answerCbQuery();

    if (walk.organizer.username) {
      await ctx.reply(
        `Вы можете связаться с организатором: @${walk.organizer.username}`,
        { reply_markup: getMainMenuKeyboard() }
      );
    } else {
      await ctx.reply("К сожалению, у организатора нет username в Telegram", {
        reply_markup: getMainMenuKeyboard(),
      });

      // Опционально: можно реализовать систему сообщений через бота
      try {
        await bot.telegram.sendMessage(
          walk.organizer.id,
          `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} хочет связаться с вами по поводу прогулки ${walk.date}, ${walk.time}.`,
          { reply_markup: getMainMenuKeyboard() }
        );
      } catch (error) {
        console.error("Ошибка при отправке сообщения организатору:", error);
      }
    }
  } catch (error) {
    console.error("Ошибка при связи с организатором:", error);
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

bot.action(/edit_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    console.log(`Редактирование прогулки с ID: ${walkId}`);

    // Проверка существования прогулки
    const walkDoc = await db.collection("walks").doc(walkId).get();
    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена");
      return ctx.reply("Прогулка не найдена или была отменена");
    }

    // Сохраняем в сессии пользователя
    if (!ctx.session) ctx.session = {};
    ctx.session.editWalkId = walkId;

    // Сохраняем ID текущего сообщения для обновления
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      ctx.session.lastMessageId = ctx.callbackQuery.message.message_id;
    }

    console.log(`Сохранили ID ${walkId} в сессии пользователя ${ctx.from.id}`);

    // Отвечаем на callback
    await ctx.answerCbQuery();

    // Вход в меню редактирования прогулки
    return ctx.scene.enter("editWalkMenu");
  } catch (error) {
    console.error("Ошибка при обработке редактирования прогулки:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    return ctx.reply("Произошла ошибка при редактировании прогулки");
  }
});

// Обработка кнопки "Редактировать профиль"
bot.action("edit_profile", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(
    "Выберите, что хотите изменить:",
    Markup.inlineKeyboard([
      [Markup.button.callback("Имя", "edit_name")],
      [Markup.button.callback("Город", "edit_city")],
      [Markup.button.callback("Информация о собаке", "edit_dog")],
      [Markup.button.callback("Назад", "back_to_profile")],
    ])
  );
});

// Возврат в профиль
bot.action("back_to_profile", (ctx) => {
  ctx.answerCbQuery();
  ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  ctx.reply("Вернуться в профиль", { reply_markup: getMainMenuKeyboard() });
});

// Настраиваем регулярную проверку для напоминаний (каждую минуту)
cron.schedule("* * * * *", remindAboutWalks);

// Обработчики для кнопок главного меню
bot.action("find_walk", async (ctx) => {
  await ctx.answerCbQuery();
  await updateWizardMessage(
    ctx,
    "<b>Как будем искать новых друзей сегодня?</b> 🔍",
    getWalkFiltersKeyboard()
  );
});

bot.action("create_walk", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Сохраняем ID текущего сообщения для замены
    if (!ctx.session) ctx.session = {};

    // Если это сообщение с главным меню, обновляем его
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      ctx.session.lastMessageId = ctx.callbackQuery.message.message_id;

      // Обновляем сообщение главного меню, заменяя его на первый шаг создания прогулки
      await ctx.editMessageText(
        "<b>Когда отправляемся на поиски приключений?</b> 🗓️\n\n" +
          "<i>Создавая прогулки, вы зарабатываете очки организатора и повышаете свой статус!</i>",
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Сегодня", callback_data: "date_today" },
                { text: "Завтра", callback_data: "date_tomorrow" },
              ],
              [{ text: "Выбрать дату", callback_data: "date_custom" }],
              [{ text: "❌ Отмена", callback_data: "cancel" }],
            ],
          },
        }
      );

      // Входим в сцену создания прогулки, но пропускаем первый шаг
      return ctx.scene.enter("createWalk", { skipFirstStep: true });
    } else {
      // Если не можем редактировать, просто входим в сцену
      return ctx.scene.enter("createWalk");
    }
  } catch (error) {
    console.error("Ошибка при входе в сцену создания прогулки:", error);
    // В случае ошибки просто входим в сцену стандартным способом
    return ctx.scene.enter("createWalk");
  }
});

bot.action("edit_name", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editName");
});

bot.action("edit_city", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editCity");
});

bot.action("edit_dog_name", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editDogName");
});

bot.action("edit_dog_breed", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editDogBreed");
});

bot.action("edit_dog_size", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editDogSize");
});

bot.action("edit_dog_age", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editDogAge");
});

bot.action("edit_dog_photo", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("editDogPhoto");
});

bot.action("my_walks", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Получаем прогулки пользователя
    const walksSnapshot = await db
      .collection("walks")
      .where("organizer.id", "==", ctx.from.id)
      .get();

    // Показываем с пагинацией
    await showWalksWithPagination(
      ctx,
      walksSnapshot.docs,
      0,
      "back_to_main_menu"
    );
  } catch (error) {
    console.error("Ошибка при показе прогулок:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при загрузке прогулок.", {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    });
  }
});

bot.action("my_participations", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Получаем все прогулки
    const walksSnapshot = await db.collection("walks").get();
    const participatingWalks = [];

    // Фильтруем прогулки, где пользователь является участником
    for (const walkDoc of walksSnapshot.docs) {
      const walk = walkDoc.data();

      // Если пользователь - организатор или участник
      if (
        walk.organizer.id == ctx.from.id ||
        (walk.participants &&
          walk.participants.some((p) => p.id == ctx.from.id))
      ) {
        participatingWalks.push(walkDoc);
      }
    }

    // Показываем прогулки с пагинацией
    await showWalksWithPagination(
      ctx,
      participatingWalks,
      0,
      "back_to_main_menu"
    );
  } catch (error) {
    console.error("Ошибка при показе прогулок:", error);
    await updateWizardMessage(ctx, "Произошла ошибка при загрузке прогулок.", {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    });
  }
});
// Обработчик для кнопки "Пропустить уведомление"
bot.action("dismiss_notification", async (ctx) => {
  try {
    await ctx.answerCbQuery("Уведомление пропущено");

    // Удаляем кнопки из сообщения
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    // Опционально можно отправить сообщение с другими опциями
    await ctx.reply("Вы можете найти другие прогулки в меню:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📍 Найти прогулку", callback_data: "find_walk" }],
          [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
        ],
      },
    });
  } catch (error) {
    console.error("Ошибка при обработке пропуска уведомления:", error);
  }
});

// Обработчики выбора типа прогулки
bot.action("type_single", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    // Получаем информацию о пользователе
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();

    // Устанавливаем тип прогулки
    if (!ctx.wizard.state.walkData) {
      ctx.wizard.state.walkData = {};
    }
    ctx.wizard.state.walkData.type = "single";

    // Формируем превью карточки прогулки
    let previewText = `
  🗓️ <b>Встреча:</b> ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
 📍 <b>Место сбора:</b> ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 <b>Формат:</b>  Разовая
 👑 <b>Организатор:</b> ${userData.name}
🐕 <b>Компаньон:</b> ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    // Отправляем превью
    if (userData.dog.photoId) {
      await ctx.replyWithPhoto(userData.dog.photoId, {
        caption: previewText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Опубликовать ✅", callback_data: "publish_walk" },
              { text: "Отменить ❌", callback_data: "cancel_walk" },
            ],
          ],
        },
      });

      // Удаляем обычную клавиатуру
      await ctx.reply("✨ <b>АНОНС ПРОГУЛКИ</b> ✨", Markup.removeKeyboard());
    } else {
      await ctx.reply(previewText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Опубликовать ✅", callback_data: "publish_walk" },
              { text: "Отменить ❌", callback_data: "cancel_walk" },
            ],
          ],
        },
      });
    }

    return ctx.wizard.next();
  } catch (error) {
    console.error("Ошибка при выборе типа прогулки:", error);
    await ctx.reply("Произошла ошибка. Вернитесь в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return ctx.scene.leave();
  }
});

bot.action("type_regular", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    // Получаем информацию о пользователе
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();

    // Устанавливаем тип прогулки
    if (!ctx.wizard.state.walkData) {
      ctx.wizard.state.walkData = {};
    }
    ctx.wizard.state.walkData.type = "regular";

    // Формируем превью карточки прогулки
    let previewText = `
  🗓️ <b>Встреча:</b>  ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
  📍 <b>Место сбора:</b> ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 <b>Формат:</b> Регулярная
  👑 <b>Организатор:</b> ${userData.name}
  🐕 <b>Компаньон:</b> ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    // Удаляем обычную клавиатуру
    await ctx.reply("✨ <b>АНОНС ПРОГУЛКИ</b> ✨", Markup.removeKeyboard());

    // Отправляем превью
    if (userData.dog.photoId) {
      await ctx.replyWithPhoto(userData.dog.photoId, {
        caption: previewText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Опубликовать ✅", callback_data: "publish_walk" },
              { text: "Отменить ❌", callback_data: "cancel_walk" },
            ],
          ],
        },
      });
    } else {
      await ctx.reply(previewText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Опубликовать ✅", callback_data: "publish_walk" },
              { text: "Отменить ❌", callback_data: "cancel_walk" },
            ],
          ],
        },
      });
    }

    return ctx.wizard.next();
  } catch (error) {
    console.error("Ошибка при выборе типа прогулки:", error);
    await ctx.reply("Произошла ошибка. Вернитесь в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return ctx.scene.leave();
  }
});

bot.action("edit_date_time", (ctx) => ctx.scene.enter("editWalkDateTime"));
bot.action("edit_location", (ctx) => ctx.scene.enter("editWalkLocation"));
bot.action("edit_type", (ctx) => ctx.scene.enter("editWalkType"));
// Исправьте обработчик skip_photo
bot.action("skip_photo", async (ctx) => {
  await ctx.answerCbQuery();

  // Проверяем, есть ли ctx.wizard и ctx.wizard.state
  if (!ctx.wizard || !ctx.wizard.state || !ctx.wizard.state.userData) {
    ctx.reply("Пожалуйста, начните регистрацию заново.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Создать профиль", callback_data: "create_profile" }],
        ],
      },
    });
    return;
  }

  const userData = ctx.wizard.state.userData;

  // Инициализируем структуру достижений
  const achievements = {
    walkCount: 0,
    organizedCount: 0,
    participantRank: "Хвостик",
    organizerRank: "Мокрый нос",
    badges: [],
    specialStatus: {
      title: null,
      expiresAt: null,
    },
    lastUpdated: new Date(),
  };

  // Сохраняем данные пользователя в базу данных без фото
  const user = {
    id: ctx.from.id,
    username: ctx.from.username || null, // Обязательно устанавливаем null, если username отсутствует
    name: userData.name,
    city: userData.city,
    location: userData.location || null,
    dog: {
      name: userData.dogName,
      breed: userData.dogBreed,
      size: userData.dogSize,
      age: userData.dogAge,
      photoId: null,
    },
    // Заменяем walkHistory на achievements
    achievements: achievements,
    createdAt: new Date(),
  };

  try {
    await db.collection("users").doc(String(ctx.from.id)).set(user);
    ctx.reply(
      "<b>🎉 УРА! ПРОФИЛЬ СОЗДАН! 🎉</b> \n\n" +
        '🏆 Вы получили звание "<b>Хвостик</b>"!\n\n' +
        "🐾 Теперь вы можете:\n" +
        "- Создавать веселые прогулки\n" +
        "- Искать новых друзей поблизости \n" +
        "- Зарабатывать достижения и повышать уровень\n\n" +
        "<i>Готовы к первой прогулке? Начните прямо сейчас!</i>",
      { reply_markup: getMainMenuKeyboard() }
    );
  } catch (error) {
    console.error("Ошибка при сохранении пользователя:", error);
    ctx.reply("Произошла ошибка при создании профиля. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }

  return ctx.scene.leave();
});
bot.action(/breed_(.+)/, (ctx) => {
  const breed = ctx.match[1];
  if (breed === "Другая (ввести текстом)") {
    ctx.reply("Введите породу вашей собаки:", Markup.removeKeyboard());
    ctx.wizard.state.waitingForCustomBreed = true;
  } else {
    ctx.wizard.state.userData.dogBreed = breed;
    ctx.reply(
      "<b>Размер имеет значение!</b> 📏 \n\n" +
        "Подберем подходящую компанию для вашего питомца:",
      Markup.inlineKeyboard([
        [
          {
            text: "🐾 Маленькая (до 10 кг)",
            callback_data: "size_small",
          },
        ],
        [
          {
            text: "🐕 Средняя (10–25 кг)",
            callback_data: "size_medium",
          },
        ],
        [{ text: "🐕‍🦺 Крупная (25+ кг)", callback_data: "size_large" }],
      ])
    );
    return ctx.wizard.next();
  }
});

bot.action(/city_(.+)/, async (ctx) => {
  await db
    .collection("users")
    .doc(String(ctx.from.id))
    .update({ city: ctx.match[1] });
  await ctx.reply("✅ Город успешно изменен!", {
    reply_markup: getMainMenuKeyboard(),
  });
  return ctx.scene.enter("editProfileMenu");
});
bot.action("send_location_reg", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Первое сообщение с подсказкой о проверке настроек
    await ctx.reply(
      `🐶 <b>Отлично!</b> Геолокация поможет находить собачьи прогулки рядом с вами.
  
  <i>Небольшая проверка перед продолжением:</i>
  - Убедитесь, что у Telegram есть разрешение на доступ к геолокации
  - Включите геолокацию на вашем устройстве
  - Если кнопка не работает, проверьте настройки приватности в Telegram
  
  Нажмите кнопку ниже, когда будете готовы:`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.keyboard([
          [Markup.button.locationRequest("📍 Отправить мою геолокацию")],
        ]).resize(),
      }
    );

    // В сцене этот флаг уже устанавливается, но для надежности установим и здесь
    if (ctx.wizard && ctx.wizard.state) {
      ctx.wizard.state.waitingForLocationReg = true;
    }
  } catch (error) {
    console.error("Ошибка при запросе геолокации:", error);
    await ctx.reply(
      "Произошла ошибка при запросе геолокации. Пожалуйста, выберите город из списка или попробуйте отправить геолокацию позже.",
      Markup.inlineKeyboard([
        ...POPULAR_CITIES.map((city) => [
          { text: city, callback_data: `city_${city}` },
        ]),
        [{ text: "↩️ Назад", callback_data: "back_to_city_selection" }],
      ])
    );
  }
});

bot.action("publish_walk", async (ctx) => {
  try {
    console.log("Публикация новой прогулки (глобальный обработчик)");

    // Получаем данные из scene.state
    const walkData = ctx.scene.state.walkData;
    const userData = ctx.scene.state.userData;

    // Проверяем, что данные существуют
    if (!walkData || !userData) {
      throw new Error("Данные о прогулке отсутствуют");
    }

    // Удаляем кнопки
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      console.error("Ошибка при удалении клавиатуры:", error);
    }

    // Используем общую функцию публикации
    await publishWalk(ctx, walkData, userData);

    return ctx.scene.leave();
  } catch (error) {
    console.error("Ошибка при публикации прогулки:", error);
    await ctx.reply(
      "Произошла ошибка при публикации прогулки. Попробуйте снова.",
      { reply_markup: getMainMenuKeyboard() }
    );
    return ctx.scene.leave();
  }
});

bot.action("walk_here", async (ctx) => {
  await requestLocation(
    ctx,
    "Нажмите кнопку, чтобы отправить ваше текущее местоположение:",
    "📍 Моё текущее местоположение",
    "waitingForWalkHere"
  );
});

// При редактировании профиля
bot.action("current_location", async (ctx) => {
  await requestLocation(
    ctx,
    "Нажмите кнопку, чтобы отправить ваше текущее местоположение:",
    "📍 Отправить моё местоположение",
    "waitingForCurrentLocation"
  );
});

bot.action("choose_map_location", async (ctx) => {
  await requestLocation(
    ctx,
    "Выберите место на карте и отправьте:",
    "📍 Выбрать место на карте",
    "waitingForMapLocation"
  );
});

// При редактировании прогулки
bot.action("current_location_walk", async (ctx) => {
  await requestLocation(
    ctx,
    "Нажмите кнопку, чтобы отправить ваше текущее местоположение:",
    "📍 Отправить моё местоположение",
    "waitingForCurrentLocation"
  );
});

bot.action("choose_map_walk", async (ctx) => {
  await requestLocation(
    ctx,
    "Выберите место встречи на карте и отправьте:",
    "📍 Выбрать место на карте",
    "waitingForMapLocation"
  );
});

// Общий обработчик для просмотра местоположения на карте
bot.action(/view_location_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    await ctx.answerCbQuery("Открываем карту...");

    const walkDoc = await db.collection("walks").doc(walkId).get();
    if (!walkDoc.exists) {
      return;
    }

    const walk = walkDoc.data();
    if (!walk.location || !walk.location.latitude || !walk.location.longitude) {
      await ctx.reply(
        "Для этой прогулки не указаны координаты местоположения."
      );
      return;
    }

    // Отправляем местоположение на карте
    await ctx.replyWithLocation(
      walk.location.latitude,
      walk.location.longitude
    );
  } catch (error) {
    console.error("Ошибка при отображении местоположения:", error);
  }
});

bot.on("location", async (ctx) => {
  try {
    // Получаем координаты
    const location = ctx.message.location;
    console.log("Получена геолокация:", location);

    // Проверяем, ожидаем ли мы геолокацию для поиска прогулок
    if (ctx.session && ctx.session.waitingLocationForNearbyWalks) {
      // Сбрасываем флаг ожидания
      ctx.session.waitingLocationForNearbyWalks = false;

      // Сохраняем геолокацию в профиль пользователя
      try {
        // Определяем город по геолокации
        const cityName = await getLocationCity(
          location.latitude,
          location.longitude
        ).catch((err) => {
          console.error("Ошибка при определении города:", err);
          return "Определен по геолокации";
        });

        await db
          .collection("users")
          .doc(String(ctx.from.id))
          .update({
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              description: "Сохранено при поиске прогулок",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            city: cityName || "Определен по геолокации",
          });

        console.log(
          `Геолокация сохранена в профиль пользователя ${ctx.from.id}`
        );
      } catch (error) {
        console.error("Ошибка при сохранении геолокации в профиль:", error);
      }

      // Сообщаем пользователю о поиске и убираем клавиатуру
      const statusMsg = await ctx.reply("Ищем прогулки поблизости...", {
        reply_markup: { remove_keyboard: true },
      });

      // Ищем прогулки и используем единый формат отображения
      await findNearbyWalksUnified(
        ctx,
        location.latitude,
        location.longitude,
        statusMsg.message_id
      );
    }

    // Другие обработчики геолокации могут быть здесь
  } catch (error) {
    console.error("Ошибка при обработке геолокации:", error);
    await ctx.reply(
      "Произошла ошибка при обработке геолокации. Попробуйте снова.",
      {
        reply_markup: { remove_keyboard: true },
      }
    );
  }
});

// Добавить этот обработчик (заменяет 4 отдельных обработчика для возраста)
bot.action(/age_(.+)/, async (ctx) => {
  try {
    const age = ctx.match[1];
    await ctx.answerCbQuery();

    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.age": age,
    });

    await ctx.reply("✅ Возраст собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении возраста собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

// Добавить этот обработчик (заменяет 3 отдельных обработчика для размера)
bot.action(/size_(.+)/, async (ctx) => {
  try {
    const size = ctx.match[1];
    await ctx.answerCbQuery();

    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.size": size,
    });

    await ctx.reply("✅ Размер собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении размера собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("cancel_edit", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editProfileMenu");
});

// Обработчики всех кнопок редактирования в меню
editProfileMenuScene.action("edit_name", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editName");
});

editProfileMenuScene.action("edit_city", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editCity");
});

editProfileMenuScene.action("edit_dog_name", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editDogName");
});

editProfileMenuScene.action("edit_dog_breed", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editDogBreed");
});

editProfileMenuScene.action("edit_dog_size", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editDogSize");
});

editProfileMenuScene.action("edit_dog_age", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editDogAge");
});

editProfileMenuScene.action("edit_dog_photo", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editDogPhoto");
});

editProfileMenuScene.action("my_profile", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    // Вернуться к отображению профиля
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();
    const achievements = userData.achievements || {
      walkCount: 0,
      organizedCount: 0,
      participantRank: "Хвостик",
      organizerRank: "Мокрый нос",
      badges: [],
    };

    // Проверяем специальный статус
    let specialStatusText = "";
    if (achievements.specialStatus && achievements.specialStatus.title) {
      const expiryDate = achievements.specialStatus.expiresAt
        ? new Date(achievements.specialStatus.expiresAt)
        : null;
      if (expiryDate && expiryDate > new Date()) {
        specialStatusText = `\n🌟 Особый статус: ${achievements.specialStatus.title}`;
      }
    }

    // Формируем текст последних достижений
    let badgesText = "";
    if (achievements.badges && achievements.badges.length > 0) {
      const latestBadges = achievements.badges.slice(-2); // Показываем только последние 2 значка для краткости
      badgesText = "\n🏅 Последние достижения: ";
      latestBadges.forEach((badge, index) => {
        badgesText +=
          `${badge.name}` + (index < latestBadges.length - 1 ? ", " : "");
      });
    }

    const profileText = `
🐕 <b>КАРТОЧКА СОБАКОВОДА</b> 🐕

👤 <b>${userData.name}</b> ${userData.username ? "@" + userData.username : ""}
📊 <b>Звания:</b>
   Участник: ${achievements.userRank}
   Организатор: ${achievements.organizerBadge}
🦴 Прогулок: ${achievements.walkCount} (организовано: ${achievements.organizedCount})${specialStatusText}

📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
${badgesText}
    `;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✏️ Редактировать профиль",
            callback_data: "edit_profile_menu",
          },
          {
            text: "🏆 Все достижения",
            callback_data: "show_all_badges",
          },
        ],
        [
          {
            text: "❓ Как работают звания",
            callback_data: "ranks_info",
          },
        ],
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    };

    await updateWizardMessage(ctx, profileText, keyboard);
  } catch (error) {
    console.error("Ошибка при показе профиля:", error);
    await updateWizardMessage(
      ctx,
      "Произошла ошибка при загрузке профиля. Попробуйте еще раз."
    );
  }
});

bot.action("send_location", (ctx) => {
  ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
});

// Обработчики кнопок меню редактирования прогулки
editWalkMenuScene.action("edit_date_time", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editWalkDateTime");
});

editWalkMenuScene.action("edit_location", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editWalkLocation");
});

editWalkMenuScene.action("edit_type", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter("editWalkType");
});

editWalkMenuScene.action("cancel_edit", async (ctx) => {
  await ctx.answerCbQuery();
  await updateWizardMessage(
    ctx,
    "Редактирование отменено",
    getMainMenuKeyboard()
  );
  return ctx.scene.leave();
});

// Обработчики даты с прямым переходом к выбору времени
bot.action("date_today", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.state.walkData = { date: moment().format("DD.MM.YYYY") };

  // Сразу показываем выбор часов без ожидания
  await ctx.reply(
    "Выберите час:",
    Markup.inlineKeyboard(
      [
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "17",
        "18",
        "19",
        "20",
        "21",
        "22",
        "23",
      ]
        .map((h) => [{ text: h, callback_data: `hour_${h}` }])
        .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
    )
  );

  ctx.wizard.state.timeSelection = TIME_SELECTION.HOURS;
  return ctx.wizard.next();
});

bot.action("date_tomorrow", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.state.walkData = {
    date: moment().add(1, "days").format("DD.MM.YYYY"),
  };

  // Сразу показываем выбор часов без ожидания
  await ctx.reply(
    "Выберите час:",
    Markup.inlineKeyboard(
      [
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "17",
        "18",
        "19",
        "20",
        "21",
        "22",
        "23",
      ]
        .map((h) => [{ text: h, callback_data: `hour_${h}` }])
        .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
    )
  );

  ctx.wizard.state.timeSelection = TIME_SELECTION.HOURS;
  return ctx.wizard.next();
});
bot.action("date_custom", (ctx) => {
  ctx.reply("Введите дату в формате ДД.ММ.ГГГГ:", Markup.removeKeyboard());
  ctx.wizard.state.walkData = {};
});
bot.action("cancel", (ctx) => {
  ctx.reply("Создание прогулки отменено", {
    reply_markup: getMainMenuKeyboard(),
  });
  return ctx.scene.leave();
});
bot.action(/hour_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.state.walkData.hours = ctx.match[1];

  await ctx.reply(
    `Выбрано: ${ctx.wizard.state.walkData.hours} ч.\nВыберите минуты:`,
    Markup.inlineKeyboard(
      ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]
        .map((m) => [{ text: m, callback_data: `minute_${m}` }])
        .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
    )
  );

  ctx.wizard.state.timeSelection = TIME_SELECTION.MINUTES;
});

bot.action(/minute_(\d+)/, async (ctx) => {
  ctx.wizard.state.walkData.minutes = ctx.match[1];
  ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${ctx.wizard.state.walkData.minutes}`;
  ctx.reply(
    `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся? 📍\n\n` +
      "<i>Укажите точное место встречи для удобства всех участников</i>",
    Markup.inlineKeyboard([
      [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
      [{ text: "Ввести текстом", callback_data: "enter_location_text" }],
      [{ text: "❌ Отмена", callback_data: "cancel" }],
    ])
  );
  return ctx.wizard.next();
});

bot.command("start", async (ctx) => {
  // Проверяем, зарегистрирован ли пользователь
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (userDoc.exists) {
    // Отправляем сообщение с главным меню и сохраняем его ID
    const msg = await ctx.reply(
      `Привет, ${userDoc.data().name || ctx.from.first_name}! С возвращением в DogMeet 🐶`,
      {
        reply_markup: getMainMenuKeyboard(),
      }
    );

    // Сохраняем ID сообщения меню
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = msg.message_id;
  } else {
    // Для новых пользователей оставляем только приглашение к регистрации
    const name = ctx.from.first_name || "гость";
    const msg = await ctx.reply(
      `Привет, ${name}! DogMeet помогает находить компанию для прогулок с собакой 🐶.\n` +
        "🔹 Находите владельцев собак рядом.\n" +
        "🔹 Создавайте прогулки в один клик.\n" +
        "🔹 Присоединяйтесь к другим участникам.",
      {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("Создать профиль", "create_profile")],
          ],
        },
      }
    );

    // Сохраняем ID сообщения
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = msg.message_id;
  }
});

bot
  .launch()
  .then(async () => {
    BOT_START_TIME = Date.now(); // Обновляем время запуска
    console.log("Бот DogMeet успешно запущен!");
    await migrateParticipantsHistory();
  })
  .catch((err) => {
    console.error("Ошибка при запуске бота:", err);
  });

// Обработка прерываний
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
