import {Markup, Scenes} from "telegraf";
import axios from "axios";
import {HHRegion, JobSearchContext, JobSearchSession} from "../types";
import {buildKeyboardButtons, getHHRegions, hasCallbackData} from "../utils/keyboardUtils.ts";
import {formatSalary} from "../utils/salaryUtils.ts";
import {applyToVacancy, getUserResumes, searchVacancies} from "../utils/apiUtils.ts";

export const jobSearchWizard = new Scenes.WizardScene<JobSearchContext>(
    "job-search-wizard",

    // Шаг 1 — получить резюме
    async (ctx) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) {
            await ctx.reply("Не удалось определить ваш Telegram ID.");
            return ctx.scene.leave();
        }

        try {
            const resumes = await getUserResumes(telegramId);

            if (!Array.isArray(resumes) || !resumes.length) {
                await ctx.reply("Резюме не найдено. Пожалуйста, авторизуйтесь через /start.");
                return ctx.scene.leave();
            }

            // Преобразуем резюме для отображения
            const resumeOptions = resumes.map(resume => ({
                id: resume.id,
                name: resume.title || `Резюме ${resume.id.substring(0, 8)}...`
            }));

            const keyboard = buildKeyboardButtons(resumeOptions, "select_resume_");
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
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_resume_")) {
            await ctx.reply("Пожалуйста, выберите резюме нажатием на кнопку.");
            return;
        }

        const selectedResumeId = cb.data.replace("select_resume_", "");
        const session = ctx.session as JobSearchSession;
        session.selectedResumeId = selectedResumeId;

        await ctx.answerCbQuery();

        try {
            const regions = await getHHRegions();
            const countries = regions.filter((r: any) => !r.parent_id);

            const keyboard = buildKeyboardButtons(countries, "select_region_", 3);
            await ctx.reply("Выберите страну / регион:", keyboard);
            return ctx.wizard.next();
        } catch (err) {
            console.error("Ошибка получения регионов:", err);
            await ctx.reply("Ошибка при получении регионов. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 3 — выбор региона
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_region_")) {
            await ctx.reply("Пожалуйста, выберите регион нажатием на кнопку.");
            return;
        }

        const regionId = cb.data.replace("select_region_", "");
        const session = ctx.session as JobSearchSession;
        session.region = regionId;

        await ctx.answerCbQuery();

        try {
            const regions = await getHHRegions();

            // Функция для поиска региона в дереве
            const findRegion = (items: HHRegion[], id: string): HHRegion | null => {
                for (const item of items) {
                    if (String(item.id) === id) return item;
                    if (item.areas) {
                        const found = findRegion(item.areas, id);
                        if (found) return found;
                    }
                }
                return null;
            };

            const region = findRegion(regions as any, regionId);

            if (!region) {
                await ctx.reply("Регион не найден. Пожалуйста, попробуйте снова.");
                return ctx.wizard.selectStep(2);
            }

            if (region.areas && region.areas.length > 0) {
                const keyboard = buildKeyboardButtons(
                    region.areas.map(a => ({
                        id: a.id,
                        name: a.name
                    })),
                    "select_subregion_",
                    2,
                    [{text: "🌍 Все регионы", data: "ALL"}]
                );

                await ctx.reply(
                    `Вы выбрали: ${region.name}\n\n` +
                    "Хотите выбрать конкретную область или искать по всем регионам?",
                    keyboard
                );
                return ctx.wizard.next();
            } else {
                await ctx.reply(`Регион "${region.name}" выбран. Теперь выберите график работы.`);
                return ctx.wizard.selectStep(4);
            }
        } catch (err) {
            console.error("Ошибка получения областей:", err);
            await ctx.reply("Ошибка при получении областей. Попробуйте позже.");
            return ctx.scene.leave();
        }
    },

    // Шаг 4 — выбор подрегиона и показ графиков работы
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || !cb.data.startsWith("select_subregion_")) {
            await ctx.reply("Пожалуйста, выберите область нажатием на кнопку.");
            return;
        }

        const subregionId = cb.data.replace("select_subregion_", "");
        const session = ctx.session as JobSearchSession;

        if (subregionId === "ALL") {
            await ctx.answerCbQuery("Выбраны все регионы");
            await ctx.reply("✅ Выбраны все регионы. Теперь выберите график работы.");
        } else {
            session.region = subregionId;
            await ctx.answerCbQuery();
            await ctx.reply("Область выбрана. Теперь выберите график работы.");
        }

        try {
            const response = await axios.get("https://api.hh.ru/dictionaries", {
                headers: {'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'}
            });
            const dictionaries = response.data;

            // Кнопки для графика работы
            const scheduleOptions = dictionaries.schedule.map((s: any) => ({
                id: s.id,
                name: s.name
            }));

            const keyboard = buildKeyboardButtons(scheduleOptions, "select_schedule_", 2, [
                {text: "❌ Не важно", data: "ANY"}
            ]);

            await ctx.reply("Выберите желаемый график работы:", keyboard);
        } catch (err) {
            console.error("Ошибка получения графиков работы:", err);
            await ctx.reply("Ошибка при получении графиков работы. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next();
    },

    // Шаг 5 — выбор графика работы и показ кнопок типа занятости
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!cb || !hasCallbackData(cb) || !cb.data.startsWith("select_schedule_")) {
            await ctx.reply("Пожалуйста, выберите график работы нажатием на кнопку.");
            return;
        }

        const scheduleId = cb.data.replace("select_schedule_", "");
        const session = ctx.session as JobSearchSession;
        session.workSchedule = scheduleId === "ANY" ? undefined : scheduleId;

        await ctx.answerCbQuery();
        await ctx.reply(
            scheduleId === "ANY"
                ? "✅ График работы: не важно. Теперь выберите тип занятости."
                : "✅ График выбран. Теперь выберите тип занятости."
        );

        // Показ кнопок типа занятости сразу после выбора графика
        try {
            const response = await axios.get("https://api.hh.ru/dictionaries", {
                headers: {'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'}
            });
            const dictionaries = response.data;

            const employmentOptions = dictionaries.employment.map((e: any) => ({
                id: e.id,
                name: e.name
            }));

            const keyboard = buildKeyboardButtons(employmentOptions, "select_employment_", 2, [
                {text: "❌ Не важно", data: "ANY"}
            ]);

            await ctx.reply("Выберите тип занятости:", keyboard);
        } catch (err) {
            console.error("Ошибка получения типов занятости:", err);
            await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next();
    },

    // Шаг 6 — выбор типа занятости и показ кнопок профобласти
    async (ctx) => {
        const cb = ctx.callbackQuery;

        if (!cb || !hasCallbackData(cb) || !cb.data.startsWith("select_employment_")) {
            await ctx.reply("Пожалуйста, выберите тип занятости нажатием на кнопку.");
            return;
        }

        const employmentId = cb.data.replace("select_employment_", "");
        const session = ctx.session as JobSearchSession;
        session.employmentType = employmentId === "ANY" ? undefined : employmentId;

        await ctx.answerCbQuery();
        await ctx.reply(
            employmentId === "ANY"
                ? "✅ Тип занятости: не важно. Теперь выберите профессиональную область."
                : "✅ Тип занятости выбран. Теперь выберите профессиональную область."
        );

        // сразу загружаем список профобластей
        try {
            const profRes = await axios.get("https://api.hh.ru/professional_roles", {
                headers: {'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'}
            });

            const categories = Array.isArray(profRes.data?.categories) ? profRes.data.categories : [];
            const allRoles: any[] = [];

            for (const category of categories) {
                if (Array.isArray(category.roles)) {
                    allRoles.push(...category.roles);
                }
            }

            if (!allRoles.length) {
                await ctx.reply("Профессиональные области не найдены.");
                return ctx.scene.leave();
            }

            // Создаем отдельную кнопку для "Информационные технологии" (ID: 1)
            const itRole = allRoles.find(role => role.id === "1");
            let areaOptions = [];

            // Добавляем IT как первую опцию, если найдена
            if (itRole) {
                areaOptions.push({
                    id: itRole.id,
                    name: itRole.name.length > 20 ? itRole.name.substring(0, 20) + "..." : itRole.name
                });
            }

            // Добавляем остальные роли (исключая IT, если она была добавлена)
            const otherRoles = itRole
                ? allRoles.filter(role => role.id !== "1").slice(0, 9)
                : allRoles.slice(0, 10);

            areaOptions = [
                ...areaOptions,
                ...otherRoles.map(role => ({
                    id: role.id,
                    name: role.name.length > 20 ? role.name.substring(0, 20) + "..." : role.name
                }))
            ];

            const keyboard = buildKeyboardButtons(areaOptions, "select_profarea_", 2, [
                {text: "❌ Не важнфывсфывсо", data: "ANY"}
            ]);

            await ctx.reply("Выберите профессиональную область:", keyboard);
        } catch (err) {
            console.error("Ошибка получения профессиональных областей:", err);
            await ctx.reply("Ошибка при получении профессиональных областей. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next(); // переходим на шаг 7 (обработка клика)
    },

    // Шаг 7 — обработка выбора профессиональной области
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!cb || !hasCallbackData(cb) || !cb.data.startsWith("select_profarea_")) {
            await ctx.reply("Пожалуйста, выберите профессиональную область нажатием на кнопку.");
            return;
        }

        const profAreaId = cb.data.replace("select_profarea_", "");
        const session = ctx.session as JobSearchSession;
        session.professionalArea = profAreaId === "ANY" ? undefined : profAreaId;

        await ctx.answerCbQuery();
        await ctx.reply(
            profAreaId === "ANY"
                ? "✅ Профессиональная область: не важно. Теперь введите ключевые слова для поиска (через пробел):"
                : "✅ Профессиональная область выбрана. Теперь введите ключевые слова для поиска (через пробел):"
        );

        return ctx.wizard.next();
    },

    // Шаг 8 — ключевые слова
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите ключевые слова.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        session.keywords = ctx.message.text.trim();

        await ctx.reply("Введите сопроводительное письмо (или отправьте '-' чтобы пропустить):");
        return ctx.wizard.next();
    },

