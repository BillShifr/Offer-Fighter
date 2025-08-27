// bot/index.ts
import { Scenes, Markup } from "telegraf";
import axios from "axios";

type JobSearchSession = Partial<{
    selectedResumeId: string;
    region: string;
    workSchedule: string;
    employmentType: string;
    professionalArea: string;
    keywords: string;
    coverLetter?: string;
}>;

type JobSearchContext = Scenes.WizardContext & {
    session: JobSearchSession;
    from?: { id?: number };
};

type Vacancy = {
    name: string;
    employer?: { name?: string };
    salary?: any;
    area?: { name?: string };
    published_at?: string;
    alternate_url?: string;
    url?: string;
};

// --- Вспомогательные функции (самодостаточные, чтоб файл работал один) ---

/**
 * Формирует Markup.inlineKeyboard из массива элементов.
 * Каждый элемент может иметь поля: id, name, title. Если передан просто массив строк - тоже поддерживается.
 * Префикс добавляется к callback_data автоматически.
 */
function buildKeyboardButtons(
    items: any[],
    prefix = "",
    columns = 1,
    extraButtons: Array<{ text: string; data: string }> = []
) {
    // нормализуем элементы в { text, data }
    const normalized = items.map((it) => {
        if (typeof it === "string" || typeof it === "number") {
            return { text: String(it), data: String(it) };
        }
        const id = it.id ?? it.code ?? it.value ?? it.key ?? it.name ?? it.title ?? JSON.stringify(it);
        const text = it.name ?? it.title ?? String(id);
        return { text, data: String(id) };
    });

    // нормализуем extra кнопки: добавим префикс к data, если нужно
    const extra = (extraButtons || []).map((b) => ({ text: b.text, data: String(b.data) }));

    const all = [...normalized, ...extra];

    // создаем ряды по columns
    const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
    for (let i = 0; i < all.length; i += columns) {
        const slice = all.slice(i, i + columns).map((x) =>
            // добавляем префикс к callback_data, если он ещё не там
            Markup.button.callback(x.text, prefix && !String(x.data).startsWith(prefix) ? `${prefix}${x.data}` : x.data)
        );
        rows.push(slice);
    }

    return Markup.inlineKeyboard(rows);
}

function formatSalary(salary: any) {
    if (!salary) return "Не указана";
    // простая строковая обработка: hh API может возвращать {from, to, currency}
    if (typeof salary === "string") return salary;
    if (salary.from || salary.to) {
        const from = salary.from ? String(salary.from) : "";
        const to = salary.to ? String(salary.to) : "";
        const cur = salary.currency ? ` ${salary.currency}` : "";
        if (from && to) return `${from} — ${to}${cur}`;
        if (from) return `от ${from}${cur}`;
        if (to) return `до ${to}${cur}`;
    }
    return "Не указана";
}

// Type-guard для callbackQuery с data
function hasCallbackData(q: any): q is { data: string } {
    return !!q && typeof q === "object" && "data" in q && typeof q.data === "string";
}

const { WizardScene } = Scenes;

