import { JobSearchContext } from "../types";

export function setupHelpHandler(bot: any) {
    bot.command("help", (ctx: JobSearchContext) => {
        return ctx.replyWithMarkdown(
            "🤖 *Помощь по боту:*\n\n" +
            "*/start* - Начать работу с ботом\n" +
            "*/search* - Начать новый поиск вакансий\n" +
            "*/help* - Показать это сообщение\n\n" +
            "После авторизации вы сможете искать вакансии по вашему резюме с HH.ru."
        );
    });
}