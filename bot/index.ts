import { Markup, Scenes, session, Telegraf } from "telegraf";
import * as dotenv from "dotenv";
import axios from "axios";
import { JobSearchContext, JobSearchSession } from "./types";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
const BACKEND_URL = process.env.BACKEND_URL!;

const bot = new Telegraf<JobSearchContext>(BOT_TOKEN);
const { WizardScene, Stage } = Scenes;

bot.use(session());

/**
 * Type-guard для callbackQuery с data
 */
function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
}

// Вспомогательная функция для разбивки кнопок по рядам
function chunkButtons<T>(buttons: T[], perRow = 2): T[][] {
    const rows: T[][] = [];
    buttons.forEach((btn, idx) => {
        const rowIndex = Math.floor(idx / perRow);
        if (!rows[rowIndex]) rows[rowIndex] = [];
        rows[rowIndex].push(btn);
    });
    return rows;
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
            // hh api часто отдаёт { items: [...] }
            const resumes = res.data.items || [];

            if (!Array.isArray(resumes) || !resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            const buttons = resumes.map((r: any) =>
                Markup.button.callback(String(r.title || r.id), `select_resume_${r.id}`)
            );

            const keyboard = Markup.inlineKeyboard(chunkButtons(buttons, 2));

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

        // Далее показываем выбор стран (регионов верхнего уровня)
        try {
            const areasRes = await axios.get("https://api.hh.ru/areas");
            // areasRes.data — массив стран/регионов верхнего уровня
            const countries = areasRes.data;

            const buttons = countries.map((c: any) =>
                Markup.button.callback(c.name, `region_${c.id}`)
            );

            await ctx.reply(
                "Выберите страну или регион:",
                Markup.inlineKeyboard(chunkButtons(buttons, 2))
            );

            return ctx.wizard.next();
        } catch (e) {
            console.error("Ошибка получения регионов:", e);
            await ctx.reply("Не удалось получить список регионов. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 3 — выбор региона (callbackQuery)
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите регион кнопкой.");
            return;
        }

        const data = ctx.callbackQuery.data;
        if (!data.startsWith("region_")) {
            await ctx.reply("Пожалуйста, выберите регион кнопкой.");
            return;
        }

        const selectedRegionId = data.replace("region_", "");
        const session = ctx.session as JobSearchSession;
        session.region = selectedRegionId;

        await ctx.answerCbQuery();

        // Теперь нужно проверить, есть ли у выбранного региона дочерние области
        try {
            const areasRes = await axios.get(`https://api.hh.ru/areas/${selectedRegionId}`);
            const subAreas = areasRes.data.areas || [];

            if (subAreas.length > 0) {
                // Предложим выбрать область из дочерних регионов
                const buttons = subAreas.map((a: any) =>
                    Markup.button.callback(a.name, `subregion_${a.id}`)
                );
                await ctx.reply(
                    "Выберите область (если нет — нажмите кнопку 'Пропустить'):",
                    Markup.inlineKeyboard([
                        ...chunkButtons(buttons, 2),
                        [Markup.button.callback("Пропустить", "subregion_skip")],
                    ])
                );
                return ctx.wizard.next();
            } else {
                // Если нет дочерних, сразу к выбору графика работы
                return goToWorkScheduleStep(ctx);
            }
        } catch (e) {
            console.error("Ошибка получения подрегионов:", e);
            await ctx.reply("Не удалось получить список областей. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 4 — выбор подрегиона (callbackQuery)
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите область кнопкой или пропустите.");
            return;
        }

        const data = ctx.callbackQuery.data;
        if (data === "subregion_skip") {
            // Пропускаем выбор подрегиона
            await ctx.answerCbQuery();
            return goToWorkScheduleStep(ctx);
        }

        if (!data.startsWith("subregion_")) {
            await ctx.reply("Пожалуйста, выберите область кнопкой или пропустите.");
            return;
        }

        const selectedSubregionId = data.replace("subregion_", "");
        const session = ctx.session as JobSearchSession;
        session.subregion = selectedSubregionId;

        await ctx.answerCbQuery();

        return goToWorkScheduleStep(ctx);
    },

    // Шаг 5 — выбор графика работы (callbackQuery)
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите график работы кнопкой.");
            return;
        }

        const data = ctx.callbackQuery.data;
        if (!data.startsWith("schedule_")) {
            await ctx.reply("Пожалуйста, выберите график работы кнопкой.");
            return;
        }

        const selectedSchedule = data.replace("schedule_", "");
        const session = ctx.session as JobSearchSession;
        session.workSchedule = selectedSchedule;

        await ctx.answerCbQuery();

        // Далее — выбор типа занятости
        const employmentTypes = [
            { id: "full", label: "Полная занятость" },
            { id: "part", label: "Частичная занятость" },
            { id: "project", label: "Проектная работа" },
            { id: "volunteer", label: "Волонтёрство" },
            { id: "internship", label: "Стажировка" },
        ];
        const empButtons = employmentTypes.map((e) =>
            Markup.button.callback(e.label, `employment_${e.id}`)
        );
        await ctx.reply(
            "Выберите тип занятости:",
            Markup.inlineKeyboard(chunkButtons(empButtons, 2))
        );

        return ctx.wizard.next();
    },

    // Шаг 6 — выбор типа занятости (callbackQuery)
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите тип занятости кнопкой.");
            return;
        }

        const data = ctx.callbackQuery.data;
        if (!data.startsWith("employment_")) {
            await ctx.reply("Пожалуйста, выберите тип занятости кнопкой.");
            return;
        }

        const selectedEmployment = data.replace("employment_", "");
        const session = ctx.session as JobSearchSession;
        session.employmentType = selectedEmployment;

        await ctx.answerCbQuery();

        // Далее выбор профессиональной области — подгружаем из hh API
        try {
            const profAreasRes = await axios.get("https://api.hh.ru/professional_areas");
            const profAreas = profAreasRes.data;

            const buttons = profAreas.map((p: any) =>
                Markup.button.callback(p.name, `profarea_${p.id}`)
            );

            await ctx.reply(
                "Выберите профессиональную область:",
                Markup.inlineKeyboard(chunkButtons(buttons, 2))
            );

            return ctx.wizard.next();
        } catch (e) {
            console.error("Ошибка получения профессиональных областей:", e);
            await ctx.reply("Не удалось получить профессиональные области. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 7 — выбор профессиональной области (callbackQuery)
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите профессиональную область кнопкой.");
            return;
        }

        const data = ctx.callbackQuery.data;
        if (!data.startsWith("profarea_")) {
            await ctx.reply("Пожалуйста, выберите профессиональную область кнопкой.");
            return;
        }

        const selectedProfArea = data.replace("profarea_", "");
        const session = ctx.session as JobSearchSession;
        session.professionalArea = selectedProfArea;

        await ctx.answerCbQuery();

        await ctx.reply("Введите ключевые слова для поиска (через пробел или запятую):");
        return ctx.wizard.next();
    },

    // Шаг 8 — ключевые слова (ввод с клавиатуры)
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

    // Шаг 9 — сопроводительное письмо (ввод с клавиатуры) и поиск
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
                subregion: session.subregion,
                workSchedule: session.workSchedule,
                employmentType: session.employmentType,
                professionalArea: session.professionalArea,
                keywords: session.keywords,
                coverLetter: session.coverLetter,
            };

            const res = await axios.post(`${BACKEND_URL}/search`, payload);
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

