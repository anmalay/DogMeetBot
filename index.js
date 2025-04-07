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
const serviceAccount = require("./serviceAccountKey.json");
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
      // Проверка: сообщение пришло после перезапуска бота
      if (
        !ctx.session ||
        !ctx.session.lastInteraction ||
        ctx.session.lastInteraction < BOT_START_TIME
      ) {
        console.log(`Автоматический рестарт для пользователя ${ctx.from.id}`);

        // Очищаем сессию, но сохраняем любые сценарии
        const oldScenes =
          ctx.session && ctx.session.__scenes ? ctx.session.__scenes : null;
        ctx.session = { lastInteraction: Date.now() };

        // Если был активный сценарий, восстанавливаем его
        if (oldScenes) {
          ctx.session.__scenes = oldScenes;
        }

        // Проверяем, зарегистрирован ли пользователь
        const userDoc = await db
          .collection("users")
          .doc(String(ctx.from.id))
          .get();

        if (userDoc.exists) {
          // Если пользователь уже зарегистрирован, показываем главное меню
          await ctx.reply("Бот был обновлен. Вот главное меню:", {
            reply_markup: getMainMenuKeyboard(),
          });
        } else {
          // Если пользователь не зарегистрирован и не в сцене регистрации
          if (!oldScenes || oldScenes.current !== "register") {
            await ctx.reply(
              "Привет! DogMeet помогает находить компанию для прогулок с собакой 🐶.\n" +
                "🔹 Находите владельцев собак рядом.\n" +
                "🔹 Создавайте прогулки в один клик.\n" +
                "🔹 Присоединяйтесь к другим участникам.",
              Markup.inlineKeyboard([
                [Markup.button.callback("Создать профиль", "create_profile")],
              ])
            );
          }
        }

        // Если мы не в сцене, прерываем обработку текущего сообщения
        if (!oldScenes) {
          return;
        }
      }
    }

    // Обновляем время последнего взаимодействия в сессии
    if (!ctx.session) ctx.session = {};
    ctx.session.lastInteraction = Date.now();

    return next();
  } catch (error) {
    console.error("Ошибка в middleware автоматического рестарта:", error);
    // В случае ошибки продолжаем выполнение без автоматического рестарта
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
          await updateWizardMessage(ctx, "Как зовут вашу собаку?", null);

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
          "🎉 Отлично! Геолокация сохранена.\n\nКак зовут вашу собаку?",
          null
        );

        return ctx.wizard.next();
      }

      // Если мы здесь без геолокации/callback, спрашиваем имя собаки
      await updateWizardMessage(ctx, "Как зовут вашу собаку?", null);
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

    await updateWizardMessage(ctx, "Выберите породу", keyboard);
    return ctx.wizard.next();
  },

  // Шаг 4: Порода собаки
  async (ctx) => {
    // Обработка callback для выбора породы
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("breed_")) {
      const breed = ctx.callbackQuery.data.replace("breed_", "");
      await ctx.answerCbQuery();

      if (breed === "Другая (ввести текстом)") {
        await updateWizardMessage(ctx, "Введите породу вашей собаки:");
        ctx.wizard.state.waitingForCustomBreed = true;
        return;
      } else {
        ctx.wizard.state.userData.dogBreed = breed;

        // Переходим к следующему шагу - размер собаки
        const sizeKeyboard = {
          inline_keyboard: [
            [{ text: "Маленькая 🐾 (до 10 кг)", callback_data: "size_small" }],
            [{ text: "Средняя 🐕 (10–25 кг)", callback_data: "size_medium" }],
            [{ text: "Крупная 🐕‍🦺 (25+ кг)", callback_data: "size_large" }],
          ],
        };

        await updateWizardMessage(
          ctx,
          "Какого размера ваша собака?",
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
          [{ text: "Маленькая 🐾 (до 10 кг)", callback_data: "size_small" }],
          [{ text: "Средняя 🐕 (10–25 кг)", callback_data: "size_medium" }],
          [{ text: "Крупная 🐕‍🦺 (25+ кг)", callback_data: "size_large" }],
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
          [{ text: "Маленькая 🐾 (до 10 кг)", callback_data: "size_small" }],
          [{ text: "Средняя 🐕 (10–25 кг)", callback_data: "size_medium" }],
          [{ text: "Крупная 🐕‍🦺 (25+ кг)", callback_data: "size_large" }],
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

    await updateWizardMessage(ctx, "Выберите породу", breedKeyboard);
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

      await updateWizardMessage(ctx, "Возраст собаки:", ageKeyboard);
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

      await updateWizardMessage(ctx, "Возраст собаки:", ageKeyboard);
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

    await updateWizardMessage(ctx, "Возраст собаки:", ageKeyboard);
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
        "Загрузите фото вашей собаки 📸 (необязательно)",
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
        "Загрузите фото вашей собаки 📸 (необязательно)",
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
      "Загрузите фото вашей собаки 📸 (необязательно)",
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
          "Пожалуйста, загрузите фото вашей собаки или нажмите 'Пропустить'",
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
  (ctx) => {
    ctx.reply(
      "Когда планируете прогулку?",
      Markup.inlineKeyboard([
        [
          { text: "Сегодня", callback_data: "date_today" },
          { text: "Завтра", callback_data: "date_tomorrow" },
        ],
        [{ text: "Выбрать дату", callback_data: "date_custom" }],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 2: Обработка выбора даты
  (ctx) => {
    if (!ctx.wizard.state.walkData) {
      ctx.wizard.state.walkData = {};
    }

    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      ctx.answerCbQuery();
      ctx.reply("Создание прогулки отменено", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }

    // Обработка выбора даты через кнопки
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      ctx.answerCbQuery();

      if (data === "date_today") {
        ctx.wizard.state.walkData.date = moment().format("DD.MM.YYYY");
      } else if (data === "date_tomorrow") {
        ctx.wizard.state.walkData.date = moment()
          .add(1, "days")
          .format("DD.MM.YYYY");
      } else if (data === "date_custom") {
        ctx.reply(
          "Введите дату в формате ДД.ММ.ГГГГ:",
          Markup.removeKeyboard()
        );
        return;
      }
    }
    // Обработка ввода произвольной даты
    else if (ctx.message && ctx.message.text) {
      if (!isValidDate(ctx.message.text)) {
        ctx.reply("Пожалуйста, введите корректную дату в формате ДД.ММ.ГГГГ:");
        return; // Остаемся на этом шаге
      }
      ctx.wizard.state.walkData.date = ctx.message.text;
    }

    // Если дата была выбрана, переходим к выбору времени
    if (ctx.wizard.state.walkData.date) {
      ctx.reply(
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
    }

    return ctx.wizard.next();
  },

  // Шаг 3: Обработка выбора часа
  (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      ctx.answerCbQuery();
      ctx.reply("Создание прогулки отменено", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }

    // Обработка выбора часа
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("hour_")) {
      const hour = ctx.callbackQuery.data.replace("hour_", "");
      ctx.answerCbQuery();

      ctx.wizard.state.walkData.hours = hour;

      ctx.reply(
        `Выбрано: ${hour} ч.\nВыберите минуты:`,
        Markup.inlineKeyboard(
          [
            "00",
            "05",
            "10",
            "15",
            "20",
            "25",
            "30",
            "35",
            "40",
            "45",
            "50",
            "55",
          ]
            .map((m) => [{ text: m, callback_data: `minute_${m}` }])
            .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
        )
      );
    } else if (ctx.message && ctx.message.text) {
      if (ctx.message.text === "❌ Отмена") {
        ctx.reply("Создание прогулки отменено", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Проверка, что введено число от 0 до 23
      const hours = parseInt(ctx.message.text, 10);
      if (isNaN(hours) || hours < 0 || hours > 23) {
        ctx.reply("Пожалуйста, введите корректное значение часов (0-23):");
        return; // Остаемся на том же шаге
      }

      ctx.wizard.state.walkData.hours = String(hours);

      ctx.reply(
        `Выбрано: ${hours} ч.\nВыберите минуты:`,
        Markup.inlineKeyboard(
          [
            "00",
            "05",
            "10",
            "15",
            "20",
            "25",
            "30",
            "35",
            "40",
            "45",
            "50",
            "55",
          ]
            .map((m) => [{ text: m, callback_data: `minute_${m}` }])
            .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
        )
      );
    }

    return ctx.wizard.next();
  },

  // Шаг 4: Обработка выбора минут и выбор места
  (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      ctx.answerCbQuery();
      ctx.reply("Создание прогулки отменено", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }

    // Обработка выбора минут
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("minute_")) {
      const minute = ctx.callbackQuery.data.replace("minute_", "");
      ctx.answerCbQuery();

      ctx.wizard.state.walkData.minutes = minute;
      ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${minute}`;

      // Улучшенные опции для выбора места
      ctx.reply(
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся?`,
        Markup.inlineKeyboard([
          [
            {
              text: "🟢 Гуляю здесь (текущее место)",
              callback_data: "walk_here",
            },
          ],
          [{ text: "✏️ Ввести адрес", callback_data: "enter_location_text" }],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ])
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
        ctx.reply("Создание прогулки отменено", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Проверка, что введено число от 0 до 59
      const minutes = parseInt(ctx.message.text, 10);
      if (isNaN(minutes) || minutes < 0 || minutes > 59) {
        ctx.reply("Пожалуйста, введите корректное значение минут (0-59):");
        return; // Остаемся на том же шаге
      }

      // Форматировать минуты с ведущим нулем
      const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
      ctx.wizard.state.walkData.minutes = formattedMinutes;
      ctx.wizard.state.walkData.time = `${ctx.wizard.state.walkData.hours}:${formattedMinutes}`;

      ctx.reply(
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся?`,
        Markup.inlineKeyboard([
          [
            {
              text: "🟢 Гуляю здесь (текущее место)",
              callback_data: "walk_here",
            },
          ],
          [{ text: "✏️ Ввести адрес", callback_data: "enter_location_text" }],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ])
      );
    }
    // Обработка выбора типа ввода места
    else if (ctx.callbackQuery) {
      ctx.answerCbQuery();

      if (ctx.callbackQuery.data === "walk_here") {
        // Для опции "Гуляю здесь" - запрашиваем текущее местоположение
        ctx.reply(
          "Отправьте ваше текущее местоположение:",
          Markup.keyboard([
            [Markup.button.locationRequest("📍 Отправить моё местоположение")],
          ]).resize()
        );
        ctx.wizard.state.waitingForWalkHere = true;
        return;
      } else if (ctx.callbackQuery.data === "enter_location_text") {
        ctx.reply("Опишите место встречи:", Markup.removeKeyboard());
        ctx.wizard.state.waitingForLocationText = true;
        return;
      }
    }
    // Обработка ввода текста места или геолокации
    else if (ctx.message) {
      if (ctx.wizard.state.waitingForLocationText) {
        if (!isValidString(ctx.message.text)) {
          ctx.reply(
            "Описание места встречи не может быть пустым или 'null'. Пожалуйста, введите корректное описание:"
          );
          return;
        }
        ctx.wizard.state.walkData.locationText = ctx.message.text;
        ctx.wizard.state.waitingForLocationText = false;
      } else if (ctx.message.location) {
        ctx.wizard.state.walkData.location = {
          latitude: ctx.message.location.latitude,
          longitude: ctx.message.location.longitude,
        };

        // Если это была опция "Гуляю здесь", добавляем соответствующую метку
        if (ctx.wizard.state.waitingForWalkHere) {
          ctx.wizard.state.walkData.locationDescription =
            "Текущее местоположение";
          ctx.wizard.state.waitingForWalkHere = false;
        }

        // Если это была опция "Выбрать на карте", можно добавить другую метку
        if (ctx.wizard.state.waitingForMapLocation) {
          ctx.wizard.state.walkData.locationDescription = "Выбрано на карте";
          ctx.wizard.state.waitingForMapLocation = false;
        }
      }

      // Убираем клавиатуру
      ctx.reply(
        "Это разовая или регулярная прогулка?",
        Markup.inlineKeyboard([
          [
            { text: "Разовая 🔹", callback_data: "type_single" },
            { text: "Регулярная 🔄", callback_data: "type_regular" },
          ],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ])
      );

      return ctx.wizard.next();
    }

    return;
  },

  // Шаг 5: Тип прогулки и подтверждение
  async (ctx) => {
    // Обработка кнопки отмены
    if (ctx.callbackQuery && ctx.callbackQuery.data === "cancel") {
      ctx.answerCbQuery();
      ctx.reply("Создание прогулки отменено", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }

    // Обработка выбора типа прогулки
    if (ctx.callbackQuery) {
      ctx.answerCbQuery();

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

    // Формируем превью
    let previewText = `
  🗓 Прогулка: ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
  📍 Место: ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 Тип: ${ctx.wizard.state.walkData.type === "single" ? "Разовая" : "Регулярная"}
  👤 Организатор: ${userData.name}
  🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

    // Отправляем превью с фото собаки или без
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
  },

  // Шаг 6: Публикация или отмена
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
    } else if (action === "cancel_walk") {
      // Удаляем кнопки
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (error) {
        console.error("Ошибка при удалении клавиатуры:", error);
      }

      // Возвращаем в главное меню
      await ctx.reply("❌ Создание прогулки отменено.", {
        reply_markup: getMainMenuKeyboard(),
      });

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
      "Выберите новый город или отправьте геолокацию 📍",
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
          await ctx.reply("Главное меню:", {
            reply_markup: getMainMenuKeyboard(),
          });

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

    await updateWizardMessage(ctx, "Выберите новую породу:", keyboard);
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
        [{ text: "Маленькая 🐾 (до 10 кг)", callback_data: "size_small" }],
        [{ text: "Средняя 🐕 (10–25 кг)", callback_data: "size_medium" }],
        [{ text: "Крупная 🐕‍🦺 (25+ кг)", callback_data: "size_large" }],
        [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
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

// Сцена выбора параметра для редактирования прогулки
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
      ctx.reply("Ошибка: не удалось найти идентификатор прогулки", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }

    // Сохраняем ID в сцене
    ctx.scene.state.walkId = walkId;

    await ctx.reply(
      "Что вы хотите изменить?",
      Markup.inlineKeyboard([
        [
          { text: "🗓 Дата и время", callback_data: "edit_date_time" },
          { text: "📍 Место встречи", callback_data: "edit_location" },
        ],
        [{ text: "🔄 Тип прогулки", callback_data: "edit_type" }],
        [{ text: "❌ Отмена редактирования", callback_data: "cancel_edit" }],
      ])
    );
  } catch (error) {
    console.error("Ошибка при входе в меню редактирования:", error);
    ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
    return ctx.scene.leave();
  }
});

// Сцена редактирования даты и времени прогулки
const editWalkDateTimeScene = new Scenes.WizardScene(
  "editWalkDateTime",
  // Шаг 1: Выбор даты
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkDateTime");
    if (!initResult.success) return ctx.scene.leave();

    ctx.reply(
      "Выберите новую дату прогулки:",
      Markup.inlineKeyboard([
        [
          { text: "Сегодня", callback_data: "date_today" },
          { text: "Завтра", callback_data: "date_tomorrow" },
        ],
        [{ text: "Выбрать дату", callback_data: "date_custom" }],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ])
    );

    return ctx.wizard.next();
  },

  // Шаг 2: Обработка выбора даты
  (ctx) => {
    try {
      console.log("Шаг 2 редактирования даты/времени");

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        ctx.answerCbQuery();

        if (data === "cancel") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else if (data === "date_today") {
          ctx.wizard.state.walkData.date = moment().format("DD.MM.YYYY");
        } else if (data === "date_tomorrow") {
          ctx.wizard.state.walkData.date = moment()
            .add(1, "days")
            .format("DD.MM.YYYY");
        } else if (data === "date_custom") {
          ctx.reply("Введите дату в формате ДД.ММ.ГГГГ:");
          ctx.wizard.state.customDate = true;
          return;
        }
      }
      // Обработка текстового ввода даты
      else if (ctx.message && ctx.message.text) {
        if (ctx.wizard.state.customDate) {
          if (!isValidDate(ctx.message.text)) {
            ctx.reply(
              "Пожалуйста, введите корректную дату в формате ДД.ММ.ГГГГ:"
            );
            return; // Остаемся на этом шаге
          }
          ctx.wizard.state.walkData.date = ctx.message.text;
          ctx.wizard.state.customDate = false;
        }
      }

      // Если у нас есть дата, переходим к выбору времени
      if (ctx.wizard.state.walkData.date) {
        ctx.reply(
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
      }

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования даты:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
  },

  // Шаг 3: Выбор часа
  (ctx) => {
    try {
      console.log("Шаг 3 редактирования даты/времени (час)");

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        ctx.answerCbQuery();

        if (data === "cancel") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else if (data.startsWith("hour_")) {
          // Сохраняем час
          ctx.wizard.state.walkData.hour = data.replace("hour_", "");

          // Переходим к выбору минут
          ctx.reply(
            `Выбрано: ${ctx.wizard.state.walkData.hour} ч.\nВыберите минуты:`,
            Markup.inlineKeyboard(
              [
                "00",
                "05",
                "10",
                "15",
                "20",
                "25",
                "30",
                "35",
                "40",
                "45",
                "50",
                "55",
              ]
                .map((m) => [{ text: m, callback_data: `minute_${m}` }])
                .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
            )
          );
        }
      }
      // Обработка текстового ввода часа (на всякий случай)
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        }

        // Сохраняем час
        ctx.wizard.state.walkData.hour = ctx.message.text;

        // Переходим к выбору минут
        ctx.reply(
          `Выбрано: ${ctx.wizard.state.walkData.hour} ч.\nВыберите минуты:`,
          Markup.inlineKeyboard(
            [
              "00",
              "05",
              "10",
              "15",
              "20",
              "25",
              "30",
              "35",
              "40",
              "45",
              "50",
              "55",
            ]
              .map((m) => [{ text: m, callback_data: `minute_${m}` }])
              .concat([[{ text: "❌ Отмена", callback_data: "cancel" }]])
          )
        );
      }

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка в шаге 3 редактирования даты:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
  },

  // Шаг 4: Выбор минут и сохранение
  async (ctx) => {
    try {
      console.log("Шаг 4 редактирования даты/времени (минуты)");

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        ctx.answerCbQuery();

        if (data === "cancel") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else if (data.startsWith("minute_")) {
          // Сохраняем минуты
          const minute = data.replace("minute_", "");

          // Формируем полное время
          const walkId = ctx.wizard.state.walkId;
          const newDate = ctx.wizard.state.walkData.date;
          const newTime = `${ctx.wizard.state.walkData.hour}:${minute}`;

          console.log(
            `Обновляем дату и время для ${walkId}: ${newDate}, ${newTime}`
          );

          // Получаем текущую информацию о прогулке
          const walkDoc = await db.collection("walks").doc(walkId).get();
          if (!walkDoc.exists) {
            ctx.reply("Прогулка не найдена", {
              reply_markup: getMainMenuKeyboard(),
            });
            return ctx.scene.leave();
          }

          const walkData = walkDoc.data();

          // Сохраняем изменения
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

          ctx.reply(
            `✅ Дата и время прогулки обновлены на: ${newDate}, ${newTime}`,
            { reply_markup: getMainMenuKeyboard() }
          );

          return ctx.scene.leave();
        }
      }
      // Обработка текстового ввода минут (на всякий случай)
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        }

        // Формируем полное время
        const walkId = ctx.wizard.state.walkId;
        const newDate = ctx.wizard.state.walkData.date;
        const newTime = `${ctx.wizard.state.walkData.hour}:${ctx.message.text}`;

        console.log(
          `Обновляем дату и время для ${walkId}: ${newDate}, ${newTime}`
        );

        // Сохраняем изменения
        await db.collection("walks").doc(walkId).update({
          date: newDate,
          time: newTime,
        });

        ctx.reply(
          `✅ Дата и время прогулки обновлены на: ${newDate}, ${newTime}`,
          { reply_markup: getMainMenuKeyboard() }
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error("Ошибка в шаге 4 редактирования даты:", error);
      ctx.reply("Произошла ошибка при обновлении даты и времени", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }
  }
);
// Сцена редактирования места прогулки
// Сцена редактирования места прогулки
const editWalkLocationScene = new Scenes.WizardScene(
  "editWalkLocation",
  // Шаг 1: Выбор типа места
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkLocation");
    if (!initResult.success) return ctx.scene.leave();

    ctx.reply(
      "Укажите новое место встречи:",
      Markup.inlineKeyboard([
        [
          {
            text: "🟢 Мое текущее местоположение",
            callback_data: "current_location_walk",
          },
        ],
        [{ text: "📍 Выбрать на карте", callback_data: "choose_map_walk" }],
        [{ text: "✏️ Ввести текстом", callback_data: "enter_location_text" }],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ])
    );

    return ctx.wizard.next();
  },

  // Шаг 2: Ввод места
  async (ctx) => {
    try {
      console.log("Шаг 2 редактирования места");

      const walkId = ctx.wizard.state.walkId;

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        await ctx.answerCbQuery();

        if (data === "cancel") {
          await ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else if (data === "current_location_walk") {
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
        } else if (data === "choose_map_walk") {
          // Показываем кнопку для выбора на карте
          await ctx.reply(
            "Выберите место встречи на карте и отправьте:",
            Markup.keyboard([
              [Markup.button.locationRequest("📍 Выбрать место на карте")],
            ]).resize()
          );
          ctx.wizard.state.waitingForMapLocation = true;
          return;
        } else if (data === "enter_location_text") {
          await ctx.reply("Опишите место встречи:", Markup.removeKeyboard());
          ctx.wizard.state.waitingForLocationText = true;
          return;
        }
      }

      // Обработка геолокации
      else if (ctx.message && ctx.message.location) {
        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await ctx.reply("Прогулка не найдена", {
            reply_markup: getMainMenuKeyboard(),
          });
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

        await ctx.reply("✅ Место встречи успешно обновлено!", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Обработка текстового ввода места
      else if (
        ctx.message &&
        ctx.message.text &&
        ctx.wizard.state.waitingForLocationText
      ) {
        if (!isValidString(ctx.message.text)) {
          await ctx.reply(
            "Описание места встречи не может быть пустым или 'null'. Пожалуйста, введите корректное описание:"
          );
          return;
        }
        const newLocation = ctx.message.text;

        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await ctx.reply("Прогулка не найдена", {
            reply_markup: getMainMenuKeyboard(),
          });
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

        await ctx.reply("✅ Место встречи успешно обновлено!", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Обработка других текстовых сообщений
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else {
          // Если получили текст, но не ожидали его, просим выбрать опцию
          await ctx.reply(
            "Пожалуйста, выберите опцию из меню или отправьте запрошенную информацию."
          );
        }
      }
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования места:", error);
      await ctx.reply("Произошла ошибка", {
        reply_markup: getMainMenuKeyboard(),
      });
      return ctx.scene.leave();
    }
  }
);
// Сцена редактирования типа прогулки
const editWalkTypeScene = new Scenes.WizardScene(
  "editWalkType",
  // Шаг 1: Выбор типа
  async (ctx) => {
    const initResult = await initWalkEditScene(ctx, "editWalkType");
    if (!initResult.success) return ctx.scene.leave();

    ctx.reply(
      "Выберите тип прогулки:",
      Markup.inlineKeyboard([
        [
          { text: "Разовая 🔹", callback_data: "type_single" },
          { text: "Регулярная 🔄", callback_data: "type_regular" },
        ],
        [{ text: "❌ Отмена", callback_data: "cancel" }],
      ])
    );

    return ctx.wizard.next();
  },

  // Шаг 2: Сохранение типа
  async (ctx) => {
    try {
      console.log("Шаг 2 редактирования типа");

      // Обработка callback-кнопок
      if (ctx.callbackQuery) {
        const data = ctx.callbackQuery.data;
        ctx.answerCbQuery();

        if (data === "cancel") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        } else if (data === "type_single" || data === "type_regular") {
          const walkId = ctx.wizard.state.walkId;
          const newType = data === "type_single" ? "single" : "regular";
          const typeText = data === "type_single" ? "Разовая" : "Регулярная";

          console.log(`Обновляем тип прогулки для ${walkId} на: ${newType}`);

          await db.collection("walks").doc(walkId).update({
            type: newType,
          });

          ctx.reply(`✅ Тип прогулки изменен на "${typeText}"`, {
            reply_markup: getMainMenuKeyboard(),
          });

          return ctx.scene.leave();
        }
      }
      // Обработка текстового ввода (на всякий случай)
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          ctx.reply("Редактирование отменено", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        }

        const walkId = ctx.wizard.state.walkId;
        const newType = ctx.message.text.includes("Разовая")
          ? "single"
          : "regular";

        console.log(`Обновляем тип прогулки для ${walkId} на: ${newType}`);

        await db.collection("walks").doc(walkId).update({
          type: newType,
        });

        ctx.reply(`✅ Тип прогулки изменен на "${ctx.message.text}"`, {
          reply_markup: getMainMenuKeyboard(),
        });

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error("Ошибка в шаге 2 редактирования типа:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
  }
);

// Функция для получения текстового представления размера собаки
function getDogSizeText(size) {
  const sizeObj = Object.values(DOG_SIZES).find((s) => s.value === size);
  return sizeObj ? sizeObj.text.split(" ")[0] : "Средняя";
}

// Добавить эту функцию для форматирования данных о прогулке
function formatWalkInfo(walk, isOwn = false) {
  // Добавляем пометку для собственных прогулок
  const ownLabel = isOwn ? "🌟 МОЯ ПРОГУЛКА\n" : "";

  // Форматируем информацию о дистанции, если она есть
  const distanceText = walk.distance
    ? walk.distance < 1
      ? `${Math.round(walk.distance * 1000)} м`
      : `${walk.distance.toFixed(1)} км`
    : "";

  // Добавляем информацию о дистанции, если она доступна
  const locationInfo = walk.locationText || "По геолокации";
  const locationWithDistance = distanceText
    ? `${locationInfo} (${distanceText} от вас)`
    : locationInfo;

  // Собираем текст для предпросмотра прогулки
  return `${ownLabel}🕒 ${walk.date}, ${walk.time}
  📍 ${locationWithDistance}
  🐕 Участников: ${walk.participants ? walk.participants.length + 1 : 1}
  👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
  ${walk.organizer.username ? "@" + walk.organizer.username : ""}`.trim();
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
// Модифицируем функцию поиска прогулок по геолокации
async function findWalksNearby(ctx, latitude, longitude, maxDistance = 3) {
  try {
    console.log(
      `Поиск прогулок рядом с (${latitude}, ${longitude}) в радиусе ${maxDistance} км`
    );

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

          nearbyWalks.push({
            id: walkDoc.id,
            ...walk,
            distance: distance, // Добавляем расстояние для сортировки
            isOwn: isOwn, // Добавляем пометку
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
    nearbyWalks.sort((a, b) => a.distance - b.distance);

    // Выводим сообщение о найденных прогулках
    await ctx.reply(`Найдено ${nearbyWalks.length} прогулок поблизости:`);

    // Показываем список прогулок
    for (const walk of nearbyWalks) {
      const distanceText =
        walk.distance < 1
          ? `${Math.round(walk.distance * 1000)} м`
          : `${walk.distance.toFixed(1)} км`;

      // Добавляем пометку для собственных прогулок
      const ownLabel = walk.isOwn ? "🌟 МОЯ ПРОГУЛКА\n" : "";

      const walkPreview = `${ownLabel}🕒 ${walk.date}, ${walk.time}
  📍 ${walk.locationText || "По геолокации"} (${distanceText} от вас)
  🐕 Участников: ${walk.participants ? walk.participants.length + 1 : 1}
  👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
  ${walk.organizer.username ? "@" + walk.organizer.username : ""}`;

      await ctx.reply(walkPreview, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Подробнее", callback_data: `walk_details_${walk.id}` }],
          ],
        },
      });
    }

    await ctx.reply({
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  } catch (error) {
    console.error("Ошибка при поиске прогулок поблизости:", error);
    await ctx.reply("Произошла ошибка при поиске прогулок. Попробуйте снова.", {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    });
  }
}

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
      createdAt: new Date(),
    };

    await db.collection("users").doc(String(ctx.from.id)).set(user);

    // Отправляем завершающее сообщение
    await updateWizardMessage(
      ctx,
      "✅ Профиль создан! Теперь вы можете создавать прогулки или присоединяться к другим.",
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

      const walkPreview = `${ownLabel}🕒 ${walk.date}, ${walk.time}
  📍 ${walk.locationText || "По геолокации"}
  🐕 Участников: ${walk.participants ? walk.participants.length + 1 : 1}
  👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
  ${walk.organizer.username ? "@" + walk.organizer.username : ""}`;

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
  await ctx.reply(
    "✅ Прогулка создана! Мы уведомим владельцев собак поблизости.",
    { reply_markup: getMainMenuKeyboard() }
  );

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
      return;
    }

    const organizer = organizerDoc.data();

    // Проверяем наличие walkHistory
    if (!organizer.walkHistory) {
      console.log("У организатора нет объекта walkHistory");
      return;
    }

    // Проверяем наличие массива participants
    if (!organizer.walkHistory.participants) {
      console.log("У организатора нет walkHistory.participants");
      return;
    }

    // Проверяем, что participants - это массив
    if (!Array.isArray(organizer.walkHistory.participants)) {
      console.log(
        "walkHistory.participants не является массивом, его тип:",
        typeof organizer.walkHistory.participants
      );
      return;
    }

    // Проверяем, что массив не пустой
    if (organizer.walkHistory.participants.length === 0) {
      console.log("Массив participants пуст");
      return;
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

        const userData = userDoc.data();

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

    // Сообщаем организатору об отправленных уведомлениях
    if (sentCount > 0) {
      console.log(
        `Отправляем уведомление организатору ${organizerId} о количестве отправленных сообщений`
      );
      await bot.telegram.sendMessage(
        organizerId,
        `✅ Отправлено ${sentCount} уведомлений пользователям, которые ранее присоединялись к вашим прогулкам.`
      );
    }
  } catch (error) {
    console.error("❌ ОШИБКА при уведомлении предыдущих участников:", error);
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
  // Проверяем, зарегистрирован ли пользователь
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (userDoc.exists) {
    // Если пользователь уже зарегистрирован, показываем главное меню
    ctx.reply(
      `Привет, ${userDoc.data().name || ctx.from.first_name}! С возвращением в DogMeet 🐶`,
      {
        reply_markup: getMainMenuKeyboard(),
      }
    );
  } else {
    // Если пользователь новый, предлагаем зарегистрироваться
    const name = ctx.from.first_name || "гость";
    ctx.reply(
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
  ctx.reply("Выберите фильтр:", {
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
          text: "📍 Отправить геолокацию (рекомендуется)",
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
      [{ text: "👤 Мой профиль", callback_data: "my_profile" }],
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

    // Сохраняем ID сообщения для будущих обновлений
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = messageId;

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

    const profileText = `
👤 Имя: ${userData.name} ${userData.username ? "@" + userData.username : ""}
📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
    `;

    // Добавляем невидимый маркер к тексту, чтобы избежать ошибки "message is not modified"
    const uniqueMarker = `\u200B${Date.now().toString().slice(-5)}`;
    const modifiedText = profileText + uniqueMarker;

    // Пытаемся редактировать сообщение напрямую, используя ID из callbackQuery
    if (messageId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          messageId,
          null,
          modifiedText,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✏️ Редактировать профиль",
                    callback_data: "edit_profile_menu",
                  },
                ],
                [
                  {
                    text: "⬅️ Назад в меню",
                    callback_data: "back_to_main_menu",
                  },
                ],
              ],
            },
          }
        );

        // Если у собаки есть фото, показываем его отдельным сообщением
        if (userData.dog && userData.dog.photoId) {
          // Проверяем, было ли уже отправлено фото в этом контексте
          if (!ctx.session.dogPhotoShown) {
            await ctx.replyWithPhoto(userData.dog.photoId);
            ctx.session.dogPhotoShown = true;
          }
        }

        return;
      } catch (error) {
        console.log("Не удалось обновить сообщение:", error);
        // В случае ошибки продолжаем и отправляем новое сообщение
      }
    }

    // Если редактирование не удалось, отправляем новое сообщение
    const msg = await ctx.reply(profileText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✏️ Редактировать профиль",
              callback_data: "edit_profile_menu",
            },
          ],
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      },
    });

    // Сохраняем ID нового сообщения
    ctx.session.lastMessageId = msg.message_id;

    // Если у собаки есть фото, показываем его отдельным сообщением
    if (userData.dog && userData.dog.photoId) {
      await ctx.replyWithPhoto(userData.dog.photoId);
      ctx.session.dogPhotoShown = true;
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
  const menuText = "Главное меню";
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
      await ctx.reply("Ищем прогулки рядом с вашей сохранённой локацией...");
      await findWalksNearby(
        ctx,
        userData.location.latitude,
        userData.location.longitude
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
bot.action("walks_today", async (ctx) => {
  await ctx.answerCbQuery();

  const today = moment().format("DD.MM.YYYY");
  const walksSnapshot = await db
    .collection("walks")
    .where("date", "==", today)
    .get();

  if (walksSnapshot.empty) {
    await ctx.reply("На сегодня прогулок не найдено.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
          [{ text: "⬅️ Назад", callback_data: "find_walk" }],
        ],
      },
    });
    return;
  }

  await ctx.reply("Прогулки на сегодня:");

  await showWalksList(ctx, walksSnapshot.docs);

  await ctx.reply("Вернуться:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });
});

bot.action("walks_tomorrow", async (ctx) => {
  await ctx.answerCbQuery();

  const tomorrow = moment().add(1, "days").format("DD.MM.YYYY");
  const walksSnapshot = await db
    .collection("walks")
    .where("date", "==", tomorrow)
    .get();

  const activeWalks = walksSnapshot.docs.filter(
    (doc) => !doc.data().status || doc.data().status !== "archived"
  );

  if (activeWalks.length === 0) {
    await ctx.reply("На завтра прогулок не найдено.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
          [{ text: "⬅️ Назад", callback_data: "find_walk" }],
        ],
      },
    });
    return;
  }

  await ctx.reply("Прогулки на завтра:");

  await showWalksList(ctx, walksSnapshot.docs);

  await ctx.reply("Вернуться:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });
});

bot.action("walks_all_dates", async (ctx) => {
  await ctx.answerCbQuery();

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

  await ctx.reply("Все прогулки:");

  await showWalksList(ctx, walksSnapshot.docs);

  await ctx.reply("Вернуться:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });
});

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

    const profileText = `
👤 Имя: ${userData.name} ${userData.username ? "@" + userData.username : ""}
📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
    `;

    // Если это ответ на callback, пытаемся редактировать сообщение
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(profileText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✏️ Редактировать профиль",
                  callback_data: "edit_profile_menu",
                },
              ],
              [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
            ],
          },
        });

        // Сохраняем ID сообщения в сессии
        if (!ctx.session) ctx.session = {};
        ctx.session.lastMessageId = ctx.callbackQuery.message.message_id;
        return;
      } catch (error) {
        console.log("Не удалось отредактировать сообщение:", error);
        // Если редактирование не удалось, отправим новое сообщение
      }
    }

    // Отправляем сообщение (только если не смогли отредактировать)
    const msg = await ctx.reply(profileText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✏️ Редактировать профиль",
              callback_data: "edit_profile_menu",
            },
          ],
          [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
        ],
      },
    });

    // Сохраняем ID сообщения в сессии
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = msg.message_id;

    // Если у собаки есть фото, отправляем его отдельным сообщением
    // (нельзя преобразовать текстовое сообщение в фото при редактировании)
    if (userData.dog && userData.dog.photoId) {
      await ctx.replyWithPhoto(userData.dog.photoId);
    }
  } catch (error) {
    console.error("Ошибка при отображении профиля:", error);
    throw error;
  }
}

