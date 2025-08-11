import { Telegraf, Markup, Scenes, session } from "telegraf";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Команда /start — приветствие и кнопка авторизации
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const authUrl = `${process.env.BACKEND_URL}/auth/hh?telegramId=${telegramId}`;

    await ctx.reply(
        `Привет, ${ctx.from.first_name}!\nДля начала работы авторизуйся на hh.ru:`,
        Markup.inlineKeyboard([
            Markup.button.url("Авторизоваться на hh.ru", authUrl),
        ])
    );
});

// Тестовая команда
bot.command("test", (ctx) => ctx.reply("Бот запущен и работает!"));

// Обработка ошибок
bot.catch((err, ctx) => {
    console.error(`Ошибка в боте для ${ctx.updateType}`, err);
});

bot.launch().then(() => console.log("Telegram bot started"));
