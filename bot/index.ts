// bot/index.ts
import dotenv from "dotenv";
dotenv.config();

import { Telegraf, Scenes, session } from "telegraf";

import { jobSearchWizard } from "./scenes/jobSearchScene.js";
import { setupStartHandler } from "./handlers/startHandler.js";
import { setupHelpHandler } from "./handlers/helpHandler.js";
import { setupSearchHandler } from "./handlers/searchHandler.js";

const bot = new Telegraf(process.env.BOT_TOKEN!);

// сцены
const stage = new Scenes.Stage([jobSearchWizard]);
bot.use(session());
bot.use(stage.middleware());

// хэндлеры
setupStartHandler(bot);
setupHelpHandler(bot);
setupSearchHandler(bot);

// глобальный обработчик ошибок
bot.catch((err, ctx) => {
    console.error(`Ошибка у ${ctx.from?.id}:`, err);
    ctx.reply("😞 Произошла ошибка, попробуйте позже.");
});

// запуск
bot.launch().then(() => {
    console.log("🤖 Bot is running...");
});
