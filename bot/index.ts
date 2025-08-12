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

/**
 * Type-guard для callbackQuery с data
 */
function hasCallbackData(q: any): q is { data: string } {
    return q && typeof q === "object" && "data" in q && typeof q.data === "string";
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

            const buttons = resumes.map((r: any) =>
                Markup.button.callback(String(r.title || r.id), `select_resume_${r.id}`)
            );

            const keyboard = Markup.inlineKeyboard(
                buttons.reduce((acc: any[], btn: any, idx: number) => {
                    const i = Math.floor(idx / 2);
                    if (!acc[i]) acc[i] = [];
                    acc[i].push(btn);
                    return acc;
                }, [])
            );

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
        await ctx.reply("Введите регион или страну:");
        return ctx.wizard.next();
    },

    // Шаг 3 — регион
    async (ctx) => {
        if (!ctx.message || typeof (ctx.message as any).text !== "string") {
            await ctx.reply("Пожалуйста, введите текст региона/страны.");
            return;
        }
        const session = ctx.session as JobSearchSession;
        session.region = (ctx.message as any).text.trim();

        await ctx.reply("Введите желаемый график работы:");
        return ctx.wizard.next();
    },

    // Шаг 4 — график работы
    async (ctx) => {
        if (!ctx.message || typeof (ctx.message as any).text !== "string") {
            await ctx.reply("Пожалуйста, введите график работы.");
            return;
        }
        const session = ctx.session as JobSearchSession;
        session.workSchedule = (ctx.message as any).text.trim();

        await ctx.reply("Введите тип занятости:");
        return ctx.wizard.next();
    },

    // Шаг 5 — тип занятости
    async (ctx) => {
        if (!ctx.message || typeof (ctx.message as any).text !== "string") {
            await ctx.reply("Пожалуйста, введите тип занятости.");
            return;
        }
        const session = ctx.session as JobSearchSession;
        session.employmentType = (ctx.message as any).text.trim();

        await ctx.reply("Введите профессиональную область:");
        return ctx.wizard.next();
    },

    // Шаг 6 — проф. область
    async (ctx) => {
        if (!ctx.message || typeof (ctx.message as any).text !== "string") {
            await ctx.reply("Пожалуйста, введите профессиональную область.");
            return;
        }
        const session = ctx.session as JobSearchSession;
        session.professionalArea = (ctx.message as any).text.trim();

        await ctx.reply("Введите ключевые слова для поиска:");
        return ctx.wizard.next();
    },

    // Шаг 7 — ключевые слова
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

    // Шаг 8 — сопроводительное письмо и поиск
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
