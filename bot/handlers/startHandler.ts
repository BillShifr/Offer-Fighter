import { Markup } from "telegraf";
import { JobSearchContext } from "../types";

export function setupStartHandler(bot: any) {
    bot.start(async (ctx: JobSearchContext) => {
        const firstName = ctx.from?.first_name || "друг";
        const backendUrl = process.env.BACKEND_URL!;
        const authUrl = `${backendUrl}/auth/hh?telegramId=${ctx.from?.id}`;

        await ctx.replyWithMarkdownV2(
            `👋 *Привет, ${firstName}\\!*\\n\n` +
            `Для начала работы — авторизуйся через hh\\.ru:`,
            Markup.inlineKeyboard([
                Markup.button.url("🚀 Авторизоваться на hh.ru", authUrl)
            ])
        );
    });
}