// Импорт необходимых библиотек
const { Telegraf, Scenes, session, Markup } = require("telegraf");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const moment = require("moment");
const cron = require("node-cron");
require("dotenv").config();

// Инициализация Firebase
const serviceAccount = require("./serviceAccountKey.json");
initializeApp({
  credential: cert(serviceAccount),
});
const db = getFirestore();

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware для работы с сессиями
bot.use(session());

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

// Сцена регистрации пользователя
const registerScene = new Scenes.WizardScene(
  "register",
  // Шаг 1: Ввод имени
  (ctx) => {
    ctx.reply("Как вас зовут?");
    return ctx.wizard.next();
  },
  // Шаг 2: Выбор города
  (ctx) => {
    ctx.wizard.state.userData = { name: ctx.message.text };
    ctx.reply(
      "Выберите город или отправьте геолокацию 📍",
      Markup.keyboard([
        ...POPULAR_CITIES.map((city) => [city]),
        ["Отправить геолокацию 📍"],
      ]).resize()
    );
    return ctx.wizard.next();
  },
  // Шаг 3: Имя собаки
  (ctx) => {
    if (ctx.message.location) {
      // Геолокация
      ctx.wizard.state.userData.location = {
        latitude: ctx.message.location.latitude,
        longitude: ctx.message.location.longitude,
      };
      // Здесь можно добавить определение города по координатам с помощью какого-либо API геокодирования
      ctx.wizard.state.userData.city = "Определен по геолокации";
    } else {
      // Выбор из списка
      ctx.wizard.state.userData.city = ctx.message.text;
    }
    ctx.reply("Как зовут вашу собаку?", Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  // Шаг 4: Порода собаки
  (ctx) => {
    ctx.wizard.state.userData.dogName = ctx.message.text;
    const breedButtons = POPULAR_BREEDS.map((breed) => [breed]);
    ctx.reply("Выберите породу", Markup.keyboard(breedButtons).resize());
    return ctx.wizard.next();
  },
  // Шаг 5: Размер собаки
  (ctx) => {
    if (ctx.message.text === "Другая (ввести текстом)") {
      ctx.reply("Введите породу вашей собаки:");
      ctx.wizard.state.waitingForCustomBreed = true;
      return;
    }

    if (ctx.wizard.state.waitingForCustomBreed) {
      ctx.wizard.state.waitingForCustomBreed = false;
      ctx.wizard.state.userData.dogBreed = ctx.message.text;
    } else {
      ctx.wizard.state.userData.dogBreed = ctx.message.text;
    }

    ctx.reply(
      "Какого размера ваша собака?",
      Markup.keyboard([
        [DOG_SIZES.SMALL.text],
        [DOG_SIZES.MEDIUM.text],
        [DOG_SIZES.LARGE.text],
      ]).resize()
    );
    return ctx.wizard.next();
  },
  // Шаг 6: Возраст собаки
  (ctx) => {
    const size = Object.values(DOG_SIZES).find(
      (size) => size.text === ctx.message.text
    );
    ctx.wizard.state.userData.dogSize = size
      ? size.value
      : DOG_SIZES.MEDIUM.value;

    ctx.reply(
      "Возраст собаки:",
      Markup.keyboard([
        [DOG_AGES.PUPPY.text],
        [DOG_AGES.YOUNG.text],
        [DOG_AGES.ADULT.text],
        [DOG_AGES.SENIOR.text],
      ]).resize()
    );
    return ctx.wizard.next();
  },
  // Шаг 7: Фото собаки
  async (ctx) => {
    const age = Object.values(DOG_AGES).find(
      (age) => age.text === ctx.message.text
    );
    ctx.wizard.state.userData.dogAge = age ? age.value : DOG_AGES.ADULT.value;

    ctx.reply(
      "Загрузите фото вашей собаки 📸 (необязательно)",
      Markup.removeKeyboard()
    );
    return ctx.wizard.next();
  },
  // Шаг 8: Завершение регистрации
  async (ctx) => {
    const userData = ctx.wizard.state.userData;

    // Сохраняем фото, если оно есть
    if (ctx.message.photo) {
      const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      userData.dogPhotoId = photoId;
    }

    // Сохраняем данные пользователя в базу данных
    const user = {
      id: ctx.from.id,
      username: ctx.from.username,
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
      createdAt: new Date(),
    };

    await db.collection("users").doc(String(ctx.from.id)).set(user);

    // Возвращаемся в главное меню
    ctx.reply(
      "✅ Профиль создан! Теперь вы можете создавать прогулки или присоединяться к другим.",
      getMainMenuKeyboard()
    );

    return ctx.scene.leave();
  }
);

// Сцена создания прогулки
const createWalkScene = new Scenes.WizardScene(
  "createWalk",
  // Шаг 1: Дата прогулки
  (ctx) => {
    ctx.reply(
      "Когда планируете прогулку?",
      Markup.keyboard([
        ["Сегодня", "Завтра"],
        ["Выбрать дату"],
        ["❌ Отмена"],
      ]).resize()
    );

    return ctx.wizard.next();
  },
  // Шаг 2: Выбор даты и переход к выбору времени
  (ctx) => {
    if (addCancelHandler(ctx)) return;

    ctx.wizard.state.walkData = {};
    ctx.wizard.state.timeSelection = TIME_SELECTION.NONE;

    if (ctx.message.text === "Сегодня") {
      ctx.wizard.state.walkData.date = moment().format("DD.MM.YYYY");

      // Вместо запроса времени, предлагаем выбрать часы
      ctx.reply(
        "Выберите час:",
        Markup.keyboard([
          ["6", "7", "8", "9", "10", "11"],
          ["12", "13", "14", "15", "16", "17"],
          ["18", "19", "20", "21", "22", "23"],
          ["❌ Отмена"],
        ]).resize()
      );

      ctx.wizard.state.timeSelection = TIME_SELECTION.HOURS;
    } else if (ctx.message.text === "Завтра") {
      ctx.wizard.state.walkData.date = moment()
        .add(1, "days")
        .format("DD.MM.YYYY");

      // Вместо запроса времени, предлагаем выбрать часы
      ctx.reply(
        "Выберите час:",
        Markup.keyboard([
          ["6", "7", "8", "9", "10", "11"],
          ["12", "13", "14", "15", "16", "17"],
          ["18", "19", "20", "21", "22", "23"],
          ["❌ Отмена"],
        ]).resize()
      );

      ctx.wizard.state.timeSelection = TIME_SELECTION.HOURS;
    } else if (ctx.message.text === "Выбрать дату") {
      ctx.reply("Введите дату в формате ДД.ММ.ГГГГ:");
      return ctx.wizard.next();
    }

    return ctx.wizard.next();
  },
  // Шаг 3: Обработка времени и места
  (ctx) => {
    if (addCancelHandler(ctx)) return;

    // Проверка состояния выбора времени
    if (ctx.wizard.state.timeSelection === TIME_SELECTION.HOURS) {
      // Сохраняем выбранный час
      ctx.wizard.state.walkData.hours = ctx.message.text;
      ctx.wizard.state.timeSelection = TIME_SELECTION.MINUTES;

      // Предлагаем выбрать минуты
      ctx.reply(
        `Выбрано: ${ctx.wizard.state.walkData.hours} ч.\nВыберите минуты:`,
        Markup.keyboard([
          ["00", "05", "10", "15"],
          ["20", "25", "30", "35"],
          ["40", "45", "50", "55"],
          ["❌ Отмена"],
        ]).resize()
      );
      return;
    } else if (ctx.wizard.state.timeSelection === TIME_SELECTION.MINUTES) {
      // Сохраняем минуты и формируем полное время
      ctx.wizard.state.walkData.minutes = ctx.message.text;
      ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${ctx.wizard.state.walkData.minutes}`;

      // Переходим к выбору места
      ctx.reply(
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся?`,
        Markup.keyboard([
          ["Отправить геолокацию 📍"],
          ["Ввести текстом"],
          ["❌ Отмена"],
        ]).resize()
      );

      return ctx.wizard.next();
    }
    // Обработка выбора даты, если пользователь выбрал "Выбрать дату"
    else if (!ctx.wizard.state.walkData.date) {
      // Сохраняем дату и переходим к выбору времени
      ctx.wizard.state.walkData.date = ctx.message.text;
      ctx.wizard.state.timeSelection = TIME_SELECTION.HOURS;

      ctx.reply(
        "Выберите час:",
        Markup.keyboard([
          ["6", "7", "8", "9", "10", "11"],
          ["12", "13", "14", "15", "16", "17"],
          ["18", "19", "20", "21", "22", "23"],
          ["❌ Отмена"],
        ]).resize()
      );
      return;
    }
    // Если время уже выбрано (запасной вариант, если пользователь ввел время вручную)
    else if (
      ctx.wizard.state.walkData.date &&
      !ctx.wizard.state.walkData.time
    ) {
      ctx.wizard.state.walkData.time = ctx.message.text;

      // Переходим к выбору места
      ctx.reply(
        "Где встречаемся?",
        Markup.keyboard([
          ["Отправить геолокацию 📍"],
          ["Ввести текстом"],
          ["❌ Отмена"],
        ]).resize()
      );

      return ctx.wizard.next();
    }

    // Если каким-то образом попали сюда, переходим к следующему шагу
    return ctx.wizard.next();
  },
  // Шаг 4: Место прогулки
  (ctx) => {
    if (addCancelHandler(ctx)) return;
    if (ctx.message.text === "Ввести текстом") {
      ctx.reply("Опишите место встречи:");
      ctx.wizard.state.waitingForLocationText = true;
      return;
    }

    if (ctx.wizard.state.waitingForLocationText) {
      ctx.wizard.state.walkData.locationText = ctx.message.text;
      ctx.wizard.state.waitingForLocationText = false;
    } else if (ctx.message.location) {
      ctx.wizard.state.walkData.location = {
        latitude: ctx.message.location.latitude,
        longitude: ctx.message.location.longitude,
      };
    }

    // Переходим к выбору типа прогулки
    ctx.reply(
      "Это разовая или регулярная прогулка?",
      Markup.keyboard([["Разовая 🔹", "Регулярная 🔄"], ["❌ Отмена"]]).resize()
    );

    return ctx.wizard.next();
  },
  // Шаг 5: Тип прогулки и подтверждение
  async (ctx) => {
    if (addCancelHandler(ctx)) return;
    if (ctx.wizard.state.waitingForLocationText) {
      ctx.wizard.state.walkData.locationText = ctx.message.text;
      ctx.wizard.state.waitingForLocationText = false;

      ctx.reply(
        "Это разовая или регулярная прогулка?",
        Markup.keyboard([
          ["Разовая 🔹", "Регулярная 🔄"],
          ["❌ Отмена"],
        ]).resize()
      );
      return;
    }

    ctx.wizard.state.walkData.type = ctx.message.text.includes("Разовая")
      ? "single"
      : "regular";

    // Получаем информацию о пользователе и собаке из базы данных
    const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
    const userData = userDoc.data();

    // ВАЖНО: копируем данные в scene.state для доступа в обработчиках кнопок
    ctx.scene.state.walkData = { ...ctx.wizard.state.walkData };
    ctx.scene.state.userData = userData; // сохраняем данные пользователя

    // Формируем превью карточки прогулки
    let previewText = `
  🗓 Прогулка: ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
  📍 Место: ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 Тип: ${ctx.wizard.state.walkData.type === "single" ? "Разовая" : "Регулярная"}
  👤 Организатор: ${userData.name}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

    // Если есть фото собаки, показываем его
    await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

    // Для фото с кнопками
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
      // Для текста с кнопками
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
  },
  // Шаг 6: Обработка публикации
  // Шаг 6: Обработка публикации (ВАЖНО: добавляем логику обработки кнопок здесь)
  async (ctx) => {
    // Этот шаг ждет события callback_query
    if (addCancelHandler(ctx)) return;
    if (!ctx.callbackQuery) return;

    const action = ctx.callbackQuery.data;

    if (action === "publish_walk") {
      try {
        // Получаем данные прогулки и пользователя
        const walkData = ctx.wizard.state.walkData;
        const userData = ctx.wizard.state.userData;

        // Создаем новую прогулку в базе данных
        const walkRef = await db.collection("walks").add({
          date: walkData.date,
          time: walkData.time,
          locationText: walkData.locationText || null,
          location: walkData.location || null,
          type: walkData.type,
          organizer: {
            id: ctx.from.id,
            name: userData.name,
            username: ctx.from.username,
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

        // Отвечаем на callback, чтобы убрать загрузку
        await ctx.answerCbQuery("Прогулка опубликована!");

        // Удаляем inline кнопки из сообщения
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

        // Отправляем уведомление об успешной публикации
        await ctx.reply(
          "✅ Прогулка создана! Мы уведомим владельцев собак поблизости.",
          getMainMenuKeyboard()
        );

        // Уведомляем других пользователей о новой прогулке
        notifyNearbyUsers(walkRef.id, userData, walkData);

        return ctx.scene.leave();
      } catch (error) {
        console.error("Ошибка при публикации прогулки:", error);
        await ctx.answerCbQuery("Произошла ошибка");
        await ctx.reply(
          "Произошла ошибка при публикации прогулки. Попробуйте снова.",
          getMainMenuKeyboard()
        );
        return ctx.scene.leave();
      }
    } else if (action === "cancel_walk") {
      // Отвечаем на callback, чтобы убрать загрузку
      await ctx.answerCbQuery("Создание прогулки отменено");

      // Удаляем inline кнопки из сообщения
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

      await ctx.reply("❌ Создание прогулки отменено.", getMainMenuKeyboard());
      return ctx.scene.leave();
    }
  }
);

// Функция для получения текстового представления размера собаки
function getDogSizeText(size) {
  const sizeObj = Object.values(DOG_SIZES).find((s) => s.value === size);
  return sizeObj ? sizeObj.text.split(" ")[0] : "Средняя";
}

// Функция для получения текстового представления возраста собаки
function getDogAgeText(age) {
  const ageObj = Object.values(DOG_AGES).find((a) => a.value === age);
  return ageObj ? ageObj.text.split(" ")[0] : "Взрослая";
}

function addCancelHandler(ctx) {
  if (ctx.message && ctx.message.text === "❌ Отмена") {
    ctx.reply("Создание прогулки отменено", getMainMenuKeyboard());
    return ctx.scene.leave();
  }
  return false; // Продолжаем обычный поток
}

// Клавиатура главного меню
function getMainMenuKeyboard() {
  return Markup.keyboard([
    ["📍 Найти прогулку", "🐕 Создать прогулку"],
    ["👤 Мой профиль"],
  ]).resize();
}

// Настройка сцен
const stage = new Scenes.Stage([registerScene, createWalkScene]);
bot.use(stage.middleware());

// Обработка команды /start
bot.command("start", async (ctx) => {
  // Проверяем, зарегистрирован ли пользователь
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (userDoc.exists) {
    // Если пользователь уже зарегистрирован, показываем главное меню
    ctx.reply("Привет! С возвращением в DogMeet 🐶", getMainMenuKeyboard());
  } else {
    // Если пользователь новый, предлагаем зарегистрироваться
    ctx.reply(
      "Привет! DogMeet помогает находить компанию для прогулок с собакой 🐶.\n" +
        "🔹 Находите владельцев собак рядом.\n" +
        "🔹 Создавайте прогулки в один клик.\n" +
        "🔹 Присоединяйтесь к другим участникам.",
      Markup.inlineKeyboard([
        [Markup.button.callback("Создать профиль", "create_profile")],
      ])
    );
  }
});

// Обработка кнопок
bot.action("create_profile", (ctx) => {
  ctx.scene.enter("register");
});

// Обработка публикации прогулки
bot.action("publish_walk", async (ctx) => {
  // Получаем данные прогулки и пользователя
  const walkData = ctx.scene.state.walkData;
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
  const userData = userDoc.data();

  // Создаем новую прогулку в базе данных
  const walkRef = await db.collection("walks").add({
    date: walkData.date,
    time: walkData.time,
    locationText: walkData.locationText || null,
    location: walkData.location || null,
    type: walkData.type,
    organizer: {
      id: ctx.from.id,
      name: userData.name,
      username: ctx.from.username,
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

  // Отправляем уведомление об успешной публикации
  ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  ctx.reply(
    "✅ Прогулка создана! Мы уведомим владельцев собак поблизости.",
    getMainMenuKeyboard()
  );

  // Уведомляем других пользователей о новой прогулке (если они находятся поблизости)
  notifyNearbyUsers(walkRef.id, userData, walkData);

  ctx.scene.leave();
});

// Отмена создания прогулки
bot.action("cancel_walk", (ctx) => {
  ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  ctx.reply("❌ Создание прогулки отменено.", getMainMenuKeyboard());
  ctx.scene.leave();
});

// Поиск прогулки
bot.hears("📍 Найти прогулку", async (ctx) => {
  // Предлагаем фильтры
  ctx.reply(
    "Выберите фильтр:",
    Markup.keyboard([
      ["🔹 Прогулки рядом"],
      ["📅 Сегодня", "📅 Завтра", "📅 Все даты"],
      ["Назад в меню"],
    ]).resize()
  );
});

// Обработка фильтров прогулок
bot.hears(/🔹 Прогулки рядом|📅 Сегодня|📅 Завтра|📅 Все даты/, async (ctx) => {
  const filter = ctx.message.text;
  let query = db.collection("walks");

  // Применяем фильтры
  if (filter === "📅 Сегодня") {
    const today = moment().format("DD.MM.YYYY");
    query = query.where("date", "==", today);
  } else if (filter === "📅 Завтра") {
    const tomorrow = moment().add(1, "days").format("DD.MM.YYYY");
    query = query.where("date", "==", tomorrow);
  }

  // Получаем прогулки
  const walksSnapshot = await query.get();

  if (walksSnapshot.empty) {
    ctx.reply(
      "Прогулок не найдено. Попробуйте другой фильтр или создайте свою прогулку."
    );
    return;
  }

  // Если выбраны прогулки рядом, нужны координаты пользователя
  if (filter === "🔹 Прогулки рядом") {
    ctx.reply(
      "Отправьте вашу текущую геолокацию для поиска ближайших прогулок:",
      Markup.keyboard([
        [Markup.button.locationRequest("Отправить геолокацию 📍")],
        ["Назад в меню"],
      ]).resize()
    );
    return;
  }

  // Показываем список прогулок
  await showWalksList(ctx, walksSnapshot.docs);
});

// Функция отображения списка прогулок
async function showWalksList(ctx, walkDocs) {
  for (const walkDoc of walkDocs) {
    const walk = walkDoc.data();

    const walkPreview = `
🕒 ${walk.date}, ${walk.time}
📍 ${walk.locationText || "По геолокации"}
🐕 Участников: ${walk.participants.length + 1}
👤 ${walk.dog.name} (${walk.organizer.name})
`;

    await ctx.reply(
      walkPreview,
      Markup.inlineKeyboard([
        [Markup.button.callback("Подробнее", `walk_details_${walkDoc.id}`)],
      ])
    );
  }
}

// Обработка просмотра деталей прогулки
bot.action(/walk_details_(.+)/, async (ctx) => {
  const walkId = ctx.match[1];
  const walkDoc = await db.collection("walks").doc(walkId).get();

  if (!walkDoc.exists) {
    ctx.reply("Прогулка не найдена или была отменена.");
    return;
  }

  const walk = walkDoc.data();

  // Формируем детальную информацию о прогулке
  let walkDetails = `
🗓 Прогулка: ${walk.date}, ${walk.time}
📍 Место: ${walk.locationText || "По геолокации"}
🔄 Тип: ${walk.type === "single" ? "Разовая" : "Регулярная"}
👤 Организатор: ${walk.organizer.name}
🐕 Собака: ${walk.dog.name}, ${walk.dog.breed}, ${getDogSizeText(walk.dog.size)}, ${getDogAgeText(walk.dog.age)}
`;

  // Добавляем список участников
  if (walk.participants.length > 0) {
    walkDetails += "\n👥 Присоединились:\n";
    for (const participant of walk.participants) {
      walkDetails += `- ${participant.name} с ${participant.dogName}\n`;
    }
  }

  // Кнопки действий
  const isOrganizer = walk.organizer.id === ctx.from.id;
  const isParticipant = walk.participants.some((p) => p.id === ctx.from.id);
  const buttons = [];

  if (!isOrganizer && !isParticipant) {
    buttons.push([
      Markup.button.callback("Присоединиться ✅", `join_walk_${walkId}`),
    ]);
  }

  if (!isOrganizer) {
    buttons.push([
      Markup.button.callback(
        "Связаться с организатором 📩",
        `contact_organizer_${walkId}`
      ),
    ]);
  }

  if (isParticipant) {
    buttons.push([
      Markup.button.callback("Покинуть прогулку ❌", `leave_walk_${walkId}`),
    ]);
  }

  if (isOrganizer) {
    buttons.push([
      Markup.button.callback("Отменить прогулку ❌", `cancel_walk_${walkId}`),
    ]);
  }

  // Если есть фото собаки, показываем его
  if (walk.dog.photoId) {
    await ctx.replyWithPhoto(walk.dog.photoId, {
      caption: walkDetails,
      reply_markup: Markup.inlineKeyboard(buttons),
    });
  } else {
    await ctx.reply(walkDetails, Markup.inlineKeyboard(buttons));
  }
});

// Присоединение к прогулке
bot.action(/join_walk_(.+)/, async (ctx) => {
  const walkId = ctx.match[1];
  const walkRef = db.collection("walks").doc(walkId);
  const walkDoc = await walkRef.get();

  if (!walkDoc.exists) {
    ctx.answerCbQuery("Прогулка не найдена или была отменена.");
    return;
  }

  const walk = walkDoc.data();

  // Проверяем, не присоединился ли пользователь уже
  if (walk.participants.some((p) => p.id === ctx.from.id)) {
    ctx.answerCbQuery("Вы уже присоединились к этой прогулке!");
    return;
  }

  // Получаем данные пользователя
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();
  const userData = userDoc.data();

  // Добавляем пользователя в список участников
  const newParticipant = {
    id: ctx.from.id,
    name: userData.name,
    username: ctx.from.username,
    dogName: userData.dog.name,
    dogBreed: userData.dog.breed,
    dogSize: userData.dog.size,
    dogAge: userData.dog.age,
    dogPhotoId: userData.dog.photoId,
  };

  await walkRef.update({
    participants: [...walk.participants, newParticipant],
  });

  // Уведомляем пользователя о успешном присоединении
  ctx.answerCbQuery("✅ Вы присоединились к прогулке!");
  ctx.reply(
    "✅ Вы присоединились к прогулке! Организатор получил уведомление."
  );

  // Уведомляем организатора о новом участнике
  await bot.telegram.sendMessage(
    walk.organizer.id,
    `
📢 Новый участник в вашей прогулке!
👤 ${userData.name}
🐕 ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
📩 Контакт: ${ctx.from.username ? "@" + ctx.from.username : "Нет username"}
`
  );

  // Если у собаки участника есть фото, отправляем его организатору
  if (userData.dog.photoId) {
    await bot.telegram.sendPhoto(walk.organizer.id, userData.dog.photoId);
  }
});

// Покинуть прогулку
bot.action(/leave_walk_(.+)/, async (ctx) => {
  const walkId = ctx.match[1];
  const walkRef = db.collection("walks").doc(walkId);
  const walkDoc = await walkRef.get();

  if (!walkDoc.exists) {
    ctx.answerCbQuery("Прогулка не найдена или была отменена.");
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

  ctx.answerCbQuery("Вы покинули прогулку.");
  ctx.reply("Вы покинули прогулку.");

  // Уведомляем организатора
  await bot.telegram.sendMessage(
    walk.organizer.id,
    `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} покинул вашу прогулку.`
  );
});

// Отмена прогулки организатором
bot.action(/cancel_walk_(.+)/, async (ctx) => {
  const walkId = ctx.match[1];
  const walkRef = db.collection("walks").doc(walkId);
  const walkDoc = await walkRef.get();

  if (!walkDoc.exists) {
    ctx.answerCbQuery("Прогулка не найдена или уже отменена.");
    return;
  }

  const walk = walkDoc.data();

  // Проверяем, что пользователь - организатор
  if (walk.organizer.id !== ctx.from.id) {
    ctx.answerCbQuery("Только организатор может отменить прогулку.");
    return;
  }

  // Уведомляем всех участников об отмене
  for (const participant of walk.participants) {
    await bot.telegram.sendMessage(
      participant.id,
      `❌ Прогулка ${walk.date}, ${walk.time} была отменена организатором.`
    );
  }

  // Удаляем прогулку
  await walkRef.delete();

  ctx.answerCbQuery("Прогулка отменена.");
  ctx.reply("Прогулка успешно отменена. Все участники получили уведомления.");
});

// Контакт с организатором
bot.action(/contact_organizer_(.+)/, async (ctx) => {
  const walkId = ctx.match[1];
  const walkDoc = await db.collection("walks").doc(walkId).get();

  if (!walkDoc.exists) {
    ctx.answerCbQuery("Прогулка не найдена или была отменена.");
    return;
  }

  const walk = walkDoc.data();

  if (walk.organizer.username) {
    ctx.reply(
      `Вы можете связаться с организатором: @${walk.organizer.username}`
    );
  } else {
    ctx.reply(
      "К сожалению, у организатора нет username в Telegram. Попробуйте оставить сообщение через бота."
    );

    // Опционально: можно реализовать систему сообщений через бота
    await bot.telegram.sendMessage(
      walk.organizer.id,
      `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} хочет связаться с вами по поводу прогулки ${walk.date}, ${walk.time}.`
    );
  }

  ctx.answerCbQuery();
});

// Создание прогулки
bot.hears("🐕 Создать прогулку", (ctx) => {
  ctx.scene.enter("createWalk");
});

// Мой профиль
bot.hears("👤 Мой профиль", async (ctx) => {
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (!userDoc.exists) {
    ctx.reply("Ваш профиль не найден. Пожалуйста, пройдите регистрацию.");
    return;
  }

  const userData = userDoc.data();

  const profileText = `
👤 Имя: ${userData.name}
📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
`;

  const buttons = [
    [Markup.button.callback("Редактировать профиль", "edit_profile")],
    [Markup.button.callback("Мои прогулки", "my_walks")],
    [Markup.button.callback("Где я участвую", "my_participations")],
  ];

  if (userData.dog.photoId) {
    await ctx.replyWithPhoto(userData.dog.photoId, {
      caption: profileText,
      reply_markup: Markup.inlineKeyboard(buttons),
    });
  } else {
    await ctx.reply(profileText, Markup.inlineKeyboard(buttons));
  }
});

// Обработка кнопки "Мои прогулки"
bot.action("my_walks", async (ctx) => {
  const walksSnapshot = await db
    .collection("walks")
    .where("organizer.id", "==", ctx.from.id)
    .get();

  if (walksSnapshot.empty) {
    ctx.answerCbQuery();
    ctx.reply("У вас пока нет созданных прогулок.");
    return;
  }

  ctx.answerCbQuery();
  ctx.reply("Ваши созданные прогулки:");

  await showWalksList(ctx, walksSnapshot.docs);
});

// Обработка кнопки "Где я участвую"
bot.action("my_participations", async (ctx) => {
  const walksSnapshot = await db
    .collection("walks")
    .where("participants", "array-contains", { id: ctx.from.id })
    .get();

  if (walksSnapshot.empty) {
    ctx.answerCbQuery();
    ctx.reply("Вы пока не присоединились ни к одной прогулке.");
    return;
  }

  ctx.answerCbQuery();
  ctx.reply("Прогулки, к которым вы присоединились:");

  await showWalksList(ctx, walksSnapshot.docs);
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
  ctx.reply("Вернуться в профиль", getMainMenuKeyboard());
});

// Возврат в меню
bot.hears("Назад в меню", (ctx) => {
  ctx.reply("Главное меню", getMainMenuKeyboard());
});

// Функция для уведомления пользователей поблизости о новой прогулке
async function notifyNearbyUsers(walkId, organizer, walkData) {
  // В продакшене здесь будет более сложная логика для определения пользователей поблизости
  // Для простоты, пока просто берем всех пользователей в том же городе

  const usersSnapshot = await db
    .collection("users")
    .where("city", "==", organizer.city)
    .get();

  for (const userDoc of usersSnapshot.docs) {
    const user = userDoc.data();

    // Не уведомляем организатора
    if (user.id === organizer.id) continue;

    await bot.telegram.sendMessage(
      user.id,
      `
🔔 Новая прогулка рядом с вами!
🗓 ${walkData.date}, ${walkData.time}
👤 Организатор: ${organizer.name}
🐕 Собака: ${organizer.dog.name}, ${organizer.dog.breed}
`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Подробнее", `walk_details_${walkId}`)],
      ])
    );
  }
}

// Функция для напоминания о предстоящих прогулках
async function remindAboutWalks() {
  const now = new Date();
  const today = moment(now).format("DD.MM.YYYY");

  // Получаем все прогулки на сегодня
  const walksSnapshot = await db
    .collection("walks")
    .where("date", "==", today)
    .get();

  for (const walkDoc of walksSnapshot.docs) {
    const walk = walkDoc.data();

    // Парсим время прогулки
    const [hours, minutes] = walk.time.split(":").map(Number);
    const walkTime = new Date(now);
    walkTime.setHours(hours, minutes, 0, 0);

    // Проверяем, что до прогулки осталось примерно 15 минут
    const timeDiffMinutes = Math.round((walkTime - now) / (1000 * 60));

    if (timeDiffMinutes > 14 && timeDiffMinutes < 16) {
      // Отправляем напоминания всем участникам и организатору
      const reminderText = `
🔔 Напоминание: у вас прогулка через 15 минут!
🗓 ${walk.date}, ${walk.time}
📍 ${walk.locationText || "По геолокации"}
`;

      // Уведомляем организатора
      await bot.telegram.sendMessage(walk.organizer.id, reminderText);

      // Уведомляем всех участников
      for (const participant of walk.participants) {
        await bot.telegram.sendMessage(participant.id, reminderText);
      }
    }
  }
}

// Настраиваем регулярную проверку для напоминаний (каждую минуту)
cron.schedule("* * * * *", remindAboutWalks);

// Запускаем бота
bot
  .launch()
  .then(() => {
    console.log("Бот DogMeet успешно запущен!");
  })
  .catch((err) => {
    console.error("Ошибка при запуске бота:", err);
  });

// Обработка прерываний
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
