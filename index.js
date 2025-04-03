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

  // Шаг 2: Ввод имени и выбор города
  (ctx) => {
    if (!ctx.wizard.state.userData) {
      ctx.wizard.state.userData = {};
    }

    if (ctx.message && ctx.message.text) {
      ctx.wizard.state.userData.name = ctx.message.text;
    }

    ctx.reply(
      "Выберите город или отправьте геолокацию 📍",
      Markup.inlineKeyboard([
        ...POPULAR_CITIES.map((city) => [
          { text: city, callback_data: `city_${city}` },
        ]),
        [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 3: Обработка города и имени собаки
  (ctx) => {
    // Обработка callback
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      ctx.answerCbQuery();

      if (data.startsWith("city_")) {
        ctx.wizard.state.userData.city = data.replace("city_", "");
      } else if (data === "send_location") {
        ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
        return; // Ожидаем следующее сообщение с геолокацией
      }
    }
    // Обработка геолокации
    else if (ctx.message && ctx.message.location) {
      ctx.wizard.state.userData.location = {
        latitude: ctx.message.location.latitude,
        longitude: ctx.message.location.longitude,
      };
      ctx.wizard.state.userData.city = "Определен по геолокации";
    }

    ctx.reply("Как зовут вашу собаку?", Markup.removeKeyboard());
    return ctx.wizard.next();
  },

  // Шаг 4: Порода собаки
  (ctx) => {
    if (ctx.message && ctx.message.text) {
      ctx.wizard.state.userData.dogName = ctx.message.text;
    }

    ctx.reply(
      "Выберите породу",
      Markup.inlineKeyboard(
        POPULAR_BREEDS.map((breed) => [
          { text: breed, callback_data: `breed_${breed}` },
        ])
      )
    );
    return ctx.wizard.next();
  },

  // Шаг 5: Размер собаки
  (ctx) => {
    // Обработка callback для выбора породы
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith("breed_")) {
      const breed = ctx.callbackQuery.data.replace("breed_", "");
      ctx.answerCbQuery();

      if (breed === "Другая (ввести текстом)") {
        ctx.reply("Введите породу вашей собаки:");
        ctx.wizard.state.waitingForCustomBreed = true;
        return;
      } else {
        ctx.wizard.state.userData.dogBreed = breed;
      }
    }
    // Обработка ввода произвольной породы
    else if (
      ctx.wizard.state.waitingForCustomBreed &&
      ctx.message &&
      ctx.message.text
    ) {
      ctx.wizard.state.userData.dogBreed = ctx.message.text;
      ctx.wizard.state.waitingForCustomBreed = false;
    }
    // Если напрямую ввели текст (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      ctx.wizard.state.userData.dogBreed = ctx.message.text;
    }

    ctx.reply(
      "Какого размера ваша собака?",
      Markup.inlineKeyboard([
        [{ text: "Маленькая 🐾 (до 10 кг)", callback_data: "size_small" }],
        [{ text: "Средняя 🐕 (10–25 кг)", callback_data: "size_medium" }],
        [{ text: "Крупная 🐕‍🦺 (25+ кг)", callback_data: "size_large" }],
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 6: Возраст собаки
  (ctx) => {
    // Обработка callback для выбора размера
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      ctx.answerCbQuery();

      if (data === "size_small") {
        ctx.wizard.state.userData.dogSize = "small";
      } else if (data === "size_medium") {
        ctx.wizard.state.userData.dogSize = "medium";
      } else if (data === "size_large") {
        ctx.wizard.state.userData.dogSize = "large";
      }
    }
    // Обработка текстового ввода размера (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      const size = Object.values(DOG_SIZES).find((size) =>
        size.text.includes(ctx.message.text)
      );

      ctx.wizard.state.userData.dogSize = size
        ? size.value
        : DOG_SIZES.MEDIUM.value;
    }
    // Если размер не был выбран, устанавливаем средний по умолчанию
    else if (!ctx.wizard.state.userData.dogSize) {
      ctx.wizard.state.userData.dogSize = DOG_SIZES.MEDIUM.value;
    }

    ctx.reply(
      "Возраст собаки:",
      Markup.inlineKeyboard([
        [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
        [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
        [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
        [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 7: Фото собаки
  async (ctx) => {
    // Обработка callback для выбора возраста
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      ctx.answerCbQuery();

      if (data === "age_puppy") {
        ctx.wizard.state.userData.dogAge = "puppy";
      } else if (data === "age_young") {
        ctx.wizard.state.userData.dogAge = "young";
      } else if (data === "age_adult") {
        ctx.wizard.state.userData.dogAge = "adult";
      } else if (data === "age_senior") {
        ctx.wizard.state.userData.dogAge = "senior";
      }
    }
    // Обработка текстового ввода возраста (на всякий случай)
    else if (ctx.message && ctx.message.text) {
      const age = Object.values(DOG_AGES).find((age) =>
        age.text.includes(ctx.message.text)
      );

      ctx.wizard.state.userData.dogAge = age ? age.value : DOG_AGES.ADULT.value;
    }
    // Если возраст не был выбран, устанавливаем взрослый по умолчанию
    else if (!ctx.wizard.state.userData.dogAge) {
      ctx.wizard.state.userData.dogAge = DOG_AGES.ADULT.value;
    }

    // Добавляем кнопку "Пропустить"
    ctx.reply(
      "Загрузите фото вашей собаки 📸 (необязательно)",
      Markup.inlineKeyboard([
        [{ text: "Пропустить ⏭️", callback_data: "skip_photo" }],
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 8: Завершение регистрации
  async (ctx) => {
    try {
      const userData = ctx.wizard.state.userData;

      // Обработка callback для пропуска фото
      if (ctx.callbackQuery && ctx.callbackQuery.data === "skip_photo") {
        await ctx.answerCbQuery();
      }
      // Обработка отправки фото
      else if (ctx.message && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        userData.dogPhotoId = photoId;
      }

      // Проверка наличия всех необходимых данных
      if (
        !userData.name ||
        !userData.city ||
        !userData.dogName ||
        !userData.dogBreed ||
        !userData.dogSize ||
        !userData.dogAge
      ) {
        console.error(
          "Отсутствуют необходимые данные для регистрации:",
          userData
        );
        await ctx.reply(
          "Произошла ошибка при регистрации. Пожалуйста, начните снова.",
          Markup.removeKeyboard()
        );
        return ctx.scene.reenter();
      }

      // Сохраняем данные пользователя в базу данных
      const user = {
        id: ctx.from.id,
        username: ctx.from.username || null, // Добавить проверку на undefined
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
      await ctx.reply(
        "✅ Профиль создан! Теперь вы можете создавать прогулки или присоединяться к другим.",
        { reply_markup: getMainMenuKeyboard() }
      );

      return ctx.scene.leave();
    } catch (error) {
      console.error("Ошибка при завершении регистрации:", error);
      await ctx.reply(
        "Произошла ошибка при регистрации. Попробуйте снова.",
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

      ctx.reply(
        `Время прогулки: ${ctx.wizard.state.walkData.time}\nГде встречаемся?`,
        Markup.inlineKeyboard([
          [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
          [{ text: "Ввести текстом", callback_data: "enter_location_text" }],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ])
      );
    }
    // Обработка выбора типа ввода места
    else if (ctx.callbackQuery) {
      ctx.answerCbQuery();

      if (ctx.callbackQuery.data === "send_location") {
        ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
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
        ctx.wizard.state.walkData.locationText = ctx.message.text;
        ctx.wizard.state.waitingForLocationText = false;
      } else if (ctx.message.location) {
        ctx.wizard.state.walkData.location = {
          latitude: ctx.message.location.latitude,
          longitude: ctx.message.location.longitude,
        };
      }

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
            username: ctx.from.username || null, // Добавить проверку на undefined
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

        // Удаляем кнопки
        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (error) {
          console.error("Ошибка при удалении клавиатуры:", error);
        }

        // Сообщаем об успехе
        await ctx.reply(
          "✅ Прогулка создана! Мы уведомим владельцев собак поблизости.",
          { reply_markup: getMainMenuKeyboard() }
        );

        // Уведомляем других пользователей
        notifyNearbyUsers(walkRef.id, userData, walkData);

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
  await ctx.reply(
    "Что вы хотите изменить?",
    Markup.inlineKeyboard([
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
    ])
  );
});

// Сцена редактирования имени
const editNameScene = new Scenes.WizardScene(
  "editName",
  // Шаг 1: Ввод нового имени
  (ctx) => {
    ctx.reply("Введите ваше новое имя:", Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение нового имени
  async (ctx) => {
    const newName = ctx.message.text;

    await db.collection("users").doc(String(ctx.from.id)).update({
      name: newName,
    });

    await ctx.reply("✅ Имя успешно изменено!");
    return ctx.scene.enter("editProfileMenu");
  }
);

// Сцена редактирования города
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
        [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
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
        } else if (data === "send_location") {
          await ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
          return;
        } else if (data.startsWith("city_")) {
          const city = data.replace("city_", "");
          await db.collection("users").doc(String(ctx.from.id)).update({
            city: city,
          });

          await ctx.reply("✅ Город успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        }
      }
      // Обработка геолокации
      else if (ctx.message && ctx.message.location) {
        await db
          .collection("users")
          .doc(String(ctx.from.id))
          .update({
            location: {
              latitude: ctx.message.location.latitude,
              longitude: ctx.message.location.longitude,
            },
            city: "Определен по геолокации",
          });

        await ctx.reply("✅ Геолокация успешно сохранена!");
        return ctx.scene.enter("editProfileMenu");
      }
      // Обработка текстового ввода города
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "↩️ Отмена") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        }

        await db.collection("users").doc(String(ctx.from.id)).update({
          city: ctx.message.text,
        });

        await ctx.reply("✅ Город успешно изменен!");
        return ctx.scene.enter("editProfileMenu");
      }
    } catch (error) {
      console.error("Ошибка при редактировании города:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);
// Сцена редактирования имени собаки
const editDogNameScene = new Scenes.WizardScene(
  "editDogName",
  // Шаг 1: Ввод нового имени собаки
  (ctx) => {
    ctx.reply("Введите новое имя собаки:", Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  // Шаг 2: Сохранение имени собаки
  async (ctx) => {
    try {
      if (ctx.message && ctx.message.text) {
        const newDogName = ctx.message.text;

        await db.collection("users").doc(String(ctx.from.id)).update({
          "dog.name": newDogName,
        });

        await ctx.reply("✅ Имя собаки успешно изменено!");
        return ctx.scene.enter("editProfileMenu");
      } else {
        await ctx.reply("Пожалуйста, введите текст для имени собаки.");
      }
    } catch (error) {
      console.error("Ошибка при редактировании имени собаки:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);
// Сцена редактирования породы собаки
const editDogBreedScene = new Scenes.WizardScene(
  "editDogBreed",
  // Шаг 1: Выбор породы
  (ctx) => {
    ctx.reply(
      "Выберите новую породу:",
      Markup.inlineKeyboard(
        POPULAR_BREEDS.map((breed) => [
          { text: breed, callback_data: `breed_${breed}` },
        ]).concat([[{ text: "❌ Отмена", callback_data: "cancel_edit" }]])
      )
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
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        } else if (data.startsWith("breed_")) {
          const breed = data.replace("breed_", "");

          if (breed === "Другая (ввести текстом)") {
            await ctx.reply(
              "Введите породу вашей собаки:",
              Markup.removeKeyboard()
            );
            ctx.wizard.state.waitingForCustomBreed = true;
            return;
          } else {
            await db.collection("users").doc(String(ctx.from.id)).update({
              "dog.breed": breed,
            });

            await ctx.reply("✅ Порода собаки успешно изменена!");
            return ctx.scene.enter("editProfileMenu");
          }
        }
      }
      // Обработка текстового ввода породы
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        }

        if (ctx.wizard.state.waitingForCustomBreed) {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.breed": ctx.message.text,
          });

          await ctx.reply("✅ Порода собаки успешно изменена!");
        } else {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.breed": ctx.message.text,
          });

          await ctx.reply("✅ Порода собаки успешно изменена!");
        }

        return ctx.scene.enter("editProfileMenu");
      }
    } catch (error) {
      console.error("Ошибка при редактировании породы собаки:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);

// Сцена редактирования размера собаки
const editDogSizeScene = new Scenes.WizardScene(
  "editDogSize",
  // Шаг 1: Выбор размера
  (ctx) => {
    ctx.reply(
      "Выберите новый размер собаки:",
      Markup.inlineKeyboard([
        [{ text: "Маленькая", callback_data: "size_small" }],
        [{ text: "Средняя", callback_data: "size_medium" }],
        [{ text: "Большая", callback_data: "size_large" }],
        [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
      ])
    );
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
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "size_small") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.size": "small",
          });

          await ctx.reply("✅ Размер собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "size_medium") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.size": "medium",
          });

          await ctx.reply("✅ Размер собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "size_large") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.size": "large",
          });

          await ctx.reply("✅ Размер собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        }
      }
      // Обработка текстового ввода
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "↩️ Отмена") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        }

        const size = Object.values(DOG_SIZES).find((size) =>
          size.text.includes(ctx.message.text)
        );

        if (size) {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.size": size.value,
          });

          await ctx.reply("✅ Размер собаки успешно изменен!");
        } else {
          await ctx.reply("❌ Неверный выбор. Попробуйте еще раз.");
        }

        return ctx.scene.enter("editProfileMenu");
      }
    } catch (error) {
      console.error("Ошибка при редактировании размера собаки:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);
// Сцена редактирования возраста собаки
const editDogAgeScene = new Scenes.WizardScene(
  "editDogAge",
  // Шаг 1: Выбор возраста
  (ctx) => {
    ctx.reply(
      "Выберите новый возраст собаки:",
      Markup.inlineKeyboard([
        [{ text: DOG_AGES.PUPPY.text, callback_data: "age_puppy" }],
        [{ text: DOG_AGES.YOUNG.text, callback_data: "age_young" }],
        [{ text: DOG_AGES.ADULT.text, callback_data: "age_adult" }],
        [{ text: DOG_AGES.SENIOR.text, callback_data: "age_senior" }],
        [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
      ])
    );
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
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "age_puppy") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": "puppy",
          });

          await ctx.reply("✅ Возраст собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "age_young") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": "young",
          });

          await ctx.reply("✅ Возраст собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "age_adult") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": "adult",
          });

          await ctx.reply("✅ Возраст собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        } else if (data === "age_senior") {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": "senior",
          });

          await ctx.reply("✅ Возраст собаки успешно изменен!");
          return ctx.scene.enter("editProfileMenu");
        }
      }
      // Обработка текстового ввода
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        }

        const age = Object.values(DOG_AGES).find((age) =>
          age.text.includes(ctx.message.text)
        );

        if (age) {
          await db.collection("users").doc(String(ctx.from.id)).update({
            "dog.age": age.value,
          });

          await ctx.reply("✅ Возраст собаки успешно изменен!");
        } else {
          await ctx.reply("❌ Неверный выбор. Попробуйте еще раз.");
        }

        return ctx.scene.enter("editProfileMenu");
      }
    } catch (error) {
      console.error("Ошибка при редактировании возраста собаки:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
    }
  }
);
// Сцена редактирования фото собаки
const editDogPhotoScene = new Scenes.WizardScene(
  "editDogPhoto",
  // Шаг 1: Запрос фото
  (ctx) => {
    ctx.reply(
      "Отправьте новое фото вашей собаки 📸",
      Markup.inlineKeyboard([
        [{ text: "❌ Отмена", callback_data: "cancel_edit" }],
      ])
    );
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
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        }
      }
      // Обработка загрузки фото
      else if (ctx.message && ctx.message.photo) {
        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        await db.collection("users").doc(String(ctx.from.id)).update({
          "dog.photoId": photoId,
        });

        await ctx.reply("✅ Фото собаки успешно обновлено!");
        return ctx.scene.enter("editProfileMenu");
      }
      // Обработка текстовых сообщений
      else if (ctx.message && ctx.message.text) {
        if (ctx.message.text === "❌ Отмена") {
          await ctx.reply("Редактирование отменено");
          return ctx.scene.enter("editProfileMenu");
        } else {
          await ctx.reply(
            "Пожалуйста, отправьте фото собаки или нажмите 'Отмена'."
          );
        }
      }
    } catch (error) {
      console.error("Ошибка при редактировании фото собаки:", error);
      await ctx.reply("Произошла ошибка. Попробуйте снова.");
      return ctx.scene.enter("editProfileMenu");
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
  (ctx) => {
    try {
      console.log("Шаг 1 редактирования даты/времени");

      // Получаем ID из сессии
      if (!ctx.session) ctx.session = {};
      const walkId = ctx.session.editWalkId;

      if (!walkId) {
        console.error("ID прогулки не найден!");
        ctx.reply("Ошибка: не удалось найти идентификатор прогулки", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Сохраняем ID в state
      ctx.wizard.state.walkId = walkId;
      ctx.wizard.state.walkData = {};

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
    } catch (error) {
      console.error("Ошибка в шаге 1 редактирования даты:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
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
const editWalkLocationScene = new Scenes.WizardScene(
  "editWalkLocation",
  // Шаг 1: Выбор типа места
  (ctx) => {
    try {
      console.log("Шаг 1 редактирования места");

      // Получаем ID из сессии
      if (!ctx.session) ctx.session = {};
      const walkId = ctx.session.editWalkId;

      if (!walkId) {
        console.error("ID прогулки не найден!");
        ctx.reply("Ошибка: не удалось найти идентификатор прогулки", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Сохраняем ID в state
      ctx.wizard.state.walkId = walkId;

      ctx.reply(
        "Укажите новое место встречи:",
        Markup.inlineKeyboard([
          [{ text: "Отправить геолокацию 📍", callback_data: "send_location" }],
          [{ text: "Ввести текстом", callback_data: "enter_location_text" }],
          [{ text: "❌ Отмена", callback_data: "cancel" }],
        ])
      );

      return ctx.wizard.next();
    } catch (error) {
      console.error("Ошибка в шаге 1 редактирования места:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
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
        } else if (data === "send_location") {
          await ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
          ctx.wizard.state.waitingForLocation = true;
          return;
        } else if (data === "enter_location_text") {
          await ctx.reply("Опишите место встречи:", Markup.removeKeyboard());
          ctx.wizard.state.waitingForLocationText = true;
          return;
        }
      }

      // Обработка геолокации
      else if (
        ctx.message &&
        ctx.message.location &&
        ctx.wizard.state.waitingForLocation
      ) {
        // Получаем текущую информацию о прогулке для уведомления участников
        const walkDoc = await db.collection("walks").doc(walkId).get();
        if (!walkDoc.exists) {
          await ctx.reply("Прогулка не найдена", {
            reply_markup: getMainMenuKeyboard(),
          });
          return ctx.scene.leave();
        }

        const walkData = walkDoc.data();

        // Обновляем геолокацию в базе данных
        await db
          .collection("walks")
          .doc(walkId)
          .update({
            location: {
              latitude: ctx.message.location.latitude,
              longitude: ctx.message.location.longitude,
            },
            locationText: null,
          });

        // Отправляем уведомление участникам
        if (walkData.participants && walkData.participants.length > 0) {
          const message = `
  📢 Внимание! Организатор изменил место встречи:
  🗓 Дата и время: ${walkData.date}, ${walkData.time}
  📍 Место: Обновлена геолокация (проверьте детали прогулки)
  `;
          await notifyWalkParticipants(walkData.participants, message);
        }

        await ctx.reply("✅ Геолокация встречи успешно обновлена!", {
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
  (ctx) => {
    try {
      console.log("Шаг 1 редактирования типа");

      // Получаем ID из сессии
      if (!ctx.session) ctx.session = {};
      const walkId = ctx.session.editWalkId;

      if (!walkId) {
        console.error("ID прогулки не найден!");
        ctx.reply("Ошибка: не удалось найти идентификатор прогулки", {
          reply_markup: getMainMenuKeyboard(),
        });
        return ctx.scene.leave();
      }

      // Сохраняем ID в state
      ctx.wizard.state.walkId = walkId;

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
    } catch (error) {
      console.error("Ошибка в шаге 1 редактирования типа:", error);
      ctx.reply("Произошла ошибка", { reply_markup: getMainMenuKeyboard() });
      return ctx.scene.leave();
    }
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

// Функция для получения текстового представления возраста собаки
function getDogAgeText(age) {
  const ageObj = Object.values(DOG_AGES).find((a) => a.value === age);
  return ageObj ? ageObj.text.split(" ")[0] : "Взрослая";
}

function addCancelHandler(ctx) {
  if (
    (ctx.message && ctx.message.text === "❌ Отмена") ||
    (ctx.callbackQuery && ctx.callbackQuery.data === "cancel")
  ) {
    ctx.reply("Создание прогулки отменено", getMainMenuKeyboard());
    if (ctx.callbackQuery) {
      ctx.answerCbQuery(); // Подтверждаем callback-запрос
    }
    return ctx.scene.leave();
  }
  return false;
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
    ctx.reply("Привет! С возвращением в DogMeet 🐶", {
      reply_markup: getMainMenuKeyboard(),
    });
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

// Главное меню
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

// Добавьте эти обработчики перед bot.launch()

// Обработчики для главного меню
bot.action("find_walk", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Выберите фильтр:", {
    reply_markup: getWalkFiltersKeyboard(),
  });
});

bot.action("create_walk", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("createWalk");
});

bot.action("my_walks", async (ctx) => {
  await ctx.answerCbQuery();
  const walksSnapshot = await db
    .collection("walks")
    .where("organizer.id", "==", ctx.from.id)
    .get();

  if (walksSnapshot.empty) {
    ctx.reply("У вас пока нет созданных прогулок.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return;
  }

  await ctx.reply("Ваши созданные прогулки:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    },
  });

  // Показываем список прогулок
  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("my_participations", async (ctx) => {
  await ctx.answerCbQuery();

  // Находим прогулки, где пользователь участвует
  const walksSnapshot = await db.collection("walks").get();
  const participatingWalks = [];

  for (const walkDoc of walksSnapshot.docs) {
    const walk = walkDoc.data();
    if (
      walk.participants &&
      walk.participants.some((p) => p.id == ctx.from.id)
    ) {
      participatingWalks.push({ id: walkDoc.id, ...walk });
    }
  }

  if (participatingWalks.length === 0) {
    ctx.reply("Вы пока не присоединились ни к одной прогулке.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return;
  }

  await ctx.reply("Прогулки, к которым вы присоединились:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    },
  });

  // Показываем список прогулок
  for (const walk of participatingWalks) {
    const walkPreview = `
        🕒 ${walk.date}, ${walk.time}
        📍 ${walk.locationText || "По геолокации"}
        🐕 Участников: ${walk.participants.length + 1}
        👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
        ${walk.organizer.username ? "@" + walk.organizer.username : ""}
      `;

    await ctx.reply(walkPreview, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Подробнее", callback_data: `walk_details_${walk.id}` }],
        ],
      },
    });
  }
});

bot.action("my_profile", async (ctx) => {
  await ctx.answerCbQuery();
  await showProfile(ctx);
});

bot.action("back_to_main_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Главное меню", { reply_markup: getMainMenuKeyboard() });
});

// Редактирование профиля
bot.action("edit_profile_menu", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply("Что вы хотите изменить?", {
    reply_markup: {
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
    },
  });
});

// Обработчики фильтров прогулок
bot.action("walks_nearby", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Отправьте вашу текущую геолокацию для поиска ближайших прогулок",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    }
  );
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

  await ctx.reply("Прогулки на сегодня:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("walks_tomorrow", async (ctx) => {
  await ctx.answerCbQuery();

  const tomorrow = moment().add(1, "days").format("DD.MM.YYYY");
  const walksSnapshot = await db
    .collection("walks")
    .where("date", "==", tomorrow)
    .get();

  if (walksSnapshot.empty) {
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

  await ctx.reply("Прогулки на завтра:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
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

  await ctx.reply("Все прогулки:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
});

// Модифицированная функция showProfile
async function showProfile(ctx) {
  const userDoc = await db.collection("users").doc(String(ctx.from.id)).get();

  if (!userDoc.exists) {
    ctx.reply("Ваш профиль не найден. Пожалуйста, пройдите регистрацию.");
    return;
  }

  const userData = userDoc.data();

  const profileText = `
    👤 Имя: ${userData.name} ${ctx.from.username ? "@" + ctx.from.username : ""}
    📍 Город: ${userData.city}
    🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
    `;

  // Сначала отправляем информацию о профиле
  if (userData.dog.photoId) {
    await ctx.replyWithPhoto(userData.dog.photoId, {
      caption: profileText,
    });
  } else {
    await ctx.reply(profileText);
  }

  // Отправляем кнопки
  await ctx.reply("Выберите действие:", {
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
}

// Функция отображения списка прогулок
async function showWalksList(ctx, walkDocs) {
  for (const walkDoc of walkDocs) {
    const walk = walkDoc.data();

    const walkPreview = `
    🕒 ${walk.date}, ${walk.time}
    📍 ${walk.locationText || "По геолокации"}
    🐕 Участников: ${walk.participants.length + 1}
    👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
    ${walk.organizer.username ? "@" + walk.organizer.username : ""}
    `;

    await ctx.reply(
      walkPreview,
      Markup.inlineKeyboard([
        [Markup.button.callback("Подробнее", `walk_details_${walkDoc.id}`)],
      ])
    );
  }
}

async function notifyWalkParticipants(participants, message) {
  if (!participants || participants.length === 0) return;

  for (const participant of participants) {
    try {
      await bot.telegram.sendMessage(participant.id, message);
    } catch (error) {
      console.error(
        `Ошибка при отправке уведомления участнику ${participant.id}:`,
        error
      );
    }
  }
}

// Обработка просмотра деталей прогулки
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

    // Формируем детальную информацию о прогулке
    let walkDetails = `
  🗓 Прогулка: ${walk.date}, ${walk.time}
  📍 Место: ${walk.locationText || "По геолокации"}
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
      username: ctx.from.username,
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
  `
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
        `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} покинул вашу прогулку.`
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
      await ctx.reply(
        "К сожалению, у организатора нет username в Telegram. Попробуйте оставить сообщение через бота.",
        { reply_markup: getMainMenuKeyboard() }
      );

      // Опционально: можно реализовать систему сообщений через бота
      try {
        await bot.telegram.sendMessage(
          walk.organizer.id,
          `Участник ${ctx.from.username ? "@" + ctx.from.username : ctx.from.id} хочет связаться с вами по поводу прогулки ${walk.date}, ${walk.time}.`
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
// Функция для напоминания о предстоящих прогулках и удаления прошедших
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
      await db.collection("walks").doc(walkId).delete();
      console.log(
        `Прогулка ${walkId} автоматически удалена (прошла более часа назад)`
      );
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
        await bot.telegram.sendMessage(walk.organizer.id, reminderText);

        // Уведомляем всех участников
        for (const participant of walk.participants) {
          await bot.telegram.sendMessage(participant.id, reminderText);
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
  await ctx.reply("Выберите фильтр:", {
    reply_markup: getWalkFiltersKeyboard(),
  });
});

bot.action("create_walk", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.enter("createWalk");
});

bot.action("edit_name", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editName");
});

bot.action("edit_city", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editCity");
});

bot.action("edit_dog_name", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editDogName");
});

bot.action("edit_dog_breed", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editDogBreed");
});

bot.action("edit_dog_size", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editDogSize");
});

bot.action("edit_dog_age", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editDogAge");
});

bot.action("edit_dog_photo", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("editDogPhoto");
});

bot.action("my_walks", async (ctx) => {
  await ctx.answerCbQuery();
  const walksSnapshot = await db
    .collection("walks")
    .where("organizer.id", "==", ctx.from.id)
    .get();

  if (walksSnapshot.empty) {
    ctx.reply("У вас пока нет созданных прогулок.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return;
  }

  await ctx.reply("Ваши созданные прогулки:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    },
  });

  // Показываем список прогулок
  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("my_participations", async (ctx) => {
  await ctx.answerCbQuery();

  // Находим прогулки, где пользователь участвует
  const walksSnapshot = await db.collection("walks").get();
  const participatingWalks = [];

  for (const walkDoc of walksSnapshot.docs) {
    const walk = walkDoc.data();
    if (
      walk.participants &&
      walk.participants.some((p) => p.id == ctx.from.id)
    ) {
      participatingWalks.push({ id: walkDoc.id, ...walk });
    }
  }

  if (participatingWalks.length === 0) {
    ctx.reply("Вы пока не присоединились ни к одной прогулке.", {
      reply_markup: getMainMenuKeyboard(),
    });
    return;
  }

  await ctx.reply("Прогулки, к которым вы присоединились:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Назад", callback_data: "back_to_main_menu" }],
      ],
    },
  });

  // Показываем список прогулок
  for (const walk of participatingWalks) {
    const walkPreview = `
        🕒 ${walk.date}, ${walk.time}
        📍 ${walk.locationText || "По геолокации"}
        🐕 Участников: ${walk.participants.length + 1}
        👤 ${walk.dog.name} (${walk.organizer.name}) ${getDogAgeText(walk.dog.age)}
        ${walk.organizer.username ? "@" + walk.organizer.username : ""}
      `;

    await ctx.reply(walkPreview, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Подробнее", callback_data: `walk_details_${walk.id}` }],
        ],
      },
    });
  }
});

// Обработчики кнопок выбора размера собаки
bot.action("size_small", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.size": "small",
    });
    await ctx.reply("✅ Размер собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении размера собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("size_medium", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.size": "medium",
    });
    await ctx.reply("✅ Размер собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении размера собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("size_large", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.size": "large",
    });
    await ctx.reply("✅ Размер собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении размера собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

// Обработчики кнопок выбора возраста собаки
bot.action("age_puppy", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.age": "puppy",
    });
    await ctx.reply("✅ Возраст собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении возраста собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("age_young", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.age": "young",
    });
    await ctx.reply("✅ Возраст собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении возраста собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("age_adult", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.age": "adult",
    });
    await ctx.reply("✅ Возраст собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении возраста собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
  }
});

