import { Telegraf, Scenes, session, Markup } from "telegraf";
import dotenv from "dotenv";
import jobSearchWizard from "./index.js"; // твоя сцена

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN!);

// сцены
const stage = new Scenes.Stage([jobSearchWizard]);
bot.use(session());
bot.use(stage.middleware());

// приветствие
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const authUrl = `${process.env.BACKEND_URL}/auth/hh?telegramId=${telegramId}`;

    await ctx.reply(
        `👋 Привет, ${ctx.from.first_name}!\n\n🚀 Я помогу тебе найти работу мечты.\n` +
        `Чтобы начать, авторизуйся через hh.ru:`,
        Markup.inlineKeyboard([Markup.button.url("🔑 Авторизоваться", authUrl)])
    );
});

// запуск сценария
bot.command("search", (ctx) => ctx.scene.enter("job-search-wizard"));

// тестовая команда
bot.command("test", (ctx) => ctx.reply("✅ Бот работает!"));

// обработка ошибок
bot.catch((err, ctx) => {
    console.error(`Ошибка у пользователя ${ctx.from?.id}`, err);
});

// запуск
bot.launch().then(() => console.log("🤖 Telegram bot started"));