// Оптимизированная функция для отображения списка прогулок
async function showWalksList(ctx, walkDocs) {
  const groupSize = 3; // Группируем по 3 прогулки

  for (let i = 0; i < walkDocs.length; i += groupSize) {
    const chunk = walkDocs.slice(i, i + groupSize);
    let messageText = "";
    const keyboard = [];

    for (let j = 0; j < chunk.length; j++) {
      const walkDoc = chunk[j];
      const walk = walkDoc.data();
      const isOwn = walk.organizer.id == ctx.from.id;
      const walkNum = i + j + 1;

      // Добавляем информацию о прогулке с номером
      messageText += `<b>🐕 Прогулка ${walkNum}</b>\n`;
      messageText += formatWalkInfo(walk, isOwn);

      // Добавляем разделитель между прогулками
      if (j < chunk.length - 1) {
        messageText += "\n\n" + "─────────────────\n\n";
      }

      // Добавляем кнопку для прогулки
      keyboard.push([
        Markup.button.callback(
          `Подробнее о прогулке ${walkNum}`,
          `walk_details_${walkDoc.id}`
        ),
      ]);
    }

    // Отправляем одно сообщение с группой прогулок
    await ctx.reply(messageText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

// Функция для обновления сообщения вместо отправки нового
async function updateWizardMessage(ctx, text, keyboard = null) {
  try {
    const modifiedText = text + " ";

    // Проверяем, есть ли сохранённый ID сообщения для обновления
    if (ctx.session && ctx.session.lastMessageId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.session.lastMessageId,
          null,
          modifiedText,
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }
        );
        return true; // Успешное обновление
      } catch (error) {
        console.error("Ошибка при обновлении сообщения:", error);
        // Если сообщение не найдено (было удалено) или другая ошибка - создаем новое
        const msg = await ctx.reply(modifiedText, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });

        // Обновляем ID сообщения
        ctx.session.lastMessageId = msg.message_id;
        return false;
      }
    }
  } catch (error) {
    console.error("Ошибка при обновлении сообщения:", error);
  }

  // Если обновить не удалось или нет сохранённого ID, создаём новое сообщение
  try {
    const msg = await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    // Сохраняем ID сообщения для будущих обновлений
    if (!ctx.session) ctx.session = {};
    ctx.session.lastMessageId = msg.message_id;
    return false; // Создано новое сообщение
  } catch (error) {
    console.error("Ошибка при отправке нового сообщения:", error);
    return false;
  }
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

  // Дополнительная проверка валидности даты
  const [day, month, year] = dateStr.split(".").map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
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