bot.action("age_senior", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await db.collection("users").doc(String(ctx.from.id)).update({
      "dog.age": "senior",
    });
    await ctx.reply("✅ Возраст собаки успешно изменен!");
    return ctx.scene.enter("editProfileMenu");
  } catch (error) {
    console.error("Ошибка при обновлении возраста собаки:", error);
    await ctx.reply("Произошла ошибка. Попробуйте еще раз.");
    return ctx.scene.enter("editProfileMenu");
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
bot.action("type_regular", async (ctx) => {
  ctx.wizard.state.walkData.type = "regular";

  // Формируем текст превью
  const userData = ctx.wizard.state.userData;
  let previewText = `
    🗓 Прогулка: ${ctx.wizard.state.walkData.date}, ${ctx.wizard.state.walkData.time}
    📍 Место: ${ctx.wizard.state.walkData.locationText || "По геолокации"}
    🔄 Тип: Регулярная
    👤 Организатор: ${userData.name}
    🐕 Собака: ${userData.dog.name}, ${userData.dog.breed}, ${getDogSizeText(userData.dog.size)}, ${getDogAgeText(userData.dog.age)}
    `;

  // Удаляем обычную клавиатуру
  await ctx.reply("Превью прогулки:", Markup.removeKeyboard());

  // Отправляем превью с фото собаки (если есть) или без него
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

// Редактирование профиля
bot.action("edit_profile_menu", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.reply("Что вы хотите изменить?", {
    reply_markup: {
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
    },
  });
});

// Обработчики фильтров прогулок
bot.action("walks_nearby", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Отправьте вашу текущую геолокацию для поиска ближайших прогулок",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
      },
    }
  );
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
bot.action("send_location", (ctx) => {
  ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
});
bot.action("cancel_edit", (ctx) => {
  ctx.reply("Редактирование отменено", { reply_markup: getMainMenuKeyboard() });
  return ctx.scene.enter("editProfileMenu");
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

  await ctx.reply("Прогулки на сегодня:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("walks_tomorrow", async (ctx) => {
  await ctx.answerCbQuery();

  const tomorrow = moment().add(1, "days").format("DD.MM.YYYY");
  const walksSnapshot = await db
    .collection("walks")
    .where("date", "==", tomorrow)
    .get();

  if (walksSnapshot.empty) {
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

  await ctx.reply("Прогулки на завтра:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action(/city_(.+)/, (ctx) => {
  ctx.wizard.state.userData.city = ctx.match[1];
  ctx.reply("Как зовут вашу собаку?", Markup.removeKeyboard());
  return ctx.wizard.next();
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

  await ctx.reply("Все прогулки:", {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "find_walk" }]],
    },
  });

  await showWalksList(ctx, walksSnapshot.docs);
});

bot.action("send_location", (ctx) => {
  ctx.reply("Отправьте геолокацию:", Markup.removeKeyboard());
});
bot.action("enter_location_text", (ctx) => {
  ctx.reply("Опишите место встречи:", Markup.removeKeyboard());
  ctx.wizard.state.waitingForLocationText = true;
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
