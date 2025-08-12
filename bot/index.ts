import {Markup, Scenes, session, Telegraf} from "telegraf";
import * as dotenv from "dotenv";
import axios from "axios";
import {JobSearchContext, JobSearchSession} from "./types";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
const BACKEND_URL = process.env.BACKEND_URL!;

const bot = new Telegraf<JobSearchContext>(BOT_TOKEN);
const {WizardScene, Stage} = Scenes;

bot.use(session());

// Type-guard для callbackQuery с data
function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
}

// Утилита для построения inline клавиатуры по 2 кнопки в ряд
function buildKeyboardButtons(items: any[], cbPrefix: string) {
    const buttons = items.map((item: any) =>
        Markup.button.callback(item.name || item.title || item.id, `${cbPrefix}${item.id}`)
    );
    return Markup.inlineKeyboard(
        buttons.reduce((acc: any[], btn: any, idx: number) => {
            const i = Math.floor(idx / 2);
            if (!acc[i]) acc[i] = [];
            acc[i].push(btn);
            return acc;
        }, [])
    );
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
            const resumes = res.data.items || [];

            if (!Array.isArray(resumes) || !resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            const keyboard = buildKeyboardButtons(resumes, "select_resume_");
            await ctx.reply("Выберите резюме:", {reply_markup: keyboard.reply_markup});
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
            // Возьмём страны (id 113 — Россия, но можем показать все)
            const countries = regionsRes.data.filter((r: any) => r.type === "country");
            const keyboard = buildKeyboardButtons(countries, "select_region_");
            await ctx.reply("Выберите страну / регион:", {reply_markup: keyboard.reply_markup});
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

        // Для выбранного региона можно показать дочерние области (если есть)
        try {
            const regionsRes = await axios.get("https://api.hh.ru/areas");

            // Найдём выбранный регион
            function findRegion(arr: any[], id: string): any | null {
                for (const r of arr) {
                    if (String(r.id) === id) return r;
                    if (r.areas) {
                        const found = findRegion(r.areas, id);
                        if (found) return found;
                    }
                }
                return null;
            }

            const selectedRegion = findRegion(regionsRes.data, regionId);
            if (selectedRegion && selectedRegion.areas && selectedRegion.areas.length) {
                // Есть дочерние области — показываем их кнопками
                const keyboard = buildKeyboardButtons(selectedRegion.areas, "select_subregion_");
                await ctx.reply("Выберите область:", {reply_markup: keyboard.reply_markup});
                return ctx.wizard.next();
            } else {
                // Нет дочерних областей — пропускаем шаг выбора области
                return ctx.wizard.steps[4](ctx); // Перейти к шагу 4 (график работы)
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
        session.region = subregionId; // Обновляем регион на более точный

        await ctx.answerCbQuery();

        return ctx.wizard.next(); // идём к шагу 5 (график работы)
    },

    // Шаг 5 — выбор графика работы (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_schedule_")) {
            // Запрашиваем и показываем кнопки графика работы
            try {
                const scheduleRes = await axios.get("https://api.hh.ru/schedules");
                const schedules = scheduleRes.data || [];
                const keyboard = buildKeyboardButtons(schedules, "select_schedule_");
                await ctx.reply("Выберите желаемый график работы:", {reply_markup: keyboard.reply_markup});
            } catch (err) {
                console.error("Ошибка получения графиков работы:", err);
                await ctx.reply("Ошибка при получении графиков работы. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const scheduleId = cb.data.replace("select_schedule_", "");
        const session = ctx.session as JobSearchSession;
        session.workSchedule = scheduleId;

        await ctx.answerCbQuery();

        return ctx.wizard.next(); // Шаг 6 — тип занятости
    },

    // Шаг 6 — выбор типа занятости (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_employment_")) {
            // Запрашиваем и показываем кнопки типов занятости
            try {
                const empRes = await axios.get("https://api.hh.ru/employments");
                const employments = empRes.data || [];
                const keyboard = buildKeyboardButtons(employments, "select_employment_");
                await ctx.reply("Выберите тип занятости:", {reply_markup: keyboard.reply_markup});
            } catch (err) {
                console.error("Ошибка получения типов занятости:", err);
                await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const employmentId = cb.data.replace("select_employment_", "");
        const session = ctx.session as JobSearchSession;
        session.employmentType = employmentId;

        await ctx.answerCbQuery();

        return ctx.wizard.next(); // Шаг 7 — профессиональная область
    },

    // Шаг 7 — выбор профессиональной области (callbackQuery)
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_profarea_")) {
            // Запрашиваем и показываем кнопки профобластей
            try {
                const profRes = await axios.get("https://api.hh.ru/professional_areas");
                const profAreas = profRes.data || [];
                const keyboard = buildKeyboardButtons(profAreas, "select_profarea_");
                await ctx.reply("Выберите профессиональную область:", {reply_markup: keyboard.reply_markup});
            } catch (err) {
                console.error("Ошибка получения профобластей:", err);
                await ctx.reply("Ошибка при получении профессиональных областей. Попробуйте позже.");
                return ctx.scene.leave();
            }
            return;
        }

        const profAreaId = cb.data.replace("select_profarea_", "");
        const session = ctx.session as JobSearchSession;
        session.professionalArea = profAreaId;

        await ctx.answerCbQuery();

        await ctx.reply("Введите ключевые слова для поиска (через пробел):");
        return ctx.wizard.next(); // Шаг 8 — ключевые слова (текст)
    },

    // Шаг 8 — ключевые слова (текст)
    async (ctx) => {
        if (!ctx.message || typeof (ctx.message as any).text !== "string") {
            await ctx.reply("Пожалуйста, введите ключевые слова.");
            return;
        }
        const session = ctx.session as JobSearchSession;
        session.keywords = (ctx.message as any).text.trim();

        await ctx.reply("Введите сопроводительное письмо:");
        return ctx.wizard.next();
    },

    // Шаг 9 — сопроводительное письмо и поиск
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        session.coverLetter = ctx.message.text.trim();

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

            const res = await axios.post(`${process.env.BACKEND_URL}/search`, payload);
            const vacancies = res.data;

            if (!vacancies.length) {
                await ctx.reply("Вакансий не найдено.");
            } else {
                for (const v of vacancies) {
                    await ctx.replyWithMarkdown(
                        `*${v.position}*\n${v.company}\n${v.location}\n[Ссылка](${v.url})`
                    );
                }
            }
        } catch (e) {
            console.error(e);
            await ctx.reply("Ошибка при поиске вакансий.");
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
        {reply_markup: Markup.inlineKeyboard([Markup.button.url("🚀 Авторизоваться на hh.ru", authUrl)]).reply_markup}
    );
});

// бэкенд отправляет пользователю уведомление с кнопкой (callback "start_search").
// Обработчик запускает сцену
bot.action("start_search", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("✅ Авторизация подтверждена. Начинаем подбор вакансий...");
    return ctx.scene.enter("job-search-wizard");
});

bot.command("search", (ctx) => ctx.scene.enter("job-search-wizard"));

bot.launch().then(() => console.log("Bot started")).catch(console.error);
