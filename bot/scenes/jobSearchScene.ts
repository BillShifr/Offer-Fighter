import {Markup, Scenes} from "telegraf";
import axios from "axios";
import {HHRegion, JobSearchContext, JobSearchSession} from "../types";
import {buildKeyboardButtons, getHHRegions, hasCallbackData} from "../utils/keyboardUtils.ts";
import {formatSalary} from "../utils/salaryUtils.ts";
import {getUserResumes, searchVacancies} from "../utils/apiUtils.ts";

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

// Шаг 4 — выбор подрегиона и получение графиков работы
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
            // Получаем все справочники из HH API
            const response = await axios.get("https://api.hh.ru/dictionaries", {
                headers: {
                    'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'
                }
            });

            const dictionaries = response.data;

            // Используем графики работы из словаря (schedule)
            const scheduleOptions = dictionaries.schedule.map((schedule: any) => ({
                id: schedule.id,
                name: schedule.name
            }));

            const keyboard = buildKeyboardButtons(
                scheduleOptions,
                "select_schedule_",
                2,
                [{text: "❌ Не важно", data: "ANY"}]
            );

            await ctx.reply("Выберите желаемый график работы:", keyboard);
        } catch (err) {
            console.error("Ошибка получения графиков работы:", err);
            await ctx.reply("Ошибка при получении графиков работы. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next();
    },

// Шаг 5 — обработка выбранного графика работы
    async (ctx) => {
        if (!ctx.callbackQuery || !hasCallbackData(ctx.callbackQuery)) {
            await ctx.reply("Пожалуйста, выберите график работы нажатием на кнопку.");
            return;
        }

        const cb = ctx.callbackQuery;

        if (cb.data.startsWith("select_schedule_")) {
            const scheduleId = cb.data.replace("select_schedule_", "");
            const session = ctx.session as JobSearchSession;
            session.workSchedule = scheduleId === "ANY" ? undefined : scheduleId;

            await ctx.answerCbQuery();
            await ctx.reply(
                scheduleId === "ANY"
                    ? "✅ График работы: не важно. Теперь выберите тип занятости."
                    : "✅ График выбран. Теперь выберите тип занятости."
            );

            return ctx.wizard.next();
        } else {
            await ctx.answerCbQuery();
            return;
        }
    },

// Шаг 6 — выбор типа занятости (исправленная версия)
    async (ctx) => {
        // Обрабатываем callback от выбора графика работы из предыдущего шага
        if (ctx.callbackQuery && hasCallbackData(ctx.callbackQuery)) {
            const cb = ctx.callbackQuery;

            if (cb.data.startsWith("select_schedule_")) {
                // Это callback от предыдущего шага (график работы)
                const scheduleId = cb.data.replace("select_schedule_", "");
                const session = ctx.session as JobSearchSession;
                session.workSchedule = scheduleId === "ANY" ? undefined : scheduleId;

                await ctx.answerCbQuery();
                await ctx.reply(
                    scheduleId === "ANY"
                        ? "✅ График работы: не важно. Теперь выберите тип занятости."
                        : "✅ График выбран. Теперь выберите тип занятости."
                );

                // После обработки callback от предыдущего шага показываем кнопки для типа занятости
                try {
                    const response = await axios.get("https://api.hh.ru/dictionaries", {
                        headers: {
                            'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'
                        }
                    });

                    const dictionaries = response.data;
                    const employmentOptions = dictionaries.employment.map((employment: any) => ({
                        id: employment.id,
                        name: employment.name
                    }));

                    const keyboard = buildKeyboardButtons(
                        employmentOptions,
                        "select_employment_",
                        2,
                        [{text: "❌ Не важно", data: "ANY"}]
                    );

                    await ctx.reply("Выберите тип занятости:", keyboard);
                    return; // Остаемся на этом же шаге для обработки выбора типа занятости
                } catch (err) {
                    console.error("Ошибка получения типов занятости:", err);
                    await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
                    return ctx.scene.leave();
                }
            } else if (cb.data.startsWith("select_employment_")) {
                // Это callback от выбора типа занятости
                const employmentId = cb.data.replace("select_employment_", "");
                const session = ctx.session as JobSearchSession;
                session.employmentType = employmentId === "ANY" ? undefined : employmentId;

                await ctx.answerCbQuery();
                await ctx.reply(
                    employmentId === "ANY"
                        ? "✅ Тип занятости: не важно. Теперь выберите профессиональную область."
                        : "✅ Тип занятости выбран. Теперь выберите профессиональную область."
                );
                return ctx.wizard.next();
            }
        }

        // Если это не callback или callback не опознан, просим выбрать тип занятости
        await ctx.reply("Пожалуйста, выберите тип занятости нажатием на кнопку.");
    },

// Шаг 7 — показ кнопок выбора типа занятости (по аналогии с шагом 4)
    async (ctx) => {
        try {
            // Получаем все справочники из HH API
            const response = await axios.get("https://api.hh.ru/dictionaries", {
                headers: {
                    'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'
                }
            });

            const dictionaries = response.data;

            // Используем типы занятости из словаря (employment)
            const employmentOptions = dictionaries.employment.map((employment: any) => ({
                id: employment.id,
                name: employment.name
            }));

            const keyboard = buildKeyboardButtons(
                employmentOptions,
                "select_employment_",
                2,
                [{text: "❌ Не важно", data: "ANY"}]
            );

            await ctx.reply("Выберите тип занятости:", keyboard);
        } catch (err) {
            console.error("Ошибка получения типов занятости:", err);
            await ctx.reply("Ошибка при получении типов занятости. Попробуйте позже.");
            return ctx.scene.leave();
        }

        return ctx.wizard.next();
    },

    // Шаг 7 — выбор профессиональной области
    async (ctx) => {
        // Обрабатываем callback от выбора проф. области
        if (ctx.callbackQuery && hasCallbackData(ctx.callbackQuery)) {
            const cb = ctx.callbackQuery;

            if (cb.data.startsWith("select_profarea_")) {
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
            }

            // Если callback не от проф. области, просто отвечаем и остаемся на этом шаге
            await ctx.answerCbQuery();
            return;
        }

        // Если нет callback (первый вход на шаг), показываем кнопки
        try {
            const profRes = await axios.get("https://api.hh.ru/professional_roles", {
                headers: {
                    'HH-User-Agent': 'HH-Bot/1.0 (vladislavtatyankin01@gmail.com)'
                }
            });
            const profRoles = profRes.data || [];

            const areaOptions = profRoles.map((role: any) => ({
                id: role.id,
                name: role.name
            }));

            const keyboard = buildKeyboardButtons(
                areaOptions,
                "select_profarea_",
                1,
                [{text: "❌ Не важно", data: "ANY"}]
            );

            await ctx.reply("Выберите профессиональную область:", keyboard);
        } catch (err) {
            console.error("Ошибка получения профессиональных областей:", err);
            await ctx.reply("Ошибка при получении профессиональных областей. Попробуйте позже.");
            return ctx.scene.leave();
        }
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

    // Шаг 9 — сопроводительное письмо и поиск
    async (ctx) => {
        if (!ctx.message || !("text" in ctx.message)) {
            await ctx.reply("Пожалуйста, введите сопроводительное письмо или отправьте '-'.");
            return;
        }

        const session = ctx.session as JobSearchSession;
        const coverLetter = ctx.message.text.trim();
        session.coverLetter = coverLetter === '-' ? undefined : coverLetter;

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
            const vacancies = await searchVacancies(payload);

            if (!vacancies.length) {
                await ctx.reply("😔 К сожалению, по вашим критериям вакансий не найдено.");
            } else {
                await ctx.reply(`✅ Найдено ${vacancies.length} вакансий. Показываю первые 10:`);

                for (const v of vacancies.slice(0, 10)) {
                    try {
                        // Добавляем информацию о графике работы и типе занятости в вывод
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
                    } catch (e) {
                        console.error("Ошибка отправки вакансии:", e);
                        await ctx.reply("Не удалось отправить информацию о вакансии");
                    }
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        } catch (e) {
            console.error("Ошибка поиска:", e);
            await ctx.reply("😞 Произошла ошибка при поиске вакансий. Попробуйте позже.");
        }

        return ctx.scene.leave();
    }
);