import { Markup, Scenes, session, Telegraf } from "telegraf";
import * as dotenv from "dotenv";
import axios from "axios";
import { JobSearchContext, JobSearchSession, Vacancy } from "./types";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
const BACKEND_URL = process.env.BACKEND_URL!;

const bot = new Telegraf<JobSearchContext>(BOT_TOKEN);
const { WizardScene, Stage } = Scenes;

bot.use(session());

// Type-guard для callbackQuery с data
function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
}

// Утилита для построения inline клавиатуры
function buildKeyboardButtons(
    items: any[],
    cbPrefix: string,
    columns = 2,
    additionalButtons: { text: string; data: string }[] = []
) {
    const buttons = items.map((item) =>
        Markup.button.callback(item.name || item.title || item.id, `${cbPrefix}${item.id}`)
    );

    // Добавляем дополнительные кнопки
    additionalButtons.forEach(btn => {
        buttons.unshift(Markup.button.callback(btn.text, `${cbPrefix}${btn.data}`));
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += columns) {
        rows.push(buttons.slice(i, i + columns));
    }

    return Markup.inlineKeyboard(rows);
}

// Форматирование зарплаты
function formatSalary(salary?: {
    from?: number;
    to?: number;
    currency?: string;
    gross?: boolean;
}): string {
    if (!salary) return "Не указана";

    const from = salary.from ? Math.round(salary.from).toLocaleString() : "?";
    const to = salary.to ? Math.round(salary.to).toLocaleString() : "?";
    const currency = salary.currency || "";
    const gross = salary.gross ? " (до вычета налогов)" : " (на руки)";

    return `${from}-${to} ${currency}${gross}`;
}

const jobSearchWizard = new WizardScene<JobSearchContext>(
    "job-search-wizard",

    // Шаг 1 — получить резюме
    async (ctx) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) {
            await ctx.reply("Не удалось определить ваш Telegram ID.");
            return ctx.scene.leave();
        }

        try {
            const res = await axios.get(`${BACKEND_URL}/user/${telegramId}/resumes`);
            const resumes = res.data.items || res.data || [];

            if (!Array.isArray(resumes) || !resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            const keyboard = buildKeyboardButtons(resumes, "select_resume_");
            await ctx.reply("Выберите резюме:", keyboard);
            return ctx.wizard.next();
        } catch (err) {
            console.error("Ошибка получения резюме:", err);
            await ctx.reply("Ошибка при получении резюме. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 2 — выбор резюме (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_resume_")) {
            await ctx.reply("Пожалуйста, выберите резюме нажатием на кнопку.");
            return;
        }

        const selectedResumeId = cb.data.replace("select_resume_", "");
        const session = ctx.session as JobSearchSession;
        session.selectedResumeId = selectedResumeId;

        await ctx.answerCbQuery();

        // Запрашиваем регионы с hh API
        try {
            const regionsRes = await axios.get("https://api.hh.ru/areas");
            const countries = regionsRes.data.filter((r: any) => !r.parent_id);

            const keyboard = buildKeyboardButtons(countries, "select_region_", 3);
            await ctx.reply("Выберите страну / регион:", keyboard);
            return ctx.wizard.next();
        } catch (err) {
            console.error("Ошибка получения регионов:", err);
            await ctx.reply("Ошибка при получении регионов. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 3 — выбор региона (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_region_")) {
            await ctx.reply("Пожалуйста, выберите регион нажатием на кнопку.");
            return;
        }

        const regionId = cb.data.replace("select_region_", "");
        const session = ctx.session as JobSearchSession;
        session.region = regionId;

        await ctx.answerCbQuery();

        try {
            const regionsRes = await axios.get("https://api.hh.ru/areas");
            const region = regionsRes.data.find((r: any) => String(r.id) === regionId);

            if (region && region.areas && region.areas.length) {
                // Добавляем кнопку "Все регионы" в начало
                const keyboard = buildKeyboardButtons(
                    region.areas,
                    "select_subregion_",
                    2,
                    [{ text: "🌍 Все регионы", data: "ALL" }]
                );

                await ctx.reply(
                    `Вы выбрали: ${region.name}\n\n` +
                    "Хотите выбрать конкретную область или искать по всем регионам?",
                    keyboard
                );
                return ctx.wizard.next();
            } else {
                // Нет подрегионов - переходим к следующему шагу
                await ctx.reply("Регион выбран. Теперь выберите график работы.");
                return ctx.wizard.selectStep(4);
            }
        } catch (err) {
            console.error("Ошибка получения областей:", err);
            await ctx.reply("Ошибка при получении областей. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 4 — выбор подрегиона (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_subregion_")) {
            await ctx.reply("Пожалуйста, выберите область нажатием на кнопку.");
            return;
        }

        const subregionId = cb.data.replace("select_subregion_", "");
        const session = ctx.session as JobSearchSession;

        if (subregionId === "ALL") {
            // Оставляем выбранный родительский регион
            await ctx.answerCbQuery("Выбраны все регионы");
            await ctx.reply("✅ Выбраны все регионы. Теперь выберите график работы.");
        } else {
            session.region = subregionId;
            await ctx.answerCbQuery();
            await ctx.reply("Область выбрана. Теперь выберите график работы.");
        }

        return ctx.wizard.next();
    },

    // Шаг 5 — выбор графика работы
    async (ctx) => {
        // Обработка первого входа на шаг
        if (!ctx.callbackQuery) {
            try {
                const scheduleRes = await axios.get("https://api.hh.ru/schedules");
                const schedules = scheduleRes.data || [];

                // Добавляем кнопку "Не важно"
                const scheduleOptions = schedules.map((s: any) => ({
                    ...s,
                    name: s.name || `График: ${s.id}`
                }));

                const keyboard = buildKeyboardButtons(
                    scheduleOptions,
                    "select_schedule_",
                    2,
                    [{ text: "❌ Не важно", data: "ANY" }]
                );

                await ctx.reply("Выберите желаемый график работы:", keyboard);
            } catch (err) {
                console.error("Ошибка получения графиков работы:", err);
                await ctx.reply("Ошибка при получении графиков работы. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_schedule_")) {
            await ctx.reply("Пожалуйста, выберите график работы нажатием на кнопку.");
            return;
        }

        const scheduleId = cb.data.replace("select_schedule_", "");
        const session = ctx.session as JobSearchSession;
        session.workSchedule = scheduleId === "ANY" ? undefined : scheduleId;

        await ctx.answerCbQuery();
        await ctx.reply(
            scheduleId === "ANY"
                ? "✅ График работы: не важно. Теперь выберите тип занятости."
                : "✅ График выбран. Теперь выберите тип занятости."
        );
        return ctx.wizard.next();
    },

    // Шаг 6 — выбор типа занятости
    async (ctx) => {
        // Обработка первого входа на шаг
        if (!ctx.callbackQuery) {
            try {
                const empRes = await axios.get("https://api.hh.ru/employments");
                const employments = empRes.data || [];

                // Добавляем кнопку "Не важно"
                const employmentOptions = employments.map((e: any) => ({
                    ...e,
                    name: e.name || `Тип: ${e.id}`
                }));

                const keyboard = buildKeyboardButtons(
                    employmentOptions,
                    "select_employment_",
                    2,
                    [{ text: "❌ Не важно", data: "ANY" }]
                );

                await ctx.reply("Выберите тип занятости:", keyboard);
            } catch (err) {
                console.error("Ошибка получения типов занятости:", err);
                await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_employment_")) {
            await ctx.reply("Пожалуйста, выберите тип занятости нажатием на кнопку.");
            return;
        }

        const employmentId = cb.data.replace("select_employment_", "");
        const session = ctx.session as JobSearchSession;
        session.employmentType = employmentId === "ANY" ? undefined : employmentId;

        await ctx.answerCbQuery();
        await ctx.reply(
            employmentId === "ANY"
                ? "✅ Тип занятости: не важно. Теперь выберите профессиональную область."
                : "✅ Тип занятости выбран. Теперь выберите профессиональную область."
        );
        return ctx.wizard.next();
    },

    // Шаг 7 — выбор профессиональной области
    async (ctx) => {
        // Обработка первого входа на шаг
        if (!ctx.callbackQuery) {
            try {
                const profRes = await axios.get("https://api.hh.ru/professional_areas");
                const profAreas = profRes.data || [];

                // Форматируем профобласти
                const areaOptions = profAreas.flatMap((group: any) =>
                    (group.categories || []).map((cat: any) => ({
                        id: cat.id,
                        name: cat.name,
                        title: cat.name
                    }))
                );

                // Добавляем кнопку "Не важно"
                const keyboard = buildKeyboardButtons(
                    areaOptions,
                    "select_profarea_",
                    1,
                    [{ text: "❌ Не важно", data: "ANY" }]
                );

                await ctx.reply("Выберите профессиональную область:", keyboard);
            } catch (err) {
                console.error("Ошибка получения профобластей:", err);
                await ctx.reply("Ошибка при получении профессиональных областей. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_profarea_")) {
            await ctx.reply("Пожалуйста, выберите профессиональную область нажатием на кнопку.");
            return;
        }

        const profAreaId = cb.data.replace("select_profarea_", "");
        const session = ctx.session as JobSearchSession;
        session.professionalArea = profAreaId === "ANY" ? undefined : profAreaId;

        await ctx.answerCbQuery();
        await ctx.reply(
            profAreaId === "ANY"
                ? "✅ Профессиональная область: не важно. Теперь введите ключевые слова для поиска (через пробел):"
                : "✅ Профессиональная область выбрана. Теперь введите ключевые слова для поиска (через пробел):"
        );
        return ctx.wizard.next();
    },

    // Шаг 8 — ключевые слова (текст)
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите ключевые слова.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        session.keywords = ctx.message.text.trim();

        await ctx.reply("Введите сопроводительное письмо (или отправьте '-' чтобы пропустить):");
        return ctx.wizard.next();
    },

    // Шаг 9 — сопроводительное письмо и поиск
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо или отправьте '-'.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        const coverLetter = ctx.message.text.trim();
        session.coverLetter = coverLetter === '-' ? undefined : coverLetter;

        try {
            const telegramId = ctx.from?.id;
            const payload = {
                telegramId,
                resumeId: session.selectedResumeId,
                region: session.region,
                workSchedule: session.workSchedule,
                employmentType: session.employmentType,
                professionalArea: session.professionalArea,
                keywords: session.keywords,
                coverLetter: session.coverLetter,
            };

            await ctx.reply("🔍 Ищем подходящие вакансии...");

            const res = await axios.post<Vacancy[]>(`${BACKEND_URL}/search`, payload);
            const data = res.data;
            const vacancies = Array.isArray(data) ? data : [];

            if (!vacancies.length) {
                await ctx.reply("😔 К сожалению, по вашим критериям вакансий не найдено.");
            } else {
                await ctx.reply(`✅ Найдено ${vacancies.length} вакансий. Показываю первые 10:`);

                for (const v of vacancies.slice(0, 10)) {
                    try {
                        await ctx.replyWithMarkdown(
                            `*${v.name}*\n` +
                            `🏢 Компания: ${v.employer?.name || "Не указано"}\n` +
                            `💰 Зарплата: ${formatSalary(v.salary)}\n` +
                            `📍 Регион: ${v.area?.name || "Не указан"}\n` +
                            `📅 Опубликовано: ${new Date(v.published_at).toLocaleDateString() || "Неизвестно"}`,
                            Markup.inlineKeyboard([
                                Markup.button.url("🔗 Открыть вакансию", v.alternate_url || v.url || "#")
                            ])
                        );
                    } catch (e) {
                        console.error("Ошибка отправки вакансии:", e);
                        await ctx.reply("Не удалось отправить информацию о вакансии");
                    }
                    await new Promise(resolve => setTimeout(resolve, 300)); // Задержка между сообщениями
                }
            }
        } catch (e) {
            console.error("Ошибка поиска:", e);
            await ctx.reply("😞 Произошла ошибка при поиске вакансий. Попробуйте позже.");
        }

        return ctx.scene.leave();
    }
);

const stage = new Stage<JobSearchContext>([jobSearchWizard]);
bot.use(stage.middleware());

// /start — выдаём ссылку на авторизацию
bot.start(async (ctx) => {
    const firstName = ctx.from?.first_name || "друг";
    const authUrl = `${BACKEND_URL}/auth/hh?telegramId=${ctx.from?.id}`;

    await ctx.replyWithMarkdownV2(
        `👋 *Привет, ${firstName}\\!*\\n\n` +
        `Для начала работы — авторизуйся через hh\\.ru:`,
        Markup.inlineKeyboard([
            Markup.button.url("🚀 Авторизоваться на hh.ru", authUrl)
        ])
    );
});

// Обработчик для начала поиска
bot.action("start_search", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("✅ Авторизация подтверждена. Начинаем подбор вакансий...");
    return ctx.scene.enter("job-search-wizard");
});

bot.command("search", (ctx) => ctx.scene.enter("job-search-wizard"));

bot.command("help", (ctx) => {
    return ctx.replyWithMarkdown(
        "🤖 *Помощь по боту:*\n\n" +
        "*/start* - Начать работу с ботом\n" +
        "*/search* - Начать новый поиск вакансий\n" +
        "*/help* - Показать это сообщение\n\n" +
        "После авторизации вы сможете искать вакансии по вашему резюме с HH.ru."
    );
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

bot.launch().then(() => console.log("Bot started")).catch(console.error);