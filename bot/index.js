import { Telegraf, Markup, Scenes, session } from "telegraf";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const { WizardScene, Stage } = Scenes;

bot.use(session());

// Шаги воркфлоу
const jobSearchWizard = new WizardScene(
    "job-search-wizard",

    // Шаг 1: Получить список резюме у пользователя (с backend)
    async (ctx) => {
        const telegramId = ctx.from.id;
        try {
            // Запрос на backend, чтобы получить список резюме
            const res = await axios.get(`${process.env.BACKEND_URL}/user/${telegramId}/resumes`);
            const resumes = res.data; // ожидаем массив, например [{id, title}, ...]

            if (!resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            // Формируем кнопки для выбора резюме
            const buttons = resumes.map(r =>
                Markup.button.callback(r.title, `select_resume_${r.id}`)
            );

            // Разбиваем кнопки по 2 в ряд
            const keyboard = Markup.inlineKeyboard(
                buttons.reduce((resultArray, item, index) => {
                    const chunkIndex = Math.floor(index/2);

                    if(!resultArray[chunkIndex]) {
                        resultArray[chunkIndex] = [];
                    }

                    resultArray[chunkIndex].push(item);
                    return resultArray;
                }, [])
            );

            await ctx.reply("Выберите резюме:", keyboard);

            return ctx.wizard.next();

        } catch (err) {
            console.error(err);
            await ctx.reply("Ошибка при получении резюме. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 2: Обработать выбор резюме
    async (ctx) => {
        if (!ctx.callbackQuery?.data?.startsWith("select_resume_")) {
            await ctx.reply("Пожалуйста, выберите резюме нажатием на кнопку.");
            return;
        }

        const selectedResumeId = ctx.callbackQuery.data.replace("select_resume_", "");
        ctx.session.selectedResumeId = selectedResumeId;

        await ctx.answerCbQuery(); // Убрать "часики" у кнопки
        await ctx.reply("Вы выбрали резюме. Теперь введите регион или страну:");
        return ctx.wizard.next();
    },

    // Шаг 3: Ввод региона
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите текст региона/страны.");
            return;
        }

        ctx.session.region = ctx.message.text.trim();
        await ctx.reply("Введите желаемый график работы (например, полный день, гибкий график):");
        return ctx.wizard.next();
    },

    // Шаг 4: Ввод графика работы
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите текст графика работы.");
            return;
        }

        ctx.session.workSchedule = ctx.message.text.trim();
        await ctx.reply("Введите тип занятости (например, полный рабочий день, частичная занятость):");
        return ctx.wizard.next();
    },

    // Шаг 5: Ввод типа занятости
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите тип занятости.");
            return;
        }

        ctx.session.employmentType = ctx.message.text.trim();
        await ctx.reply("Введите профессиональную область (например, IT, маркетинг):");
        return ctx.wizard.next();
    },

    // Шаг 6: Ввод профессиональной области
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите профессиональную область.");
            return;
        }

        ctx.session.professionalArea = ctx.message.text.trim();
        await ctx.reply("Введите ключевые слова для поиска (через пробел):");
        return ctx.wizard.next();
    },

    // Шаг 7: Ввод ключевых слов
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите ключевые слова.");
            return;
        }

        ctx.session.keywords = ctx.message.text.trim();
        await ctx.reply("Введите сопроводительное письмо:");
        return ctx.wizard.next();
    },

    // Шаг 8: Ввод сопроводительного письма и завершение
    async (ctx) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо.");
            return;
        }

        ctx.session.coverLetter = ctx.message.text.trim();

        // Все данные собраны — отправляем на backend для сохранения/поиска
        try {
            const telegramId = ctx.from.id;
            const payload = {
                telegramId,
                resumeId: ctx.session.selectedResumeId,
                region: ctx.session.region,
                workSchedule: ctx.session.workSchedule,
                employmentType: ctx.session.employmentType,
                professionalArea: ctx.session.professionalArea,
                keywords: ctx.session.keywords,
                coverLetter: ctx.session.coverLetter,
            };

            const res = await axios.post(`${process.env.BACKEND_URL}/search`, payload);
            const vacancies = res.data; // предположим массив вакансий

            if (!vacancies.length) {
                await ctx.reply("Вакансий не найдено по вашим параметрам.");
            } else {
                for (const v of vacancies) {
                    await ctx.replyWithMarkdown(
                        `*${v.position}*\n${v.company}\n${v.location}\n[Ссылка на вакансию](${v.url})`
                    );
                }
            }
        } catch (e) {
            console.error(e);
            await ctx.reply("Ошибка при поиске вакансий. Попробуйте позже.");
        }

        return ctx.scene.leave();
    }
);

const stage = new Stage([jobSearchWizard]);
bot.use(stage.middleware());

// Команда /start — приветствие и кнопка авторизации
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const authUrl = `${process.env.BACKEND_URL}/auth/hh?telegramId=${telegramId}`;

    await ctx.reply(
        `Привет, ${ctx.from.first_name}!\nДля начала работы авторизуйся на hh.ru:`,
        Markup.inlineKeyboard([Markup.button.url("Авторизоваться на hh.ru", authUrl)])
    );
});

// Команда для запуска поиска по шагам
bot.command("search", (ctx) => ctx.scene.enter("job-search-wizard"));

// Тестовая команда
bot.command("test", (ctx) => ctx.reply("Бот запущен и работает!"));

// Обработка ошибок
bot.catch((err, ctx) => {
    console.error(`Ошибка в боте для ${ctx.updateType}`, err);
});

bot.launch().then(() => console.log("Telegram bot started"));

bot.command('subscribe', async (ctx) => {
    const telegramId = ctx.from.id;

    try {
        const res = await axios.post(`${process.env.BACKEND_URL}/payment/create`, {
            telegramId,
            amount: 299, // цена подписки, например
        });

        const { paymentUrl } = res.data;
        await ctx.reply(`Для оформления подписки перейдите по ссылке:\n${paymentUrl}`);
    } catch (e) {
        console.error(e);
        await ctx.reply('Ошибка при создании платежа. Попробуйте позже.');
    }
});