// --- Сам сцен-волшебник ---
export const jobSearchWizard = new WizardScene<JobSearchContext>(
    "job-search-wizard",

    // Шаг 1 — получить резюме
    async (ctx) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) {
            await ctx.reply("Не удалось определить ваш Telegram ID.");
            return ctx.scene.leave();
        }

        try {
            const res = await axios.get(`${process.env.BACKEND_URL}/user/${telegramId}/resumes`);
            const resumes = res.data.items || res.data || [];

            if (!Array.isArray(resumes) || !resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            const keyboard = buildKeyboardButtons(resumes, "select_resume_", 1);
            await ctx.reply("Выберите резюме:", keyboard);
            return ctx.wizard.next();
        } catch (err) {
            console.error("Ошибка получения резюме:", err);
            await ctx.reply("Ошибка при получении резюме. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 2 — выбор резюме
    async (ctx) => {
        const cb = ctx.callbackQuery;
        // Если callback с правильным префиксом — обрабатываем
        if (hasCallbackData(cb) && cb.data.startsWith("select_resume_")) {
            const selectedResumeId = cb.data.replace("select_resume_", "");
            const session = ctx.session as JobSearchSession;
            session.selectedResumeId = selectedResumeId;

            await ctx.answerCbQuery().catch(() => {});
            try {
                const regionsRes = await axios.get("https://api.hh.ru/areas");
                const countries = regionsRes.data.filter((r: any) => !r.parent_id);

                const keyboard = buildKeyboardButtons(countries, "select_region_", 3);
                await ctx.reply("Выберите страну / регион:", keyboard);
                return ctx.wizard.next();
            } catch (err) {
                console.error("Ошибка получения регионов:", err);
                await ctx.reply("Ошибка при получении регионов. Попробуйте позже.");
                return ctx.scene.leave();
            }
        }

        // Иначе — попросим нажать кнопку (или просто игнорируем)
        await ctx.reply("Пожалуйста, выберите резюме нажатием на кнопку.");
        return;
    },

    // Шаг 3 — выбор региона
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (hasCallbackData(cb) && cb.data.startsWith("select_region_")) {
            const regionId = cb.data.replace("select_region_", "");
            const session = ctx.session as JobSearchSession;
            session.region = regionId;

            await ctx.answerCbQuery().catch(() => {});
            try {
                const regionsRes = await axios.get("https://api.hh.ru/areas");
                const region = regionsRes.data.find((r: any) => String(r.id) === regionId);

                if (region && region.areas && region.areas.length) {
                    const keyboard = buildKeyboardButtons(
                        region.areas,
                        "select_subregion_",
                        2,
                        [{ text: "🌍 Все регионы", data: "ALL" }]
                    );

                    await ctx.reply(
                        `Вы выбрали: ${region.name}\n\nХотите выбрать конкретную область или искать по всем регионам?`,
                        keyboard
                    );
                    return ctx.wizard.next();
                } else {
                    await ctx.reply("Регион выбран. Теперь выберите график работы.");
                    // переходим сразу на шаг 5 (indexing: шаги начинаются с 0, поэтому selectStep(4) — пятый шаг)
                    return ctx.wizard.selectStep(4);
                }
            } catch (err) {
                console.error("Ошибка получения областей:", err);
                await ctx.reply("Ошибка при получении областей. Попробуйте позже.");
                return ctx.scene.leave();
            }
        }

        await ctx.reply("Пожалуйста, выберите регион нажатием на кнопку.");
        return;
    },

    // Шаг 4 — выбор подрегиона
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (hasCallbackData(cb) && cb.data.startsWith("select_subregion_")) {
            const subregionId = cb.data.replace("select_subregion_", "");
            const session = ctx.session as JobSearchSession;

            if (subregionId === "ALL") {
                await ctx.answerCbQuery("Выбраны все регионы").catch(() => {});
                await ctx.reply("✅ Выбраны все регионы. Теперь выберите график работы.");
            } else {
                session.region = subregionId;
                await ctx.answerCbQuery().catch(() => {});
                await ctx.reply("Область выбрана. Теперь выберите график работы.");
            }

            return ctx.wizard.next();
        }

        await ctx.reply("Пожалуйста, выберите область нажатием на кнопку.");
        return;
    },

    // Шаг 5 — выбор графика работы
    async (ctx) => {
        const cb = ctx.callbackQuery;

        // Если пришёл callback именно от выбора графика — обрабатываем
        if (hasCallbackData(cb) && cb.data.startsWith("select_schedule_")) {
            const scheduleId = cb.data.replace("select_schedule_", "");
            const session = ctx.session as JobSearchSession;
            session.workSchedule = scheduleId === "ANY" ? undefined : scheduleId;

            await ctx.answerCbQuery().catch(() => {});
            await ctx.reply(
                scheduleId === "ANY"
                    ? "✅ График работы: не важно. Теперь выберите тип занятости."
                    : "✅ График выбран. Теперь выберите тип занятости."
            );
            return ctx.wizard.next();
        }

        // В противном случае — возможно остаточный callback от предыдущего шага: отвечаем и показываем клавиатуру
        if (cb) {
            await ctx.answerCbQuery().catch(() => {});
        }

        try {
            const scheduleRes = await axios.get("https://api.hh.ru/schedules");
            const schedules = scheduleRes.data || [];

            const keyboard = buildKeyboardButtons(
                schedules,
                "select_schedule_",
                2,
                [{ text: "❌ Не важно", data: "ANY" }]
            );

            await ctx.reply("Выберите желаемый график работы:", keyboard);
        } catch (err) {
            console.error("Ошибка получения графиков работы:", err);
            await ctx.reply("Ошибка при получении графиков работы. Попробуйте позже.");
            return ctx.scene.leave();
        }
        return;
    },

    // Шаг 6 — выбор типа занятости
    async (ctx) => {
        const cb = ctx.callbackQuery;
        // обработка выбора
        if (hasCallbackData(cb) && cb.data.startsWith("select_employment_")) {
            const employmentId = cb.data.replace("select_employment_", "");
            const session = ctx.session as JobSearchSession;
            session.employmentType = employmentId === "ANY" ? undefined : employmentId;

            await ctx.answerCbQuery().catch(() => {});
            await ctx.reply(
                employmentId === "ANY"
                    ? "✅ Тип занятости: не важно. Теперь выберите профессиональную область."
                    : "✅ Тип занятости выбран. Теперь выберите профессиональную область."
            );
            return ctx.wizard.next();
        }

        // показать клавиатуру (если не пришёл корректный callback)
        if (cb) await ctx.answerCbQuery().catch(() => {});

        try {
            const empRes = await axios.get("https://api.hh.ru/employments");
            const employments = empRes.data || [];

            const keyboard = buildKeyboardButtons(
                employments,
                "select_employment_",
                2,
                [{ text: "❌ Не важно", data: "ANY" }]
            );

            await ctx.reply("Выберите тип занятости:", keyboard);
        } catch (err) {
            console.error("Ошибка получения типов занятости:", err);
            await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
            return ctx.scene.leave();
        }
        return;
    },

    // Шаг 7 — выбор профессиональной области
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (hasCallbackData(cb) && cb.data.startsWith("select_profarea_")) {
            const profAreaId = cb.data.replace("select_profarea_", "");
            const session = ctx.session as JobSearchSession;
            session.professionalArea = profAreaId === "ANY" ? undefined : profAreaId;

            await ctx.answerCbQuery().catch(() => {});
            await ctx.reply(
                profAreaId === "ANY"
                    ? "✅ Профессиональная область: не важно. Теперь введите ключевые слова для поиска (через пробел):"
                    : "✅ Профессиональная область выбрана. Теперь введите ключевые слова для поиска (через пробел):"
            );
            return ctx.wizard.next();
        }

        if (cb) await ctx.answerCbQuery().catch(() => {});

        try {
            const profRes = await axios.get("https://api.hh.ru/professional_areas");
            const profAreas = profRes.data || [];

            const areaOptions = profAreas.flatMap((group: any) =>
                (group.categories || []).map((cat: any) => ({
                    id: cat.id,
                    name: cat.name,
                    title: cat.name,
                }))
            );

            const keyboard = buildKeyboardButtons(areaOptions, "select_profarea_", 1, [
                { text: "❌ Не важно", data: "ANY" },
            ]);

            await ctx.reply("Выберите профессиональную область:", keyboard);
        } catch (err) {
            console.error("Ошибка получения профобластей:", err);
            await ctx.reply("Ошибка при получении профессиональных областей. Попробуйте позже.");
            return ctx.scene.leave();
        }
        return;
    },

    // Шаг 8 — ключевые слова
    async (ctx) => {
        if (!ctx.message || typeof ctx.message !== "object" || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите ключевые слова.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        // @ts-ignore
        session.keywords = (ctx.message.text as string).trim();

        await ctx.reply("Введите сопроводительное письмо (или отправьте '-' чтобы пропустить):");
        return ctx.wizard.next();
    },

    // Шаг 9 — сопроводительное письмо и поиск
    async (ctx) => {
        if (!ctx.message || typeof ctx.message !== "object" || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо или отправьте '-'.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        // @ts-ignore
        const coverLetter = (ctx.message.text as string).trim();
        session.coverLetter = coverLetter === "-" ? undefined : coverLetter;

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

            await ctx.reply("🔍 Ищем подходящие вакансии...");

            const res = await axios.post<Vacancy[]>(`${process.env.BACKEND_URL}/search`, payload);
            const vacancies = Array.isArray(res.data) ? res.data : [];

            if (!vacancies.length) {
                await ctx.reply("😔 К сожалению, по вашим критериям вакансий не найдено.");
            } else {
                await ctx.reply(`✅ Найдено ${vacancies.length} вакансий. Показываю первые 10:`);

                for (const v of vacancies.slice(0, 10)) {
                    try {
                        await ctx.replyWithMarkdown(
                            `*${v.name}*\n` +
                            `🏢 Компания: ${v.employer?.name || "Не указано"}\n` +
                            `💰 Зарплата: ${formatSalary(v.salary)}\n` +
                            `📍 Регион: ${v.area?.name || "Не указан"}\n` +
                            `📅 Опубликовано: ${v.published_at ? new Date(v.published_at).toLocaleDateString() : "?"}`,
                            Markup.inlineKeyboard([Markup.button.url("🔗 Открыть вакансию", v.alternate_url || v.url || "#")])
                        );
                    } catch (e) {
                        console.error("Ошибка отправки вакансии:", e);
                        await ctx.reply("Не удалось отправить информацию о вакансии");
                    }
                    // лёгкая пауза, чтобы не флудить API Telegram
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }
        } catch (e) {
            console.error("Ошибка поиска:", e);
            await ctx.reply("😞 Произошла ошибка при поиске вакансий. Попробуйте позже.");
        }

        return ctx.scene.leave();
    }
);

export default jobSearchWizard;