// Вспомогательная функция, чтобы перейти к шагу выбора графика работы
async function goToWorkScheduleStep(ctx: any) {
    const schedules = [
        { id: "full_day", label: "Полный день" },
        { id: "shift", label: "Сменный график" },
        { id: "remote", label: "Удалённая работа" },
        { id: "flexible", label: "Гибкий график" },
    ];

    const buttons = schedules.map((s) =>
        Markup.button.callback(s.label, `schedule_${s.id}`)
    );

    await ctx.reply(
        "Выберите желаемый график работы:",
        Markup.inlineKeyboard(chunkButtons(buttons, 2))
    );

    return ctx.wizard.next();
}

const stage = new Stage<JobSearchContext>([jobSearchWizard]);
bot.use(stage.middleware());

// /start — выдаём ссылку на авторизацию
bot.start(async (ctx) => {
    const firstName = ctx.from?.first_name || "друг";
    const authUrl = `${BACKEND_URL}/auth/hh?telegramId=${ctx.from?.id}`;

    await ctx.replyWithMarkdownV2(
        `👋 *Привет, ${firstName}\\!*\\n\n` +
        `Для начала работы — авторизуйся через hh\\.ru:`,
        Markup.inlineKeyboard([Markup.button.url("🚀 Авторизоваться на hh.ru", authUrl)])
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
