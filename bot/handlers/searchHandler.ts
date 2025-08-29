import { JobSearchContext } from "../types";
import axios from "axios";

export function setupSearchHandler(bot: any) {
    // Обработчик для начала поиска
    bot.action("start_search", async (ctx: JobSearchContext) => {
        await ctx.answerCbQuery();

        // Проверяем статус авторизации
        try {
            const backendUrl = process.env.BACKEND_URL;
            const response = await axios.get(`${backendUrl}/user/${ctx.from?.id}/auth-status`);

            if (response.data.isAuthenticated) {
                await ctx.reply("✅ Авторизация подтверждена. Начинаем подбор вакансий...");
                return ctx.scene.enter("job-search-wizard");
            } else {
                await ctx.reply("❌ Требуется авторизация. Пожалуйста, используйте /start для авторизации.");
            }
        } catch (error) {
            console.error("Error checking auth status:", error);
            await ctx.reply("❌ Ошибка проверки авторизации. Попробуйте позже.");
        }
    });

    bot.command("search", async (ctx: JobSearchContext) => {
        // Проверяем статус авторизации
        try {
            const backendUrl = process.env.BACKEND_URL;
            const response = await axios.get(`${backendUrl}/user/${ctx.from?.id}/auth-status`);

            if (response.data.isAuthenticated) {
                return ctx.scene.enter("job-search-wizard");
            } else {
                await ctx.reply("❌ Требуется авторизация. Пожалуйста, используйте /start для авторизации.");
            }
        } catch (error) {
            console.error("Error checking auth status:", error);
            await ctx.reply("❌ Ошибка проверки авторизации. Попробуйте позже.");
        }
    });
}