// Обновление функции отображения деталей прогулки
bot.action(/walk_details_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    await ctx.answerCbQuery();

    const walkDoc = await db.collection("walks").doc(walkId).get();

    if (!walkDoc.exists) {
      await ctx.reply("Прогулка не найдена или была отменена.", {
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }

    const walk = walkDoc.data();

    // Формируем информацию о местоположении
    let locationInfo = "Не указано";
    if (walk.locationText) {
      locationInfo = walk.locationText;
    } else if (walk.location) {
      // Если есть описание местоположения, используем его
      locationInfo = walk.location.description || "По геолокации";

      // Дополнительно можно добавить кнопку для просмотра на карте
      if (walk.location.latitude && walk.location.longitude) {
        locationInfo += " (можно открыть на карте)";
      }
    }

    // Формируем детальную информацию о прогулке
    let walkDetails = `
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

    // Добавляем кнопку "Назад" в главное меню
    keyboard.push([
      { text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" },
    ]);

    // Если есть фото собаки, показываем его
    if (walk.dog.photoId) {
      await ctx.replyWithPhoto(walk.dog.photoId, {
        caption: walkDetails,
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await ctx.reply(walkDetails, {
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error) {
    console.error("Ошибка при отображении деталей прогулки:", error);
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Присоединение к прогулке
bot.action(/join_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkRef = db.collection("walks").doc(walkId);
    const walkDoc = await walkRef.get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или была отменена.");
      await ctx.reply("Прогулка не найдена или была отменена.", {
        reply_markup: getMainMenuKeyboard(),
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

    // Добавляем возврат в главное меню
    await ctx.reply(
      "✅ Вы присоединились к прогулке! Организатор получил уведомление.",
      { reply_markup: getMainMenuKeyboard() }
    );

    // Уведомляем организатора о новом участнике
    try {
      await bot.telegram.sendMessage(
        walk.organizer.id,
        `
  📢 Новый участник в вашей прогулке!
  👤 ${userData.name}
  🐕 ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  📩 Контакт: ${ctx.from.username ? "@" + ctx.from.username : "Нет username"}
  `,
        { reply_markup: getMainMenuKeyboard() }
      );

      // Если у собаки участника есть фото, отправляем его организатору
      if (userData.dog.photoId) {
        await bot.telegram.sendPhoto(walk.organizer.id, userData.dog.photoId);
      }
    } catch (error) {
      console.error("Ошибка при отправке уведомления организатору:", error);
    }
  } catch (error) {
    console.error("Ошибка при присоединении к прогулке:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
  }
});

// Покинуть прогулку
// Покинуть прогулку
bot.action(/leave_walk_(.+)/, async (ctx) => {
  try {
    const walkId = ctx.match[1];
    const walkRef = db.collection("walks").doc(walkId);
    const walkDoc = await walkRef.get();

    if (!walkDoc.exists) {
      await ctx.answerCbQuery("Прогулка не найдена или была отменена.");
      await ctx.reply("Прогулка не найдена или была отменена.", {
        reply_markup: getMainMenuKeyboard(),
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

    // Добавляем возврат в главное меню
    await ctx.reply("Вы покинули прогулку.", {
      reply_markup: getMainMenuKeyboard(),
    });

    // Уведомляем организатора
    try {
      await bot.telegram.sendMessage(
        walk.organizer.id,
        `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} покинул вашу прогулку.`,
        { reply_markup: getMainMenuKeyboard() }
      );
    } catch (error) {
      console.error("Ошибка при отправке уведомления организатору:", error);
    }
  } catch (error) {
    console.error("Ошибка при покидании прогулки:", error);
    await ctx.answerCbQuery("Произошла ошибка");
    await ctx.reply("Произошла ошибка. Возврат в главное меню.", {
      reply_markup: getMainMenuKeyboard(),
    });
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
        `✅ Ваша прогулка создана! Отправлено ${notificationCount} уведомлений владельцам собак поблизости.`
      );
    }
  } catch (error) {
    console.error("Ошибка при отправке уведомлений о новой прогулке:", error);
  }
}

// Функция для напоминания о предстоящих прогулках и удаления прошедших
async function remindAboutWalks() {
  const now = new Date();
  const today = moment(now).format("DD.MM.YYYY");

  // Получаем все прогулки
  const walksSnapshot = await db.collection("walks").get();

  for (const walkDoc of walksSnapshot.docs) {
    const walk = walkDoc.data();
    const walkId = walkDoc.id;

    // Парсим время прогулки
    const [hours, minutes] = walk.time.split(":").map(Number);
    const walkTime = new Date(now);

    // Парсим дату прогулки
    const [day, month, year] = walk.date.split(".").map(Number);
    walkTime.setFullYear(year, month - 1, day); // Месяцы в JavaScript начинаются с 0
    walkTime.setHours(hours, minutes, 0, 0);

    // Проверяем, что прогулка уже прошла и прошло более часа
    const timeDiffMinutes = Math.round((now - walkTime) / (1000 * 60));

    // Если это разовая прогулка, которая закончилась более часа назад, удаляем её
    if (walk.type === "single" && timeDiffMinutes > 60) {
      // Проверяем, есть ли уже статус у прогулки
      if (!walk.status || walk.status !== "archived") {
        await db.collection("walks").doc(walkId).update({
          status: "archived",
          archivedAt: new Date(),
        });
        console.log(
          `Прогулка ${walkId} помечена как архивная (прошла более часа назад)`
        );
      }
      continue; // Переходим к следующей прогулке
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
        await bot.telegram.sendMessage(walk.organizer.id, reminderText, {
          reply_markup: getMainMenuKeyboard(),
        });
        // Уведомляем всех участников
        for (const participant of walk.participants) {
          await bot.telegram.sendMessage(participant.id, reminderText, {
            reply_markup: getMainMenuKeyboard(),
          });
        }
      }
    }
  }
}

// Настраиваем регулярную проверку для напоминаний (каждую минуту)
cron.schedule("* * * * *", remindAboutWalks);

// Обработчики для кнопок главного меню
bot.action("find_walk", async (ctx) => {
  await ctx.answerCbQuery();
  await updateWizardMessage(ctx, "Выберите фильтр:", getWalkFiltersKeyboard());
});

bot.action("create_walk", async (ctx) => {
  await ctx.answerCbQuery();
  // Сохраняем текущее ID сообщения перед входом в сцену
  if (ctx.session && ctx.session.lastMessageId) {
    ctx.session.previousMessageId = ctx.session.lastMessageId;
  }
  ctx.scene.enter("createWalk");
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
  await ctx.answerCbQuery();
  // Реализация с использованием updateWizardMessage
  const walksSnapshot = await db
    .collection("walks")
    .where("organizer.id", "==", ctx.from.id)
    .get();

  if (walksSnapshot.empty) {
    await updateWizardMessage(ctx, "У вас пока нет созданных прогулок.", {
      inline_keyboard: [
        [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
        [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
      ],
    });
    return;
  }

  // Для прогулок возможно придется отправить новые сообщения, т.к. их может быть много
  await updateWizardMessage(ctx, "Ваши созданные прогулки:", {
    inline_keyboard: [
      [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
    ],
  });

  // Отображаем список прогулок
  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("my_participations", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Находим прогулки, где пользователь участвует
    const walksSnapshot = await db.collection("walks").get();

    // Массив для всех прогулок (и организованных, и где участвует)
    const allInvolvedWalks = [];

    // Перебираем все прогулки
    for (const walkDoc of walksSnapshot.docs) {
      const walk = walkDoc.data();
      const walkId = walkDoc.id;

      // Проверяем, является ли пользователь организатором
      if (walk.organizer.id == ctx.from.id) {
        // Добавляем пометку, что это собственная прогулка
        allInvolvedWalks.push({
          id: walkId,
          ...walk,
          isOwn: true, // Пометка "Моя прогулка"
        });
      }
      // Проверяем, является ли пользователь участником
      else if (
        walk.participants &&
        walk.participants.some((p) => p.id == ctx.from.id)
      ) {
        allInvolvedWalks.push({
          id: walkId,
          ...walk,
          isOwn: false,
        });
      }
    }

    // Если прогулок нет вообще
    if (allInvolvedWalks.length === 0) {
      ctx.reply("Вы пока не участвуете ни в одной прогулке.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🐕 Создать прогулку", callback_data: "create_walk" }],
            [{ text: "📍 Найти прогулку", callback_data: "find_walk" }],
            [{ text: "⬅️ Назад в меню", callback_data: "back_to_main_menu" }],
          ],
        },
      });
      return;
    }

    // Сортируем прогулки по дате и времени (от ближайших к дальним)
    allInvolvedWalks.sort((a, b) => {
      // Сначала сравниваем даты
      const dateA = a.date.split(".").reverse().join("-");
      const dateB = b.date.split(".").reverse().join("-");

      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      // Если даты одинаковые, сравниваем время
      return a.time.localeCompare(b.time);
    });

    await ctx.reply("Прогулки, в которых вы участвуете:");

    // Показываем список прогулок с пометкой для собственных
    for (const walk of allInvolvedWalks) {
      const walkPreview = formatWalkInfo(walk, walk.isOwn);

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
    console.error("Ошибка при отображении участия в прогулках:", error);
    await ctx.reply("Произошла ошибка. Попробуйте снова.", {
      reply_markup: getMainMenuKeyboard(),
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
  🗓 Прогулка: ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
  📍 Место: ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 Тип: Разовая
  👤 Организатор: ${userData.name}
  🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    // Удаляем обычную клавиатуру
    await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

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
  🗓 Прогулка: ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
  📍 Место: ${ctx.wizard.state.walkData.locationText || "По геолокации"}
  🔄 Тип: Регулярная
  👤 Организатор: ${userData.name}
  🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
  `;

    // Удаляем обычную клавиатуру
    await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

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
    walkHistory: {
      joinedWithOrganizers: [],
      lastUpdated: new Date(),
    },
    createdAt: new Date(),
  };

  try {
    await db.collection("users").doc(String(ctx.from.id)).set(user);
    ctx.reply(
      "✅ Профиль создан! Теперь вы можете создавать прогулки или присоединяться к другим.",
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
      "Какого размера ваша собака?",
      Markup.inlineKeyboard([
        [{ text: "Маленькая", callback_data: "size_small" }],
        [{ text: "Средняя", callback_data: "size_medium" }],
        [{ text: "Большая", callback_data: "size_large" }],
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

      // Поиск прогулок поблизости
      await ctx.reply("Ищем прогулки поблизости...");
      await findWalksNearby(ctx, location.latitude, location.longitude);

      // Убираем клавиатуру
      await ctx.reply("Поиск завершен", {
        reply_markup: { remove_keyboard: true },
      });
    }

    // Другие обработчики геолокации могут быть здесь, но они должны проверять
    // свои соответствующие флаги в ctx.session или ctx.wizard.state
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

    const profileText = `
👤 Имя: ${userData.name} ${userData.username ? "@" + userData.username : ""}
📍 Город: ${userData.city}
🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
    `;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✏️ Редактировать профиль",
            callback_data: "edit_profile_menu",
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
  await ctx.reply("Редактирование отменено", {
    reply_markup: getMainMenuKeyboard(),
  });
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
    `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся?`,
    Markup.inlineKeyboard([
      [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
      [{ text: "Ввести текстом", callback_data: "enter_location_text" }],
      [{ text: "❌ Отмена", callback_data: "cancel" }],
    ])
  );
  return ctx.wizard.next();
});

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