// Шаг 9 — сопроводительное письмо
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо или отправьте '-'.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        const coverLetter = ctx.message.text.trim();
        session.coverLetter = coverLetter === '-' ? undefined : coverLetter;

        // Спрашиваем: показывать вакансии?
        await ctx.reply(
            "Хотите сразу посмотреть найденные вакансии?",
            Markup.inlineKeyboard([
                Markup.button.callback("Да ✅", "show_vacancies"),
                Markup.button.callback("Нет ❌", "skip_vacancies")
            ])
        );

        return ctx.wizard.next();
    },

    // Шаг 10 — обработка выбора показывать вакансии
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb)) {
            await ctx.reply("Пожалуйста, выберите опцию нажатием на кнопку.");
            return;
        }

        await ctx.answerCbQuery();
        const session = ctx.session as JobSearchSession;

        if (cb.data === "skip_vacancies") {
            await ctx.reply("Хорошо, поиск завершён без отображения вакансий.");
            return ctx.scene.leave();
        }

        try {
            // Подготовка payload для HH API
            const hhApiPayload = {
                text: session.keywords || "",
                area: parseInt(session.region) || 113,
                schedule: session.workSchedule || undefined,
                employment: session.employmentType || undefined,
                professional_role: session.professionalArea ? parseInt(session.professionalArea) : undefined,
                per_page: 20,
                page: 0
            };

            const vacancies = await searchVacancies(hhApiPayload);

            if (!vacancies.length) {
                await ctx.reply("😔 К сожалению, по вашим критериям вакансий не найдено.");
                return ctx.scene.leave();
            }

            await ctx.reply(`✅ Найдено ${vacancies.length} вакансий. Показываю первые 10:`);

            // Отправка вакансий
            for (const v of vacancies.slice(0, 1)) {
                const scheduleInfo = v.schedule ? `\n⏰ График: ${v.schedule.name}` : "";
                const employmentInfo = v.employment ? `\n👔 Тип занятости: ${v.employment.name}` : "";

                await ctx.replyWithMarkdown(
                    `*${v.name}*\n` +
                    `🏢 Компания: ${v.employer?.name || "Не указано"}\n` +
                    `💰 Зарплата: ${formatSalary(v.salary)}` +
                    scheduleInfo +
                    employmentInfo +
                    `\n📍 Регион: ${v.area?.name || "Не указан"}\n` +
                    `📅 Опубликовано: ${v.published_at ? new Date(v.published_at).toLocaleDateString() : "Неизвестно"}`,
                    Markup.inlineKeyboard([
                        Markup.button.url("🔗 Открыть вакансию", v.alternate_url || v.url || "#")
                    ])
                );

                await new Promise(resolve => setTimeout(resolve, 300));
            }

            // Кнопка откликнуться на все вакансии
            await ctx.reply(
                "Хотите откликнуться на все найденные вакансии сразу?",
                Markup.inlineKeyboard([
                    Markup.button.callback("Откликнуться 🚀", "apply_all")
                ])
            );

            // Сохраняем вакансии в сессии для массового отклика
            session.lastVacancies = vacancies.slice(0, 10);

        } catch (e) {
            console.error("Ошибка поиска вакансий:", e);
            await ctx.reply("😞 Произошла ошибка при поиске вакансий. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next();
    },

// Шаг 11 — массовый отклик
    async (ctx) => {
        const cb = ctx.callbackQuery;
        if (!hasCallbackData(cb) || cb.data !== "apply_all") {
            await ctx.reply("Поиск завершён.");
            return ctx.scene.leave();
        }

        await ctx.answerCbQuery();
        const session = ctx.session as JobSearchSession;

        // Проверяем вакансии
        if (!session.lastVacancies || !session.lastVacancies.length) {
            await ctx.reply("Нет вакансий для отклика.");
            return ctx.scene.leave();
        }

        // Проверяем resumeId и при необходимости подгружаем
        let resumeId = session.selectedResumeId;
        if (!resumeId) {
            try {
                const resumes = await getUserResumes(ctx.from.id);
                if (!resumes || !resumes.length) {
                    await ctx.reply("Резюме не найдено. Сначала выберите резюме через /start.");
                    return ctx.scene.leave();
                }
                resumeId = resumes[0].id; // берем первый доступный
                session.selectedResumeId = resumeId;
                console.log("Используем fallback resumeId:", resumeId);
            } catch (err) {
                console.error("Ошибка получения резюме для отклика:", err);
                await ctx.reply("Не удалось получить резюме. Попробуйте позже.");
                return ctx.scene.leave();
            }
        }

        await ctx.reply("🚀 Начинаю отклик на все вакансии...");
        let successCount = 0;
        let failCount = 0;

        for (const v of session.lastVacancies) {
            try {
                await applyToVacancy({
                    telegramId: ctx.from.id,
                    vacancyId: v.id,
                    resumeId,
                    coverLetter: session.coverLetter
                });
                successCount++;
                await ctx.reply(`✅ Отклик отправлен на: ${v.name}`);
            } catch (err: any) {
                failCount++;
                console.error("Ошибка отклика:", err);

                let errorMessage = `❌ Не удалось откликнуться на: ${v.name}`;
                if (err.message.includes("archived")) {
                    errorMessage += "\nВакансия архивирована";
                } else if (err.message.includes("token")) {
                    errorMessage += "\nПроблема с авторизацией";
                }

                await ctx.reply(errorMessage);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await ctx.reply(
            `📊 Результаты откликов:\n` +
            `✅ Успешно: ${successCount}\n` +
            `❌ Не удалось: ${failCount}\n\n` +
            `Все отклики завершены.`
        );

        return ctx.scene.leave();
    }
);