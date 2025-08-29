// bot/index.ts
import dotenv from "dotenv";
dotenv.config();

import { Telegraf, Scenes, session } from "telegraf";

import { jobSearchWizard } from "./scenes/jobSearchScene.js";
import { setupStartHandler } from "./handlers/startHandler.js";
import { setupHelpHandler } from "./handlers/helpHandler.js";
import { setupSearchHandler } from "./handlers/searchHandler.js";

// Проверка обязательных переменных окружения
const requiredEnvVars = ['BOT_TOKEN', 'BACKEND_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars);
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN!);

// сцены
const stage = new Scenes.Stage([jobSearchWizard]);
bot.use(session());
bot.use(stage.middleware());

// хэндлеры
setupStartHandler(bot);
setupHelpHandler(bot);
setupSearchHandler(bot);

// Обработчик ошибок сцены
bot.on('callback_query', async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        console.error('Error in callback query:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка. Попробуйте еще раз.');
    }
});

// Глобальный обработчик ошибкок
bot.catch((err, ctx) => {
    console.error(`Ошибка у ${ctx.from?.id}:`, err);
    ctx.reply("😞 Произошла ошибка, попробуйте позже.");
});

// Запуск
bot.launch().then(() => {
    console.log("🤖 Bot is running...");
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));