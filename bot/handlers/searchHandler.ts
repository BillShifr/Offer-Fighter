import { JobSearchContext } from "../types";

export function setupSearchHandler(bot: any) {
    // Обработчик для начала поиска
    bot.action("start_search", async (ctx: JobSearchContext) => {
        await ctx.answerCbQuery();
        await ctx.reply("✅ Авторизация подтверждена. Начинаем подбор вакансий...");
        return ctx.scene.enter("job-search-wizard");
    });

    bot.command("search", (ctx: JobSearchContext) => ctx.scene.enter("job-search-wizard"));
}